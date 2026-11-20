import { Logger } from '@nestjs/common';
import type { z } from 'zod';
import { codeForStatus, NorthflankError } from './northflank.errors.js';
import {
  type NfAuthInfo,
  nfAuthInfoSchema,
  nfBuildsSchema,
  nfPatchServiceSchema,
  type NfPort,
  nfProjectsSchema,
  type NfService,
  nfServiceSchema,
  nfServicesSchema,
  nfStartBuildSchema,
} from './northflank.types.js';

/** Northflank IDs are slugs; anything else never reaches a URL path. */
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
function id(value: string): string {
  if (!ID.test(value)) throw new NorthflankError('NF_REQUEST_REJECTED');
  return value;
}
const MAX_PAGES = 10;

const TIMEOUT_MS = 10_000;
const MAX_GET_ATTEMPTS = 3;
/** Only auto-retry a 429 if Northflank asks us to wait this long or less. */
const MAX_AUTO_RETRY_WAIT_S = 5;

export interface NorthflankClientOptions {
  baseUrl: string;
  token: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Thin, typed wrapper over the Northflank REST API (D-10).
 * - Paths are fixed in code. Callers can never pass arbitrary URLs (no SSRF).
 * - Only GET requests are retried (network errors, 5xx, short 429s).
 * - The token and response bodies are never logged.
 */
export class NorthflankClient {
  private readonly logger = new Logger(NorthflankClient.name);
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: NorthflankClientOptions) {
    this.baseUrl = options.baseUrl.endsWith('/')
      ? options.baseUrl
      : `${options.baseUrl}/`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep =
      options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Verifies the token and returns its (non-secret) details. */
  async getAuthInfo(): Promise<NfAuthInfo> {
    return (await this.get('auth', nfAuthInfoSchema)).data;
  }

  /** All projects visible to the token (follows cursor pagination). */
  async listProjects() {
    return this.paginate('projects', nfProjectsSchema, (d) => d.data.projects);
  }

  async listServices(projectId: string) {
    return this.paginate(
      `projects/${id(projectId)}/services`,
      nfServicesSchema,
      (d) => d.data.services,
    );
  }

  async getService(projectId: string, serviceId: string): Promise<NfService> {
    return (
      await this.get(
        `projects/${id(projectId)}/services/${id(serviceId)}`,
        nfServiceSchema,
      )
    ).data;
  }

  /** Most recent builds (first page only). */
  async listBuilds(projectId: string, serviceId: string) {
    return (
      await this.get(
        `projects/${id(projectId)}/services/${id(serviceId)}/build?per_page=20`,
        nfBuildsSchema,
      )
    ).data.builds;
  }

  /** Never retried automatically (it is not idempotent). */
  async startBuild(
    projectId: string,
    serviceId: string,
    body: { branch?: string; sha?: string },
  ) {
    return (
      await this.request(
        'POST',
        `projects/${id(projectId)}/services/${id(serviceId)}/build`,
        nfStartBuildSchema,
        body,
      )
    ).data;
  }

  /**
   * Replaces the service's port list. Always send the COMPLETE list: the API
   * docs don't say whether `ports` merges or replaces, so a full list is
   * correct either way. Changing ports redeploys the service.
   */
  async setServicePorts(
    projectId: string,
    serviceId: string,
    serviceType: 'combined' | 'deployment',
    ports: NfPort[],
  ): Promise<void> {
    await this.request(
      'PATCH',
      `projects/${id(projectId)}/services/${serviceType}/${id(serviceId)}`,
      nfPatchServiceSchema,
      { ports },
    );
  }

  private async paginate<T extends z.ZodType, Item>(
    path: string,
    schema: T,
    items: (data: z.infer<T>) => Item[],
  ): Promise<Item[]> {
    const all: Item[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const qs = new URLSearchParams({ per_page: '100' });
      if (cursor) qs.set('cursor', cursor);
      const data = await this.get(`${path}?${qs}`, schema);
      all.push(...items(data));
      const p = (
        data as { pagination?: { hasNextPage: boolean; cursor?: string } }
      ).pagination;
      if (!p?.hasNextPage || !p.cursor) break;
      cursor = p.cursor;
    }
    return all;
  }

  private async get<T extends z.ZodType>(
    path: string,
    schema: T,
  ): Promise<z.infer<T>> {
    let lastError: NorthflankError | undefined;
    for (let attempt = 1; attempt <= MAX_GET_ATTEMPTS; attempt++) {
      try {
        return await this.request('GET', path, schema);
      } catch (error) {
        if (!(error instanceof NorthflankError)) throw error;
        lastError = error;
        const wait = this.retryDelayMs(error, attempt);
        if (wait === null || attempt === MAX_GET_ATTEMPTS) throw error;
        this.logger.warn(
          `GET ${path} failed with ${error.nfCode}; retry ${attempt}/${MAX_GET_ATTEMPTS - 1}`,
        );
        await this.sleep(wait);
      }
    }
    throw lastError ?? new NorthflankError('NF_UNAVAILABLE');
  }

  private retryDelayMs(error: NorthflankError, attempt: number): number | null {
    switch (error.nfCode) {
      case 'NF_UNAVAILABLE':
      case 'NF_NETWORK':
      case 'NF_TIMEOUT':
        return 500 * 2 ** (attempt - 1);
      case 'NF_RATE_LIMITED':
        return error.retryAfterSeconds !== undefined &&
          error.retryAfterSeconds <= MAX_AUTO_RETRY_WAIT_S
          ? error.retryAfterSeconds * 1000
          : null;
      default:
        return null;
    }
  }

  private async request<T extends z.ZodType>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    schema: T,
    body?: unknown,
  ): Promise<z.infer<T>> {
    let res: Response;
    try {
      res = await this.fetchImpl(new URL(path, this.baseUrl), {
        method,
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (error) {
      const name = (error as Error).name;
      throw new NorthflankError(
        name === 'TimeoutError' || name === 'AbortError'
          ? 'NF_TIMEOUT'
          : 'NF_NETWORK',
      );
    }

    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      const code = codeForStatus(res.status);
      throw new NorthflankError(
        code,
        code === 'NF_RATE_LIMITED' ? retryAfterSeconds(res) : undefined,
      );
    }

    const json: unknown = await res.json().catch(() => undefined);
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      this.logger.warn(`Unexpected response shape from ${method} ${path}`);
      throw new NorthflankError('NF_BAD_RESPONSE');
    }
    return parsed.data;
  }
}

/** Northflank sends `x-ratelimit-reset` (seconds); also honour `Retry-After`. */
function retryAfterSeconds(res: Response): number | undefined {
  for (const header of ['retry-after', 'x-ratelimit-reset']) {
    const raw = res.headers.get(header);
    if (raw === null || raw.trim() === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return Math.ceil(value);
  }
  return undefined;
}

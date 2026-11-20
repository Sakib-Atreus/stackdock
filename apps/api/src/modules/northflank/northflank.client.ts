import { Logger } from '@nestjs/common';
import type { z } from 'zod';
import { codeForStatus, NorthflankError } from './northflank.errors.js';
import { type NfAuthInfo, nfAuthInfoSchema } from './northflank.types.js';

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

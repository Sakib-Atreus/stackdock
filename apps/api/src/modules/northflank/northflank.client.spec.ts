import { NorthflankClient } from './northflank.client.js';
import { NorthflankError } from './northflank.errors.js';

const TOKEN = 'nf-secret-token-abcdef123456';
const AUTH_BODY = {
  data: {
    tokenKind: 'api',
    id: 'stackdock-token',
    name: 'StackDock',
    entityId: 'my-team',
    entityType: 'team',
    role: { name: 'Developer', roleId: 'developer' },
    createdAt: '2026-11-01T00:00:00.000Z',
    expiresAt: null,
  },
};

function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function client(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const sleep = vi.fn(async () => undefined);
  const c = new NorthflankClient({
    baseUrl: 'https://api.northflank.test/v1/',
    token: TOKEN,
    fetchImpl,
    sleep,
  });
  return { c, calls, sleep };
}

async function expectNfError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(NorthflankError);
  await promise.catch((e: NorthflankError) => expect(e.nfCode).toBe(code));
}

describe('NorthflankClient', () => {
  it('calls GET /v1/auth with a bearer token and parses the response', async () => {
    const { c, calls } = client([json(200, AUTH_BODY)]);
    const info = await c.getAuthInfo();
    expect(info).toMatchObject({ name: 'StackDock', entityId: 'my-team' });
    expect(calls[0]!.url).toBe('https://api.northflank.test/v1/auth');
    expect(calls[0]!.init.method).toBe('GET');
    expect(
      (calls[0]!.init.headers as Record<string, string>).Authorization,
    ).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]!.init.redirect).toBe('error');
  });

  it.each([
    [401, 'NF_UNAUTHORIZED'],
    [403, 'NF_FORBIDDEN'],
    [404, 'NF_NOT_FOUND'],
    [422, 'NF_REQUEST_REJECTED'],
  ])('maps HTTP %s to %s without retrying', async (status, code) => {
    const { c, calls } = client([json(status, { error: 'x' })]);
    await expectNfError(c.getAuthInfo(), code);
    expect(calls).toHaveLength(1);
  });

  it('retries GET on 5xx and then succeeds', async () => {
    const { c, calls, sleep } = client([
      json(502, {}),
      json(503, {}),
      json(200, AUTH_BODY),
    ]);
    await expect(c.getAuthInfo()).resolves.toBeDefined();
    expect(calls).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up after 3 attempts', async () => {
    const { c, calls } = client([json(500, {}), json(500, {}), json(500, {})]);
    await expectNfError(c.getAuthInfo(), 'NF_UNAVAILABLE');
    expect(calls).toHaveLength(3);
  });

  it('retries a 429 with a short reset time', async () => {
    const { c, sleep } = client([
      json(429, {}, { 'x-ratelimit-reset': '2' }),
      json(200, AUTH_BODY),
    ]);
    await c.getAuthInfo();
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('does not wait for a long 429; reports retryAfterSeconds', async () => {
    const { c, calls } = client([
      json(429, {}, { 'x-ratelimit-reset': '1800' }),
    ]);
    const error = await c.getAuthInfo().catch((e: NorthflankError) => e);
    expect(error).toBeInstanceOf(NorthflankError);
    expect((error as NorthflankError).retryAfterSeconds).toBe(1800);
    expect(calls).toHaveLength(1);
  });

  it('maps network failures and timeouts', async () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    const net = new TypeError('fetch failed');
    await expectNfError(
      client([timeout, timeout, timeout]).c.getAuthInfo(),
      'NF_TIMEOUT',
    );
    await expectNfError(client([net, net, net]).c.getAuthInfo(), 'NF_NETWORK');
  });

  it('rejects responses that do not match the schema', async () => {
    const { c } = client([json(200, { data: { unexpected: true } })]);
    await expectNfError(c.getAuthInfo(), 'NF_BAD_RESPONSE');
  });

  it('never includes the token or response body in error messages', async () => {
    const { c } = client([
      json(401, { error: { message: `bad token ${TOKEN}` } }),
    ]);
    const error = (await c.getAuthInfo().catch((e: unknown) => e)) as Error;
    expect(JSON.stringify(error)).not.toContain(TOKEN);
    expect(error.message).not.toContain(TOKEN);
  });
});

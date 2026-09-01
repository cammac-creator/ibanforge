import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IBANforge,
  IBANforgeError,
  AuthError,
  PaymentRequiredError,
  QuotaExhaustedError,
  RateLimitError,
  InvalidInputError,
  PayloadTooLargeError,
  APIError,
} from './index.js';

// ─── fetch mock helpers ──────────────────────────────────────────────────────

/** Build a minimal Response-like object the SDK's request() understands. */
function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // Since 1.4.3 the client falls back to the environment for both of these.
  // A developer machine (or a sibling test) that has them set would otherwise
  // silently change what every assertion below is measuring.
  vi.stubEnv('IBANFORGE_API_BASE', '');
  vi.stubEnv('IBANFORGE_API_KEY', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** The URL the SDK called on its Nth fetch (default: first call). */
function calledUrl(n = 0): string {
  return fetchMock.mock.calls[n][0] as string;
}
/** The RequestInit the SDK passed on its Nth fetch. */
function calledInit(n = 0): RequestInit {
  return fetchMock.mock.calls[n][1] as RequestInit;
}

describe('IBANforge — construction & base URL', () => {
  it('strips trailing slashes from a custom baseUrl', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ valid: true }));
    const sdk = new IBANforge({ baseUrl: 'https://example.test///' });
    await sdk.formatIban('CH9300762011623852957');
    expect(calledUrl()).toBe(
      'https://example.test/v1/iban/format?iban=CH9300762011623852957',
    );
  });

  it('defaults to the public production base URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ valid: true }));
    await new IBANforge().formatIban('CH93');
    expect(calledUrl()).toBe('https://api.ibanforge.com/v1/iban/format?iban=CH93');
  });

  it('falls back to IBANFORGE_API_BASE, and explicit config still wins', async () => {
    vi.stubEnv('IBANFORGE_API_BASE', 'http://127.0.0.1:3300');
    fetchMock.mockResolvedValue(jsonResponse({ valid: true }));

    await new IBANforge().formatIban('CH93');
    expect(calledUrl(0)).toBe('http://127.0.0.1:3300/v1/iban/format?iban=CH93');

    await new IBANforge({ baseUrl: 'https://staging.example.test' }).formatIban('CH93');
    expect(calledUrl(1)).toBe('https://staging.example.test/v1/iban/format?iban=CH93');
  });

  it('falls back to IBANFORGE_API_KEY for auth', async () => {
    vi.stubEnv('IBANFORGE_API_KEY', 'ifk_from_env');
    fetchMock.mockResolvedValue(jsonResponse({ valid: true }));
    await new IBANforge().validateIban('CH93');
    expect((calledInit().headers as Record<string, string>).Authorization).toBe('Bearer ifk_from_env');
  });
});

describe('package version', () => {
  /**
   * RELEASING.md asks for one number in six places, two of them in this
   * package: `package.json` and the `VERSION` the User-Agent is built from.
   * Bumping one and forgetting the other publishes a package that lies about
   * itself in every request log — and `npm ci` in CI refuses a lockfile whose
   * version disagrees with the manifest, which is the failure that has already
   * cost this repo two red pipelines.
   */
  const here = dirname(new URL(import.meta.url).pathname);
  const read = (f: string) => JSON.parse(readFileSync(join(here, '..', f), 'utf8'));

  it('is the same in package.json, package-lock.json and the User-Agent', async () => {
    const manifest = read('package.json').version;
    const lock = read('package-lock.json');

    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }));
    await new IBANforge().health();
    const ua = (calledInit().headers as Record<string, string>)['User-Agent'];

    expect(ua).toBe(`ibanforge-ts/${manifest}`);
    expect(lock.version).toBe(manifest);
    expect(lock.packages?.['']?.version).toBe(manifest);
  });
});

describe('IBANforge — auth headers', () => {
  it('omits Authorization when no API key is configured', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ valid: true }));
    await new IBANforge().formatIban('CH93');
    const headers = calledInit().headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['User-Agent']).toMatch(/^ibanforge-ts\//);
  });

  it('sends a Bearer Authorization header when an API key is set', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ valid: true }));
    await new IBANforge({ apiKey: 'ifk_test' }).validateIban('CH93');
    const headers = calledInit().headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ifk_test');
    expect(headers['Content-Type']).toBe('application/json');
  });
});

describe('IBANforge — request shapes', () => {
  it('formatIban issues a GET with the IBAN url-encoded', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ valid: true }));
    await new IBANforge().formatIban('CH93 0076 2011');
    expect(calledInit().method).toBe('GET');
    expect(calledUrl()).toContain('iban=CH93%200076%202011');
  });

  it('validateIban POSTs a JSON body { iban }', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ valid: true }));
    await new IBANforge().validateIban('CH93');
    const init = calledInit();
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ iban: 'CH93' });
  });

  it('lookupBic url-encodes the code into the path', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ found: true }));
    await new IBANforge().lookupBic('UBSWCHZH80A');
    expect(calledUrl()).toContain('/v1/bic/UBSWCHZH80A');
  });

  it('lookupChClearing coerces a numeric IID to a string path', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ found: true }));
    await new IBANforge().lookupChClearing(100);
    expect(calledUrl()).toContain('/v1/ch/clearing/100');
  });
});

describe('IBANforge — the two free endpoints shipped on 27/08/2026', () => {
  // Audit DX-10, 2026-09-01: both SDKs covered 12 endpoints and omitted these
  // two. They are the only calls that answer 200 with no key and no payment —
  // the free shop window an agent tries before deciding anything — and they
  // were unreachable from the client the docs point at.
  it('validateReference issues a free GET with the reference url-encoded', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reference: 'RF18539007547034', scheme: 'rf', valid: true }));
    await new IBANforge().validateReference('RF18539007547034');
    expect(calledInit().method).toBe('GET');
    expect(calledUrl()).toBe('https://api.ibanforge.com/v1/reference/validate?reference=RF18539007547034');
  });

  it('validateReference passes reference_type through when the caller pins the scheme', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reference: '21000', scheme: 'qrr', valid: true }));
    await new IBANforge().validateReference('21000', { referenceType: 'qrr' });
    expect(calledUrl()).toContain('reference_type=qrr');
  });

  it('validateReference relays `valid: null`, which is an answer and not a gap', async () => {
    // Norwegian KID and Swedish OCR are configured per creditor account by the
    // beneficiary's bank. Typing `valid` as a plain boolean would push callers
    // into reading that as false.
    fetchMock.mockResolvedValue(
      jsonResponse({ reference: '12345678903', scheme: 'kid', valid: null, status: 'not_checkable', source: null, note: 'n/a' }),
    );
    const out = await new IBANforge().validateReference('12345678903');
    expect(out.valid).toBeNull();
  });

  it('checkAddress POSTs { scheme, address } and reads the findings back', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        scheme: 'sps',
        conforms: true,
        findings: [{ rule: 'twn_nm_required', verdict: 'pass', detail: 'TwnNm is present.', source: 'SIX SPS 2026 v2.3' }],
      }),
    );
    const out = await new IBANforge().checkAddress('sps', { twn_nm: 'Zurich', ctry: 'CH' });
    const init = calledInit();
    expect(init.method).toBe('POST');
    expect(calledUrl()).toBe('https://api.ibanforge.com/v1/address/check');
    expect(JSON.parse(init.body as string)).toEqual({ scheme: 'sps', address: { twn_nm: 'Zurich', ctry: 'CH' } });
    // Each finding names the guideline it was read from; a bare boolean would
    // strip the licence-bearing citation the API is careful to attach.
    expect(out.findings[0].source).toContain('SIX');
  });

  it('neither free endpoint sends an Authorization header when no key is set', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ scheme: 'sps', conforms: true, findings: [] }));
    await new IBANforge().checkAddress('sps', { ctry: 'CH' });
    expect((calledInit().headers as Record<string, string>).Authorization).toBeUndefined();
  });
});

describe('IBANforge — validateBatch input guards', () => {
  it('rejects an empty array before hitting the network', () => {
    // The guard throws synchronously, before any async work begins.
    expect(() => new IBANforge().validateBatch([])).toThrow(InvalidInputError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects more than 100 IBANs before hitting the network', () => {
    const tooMany = Array.from({ length: 101 }, () => 'CH93');
    expect(() => new IBANforge().validateBatch(tooMany)).toThrow(InvalidInputError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a valid batch and posts { ibans }', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));
    await new IBANforge().validateBatch(['CH93', 'DE89']);
    expect(JSON.parse(calledInit().body as string)).toEqual({
      ibans: ['CH93', 'DE89'],
    });
  });
});

describe('IBANforge — HTTP status → typed error mapping', () => {
  const cases: Array<[number, unknown, new (...a: never[]) => Error]> = [
    [401, { message: 'no key' }, AuthError],
    [403, { message: 'forbidden' }, AuthError],
    [402, { message: 'pay up' }, PaymentRequiredError],
    [429, { error: 'quota_exceeded', message: 'out of quota' }, QuotaExhaustedError],
    [429, { error: 'rate_limited', message: 'slow down' }, RateLimitError],
    [400, { message: 'bad iban' }, InvalidInputError],
    // 413 is a distinct, reproducible answer with a distinct remedy — split the
    // payload. Folded into InvalidInputError until 2026-09-01 (audit DX-09), it
    // told a caller to fix a body that was not malformed, only too big.
    [413, { error: 'payload_too_large', message: 'body over 1 MB' }, PayloadTooLargeError],
    [404, { message: 'not found' }, InvalidInputError],
    [500, { message: 'boom' }, APIError],
    [503, { message: 'down' }, APIError],
  ];

  for (const [status, body, ErrCls] of cases) {
    it(`maps ${status} → ${ErrCls.name}`, async () => {
      fetchMock.mockResolvedValue(jsonResponse(body, { status }));
      const err = await new IBANforge().validateIban('CH93').catch((e) => e);
      expect(err).toBeInstanceOf(ErrCls);
      expect(err).toBeInstanceOf(IBANforgeError);
      expect((err as IBANforgeError).status).toBe(status);
    });
  }

  it('carries the parsed response body on the error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'bad iban' }, { status: 400 }));
    const err = (await new IBANforge()
      .validateIban('CH93')
      .catch((e) => e)) as InvalidInputError;
    expect((err.body as { message: string }).message).toBe('bad iban');
    expect(err.message).toBe('bad iban');
  });

  it('lifts the error slug onto err.code so branching needs no cast', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'invalid_key', message: 'API key not found or inactive' }, { status: 401 }),
    );
    const err = (await new IBANforge({ apiKey: 'ifk_wrong' }).usage().catch((e) => e)) as AuthError;
    expect(err.code).toBe('invalid_key');
    expect(err.status).toBe(401);
  });

  it('leaves code undefined when the body carries no slug', async () => {
    fetchMock.mockResolvedValue(jsonResponse('plain text failure', { status: 500 }));
    const err = (await new IBANforge().health().catch((e) => e)) as APIError;
    expect(err.code).toBeUndefined();
  });
});

describe('IBANforge — free reference endpoints', () => {
  const cases: Array<[string, (c: IBANforge) => Promise<unknown>, string]> = [
    ['ibanStructures', (c) => c.ibanStructures(), '/v1/iban/structure'],
    ['ibanStructure', (c) => c.ibanStructure('CH'), '/v1/iban/structure/CH'],
    ['creditBundles', (c) => c.creditBundles(), '/v1/credits/bundles'],
    ['demo', (c) => c.demo(), '/v1/demo'],
  ];

  for (const [name, call, path] of cases) {
    it(`${name} GETs ${path}`, async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      await call(new IBANforge());
      expect(calledInit().method).toBe('GET');
      expect(calledUrl()).toBe(`https://api.ibanforge.com${path}`);
    });
  }

  it('testIban passes country and count, and omits an empty query', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ test_ibans: [] }));
    await new IBANforge().testIban();
    expect(calledUrl(0)).toBe('https://api.ibanforge.com/v1/test-iban');

    await new IBANforge().testIban({ country: 'CH', count: 3 });
    expect(calledUrl(1)).toBe('https://api.ibanforge.com/v1/test-iban?country=CH&count=3');
  });
});

describe('IBANforge — network & timeout failures', () => {
  it('wraps a network failure in IBANforgeError', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const err = await new IBANforge().health().catch((e) => e);
    expect(err).toBeInstanceOf(IBANforgeError);
    expect((err as Error).message).toMatch(/network error/i);
  });

  it('maps an AbortError to a timeout IBANforgeError', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    fetchMock.mockRejectedValue(abort);
    const err = await new IBANforge({ timeoutMs: 5 }).health().catch((e) => e);
    expect(err).toBeInstanceOf(IBANforgeError);
    expect((err as Error).message).toMatch(/timed out/i);
  });
});

describe('IBANforge — client-side preconditions', () => {
  it('usage() throws AuthError without an API key and never calls the network', async () => {
    expect(() => new IBANforge().usage()).toThrow(AuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('static generateApiKey posts the email to /v1/keys/generate', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ api_key: 'ifk_x', key_prefix: 'ifk_x' }));
    await IBANforge.generateApiKey('dev@example.test', { baseUrl: 'https://example.test' });
    expect(calledUrl()).toBe('https://example.test/v1/keys/generate');
    expect(JSON.parse(calledInit().body as string)).toEqual({ email: 'dev@example.test' });
  });

  it('generateApiKey sends the mailbox code when one is given, and never as a config field', async () => {
    // The 18/08 signup guard answers 403 on a second key from the same network
    // and mails a six-digit code; the retry is the SAME call plus `code`.
    fetchMock.mockResolvedValue(jsonResponse({ api_key: 'ifk_x', key_prefix: 'ifk_x' }));
    await IBANforge.generateApiKey('dev@example.test', {
      baseUrl: 'https://example.test',
      code: '123456',
    });
    expect(JSON.parse(calledInit().body as string)).toEqual({
      email: 'dev@example.test',
      code: '123456',
    });
  });
});

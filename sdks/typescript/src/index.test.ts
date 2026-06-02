import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IBANforge,
  IBANforgeError,
  AuthError,
  PaymentRequiredError,
  QuotaExhaustedError,
  RateLimitError,
  InvalidInputError,
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
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    expect(calledUrl()).toMatch(/^https?:\/\/[^/]+\/v1\/iban\/format/);
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
});

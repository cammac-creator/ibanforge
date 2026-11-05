/**
 * GET /v1/demo/:country, tested on the REAL application object and on the real
 * validation (no stand-in registers: the expectations below do not depend on
 * the private overlay).
 *
 * It exists for the reader that cannot send a POST: an assistant that opens
 * pages. Four promises, each held here:
 *   - it answers 200 with the real validation of a fixed example, without a key
 *     and without a payment, and dates the answer;
 *   - it never takes an IBAN: a value pasted in the address is neither served
 *     nor repeated, and never reaches `request_log` or the console as written;
 *   - it consumes nothing of the keyless trial and writes no IBAN of its own;
 *   - every example comes from the public lists already in the repository.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildApp } from '../app.js';
import { resetX402Paywall } from '../middleware/x402.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import { resetDailyLedger } from '../lib/daily-ip-ledger.js';
import { normalizeRequestPath } from '../lib/stats.js';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { EXAMPLE_IBANS } from '../lib/countries.js';
import { COUNTRY_EXAMPLES, DEMO_IBANS, OFFICIAL_EXAMPLE_IBANS } from './demo.js';

const WALLET = '0x00000000000000000000000000000000000000A1';
// The public example IBAN of the ISO 13616 registry for Germany.
const PUBLIC_IBAN = 'DE89370400440532013000';

let facilitator: Server;
let facilitatorUrl: string;
const originalEnv = { ...process.env };

beforeAll(async () => {
  // Paid mode, the only mode in which a 402 can be observed at all.
  facilitator = createServer((req, res) => {
    if (req.url === '/supported') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }],
          extensions: [],
          signers: {},
        }),
      );
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((resolve) => facilitator.listen(0, '127.0.0.1', resolve));
  facilitatorUrl = `http://127.0.0.1:${(facilitator.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => facilitator.close(() => resolve()));
  process.env = originalEnv;
  closeAll();
});

let logSpy: MockInstance<typeof console.log>;
beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.X402_ENABLED = 'true';
  process.env.WALLET_ADDRESS = WALLET;
  process.env.FACILITATOR_URL = facilitatorUrl;
  delete process.env.CDP_API_KEY_ID;
  delete process.env.CDP_API_KEY_SECRET;
  delete process.env.IBANFORGE_FREE_MODE;
  resetX402Paywall();
  resetDailyLedger();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
});

let sequence = 0;
async function get(path: string, extra: Record<string, string> = {}) {
  sequence += 1;
  const ua = `demo-country-test/${sequence}`;
  const res = await buildApp().request(`https://api.ibanforge.com${path}`, {
    headers: { 'x-real-ip': `203.0.113.${(sequence % 200) + 1}`, 'user-agent': ua, ...extra },
  });
  return { res, ua };
}

function storedPath(ua: string): string | undefined {
  const row = getStatsDB().prepare('SELECT path FROM request_log WHERE user_agent = ?').get(ua) as
    { path: string } | undefined;
  return row?.path;
}

interface CountryBody {
  country: string;
  served_at: string;
  how_to_read: string;
  provenance: string;
  iban_example: { label: string; iban: string; valid: boolean; country?: unknown };
  validate_your_own: { post: string };
}

describe('GET /v1/demo/:country answers', () => {
  it('200 without a key or a payment, with the real validation of the fixed example, dated', async () => {
    const before = Date.now();
    const { res } = await get('/v1/demo/DE');
    expect(res.status).toBe(200);
    const body = (await res.json()) as CountryBody;

    expect(body.country).toBe('DE');
    expect(body.served_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Date.parse(body.served_at)).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(Date.parse(body.served_at)).toBeLessThanOrEqual(Date.now());
    expect(body.how_to_read).toMatch(/served_at/);
    expect(body.how_to_read).toMatch(/simulat/);
    expect(body.provenance.length).toBeGreaterThan(0);
    expect(body.validate_your_own.post).toMatch(/POST .*\/v1\/iban\/validate/);

    // Field for field the validation `iban_examples` carries, not a stored copy.
    const { label, ...answer } = body.iban_example;
    const expected = validateIBAN(PUBLIC_IBAN);
    enrichResult(expected);
    expect(label.length).toBeGreaterThan(0);
    expect(answer).toEqual(JSON.parse(JSON.stringify(expected)));
  });

  it('takes the country in lower case and in mixed case', async () => {
    const lower = (await (await get('/v1/demo/de')).res.json()) as CountryBody;
    const mixed = (await (await get('/v1/demo/Ch')).res.json()) as CountryBody;
    expect(lower.country).toBe('DE');
    expect(mixed.country).toBe('CH');
  });

  it('is the same element /v1/demo serves for a country of its own list', async () => {
    const list = (await (await get('/v1/demo')).res.json()) as {
      iban_examples: Array<{ iban: string; label: string }>;
    };
    const fromList = list.iban_examples.find((e) => e.iban === PUBLIC_IBAN)!;
    const one = (await (await get('/v1/demo/DE')).res.json()) as CountryBody;
    expect(one.iban_example.label).toBe(fromList.label);
  });

  it('never answers a verdict in a label, and names the provenance of each example', () => {
    for (const [cc, example] of COUNTRY_EXAMPLES) {
      expect(example.iban.slice(0, 2), cc).toBe(cc);
      expect(example.provenance.length, cc).toBeGreaterThan(0);
      expect(example.label, cc).not.toMatch(/allocated|nobody|not in|invalid|valid/i);
    }
  });

  it('serves a valid example for every country it lists, none of them invented', async () => {
    const known = new Set<string>([
      ...DEMO_IBANS.map((e) => e.iban),
      ...OFFICIAL_EXAMPLE_IBANS.map((e) => e.iban),
      ...Object.values(EXAMPLE_IBANS),
    ]);
    expect(COUNTRY_EXAMPLES.size).toBeGreaterThan(80);
    for (const [cc, example] of COUNTRY_EXAMPLES) {
      expect(known.has(example.iban), cc).toBe(true);
      const result = validateIBAN(example.iban);
      expect(result.valid, cc).toBe(true);
    }
    // And through the route, for a sample of the three sources.
    for (const cc of ['GB', 'BE', 'AT', 'JO', 'XK']) {
      const { res } = await get(`/v1/demo/${cc}`);
      expect(res.status, cc).toBe(200);
      const body = (await res.json()) as CountryBody;
      expect(body.iban_example.valid, cc).toBe(true);
    }
  });

  it('lists the countries it serves in /v1/demo, additively', async () => {
    const body = (await (await get('/v1/demo')).res.json()) as {
      iban_examples: unknown[];
      country_examples: { countries: string[]; example: string };
    };
    expect(body.iban_examples.length).toBe(DEMO_IBANS.length + OFFICIAL_EXAMPLE_IBANS.length);
    expect(body.country_examples.countries).toEqual([...COUNTRY_EXAMPLES.keys()]);
    expect(body.country_examples.example).toBe('https://api.ibanforge.com/v1/demo/DE');
  });
});

describe('GET /v1/demo/:country refuses what is not a country with an example', () => {
  it.each([['XX'], ['ZZ'], ['DEU'], ['D'], ['hello']])('404 for %s, with the list', async (v) => {
    const { res } = await get(`/v1/demo/${v}`);
    expect(res.status).toBe(404);
    const text = await res.text();
    const body = JSON.parse(text) as { error: string; available_countries: string[] };
    expect(body.error).toBe('not_found');
    expect(body.available_countries).toContain('DE');
    expect(body.available_countries).toEqual([...COUNTRY_EXAMPLES.keys()]);
    // The value is never repeated (a one-letter value is a substring of anything).
    if (v.length > 2) expect(text).not.toContain(v);
  });

  it('404 for an IBAN pasted in place of the country, and never repeats it', async () => {
    const { res } = await get(`/v1/demo/${PUBLIC_IBAN}`);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain(PUBLIC_IBAN);
    expect(text).not.toContain('89370400');
    expect(text).toMatch(/never an IBAN/);
    expect(JSON.parse(text).available_countries).toContain('DE');
  });

  it('does not repeat an IBAN written in groups or percent-encoded either', async () => {
    for (const written of [
      'DE89%203704%200440%200532%200130%2000',
      'de89-3704-0440-0532-0130-00',
    ]) {
      const { res } = await get(`/v1/demo/${written}`);
      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text.replace(/[\s-]/g, '').toLowerCase()).not.toContain('de893704');
    }
  });
});

describe('the journals keep a fixed form for what is not a known country', () => {
  it('keeps a known code (any case) and folds the rest into one label', () => {
    expect(normalizeRequestPath('/v1/demo/DE')).toBe('/v1/demo/DE');
    expect(normalizeRequestPath('/v1/demo/de')).toBe('/v1/demo/DE');
    expect(normalizeRequestPath('/v1/demo/XX')).toBe('/v1/demo/:other');
    expect(normalizeRequestPath('/v1/demo/hello-world')).toBe('/v1/demo/:other');
    expect(normalizeRequestPath('/v1/demo/DE/anything')).toBe('/v1/demo/:other');
    expect(normalizeRequestPath('/v1/demo/%ZZ')).toBe('/v1/demo/:other');
    expect(normalizeRequestPath('/v1/demo')).toBe('/v1/demo');
  });

  it('stores /v1/demo/:other for an invented IBAN in the address, and prints no digit of it', async () => {
    // An IBAN invented for this test (valid shape, not a real account).
    const invented = 'FR7612345678901234567890123';
    const { res, ua } = await get(`/v1/demo/${invented}`);
    expect(res.status).toBe(404);
    expect(storedPath(ua)).toBe('/v1/demo/:other');
    const printed = logSpy.mock.calls.map((args) => String(args[0])).join('\n');
    expect(printed).not.toContain('1234567890');
  });

  it('stores a plain word too as the fixed label, not as written', async () => {
    const { ua } = await get('/v1/demo/some-customer-reference-4711');
    expect(storedPath(ua)).toBe('/v1/demo/:other');
    const printed = logSpy.mock.calls.map((args) => String(args[0])).join('\n');
    expect(printed).not.toContain('4711');
  });

  it('stores a known country as its own bucket', async () => {
    const { ua } = await get('/v1/demo/ch');
    expect(storedPath(ua)).toBe('/v1/demo/CH');
  });
});

describe('GET /v1/demo/:country costs nothing and writes no IBAN of its own', () => {
  function counts() {
    const db = getStatsDB();
    const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    return {
      weekly: n('SELECT COALESCE(SUM(units), 0) AS n FROM trial_weekly'),
      ledger: n('SELECT COUNT(*) AS n FROM trial_ledger'),
      operations: n('SELECT COUNT(*) AS n FROM operations'),
    };
  }

  it('leaves the keyless trial of POST /v1/iban/validate untouched', async () => {
    const before = counts();
    for (const path of ['/v1/demo/DE', '/v1/demo/xx', `/v1/demo/${PUBLIC_IBAN}`]) {
      const { res } = await get(path);
      expect(res.status).not.toBe(402);
      expect(res.headers.get('x-trial-used')).toBeNull();
      expect(res.headers.get('x-trial-remaining')).toBeNull();
    }
    expect(counts()).toEqual(before);
  });

  it('is not billed to a key that is presented on it', async () => {
    const { res } = await get('/v1/demo/FR', { authorization: 'Bearer ifk_not_a_real_key' });
    // A key the service does not know must not turn a free page into a refusal
    // that reads as a payment wall either.
    expect(res.status).not.toBe(402);
  });

  it('writes the example IBAN to no table, only the request line with the folded path', async () => {
    const tables = getStatsDB()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const { ua } = await get('/v1/demo/DE');
    const hits: string[] = [];
    for (const { name } of tables) {
      if (/^sqlite_|_fts/.test(name)) continue;
      const rows = getStatsDB().prepare(`SELECT * FROM "${name}"`).all();
      if (JSON.stringify(rows).includes(PUBLIC_IBAN)) hits.push(name);
    }
    // /v1/demo itself and the dashboards never write the example; neither may this route.
    expect(hits).toEqual([]);
    expect(storedPath(ua)).toBe('/v1/demo/DE');
  });
});

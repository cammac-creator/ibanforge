/**
 * The two journals that keep a request path, read end to end.
 *
 * The privacy policy promises submitted IBANs are not stored (privacy.mdx §1,
 * DPA clause 2). Two places keep a path: `request_log` (twelve months) and the
 * console log, which Railway keeps. Until 24/09/2026 each had its own pattern:
 * `request_log` caught an IBAN written in one block, the console only one
 * written in one block AND in capitals. Written in groups — spaces, `%20`, `+`,
 * dashes, dots, underscores — it went into both whole.
 *
 * Everything here runs through the real application (`buildApp()`), so what is
 * checked is what the middlewares actually write, not what a helper would
 * return if it were called. Public example IBANs only.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { buildApp } from './app.js';
import { resetX402Paywall } from './middleware/x402.js';
import { closeAll, getStatsDB } from './lib/db.js';
import { normalizeRequestPath, redactIbanShapedValues } from './lib/stats.js';

// TEST-NET-3, never routable; our own bucket in the in-memory rate limiter.
const IP = '203.0.113.77';

const originalEnv = { ...process.env };

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  // Free mode: the paywall never calls a facilitator, and no route here is paid.
  process.env.X402_ENABLED = 'false';
  process.env.IBANFORGE_FREE_MODE = 'true';
  resetX402Paywall();
});

afterAll(() => {
  process.env = originalEnv;
  closeAll();
});

let logSpy: MockInstance<typeof console.log>;
beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
});

let sequence = 0;

/**
 * One request through the real app. Returns the two logger lines it printed
 * and the path `request_log` stored for it (found by a User-Agent no other
 * request carries).
 */
async function journalsOf(path: string): Promise<{ console: string[]; stored: string }> {
  sequence += 1;
  const ua = `masquage-test/${sequence}`;
  logSpy.mockClear();
  await buildApp().request(`https://api.ibanforge.com${path}`, {
    headers: { 'x-real-ip': IP, 'user-agent': ua },
  });
  const lines = logSpy.mock.calls
    .map((args) => String(args[0]))
    .filter((line) => line.startsWith('<--') || line.startsWith('-->'));
  const row = getStatsDB().prepare('SELECT path FROM request_log WHERE user_agent = ?').get(ua) as
    { path: string } | undefined;
  // Never vacuous: both journals must have written something to check.
  expect(lines).toHaveLength(2);
  expect(row, `no request_log row for ${path}`).toBeDefined();
  return { console: lines, stored: (row as { path: string }).path };
}

/**
 * A journal line read the way a person reads it: escapes decoded, separators
 * dropped, case ignored. Restated here rather than imported, so a wrong rule in
 * stats.ts cannot make this check wrong the same way.
 */
function asRead(line: string): string {
  return line
    .replace(/%([0-7][0-9A-Fa-f])/g, (_m, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/%C2%A0|%E2%80%AF|%E2%80%89/gi, '')
    .replace(/[\s+\-._/]/g, '')
    .toUpperCase();
}

describe('an IBAN in the path reaches neither journal', () => {
  it.each([
    ['one block', '/v1/iban/CH9300762011623852957', 'CH9300762011623852957', '/v1/iban/:redacted'],
    ['lowercase', '/v1/iban/ch9300762011623852957', 'CH9300762011623852957', '/v1/iban/:redacted'],
    [
      'spaces (sent as %20)',
      '/v1/iban/CH93 0076 2011 6238 5295 7',
      'CH9300762011623852957',
      '/v1/iban/:redacted',
    ],
    [
      '%20',
      '/v1/iban/CH93%200076%202011%206238%205295%207',
      'CH9300762011623852957',
      '/v1/iban/:redacted',
    ],
    ['+', '/v1/iban/CH93+0076+2011+6238+5295+7', 'CH9300762011623852957', '/v1/iban/:redacted'],
    [
      'dashes, lowercase',
      '/v1/iban/de89-3704-0044-0532-0130-00',
      'DE89370400440532013000',
      '/v1/iban/:redacted',
    ],
    [
      'dots',
      '/v1/iban/GB29.NWBK.6016.1331.9268.19',
      'GB29NWBK60161331926819',
      '/v1/iban/:redacted',
    ],
    [
      'underscores',
      '/v1/iban/FR14_2004_1010_0505_0001_3M02_606',
      'FR1420041010050500013M02606',
      '/v1/iban/:redacted',
    ],
    [
      'no-break spaces',
      '/v1/iban/CH93%C2%A00076%C2%A02011%C2%A06238%C2%A05295%C2%A07',
      'CH9300762011623852957',
      '/v1/iban/:redacted',
    ],
    [
      'raw braces around groups (sent as %7B…%7D)',
      '/v1/bic/{CH93 0076 2011 6238 5295 7}',
      'CH9300762011623852957',
      '/v1/bic/%7B:redacted%7D',
    ],
    [
      'encoded braces around lowercase groups',
      '/v1/bic/%7Bch93-0076-2011-6238-5295-7%7D',
      'CH9300762011623852957',
      '/v1/bic/%7B:redacted%7D',
    ],
    [
      'one group per segment',
      '/v1/iban/DE89/3704/0044/0532/0130/00',
      'DE89370400440532013000',
      '/v1/iban/:redacted/:redacted',
    ],
    [
      'in the query string, without a value',
      '/v1/iban/format?ch93-0076-2011-6238-5295-7',
      'CH9300762011623852957',
      '/v1/iban/format',
    ],
  ])('%s', async (_form, path, iban, storedLabel) => {
    const journals = await journalsOf(path);

    expect(journals.stored).toBe(storedLabel);
    for (const line of journals.console) {
      expect(asRead(line)).not.toContain(iban);
      expect(line).toContain('***');
    }
  });

  it('keeps the one-time credentials masked in the console, as before', async () => {
    const stripe = await journalsOf('/v1/stripe/key/cs_live_a1B2c3D4e5F6');
    for (const line of stripe.console) expect(line).toContain('/v1/stripe/key/***');
    const recover = await journalsOf('/v1/credits/recover/0xdeadbeefcafe');
    for (const line of recover.console) expect(line).toContain('/v1/credits/recover/***');
  });

  it('keeps query values masked in the console, as before', async () => {
    const journals = await journalsOf('/v1/iban/format?iban=CH9300762011623852957&api_key=ifk_x');
    for (const line of journals.console) {
      expect(line).toContain('/v1/iban/format?iban=***&api_key=***');
    }
  });
});

describe('real routes and real values are left alone', () => {
  // Every pattern the application registers, read by both rules. A route that
  // the IBAN rule swallowed would vanish from the dashboard into `:redacted`.
  it('no registered route pattern looks like an IBAN to either journal', () => {
    const patterns = [...new Set(buildApp().routes.map((r) => r.path))];
    expect(patterns.length).toBeGreaterThan(50);
    for (const pattern of patterns) {
      expect(redactIbanShapedValues(pattern, '***'), pattern).toBe(pattern);
      expect(normalizeRequestPath(pattern), pattern).not.toContain(':redacted');
    }
  });

  // One value of the shape each parameter route really receives. The console
  // keeps them verbatim (it is a debugging aid); request_log keeps its labels.
  it.each([
    ['/v1/bic/COBADEFFXXX', '/v1/bic/:code'],
    ['/v1/ch/clearing/762', '/v1/ch/clearing/:iid'],
    ['/v1/iban/structure/CH', '/v1/iban/structure/CH'],
    ['/v1/feedback/42', '/v1/feedback/42'],
    // An audit job id is 36 hex characters: longer than any IBAN.
    [
      '/v1/audit/status/de12a4b5c6d7e8f90a1b2c3d4e5f60718293',
      '/v1/audit/status/de12a4b5c6d7e8f90a1b2c3d4e5f60718293',
    ],
    ['/v1/iban/validate', '/v1/iban/validate'],
    ['/openapi.json', '/openapi.json'],
  ])('%s', async (path, storedLabel) => {
    const journals = await journalsOf(path);
    expect(journals.stored).toBe(storedLabel);
    for (const line of journals.console) expect(line).toMatch(new RegExp(` ${path}( |$)`));
  });
});

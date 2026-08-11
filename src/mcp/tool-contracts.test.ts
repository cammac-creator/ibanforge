import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enrichResult } from '../lib/enrich.js';
import { validateIBAN } from '../lib/iban.js';

/**
 * A tool description must not promise a field the tool does not return.
 *
 * ## Why this exists
 *
 * Audited 28/07/2026 against a live MCP session: `validate_iban` documented
 * `bic: { code, institution, country_code, city }` in its "Returns:" block —
 * the block an agent parses to plan its next step — while the tool returned
 * `bic: { code, bank_name, city }`. Neither `institution` nor `country_code`
 * existed. The example beside it showed an 11-character BIC where the service
 * normalises to 8.
 *
 * For a developer that costs one puzzled minute: they read the response and
 * correct. For an agent it is different in kind, because the description IS the
 * contract — it plans before it has ever seen a response, writes
 * `result.bic.institution`, gets undefined, and either gives up or invents.
 * MCP is the inbound channel that actually brings users here, so this is the
 * expensive place to be wrong.
 *
 * ## Why the assertion is a text scan
 *
 * Neither MCP surface can be imported: `src/mcp/server.ts` calls main() at
 * module scope, so importing it would start a stdio server inside the test
 * runner, and `createMcpServer` is not exported from `src/routes/mcp-http.ts`.
 * So the descriptions are read as text and compared against a payload built
 * from the same library functions the tools call. Less elegant than importing,
 * and it is the only thing that works.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const STDIO = readFileSync(join(ROOT, 'src/mcp/server.ts'), 'utf8');
const HTTP = readFileSync(join(ROOT, 'src/routes/mcp-http.ts'), 'utf8');

/** The "Returns: { ... }" block of a named tool in the stdio server. */
function returnsBlockFor(source: string, marker: string): string {
  const at = source.indexOf(marker);
  expect(at, `tool marker not found: ${marker}`).toBeGreaterThan(-1);
  const from = source.indexOf('Returns:', at);
  expect(from, `no Returns block after ${marker}`).toBeGreaterThan(-1);
  return source.slice(from, from + 700);
}

describe('validate_iban: the documented shape is the returned shape', () => {
  const result = validateIBAN('DE89370400440532013000');
  enrichResult(result);
  const returns = returnsBlockFor(STDIO, "'validate_iban'");

  it('returns bic.bank_name, and no longer promises bic.institution', () => {
    expect(Object.keys(result.bic ?? {})).toContain('bank_name');
    expect(Object.keys(result.bic ?? {})).not.toContain('institution');
    expect(returns).toContain('bank_name');
    // The exact regression: the contract named a field that does not exist.
    expect(returns).not.toMatch(/bic:\s*\{[^}]*\binstitution\b/);
  });

  it('does not promise bic.country_code, which the tool never returned', () => {
    expect(Object.keys(result.bic ?? {})).not.toContain('country_code');
    expect(returns).not.toMatch(/bic:\s*\{[^}]*country_code/);
  });

  it('documents every key the enriched payload actually carries', () => {
    for (const key of ['valid', 'country', 'check_digits', 'bban', 'bic', 'sepa', 'issuer', 'risk_indicators']) {
      expect(returns, `Returns block omits "${key}"`).toContain(key);
    }
  });

  it('shows the register 11-character BIC in its German example, as the service now serves', () => {
    // Until 2026-08-11 the service normalised every BIC to 8 characters and this
    // test pinned that. For Germany the truth inverted: the BIC8 prefix of a
    // Sparkasse names the shared Landesbank, so the register's 11-character
    // form is the honest answer, and the documented example must match it.
    expect(result.bic?.code).toBe('COBADEFFXXX');
    expect(STDIO).toContain("bic: { code: 'COBADEFFXXX'");
    expect(STDIO).not.toContain("bic: { code: 'COBADEFF'");
  });
});

describe('lookup_bic: MCP and REST agree on the country shape', () => {
  it('both MCP surfaces emit the nested country object', () => {
    // REST (src/routes/bic-lookup.ts) has always answered country: {code, name}.
    // The two MCP transports answered a flat pair, so the same product had two
    // shapes for one lookup. They now emit both, nested being the aligned one.
    expect(STDIO).toMatch(/country:\s*\{\s*code:\s*validation\.country_code/);
    expect(HTTP).toMatch(/country:\s*\{\s*code:\s*validation\.country_code/);
  });

  it('keeps the flat pair, and dates its removal in the description', () => {
    // Removing it now would break an agent mid-conversation for no benefit.
    expect(STDIO).toContain('country_code: validation.country_code');
    expect(HTTP).toContain('country_code: validation.country_code');
    for (const src of [STDIO, HTTP]) {
      expect(src).toMatch(/DEPRECATED since 1\.4\.0/);
      expect(src).toMatch(/2027-01-01/);
    }
  });

  it('states that the two differ on the missing-name fallback', () => {
    // country.name falls back to the code; country_name has always answered
    // null. Silently mirroring one into the other would put "FR" and null in
    // the same body, which is the divergence being closed, one level down.
    expect(STDIO).toMatch(/country_name.*null|null.*country_name/s);
    expect(STDIO).toContain('falls back to the country code');
  });
});

describe('no latency claim outlives its measurement', () => {
  it('neither MCP surface repeats the old per-endpoint millisecond figures', () => {
    for (const src of [STDIO, HTTP]) {
      expect(src).not.toMatch(/under 30ms/);
      expect(src).not.toMatch(/~30ms per IBAN/);
      expect(src).not.toMatch(/p99 <\d+ms/);
    }
  });
});

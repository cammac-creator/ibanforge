import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The paid endpoint's docs described enums the API never served — fatf_status
 * `increased_monitoring`/`high_risk`/`none`, a 3-tier risk_level for the real
 * 6, example flags matching no real flag name — in all three languages, for
 * months (found by the 24/08/2026 adversarial audit). An agent implementing
 * the documented triage broke on the first `elevated`.
 *
 * This test is the class guard: every enum token the docs put in backticks on
 * the fatf_status / risk_level / flags rows must be a value the CODE actually
 * produces. The canonical lists are pinned against the source itself, so the
 * guard cannot drift into guarding stale values.
 */

const ROOT = resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf-8');

const complianceSrc = read('src/lib/compliance.ts');

// The levels calculateRiskScore can emit, plus the one compliance-response
// adds when the screen itself could not run.
const SERVED_RISK_LEVELS = ['low', 'medium', 'elevated', 'high', 'critical', 'unassessable'];
// The FATF standings the pipeline writes (compliance-static seeds them) and
// the fallback the response layer serves for countries absent from the table.
const SERVED_FATF = ['member', 'grey_list', 'black_list', 'suspended', 'non_member'];

// Every flag name the scoring function can push.
const SERVED_FLAGS = [...complianceSrc.matchAll(/flags\.push\('([a-z0-9_]+)'\)/g)].map((m) => m[1]);

/** Backticked lowercase_snake tokens on one line — the doc's enum vocabulary. */
function backtickTokens(line: string): string[] {
  return [...line.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((m) => m[1]);
}

describe('the canonical lists are pinned to the source, not to this test', () => {
  it('every risk level exists in the code that emits it', () => {
    for (const level of SERVED_RISK_LEVELS) {
      // All six live in compliance.ts: five from calculateRiskScore's
      // thresholds, 'unassessable' from unassessableCompliance().
      expect(complianceSrc, level).toContain(`'${level}'`);
    }
  });

  it('every FATF standing exists in the pipeline', () => {
    const staticSrc = read('src/lib/compliance-static.ts');
    const refreshSrc = read('scripts/refresh-compliance.ts');
    for (const status of SERVED_FATF) {
      const found =
        complianceSrc.includes(`'${status}'`) ||
        staticSrc.includes(`'${status}'`) ||
        refreshSrc.includes(`'${status}'`);
      expect(found, status).toBe(true);
    }
  });

  it('the scoring function pushes at least the flags the docs cite', () => {
    expect(SERVED_FLAGS.length).toBeGreaterThan(5);
  });
});

describe.each(['en', 'de', 'fr'])(
  'docs/compliance.mdx (%s) documents only served values',
  (lang) => {
    const mdx = read(`frontend/content/${lang}/docs/compliance.mdx`);
    const lines = mdx.split('\n');
    const row = (needle: string): string => {
      const l = lines.find((x) => x.startsWith('|') && x.includes(needle));
      expect(l, `table row for ${needle}`).toBeTruthy();
      return l!;
    };

    it('fatf_status row', () => {
      const tokens = backtickTokens(row('fatf_status')).filter(
        (t) => !t.includes('.') && t !== 'sanctions',
      );
      expect(tokens.length).toBeGreaterThanOrEqual(4);
      for (const t of tokens) expect(SERVED_FATF, t).toContain(t);
    });

    it('risk_level row', () => {
      const tokens = backtickTokens(row('risk_level')).filter((t) => t !== 'risk_level');
      expect(tokens.length).toBeGreaterThanOrEqual(5);
      for (const t of tokens) expect(SERVED_RISK_LEVELS, t).toContain(t);
    });

    it('flags row cites only real flag names', () => {
      const tokens = backtickTokens(row('| `flags`')).filter((t) => t !== 'flags');
      // Tokens inside the JSON example arrive quoted, not backticked — catch those too.
      const jsonTokens = [...row('| `flags`').matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
      for (const t of [...tokens, ...jsonTokens]) expect(SERVED_FLAGS, t).toContain(t);
    });
  },
);

describe('openapi.ts serves the same vocabulary', () => {
  const openapiSrc = read('src/routes/openapi.ts');

  it('fatf_status enum matches exactly', () => {
    const m = /fatf_status:\s*\{[^}]*enum:\s*\[([^\]]+)\]/.exec(openapiSrc);
    expect(m).toBeTruthy();
    const tokens = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(tokens.sort()).toEqual([...SERVED_FATF].sort());
  });

  it('risk_level enum matches exactly', () => {
    const m = /risk_level:\s*\{[^}]*enum:\s*\[([^\]]+)\]/s.exec(openapiSrc);
    expect(m).toBeTruthy();
    const tokens = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(tokens.sort()).toEqual([...SERVED_RISK_LEVELS].sort());
  });

  it('the flags example cites only real flag names', () => {
    // Single-line match: the flags object nests `{ type: 'string' }`, which a
    // naive [^}]* stops at before reaching `example:`.
    const m = /flags:.*example:\s*\[([^\]]+)\]/.exec(openapiSrc);
    expect(m).toBeTruthy();
    const tokens = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    for (const t of tokens) expect(SERVED_FLAGS, t).toContain(t);
  });
});

/**
 * The two enums a regulated pilot asked for by name, added 29/08/2026:
 * `bank_code_check.reason` and `bic.basis`. Same class guard, opposite
 * direction: prose on these table rows backticks neighbouring field names and
 * status values too, so instead of proving documented ⊆ served, this proves
 * served ⊆ documented — a value the code can emit that the row does not name
 * is exactly how a machine-readable vocabulary rots.
 */
const typesSrc = read('src/types.ts');

function unionValues(typeName: string): string[] {
  const start = typesSrc.indexOf(`export type ${typeName}`);
  expect(start, `${typeName} must exist in src/types.ts`).toBeGreaterThanOrEqual(0);
  const body = typesSrc.slice(start, typesSrc.indexOf(';', start));
  return [...body.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

const SERVED_REASONS = unionValues('BankCodeReason');
const SERVED_BASES = unionValues('BicBasis');

describe.each(['en', 'de', 'fr'])(
  'docs/iban-validate.mdx (%s) names every served enum value',
  (lang) => {
    const mdx = read(`frontend/content/${lang}/docs/iban-validate.mdx`);
    const lines = mdx.split('\n');
    const row = (needle: string): string => {
      const l = lines.find((x) => x.startsWith('|') && x.includes(needle));
      expect(l, `table row for ${needle}`).toBeTruthy();
      return l!;
    };

    it('the reason row names all six reasons', () => {
      expect(SERVED_REASONS.length).toBe(6);
      // Anchored on the field CELL: the status row cites `reason` in prose and
      // would be found first on a bare substring.
      const r = row('| `reason` |');
      for (const v of SERVED_REASONS) expect(r, v).toContain(`\`${v}\``);
    });

    it('the basis row names all three bases', () => {
      expect(SERVED_BASES.length).toBe(3);
      const r = row('| `basis` |');
      for (const v of SERVED_BASES) expect(r, v).toContain(`\`${v}\``);
    });
  },
);

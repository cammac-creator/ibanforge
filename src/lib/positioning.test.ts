import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { registerCoverage } from './enrich.js';
import { IBAN_LENGTHS } from './countries.js';
import {
  NOT_WHAT_IT_IS,
  codesOf,
  frozenBicShare,
  namesOf,
  positioningLong,
  positioningOneLine,
  registerCountries,
  shareInWords,
} from './positioning.js';

/**
 * The first lines machines read, held to the code that decides the verdict.
 *
 * On 24/09/2026 the first lines assistants quoted back were ours, typed by
 * hand on a dozen surfaces: Switzerland first, "sanctions" with no word saying
 * whose, "VoP" with no word saying what, a BIC directory said to be fresh when
 * two thirds of it is a copy frozen in 2018. The API surfaces now read their
 * sentences from src/lib/positioning.ts. The static ones cannot import it, so
 * this file compares them to it: a register that joins or leaves
 * NATIONAL_REGISTERS, or a share that stops being "about two thirds", turns
 * these tests red instead of leaving a static file to say the old thing.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/** The static files that carry the long paragraph verbatim. */
const LONG_SURFACES = ['frontend/public/llms.txt', 'frontend/public/llms-full.txt', 'README.md'];

/** The static files that carry the one line verbatim. */
const ONE_LINE_SURFACES = [
  'frontend/components/json-ld.tsx',
  'frontend/public/.well-known/mcp.json',
  'glama.json',
];

/** The static files that describe the BIC directory. */
const BIC_TRUTH_SURFACES = [
  'frontend/public/llms.txt',
  'frontend/public/llms-full.txt',
  'README.md',
  'glama.json',
  'frontend/components/json-ld.tsx',
];

/** The comparison page, one subtree per language, never the home page keys. */
function compareText(lang: 'en' | 'fr' | 'de'): string {
  const messages = JSON.parse(read(`frontend/messages/${lang}.json`)) as { compare: unknown };
  return JSON.stringify(messages.compare);
}

describe('the register lists are read from the code', () => {
  afterEach(() => {
    delete process.env.LU_REGISTER_PATH;
  });

  it('names exactly the countries whose register settles a negative', () => {
    const expected = Object.keys(IBAN_LENGTHS)
      .filter((cc) => registerCoverage(cc).basis === 'authoritative')
      .sort();
    expect([...registerCountries().authoritative].sort()).toEqual(expected);
    // A register that answers `authoritative: true` is the whole claim: none
    // may be missing, and no partial one may slip into this list.
    expect(expected.length).toBeGreaterThan(0);
    for (const cc of registerCountries().partial) {
      expect(registerCoverage(cc).basis, cc).not.toBe('authoritative');
    }
  });

  it('never names Switzerland first', () => {
    // The editorial half of this file: naming Switzerland first on every
    // surface is what made assistants file IBANforge as a Swiss tool.
    const { authoritative } = registerCountries();
    expect(authoritative[0]).not.toBe('CH');
    expect(authoritative.indexOf('CH')).toBeGreaterThan(authoritative.indexOf('DE'));
  });

  it('adds Luxembourg only where its register is configured', () => {
    delete process.env.LU_REGISTER_PATH;
    expect(registerCountries().partial).not.toContain('LU');
    process.env.LU_REGISTER_PATH = '/nonexistent/lu-register.json';
    expect(registerCountries().partial).toContain('LU');
    expect(registerCountries().authoritative).not.toContain('LU');
  });

  it('puts the register countries in the long paragraph and the codes in the one line', () => {
    const { authoritative } = registerCountries();
    expect(positioningLong()).toContain(namesOf(authoritative));
    expect(positioningOneLine()).toContain(codesOf(authoritative));
  });

  it('says what the product is not, name check and payee screening first', () => {
    expect(NOT_WHAT_IT_IS).toMatch(/Not a name check/);
    expect(NOT_WHAT_IT_IS).toMatch(/not a sanctions screening of the payee/);
    expect(NOT_WHAT_IT_IS).toMatch(/not a licensed copy of the SWIFT BIC directory/);
  });
});

describe('the frozen share of the BIC directory', () => {
  it('is read from the per-source counts, with its month', () => {
    const f = frozenBicShare();
    expect(f.total).toBeGreaterThan(f.rows);
    expect(f.rows).toBeGreaterThan(0);
    expect(f.month).toMatch(/^[A-Z][a-z]+ \d{4}$/);
  });

  it.each([
    [0.674, 'about two thirds'],
    [0.5, 'about half'],
    [0.33, 'about a third'],
    [0.8, 'about 80%'],
  ])('words %s as "%s"', (share, words) => {
    expect(shareInWords(share)).toBe(words);
  });
});

describe('the static surfaces say what the code says', () => {
  it.each(LONG_SURFACES)('%s carries the positioning paragraph verbatim', (rel) => {
    const text = read(rel);
    expect(text, `${rel}: resync the paragraph from positioningLong()`).toContain(
      positioningLong(),
    );
    expect(text, `${rel}: resync the "what it is not" line`).toContain(NOT_WHAT_IT_IS);
  });

  it.each(ONE_LINE_SURFACES)('%s carries the one line verbatim', (rel) => {
    expect(read(rel), `${rel}: resync from positioningOneLine()`).toContain(positioningOneLine());
  });

  it.each(BIC_TRUTH_SURFACES)(
    '%s dates the frozen copy and says how much of it there is',
    (rel) => {
      const f = frozenBicShare();
      const text = read(rel);
      expect(text).toContain(`frozen in ${f.month}`);
      expect(text).toContain(f.words);
    },
  );

  it('the comparison page names the same register codes, in three languages', () => {
    const codes = codesOf(registerCountries().authoritative);
    for (const lang of ['en', 'fr', 'de'] as const) {
      expect(compareText(lang), lang).toContain(codes);
    }
    const f = frozenBicShare();
    expect(compareText('en')).toContain(`frozen in ${f.month}`);
    expect(compareText('en')).toContain(f.words);
  });

  it('the site llms files name every partial register, Luxembourg included', () => {
    const partialNames = Object.keys(IBAN_LENGTHS)
      .filter((cc) => registerCoverage(cc).basis === 'partial')
      .map((cc) => namesOf([cc]));
    for (const rel of ['frontend/public/llms.txt', 'frontend/public/llms-full.txt']) {
      const text = read(rel);
      for (const name of [...partialNames, 'Luxembourg'])
        expect(text, `${rel}: ${name}`).toContain(name);
    }
  });
});

/**
 * The sentences assistants copied word for word, gone from the surfaces this
 * work owns. Scoped on purpose: the published packages (mcp/, sdks/,
 * server.json) change only with a release, and the home page keys wait for a
 * visual review; both are listed as follow-ups rather than exempted here.
 */
const RETIRED: Array<[RegExp, string]> = [
  [/121k\+ institutions/i, 'rows, not institutions'],
  [/GLEIF-sourced/i, 'GLEIF is one source among several'],
  [/Data sourced from GLEIF/i, 'GLEIF is one source among several'],
  [/EBA RT1 \/ SCT Inst/i, 'the VoP readiness comes from the EPC VoP register'],
  [/PSR 2024\/886/i, 'Regulation (EU) 2024/886 is the Instant Payments Regulation'],
  [/Pre-payout screening for (AI )?agents/i, 'the positioning sentence of positioning.ts'],
  [
    /deepest (public )?Swiss clearing data/i,
    'every IID of the SIX BankMaster with its rails and QR-IID',
  ],
  [/\$5 payment for 1,000/i, 'the pack price is read from BUNDLES'],
];

const OWNED = [
  'src/app.ts',
  'src/routes/mcp-http.ts',
  'src/mcp/server.ts',
  'src/routes/mcp-card.ts',
  'src/routes/discovery.ts',
  'src/routes/bic-lookup.ts',
  'src/routes/openapi.ts',
  'src/middleware/x402.ts',
  'src/middleware/enrich-402.ts',
  'src/routes/landing.ts',
  'frontend/public/llms.txt',
  'frontend/public/llms-full.txt',
  'frontend/public/.well-known/mcp.json',
  'frontend/components/json-ld.tsx',
  'README.md',
  'glama.json',
];

/** Lines that explain an old wording in a code comment are history, not copy. */
const COMMENT = /^\s*(\/\/|\*|\/\*)/;

describe('the retired sentences stay retired', () => {
  it.each(OWNED)('%s', (rel) => {
    const offenders: string[] = [];
    read(rel)
      .split('\n')
      .forEach((line, i) => {
        if (/\.(ts|tsx)$/.test(rel) && COMMENT.test(line)) return;
        for (const [pattern, instead] of RETIRED) {
          if (pattern.test(line))
            offenders.push(`${rel}:${i + 1} (${instead}): ${line.trim().slice(0, 120)}`);
        }
      });
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it.each(['en', 'fr', 'de'] as const)('the comparison page (%s)', (lang) => {
    const text = compareText(lang);
    expect(text).not.toMatch(/deepest|plus profondes|tiefsten/i);
    expect(text).not.toMatch(/121k\+ BICs, 39k\+/);
    // AbstractAPI's "$99 ... 3 requests/second" lives only in hidden HTML; no
    // visitor sees it (re-read on 24/09/2026 in a real browser).
    // Bounded on both sides: "39,99 $" is a price of another vendor, not this one.
    expect(text).not.toMatch(/\$99(?![.,]?\d)|(?<![\d.,'])99 \$/);
  });
});

/**
 * A silent page proves nothing. The comparison said "No" for competitors on
 * Swiss clearing, compliance and AI agents while at least four vendors announce
 * an MCP server; re-read on 24/09/2026, every such cell is either a fact read
 * on the vendor's page or "not checked by us".
 */
describe('the comparison claims no absence it has not read', () => {
  // A bare verdict, possibly with a parenthesis ("No", "Non", "Nein (…)"),
  // never a sentence that merely begins with the word: "Non vérifié par
  // nous" is the honest form this guard asks for.
  const NO = /^(No|Non|Nein)(\s*\(.*\))?$/;

  it('the pattern catches a bare verdict and lets the honest form through', () => {
    for (const v of ['No', 'Non', 'Nein', 'No (a library, not a service)'])
      expect(NO.test(v), v).toBe(true);
    for (const v of [
      'Non vérifié par nous',
      'Not checked by us',
      'Nicht in der dokumentierten Antwort',
    ])
      expect(NO.test(v), v).toBe(false);
  });
  const COMPETITORS = ['ibancom', 'ibanapi', 'abstract'] as const;

  it.each(['en', 'fr', 'de'] as const)('%s', (lang) => {
    const rows = (
      JSON.parse(read(`frontend/messages/${lang}.json`)) as {
        compare: { table: { rows: Record<string, Record<string, string>> } };
      }
    ).compare.table.rows;
    const offenders: string[] = [];
    for (const row of ['swiss', 'compliance', 'agents', 'bankCode']) {
      for (const col of COMPETITORS) {
        if (NO.test(rows[row][col])) offenders.push(`${row}.${col}: ${rows[row][col]}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { datasetFacts } from '../lib/dataset-facts.js';

/**
 * No surface may announce a dataset size that the shipped data does not support.
 *
 * ## What went wrong
 *
 * Audited 28/07/2026: the Swiss clearing table held 1,165 rows while the
 * product announced "~1,200" in sixty-one places, "1190+" in one and "1,000+"
 * in four. The BIC table held 121,610 and the copy said "121k+" or "121,000+"
 * depending on the file. Twenty-four files, four different values, none of them
 * checked against anything — because none of them could be: they were string
 * literals. The repository's own CLAUDE.md already forbade exactly this.
 *
 * ## What this test enforces, and what it deliberately does not
 *
 * It does not demand an exact figure in the copy. It demands that any figure
 * appearing as a claim be **less than or equal to** the live count: an
 * understated claim stays true through a refresh, an overstated one is a lie
 * the moment the data moves. That is the same direction-of-error rule the
 * compliance fix rests on.
 *
 * Served TypeScript surfaces should not carry a literal at all — they call
 * datasetFacts(). Static files (marketing copy, directory manifests, UI
 * translations) cannot call a function, so they are allowed a literal provided
 * it is not an overstatement.
 */

const ROOT = join(import.meta.dirname, '..', '..');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.superpowers',
  '.claude',
  'data',
  'tmp',
  'docs',
]);

/** Data files and history, which describe the past or hold raw rows. */
const SKIP_FILES = new Set([
  'src/db/bic_data.json',
  'CHANGELOG.md',
  'src/routes/dataset-claims.test.ts',
  'src/lib/dataset-facts.ts',
  'package-lock.json',
]);

const EXTS = /\.(ts|tsx|js|mjs|json|md|txt|yaml|yml|html)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) walk(full, out);
    else if (EXTS.test(name)) out.push(full);
  }
  return out;
}

/**
 * A claim looks like "121k+ BIC", "~1,200 SIX", "1190+ Swiss clearing".
 * The unit word is required: without it, version strings, ports and pixel
 * dimensions all look like dataset claims.
 */
const CLAIM = new RegExp(
  String.raw`(~|about |environ |ca\. |rund )?` +
    String.raw`(\d{1,3}(?:[ ,.]\d{3})+|\d+(?:[.,]\d+)?\s?k)\+?` +
    String.raw`\s*(?:\+\s*)?` +
    String.raw`(BIC|SWIFT|SIX|BankMaster|Swiss|schweiz|suisse|LEI|clearing|BC-Nummer|institutions|entr)`,
  'gi',
);

function toNumber(raw: string): number | null {
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/[ ,.](?=\d{3}\b)/g, '');
  if (t.endsWith('k')) {
    const n = Number.parseFloat(t.slice(0, -1).replace(',', '.'));
    return Number.isNaN(n) ? null : Math.round(n * 1000);
  }
  const n = Number.parseInt(t.replace(/[ ,.]/g, ''), 10);
  return Number.isNaN(n) ? null : n;
}

describe('dataset size claims never exceed the shipped data', () => {
  const F = datasetFacts();

  it('the rounded-down claims are true of the live counts', () => {
    expect(toNumber(F.claim.bic)!).toBeLessThanOrEqual(F.bicEntries);
    expect(toNumber(F.claim.lei)!).toBeLessThanOrEqual(F.leiEnriched);
    expect(toNumber(F.claim.chClearing)!).toBeLessThanOrEqual(F.chClearing);
    expect(Number(F.claim.countries)).toBe(F.ibanCountries);
  });

  it('no file claims more rows than exist', () => {
    // The ceiling for a figure depends on which dataset the unit names.
    const ceilingFor = (unit: string): number => {
      const u = unit.toLowerCase();
      if (/six|bankmaster|clearing|bc-nummer|swiss|schweiz|suisse/.test(u)) return F.chClearing;
      if (u.startsWith('lei')) return F.leiEnriched;
      return F.bicEntries;
    };

    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file).split('\\').join('/');
      if (SKIP_FILES.has(rel) || rel.endsWith('.test.ts')) continue;
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      // Skip anything that already derives its numbers.
      for (const line of text.split('\n')) {
        if (line.includes('claim.')) continue;
        for (const m of line.matchAll(CLAIM)) {
          const value = toNumber(m[2]);
          if (value === null) continue;
          const ceiling = ceilingFor(m[3]);
          // Under 100 is a version or a price, not a dataset size.
          if (value < 100) continue;
          if (value > ceiling) {
            offenders.push(`${rel}: "${m[0].trim()}" claims ${value}, data holds ${ceiling}`);
          }
        }
      }
    }

    expect(offenders, `Overstated dataset claims:\n${offenders.join('\n')}`).toEqual([]);
  });
});

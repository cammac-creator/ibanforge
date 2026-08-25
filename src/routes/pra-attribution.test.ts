import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPraListMonth, getPraBanksCount } from '../lib/pra-banks.js';

/**
 * The Bank of England's permission to use the "List of PRA-regulated Banks"
 * (25/08/2026) is conditional: attribution to the Bank of England **together
 * with the month of the list**. That makes the month a licence term, not a
 * freshness detail — a public surface still naming 2026-08 after the list has
 * moved on is a breach, and a silent one.
 *
 * The API's own /llms.txt cannot rot: it calls praAttribution() and reads the
 * month out of the serving database. The static surfaces can — a translation
 * string and a text file cannot call a function. This test is what stops them:
 * it pins every written month against the month actually loaded, so the monthly
 * refresh turns a stale credit line into a red build instead of a quiet
 * licence violation.
 *
 * Fixing a failure here means editing the files listed below to the new month,
 * in the same commit as the data. Never by relaxing this assertion.
 */
const ROOT = join(import.meta.dirname, '..', '..');

/** Every static surface that must carry the credit, and must carry it dated. */
const SURFACES = [
  'frontend/public/llms.txt',
  'frontend/public/llms-full.txt',
  'frontend/messages/en.json',
  'frontend/messages/fr.json',
  'frontend/messages/de.json',
  'frontend/content/en/docs/data-sources.mdx',
  'frontend/content/fr/docs/data-sources.mdx',
  'frontend/content/de/docs/data-sources.mdx',
];

const CREDIT = /Bank of England \(List of Banks, (\d{4}-\d{2})\)/g;

const loaded = getPraBanksCount() > 0;

describe('Bank of England attribution', () => {
  it.each(SURFACES)('%s names the Bank of England with a month', (relative) => {
    const text = readFileSync(join(ROOT, relative), 'utf8');
    const months = [...text.matchAll(CREDIT)].map((m) => m[1]);
    // Presence first: the credit disappearing is the same breach as the credit
    // being wrong, and a bare "Bank of England" with no month does not satisfy
    // the condition either.
    expect(months.length).toBeGreaterThan(0);
  });

  it.skipIf(!loaded).each(SURFACES)('%s names the month actually loaded', (relative) => {
    const text = readFileSync(join(ROOT, relative), 'utf8');
    const months = [...text.matchAll(CREDIT)].map((m) => m[1]);
    for (const month of months) {
      expect(month).toBe(getPraListMonth());
    }
  });
});

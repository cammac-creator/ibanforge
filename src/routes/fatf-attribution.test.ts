import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FATF_ACCESSED_ON,
  FATF_AS_OF,
  FATF_PLENARY_OPENED_ON,
  fatfCitation,
} from '../lib/compliance-static.js';

/**
 * The FATF permits commercial use of its data on one condition: credit in its
 * own citation format, "FATF (year), (dataset name), (data source) DOI or URL
 * (accessed on (date))" (terms read 26/08/2026, docs/data-sources.md). The
 * year and the access date are part of that credit, so a surface still citing
 * June's lists after the October plenary is a wrong attribution, and a silent
 * one: nothing else reads these pages.
 *
 * fatfCitation() builds the credit from FATF_AS_OF and FATF_ACCESSED_ON. The
 * static surfaces below cannot call it; this test pins them to it. Fixing a
 * failure means editing those files in the same commit as the new dates,
 * never relaxing an assertion.
 */
const ROOT = join(import.meta.dirname, '..', '..');

/** Every static surface that carries the FATF credit. */
const SURFACES = [
  'NOTICE',
  'docs/data-sources.md',
  'frontend/content/en/docs/data-sources.mdx',
  'frontend/content/fr/docs/data-sources.mdx',
  'frontend/content/de/docs/data-sources.mdx',
];

describe('FATF attribution', () => {
  it('the access date is a real day, not before the plenary opened, not in the future', () => {
    for (const day of [FATF_ACCESSED_ON, FATF_PLENARY_OPENED_ON]) {
      expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10)).toBe(day);
    }
    // The plenary day belongs to the plenary month the lists are dated by.
    expect(FATF_PLENARY_OPENED_ON.startsWith(`${FATF_AS_OF}-`)).toBe(true);
    // A plenary bump that forgets the access date lands here: the lists of an
    // October plenary cannot have been read in July.
    expect(FATF_ACCESSED_ON >= FATF_PLENARY_OPENED_ON).toBe(true);
    expect(new Date(`${FATF_ACCESSED_ON}T00:00:00Z`).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('the citation follows the FATF format, with the year and a dated access', () => {
    const citation = fatfCitation();
    expect(citation).toMatch(
      /^FATF \(\d{4}\), High-Risk and Other Monitored Jurisdictions, FATF public statements of the [A-Z][a-z]+ \d{4} plenary, https:\/\/www\.fatf-gafi\.org \(accessed on \d{1,2} [A-Z][a-z]+ \d{4}\)\.$/,
    );
    expect(citation.startsWith(`FATF (${FATF_AS_OF.slice(0, 4)}),`)).toBe(true);
    // Today's values, spelled out once so a reader sees what the pages say.
    if (FATF_AS_OF === '2026-06' && FATF_ACCESSED_ON === '2026-07-10') {
      expect(citation).toContain('June 2026 plenary');
      expect(citation).toContain('(accessed on 10 July 2026).');
    }
  });

  it.each(SURFACES)('%s carries the citation built from the current dates', (relative) => {
    const text = readFileSync(join(ROOT, relative), 'utf8');
    expect(text).toContain(fatfCitation());
    // The undated form this replaced must not survive next to it.
    expect(text).not.toMatch(/accessed at each plenary/i);
  });
});

import { describe, expect, it } from 'vitest';
import { nameOf, resolveCountry, UNKNOWN_LABEL } from './country';

/**
 * The shapes below are the real ones. The 27/07/2026 measurement found 42
 * distinct labels for 80 rows; these are one of each class it contained.
 */
describe('resolveCountry', () => {
  it('folds the three spellings of one country onto one code', () => {
    // The single most common defect in the field: sixteen rows said "Suisse",
    // three said "Switzerland", one said "CH", and they counted as three
    // different places.
    for (const v of ['Suisse', 'Switzerland', 'CH', 'suisse', ' SUISSE ']) {
      expect(resolveCountry(v).code).toBe('CH');
    }
  });

  it('folds the French and English names of the same country', () => {
    expect(resolveCountry('Allemagne').code).toBe('DE');
    expect(resolveCountry('Germany').code).toBe('DE');
    expect(resolveCountry('DE').code).toBe('DE');
    expect(resolveCountry('Italie').code).toBe('IT');
    expect(resolveCountry('Spain').code).toBe('ES');
    expect(resolveCountry('Espagne').code).toBe('ES');
    expect(resolveCountry('Pays-Bas').code).toBe('NL');
    expect(resolveCountry('Netherlands').code).toBe('NL');
    expect(resolveCountry('Suède').code).toBe('SE');
    expect(resolveCountry('Islande').code).toBe('IS');
    expect(resolveCountry('Belgique').code).toBe('BE');
    expect(resolveCountry('Poland').code).toBe('PL');
    // Found by running the resolver over the real eighty rows: ICU names the
    // deprecated FX ("France métropolitaine") as plain "France" in English, and
    // it was taking the six French rows off FR.
    expect(resolveCountry('France').code).toBe('FR');
    expect(resolveCountry('france').code).toBe('FR');
  });

  it('accepts the everyday abbreviations no display name covers', () => {
    expect(resolveCountry('USA').code).toBe('US');
    expect(resolveCountry('United States').code).toBe('US');
    expect(resolveCountry('UK').code).toBe('GB');
    expect(resolveCountry('United Kingdom').code).toBe('GB');
    expect(resolveCountry('GB').code).toBe('GB');
  });

  it('takes the country out of a value that carries a comment', () => {
    expect(resolveCountry('USA (Texas)').code).toBe('US');
    expect(resolveCountry('USA (New York City)').code).toBe('US');
    expect(resolveCountry('Royaume-Uni (Londres)').code).toBe('GB');
    expect(resolveCountry('Estonie (UE)').code).toBe('EE');
    expect(resolveCountry('Lituanie (UE)').code).toBe('LT');
    expect(resolveCountry('Chypre (UE)').code).toBe('CY');
    expect(resolveCountry('United States (global; covered in Swiss fintech press, EU corridors)').code).toBe('US');
  });

  it('takes the first of several countries, and keeps the text', () => {
    // Lossy and deliberately so: a row in one bucket beats a row in none, and
    // the raw string is right there beside the code.
    const r = resolveCountry('Switzerland / Austria');
    expect(r.code).toBe('CH');
    expect(r.raw).toBe('Switzerland / Austria');
    expect(resolveCountry('Hong Kong / Singapore').code).toBe('HK');
    expect(resolveCountry('Switzerland / EU').code).toBe('CH');
  });

  it('buckets a value that names no country, rather than dropping the row', () => {
    // The four "Unknown (...)" sentences and the two "Global (...)" ones. They
    // must show as their own row in any breakdown: silently omitting them
    // would make a geography cut claim a completeness it does not have.
    for (const v of [
      'Unknown (US-oriented stack: Stripe/Mercury/QuickBooks/Xero)',
      'Unknown (built on the Payouts.com platform; not stated on page)',
      'Unknown (author profile lists no location)',
      'Inconnu (non vérifié sur le site ni le repo)',
      'Global (online, EU-targeted)',
      'Global (online, agent-infrastructure)',
    ]) {
      const r = resolveCountry(v);
      expect(r.code).toBeNull();
      expect(r.label).toBe(UNKNOWN_LABEL);
      expect(r.raw).toBe(v);
    }
  });

  it('does not match a country named inside a comment it should ignore', () => {
    // "not stated on page" contains no country; but a naive contains() would
    // find "Canada" in the value below and file a Czech company under Canada.
    expect(resolveCountry('EU (Czech Republic / Canada entities)').code).toBeNull();
  });

  it('handles empty, missing and whitespace', () => {
    for (const v of [null, undefined, '', '   ']) {
      const r = resolveCountry(v);
      expect(r.code).toBeNull();
      expect(r.label).toBe(UNKNOWN_LABEL);
    }
    expect(resolveCountry(null).raw).toBeNull();
  });

  it('labels a resolved country in French', () => {
    expect(resolveCountry('Switzerland').label).toBe('Suisse');
    expect(resolveCountry('DE').label).toBe('Allemagne');
  });

  it('resolves the bare two-letter codes the sourcing used', () => {
    expect(resolveCountry('ZA').code).toBe('ZA');
    expect(resolveCountry('TH').code).toBe('TH');
    expect(resolveCountry('IL').code).toBe('IL');
    expect(resolveCountry('CZ').code).toBe('CZ');
  });
});

describe('nameOf', () => {
  it('names a code in French', () => {
    expect(nameOf('CH')).toBe('Suisse');
  });

  it('gives back the code when the runtime has no name for it', () => {
    expect(nameOf('QQ')).toBe('QQ');
  });
});

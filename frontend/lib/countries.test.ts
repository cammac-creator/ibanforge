import { describe, expect, it } from 'vitest';
import { allCountryCodes, countriesFile, getCountry } from './countries';

/** ISO 13616 mod-97, chunked so the number never leaves the safe range. */
function mod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let expanded = '';
  for (const ch of rearranged) expanded += /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
  let rem = 0;
  for (let i = 0; i < expanded.length; i += 7) rem = Number(`${rem}${expanded.slice(i, i + 7)}`) % 97;
  return rem;
}

/**
 * The exported file is data the pages trust blindly, so the trust is checked
 * here once: every country has a valid example of the stated length, and the
 * BBAN fields sit in order inside it.
 */
describe('data/countries.json', () => {
  const file = countriesFile();

  it('covers every ISO 13616 country the API validates', () => {
    expect(file.count).toBe(allCountryCodes().length);
    expect(file.count).toBeGreaterThanOrEqual(80);
  });

  it.each(allCountryCodes())('%s: example, length and layout agree', (cc) => {
    const entry = getCountry(cc)!;
    expect(entry.example.length).toBe(entry.length);
    expect(entry.example.slice(0, 2)).toBe(cc);
    expect(mod97(entry.example)).toBe(1);
    expect(entry.api.valid).toBe(true);
    // Ordered, never overlapping, inside the IBAN. Not necessarily tiling it:
    // fourteen countries keep national check digits, a currency code or an
    // account type between or after the three fields (IT's CIN, BE's last
    // two digits, MU's currency).
    let cursor = 5;
    for (const f of entry.fields) {
      expect(f.from).toBeGreaterThanOrEqual(cursor);
      expect(f.to).toBeGreaterThanOrEqual(f.from);
      expect(f.to).toBeLessThanOrEqual(entry.length);
      cursor = f.to + 1;
    }
    expect(entry.fields.map((f) => f.name)).toContain('bank_code');
    expect(entry.fields.map((f) => f.name)).toContain('account_number');
  });

  it('refuses what is not a two-letter code', () => {
    expect(getCountry('ch')).toBeNull();
    expect(getCountry('CHE')).toBeNull();
    expect(getCountry('ZZ')).toBeNull();
  });
});

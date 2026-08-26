import { describe, it, expect } from 'vitest';
import {
  ADDRESS_SCHEMES,
  CBPR_NOTE,
  checkPostalAddress,
  type AddressFinding,
  type AddressScheme,
  type AddressToCheck,
} from './address-conformity.js';

function find(scheme: AddressScheme, address: AddressToCheck, rule: string): AddressFinding {
  const finding = checkPostalAddress(scheme, address).findings.find((f) => f.rule === rule);
  if (!finding) throw new Error(`scheme ${scheme} ran no rule "${rule}"`);
  return finding;
}

/** An address that conforms everywhere, used as the base for one-defect variants. */
const clean: AddressToCheck = {
  strt_nm: 'Bahnhofstrasse',
  bldg_nb: '45',
  pst_cd: '8001',
  twn_nm: 'Zurich',
  ctry: 'CH',
};

describe('every finding carries the document it comes from', () => {
  it.each(ADDRESS_SCHEMES)('%s names a dated source on each rule, passing or failing', (scheme) => {
    for (const finding of checkPostalAddress(scheme, clean).findings) {
      expect(finding.source, `${scheme}/${finding.rule}`).toMatch(/\d{4}/); // a year is in there
      expect(finding.source.length, `${scheme}/${finding.rule}`).toBeGreaterThan(40);
      expect(finding.detail, `${scheme}/${finding.rule}`).not.toBe('');
    }
  });

  it('sources the Swiss rules to the SIX guidelines and the Fedwire ones to the Federal Reserve', () => {
    expect(find('sps', clean, 'adr_tp_forbidden').source).toContain('SIX');
    expect(find('sps', clean, 'twn_nm_required').source).toContain('14 November 2026');
    expect(find('fedwire', clean, 'twn_nm_required').source).toContain('Federal Reserve');
    expect(find('fedwire', clean, 'twn_nm_required').source).toContain('16 November 2026');
    expect(find('hvps_plus', clean, 'twn_nm_ctry_required_if_no_adr_line').source).toContain('R2026.NOV');
  });

  it('says on every answer why there is no cbpr+ scheme', () => {
    for (const scheme of ADDRESS_SCHEMES) {
      expect(checkPostalAddress(scheme, clean).note).toBe(CBPR_NOTE);
    }
    expect(CBPR_NOTE).toContain('swift.com');
    expect(ADDRESS_SCHEMES).not.toContain('cbpr+' as AddressScheme);
  });
});

describe('sps — the strictest corpus, and the only one that could be read in full', () => {
  it('passes a complete structured Swiss address', () => {
    const result = checkPostalAddress('sps', clean);
    expect(result.conforms).toBe(true);
    expect(result.findings.map((f) => f.rule)).toEqual([
      'twn_nm_required',
      'ctry_required',
      'ctry_iso3166',
      'adr_tp_forbidden',
      'adr_line_max_2',
      'adr_line_max_length_70',
      'adr_line_no_repeat',
    ]);
  });

  it('fails on a missing TwnNm — mandatory unconditionally', () => {
    const f = find('sps', { ...clean, twn_nm: undefined }, 'twn_nm_required');
    expect(f.verdict).toBe('fail');
    expect(checkPostalAddress('sps', { ...clean, twn_nm: undefined }).conforms).toBe(false);
  });

  it('fails on a missing Ctry', () => {
    expect(find('sps', { ...clean, ctry: undefined }, 'ctry_required').verdict).toBe('fail');
  });

  it('fails on a whitespace-only TwnNm, which is not a town', () => {
    expect(find('sps', { ...clean, twn_nm: '   ' }, 'twn_nm_required').verdict).toBe('fail');
  });

  it('fails when AdrTp is sent at all — SPS marks it "N — Must not be sent"', () => {
    const f = find('sps', { ...clean, adr_tp: 'ADDR' }, 'adr_tp_forbidden');
    expect(f.verdict).toBe('fail');
    expect(f.detail).toContain('ADDR');
  });

  it('fails past two AdrLine', () => {
    const f = find('sps', { ...clean, adr_line: ['a', 'b', 'c'] }, 'adr_line_max_2');
    expect(f.verdict).toBe('fail');
    expect(f.detail).toContain('3 AdrLine');
  });

  it('fails on an AdrLine over 70 characters', () => {
    const f = find('sps', { ...clean, adr_line: ['x'.repeat(71)] }, 'adr_line_max_length_70');
    expect(f.verdict).toBe('fail');
    expect(f.detail).toContain('71');
  });

  it('fails when an AdrLine repeats a value already served structurally', () => {
    const f = find('sps', { ...clean, adr_line: ['8001 Zurich'] }, 'adr_line_no_repeat');
    expect(f.verdict).toBe('fail');
    expect(f.detail).toContain('PstCd + TwnNm');
  });

  it('flags a segment inside a line, not only a whole line', () => {
    const f = find('sps', { ...clean, adr_line: ['c/o Societe Alpha, Zurich'] }, 'adr_line_no_repeat');
    expect(f.verdict).toBe('fail');
    expect(f.detail).toContain('TwnNm');
  });

  it('does NOT flag a street name that merely contains the town', () => {
    // A checker that invents violations is worse than one that misses subtle
    // ones: "Rue de Lausanne 5" in Lausanne is not a repetition of TwnNm.
    const f = find(
      'sps',
      { twn_nm: 'Lausanne', ctry: 'CH', adr_line: ['Rue de Lausanne 5'] },
      'adr_line_no_repeat',
    );
    expect(f.verdict).toBe('pass');
  });

  it('reports every violation separately rather than stopping at the first', () => {
    const result = checkPostalAddress('sps', {
      twn_nm: 'Zurich',
      ctry: 'ch',
      pst_cd: '8001',
      adr_tp: 'ADDR',
      adr_line: ['8001 Zurich', 'x'.repeat(80), 'third'],
    });

    expect(result.conforms).toBe(false);
    const failed = result.findings.filter((f) => f.verdict === 'fail').map((f) => f.rule);
    expect(failed).toEqual([
      'ctry_iso3166',
      'adr_tp_forbidden',
      'adr_line_max_2',
      'adr_line_max_length_70',
      'adr_line_no_repeat',
    ]);
    // Each violation carries its own source, so a caller can quote the document
    // to whoever produced the address.
    for (const f of result.findings) expect(f.source).toContain('SIX');
  });
});

describe('ctry_iso3166 — applied on all three rails, sourced per rail', () => {
  it.each(ADDRESS_SCHEMES)('%s rejects a lowercase country code', (scheme) => {
    const f = find(scheme, { ...clean, ctry: 'ch' }, 'ctry_iso3166');
    expect(f.verdict).toBe('fail');
    expect(f.detail).toContain('uppercase');
  });

  it.each(ADDRESS_SCHEMES)('%s rejects a three-letter code', (scheme) => {
    expect(find(scheme, { ...clean, ctry: 'CHE' }, 'ctry_iso3166').verdict).toBe('fail');
  });

  it.each(ADDRESS_SCHEMES)('%s rejects a well-formed but unassigned code', (scheme) => {
    const f = find(scheme, { ...clean, ctry: 'XX' }, 'ctry_iso3166');
    expect(f.verdict).toBe('fail');
    expect(f.detail).toContain('not an assigned');
  });

  it.each(ADDRESS_SCHEMES)('%s accepts an assigned alpha-2 code', (scheme) => {
    expect(find(scheme, { ...clean, ctry: 'GB' }, 'ctry_iso3166').verdict).toBe('pass');
  });

  it('is not_applicable rather than a second failure when Ctry is simply absent', () => {
    expect(find('sps', { twn_nm: 'Zurich' }, 'ctry_iso3166').verdict).toBe('not_applicable');
  });

  it('says out loud, on the two rails that do not restate the format, where alpha-2 comes from', () => {
    for (const scheme of ['fedwire', 'hvps_plus'] as const) {
      expect(find(scheme, clean, 'ctry_iso3166').source).toContain('CountryCode data type');
      expect(find(scheme, clean, 'ctry_iso3166').source).toContain('iso20022.org unreachable');
    }
    // SPS states it outright, so it borrows nothing.
    expect(find('sps', clean, 'ctry_iso3166').source).not.toContain('unreachable');
  });
});

describe('fedwire — town and country unconditionally, two lines of 70, and nothing invented', () => {
  it('runs exactly the rules the Federal Reserve page states', () => {
    expect(checkPostalAddress('fedwire', clean).findings.map((f) => f.rule)).toEqual([
      'twn_nm_required',
      'ctry_required',
      'ctry_iso3166',
      'adr_line_max_2',
      'adr_line_max_length_70',
    ]);
  });

  it('requires TwnNm even when AdrLine is present — unlike T2', () => {
    const address = { ctry: 'US', adr_line: ['1 Some Street'] };
    expect(find('fedwire', address, 'twn_nm_required').verdict).toBe('fail');
    expect(checkPostalAddress('fedwire', address).conforms).toBe(false);
  });

  it('borrows neither the AdrTp prohibition nor the non-repetition rule from SPS', () => {
    // The Federal Reserve page states neither, and the upstream PMPG document it
    // points to is on swift.com and could not be read. Silence is reported as
    // silence: we run no rule rather than import the Swiss one.
    const rules = checkPostalAddress('fedwire', { ...clean, adr_tp: 'ADDR', adr_line: ['8001 Zurich'] })
      .findings.map((f) => f.rule);
    expect(rules).not.toContain('adr_tp_forbidden');
    expect(rules).not.toContain('adr_line_no_repeat');
  });

  it('fails past two lines', () => {
    expect(find('fedwire', { ...clean, adr_line: ['a', 'b', 'c'] }, 'adr_line_max_2').verdict).toBe('fail');
  });
});

describe('hvps_plus — the same requirement, but conditional, which is why there is a scheme parameter', () => {
  it('requires TownName and Country only when AddressLine is absent', () => {
    const f = find('hvps_plus', { adr_line: ['Bundesplatz 1', '3003 Bern'] }, 'twn_nm_ctry_required_if_no_adr_line');
    expect(f.verdict).toBe('not_applicable');
    expect(checkPostalAddress('hvps_plus', { adr_line: ['Bundesplatz 1'] }).conforms).toBe(true);
  });

  it('fails when AddressLine is absent and TownName or Country is missing', () => {
    const missingBoth = find('hvps_plus', {}, 'twn_nm_ctry_required_if_no_adr_line');
    expect(missingBoth.verdict).toBe('fail');
    expect(missingBoth.detail).toContain('TownName');
    expect(missingBoth.detail).toContain('Country');

    const missingCtry = find('hvps_plus', { twn_nm: 'Bern' }, 'twn_nm_ctry_required_if_no_adr_line');
    expect(missingCtry.verdict).toBe('fail');
    expect(missingCtry.detail).toContain('Country');
    expect(missingCtry.detail).not.toContain('TownName,');
  });

  it('does not cap AddressLine, because the fetched T2 appendix caps nothing', () => {
    const rules = checkPostalAddress('hvps_plus', { adr_line: ['a', 'b', 'c', 'd', 'e'] }).findings.map(
      (f) => f.rule,
    );
    expect(rules).not.toContain('adr_line_max_2');
    expect(checkPostalAddress('hvps_plus', { adr_line: ['a', 'b', 'c', 'd', 'e'] }).conforms).toBe(true);
  });

  it('says that the fetched document does not forbid an AddressLine-only address', () => {
    const f = find('hvps_plus', { adr_line: ['Bundesplatz 1'] }, 'twn_nm_ctry_required_if_no_adr_line');
    expect(f.detail).toContain('does not forbid');
    expect(f.detail).toContain('MyStandards');
  });
});

describe('conforms is false on a failure and unaffected by a rule that did not run', () => {
  it('ignores not_applicable', () => {
    const result = checkPostalAddress('sps', clean);
    expect(result.findings.some((f) => f.verdict === 'not_applicable')).toBe(true);
    expect(result.conforms).toBe(true);
  });

  it('is false as soon as one rule fails', () => {
    expect(checkPostalAddress('sps', { ...clean, adr_tp: 'ADDR' }).conforms).toBe(false);
  });
});

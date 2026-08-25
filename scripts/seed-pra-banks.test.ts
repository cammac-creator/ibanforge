import { describe, it, expect } from 'vitest';
import { parseCsvRecords, parsePraList, normaliseLei } from './seed-pra-banks.js';

/**
 * The fixture below is the published layout with invented firms.
 *
 * Every trap in it is one the real August 2026 file actually contains, and each
 * cost a parser somewhere:
 *  - a UTF-8 BOM, which becomes part of the first field if not stripped;
 *  - preamble prose carrying a comma INSIDE its quotes, which `split(',')` cuts
 *    in half;
 *  - "as at" followed by TWO spaces before the date;
 *  - `,,` spacer rows between every block;
 *  - four sections, the second heading its LEI column "Head Office LEI";
 *  - a firm name with a comma inside quotes;
 *  - a LEI prefixed with an apostrophe (Excel's "this is text" escape).
 *
 * Bank names are invented (this repository is public). The section headings and
 * the preamble wording are the file's own — the parser matches on them, so a
 * paraphrase here would test nothing.
 */
const FIXTURE =
  '﻿' +
  [
    '"BANK OF ENGLAND (PRA)",,',
    '"This document provides a list of Authorised Firms, it does not supersede the Financial Service Register which should be referred to as the most accurate and up to date source of information.",,',
    ',,',
    '"List of PRA-regulated Banks as at  01 August 2026",,',
    ',,',
    '"Banks incorporated in the UK authorised to accept deposits",,',
    ',,',
    '"Firm Name","FRN","LEI"',
    '"Alpha Bank Example Plc","100001","ALPHA000000000000001"',
    '"BETA EXAMPLE BANK, LIMITED","100002","BETA0000000000000002"',
    '"Gamma Example Bank Plc","100003","GAMMA000000000000003"',
    ',,',
    ',,',
    '"Banks incorporated outside the UK authorised to accept deposits through a branch in the UK",,',
    ',,',
    '"Firm Name","FRN","Head Office LEI"',
    '"Delta Example Bank NV","200001","DELTA000000000000004"',
    '"Epsilon Example Bank SA","200002","\'12345678901234567890"',
    ',,',
    ',,',
    '"Banks incorporated in Gibraltar authorised to accept deposits through a branch or service in the UK",,',
    ',,',
    '"Firm Name","FRN","LEI"',
    '"Zeta Example Bank (Gibraltar) Ltd","300001","ZETA0000000000000005"',
    ',,',
    ',,',
    '"Banks incorporated in the EEA authorised to accept deposits through a branch in the UK while in Supervised Run Off (SRO)",,',
    ',,',
    '"Firm Name","FRN","LEI"',
    '"Eta Example Banque SA","400001","ETA00000000000000006"',
  ].join('\n');

describe('parseCsvRecords', () => {
  it('strips the UTF-8 BOM instead of gluing it to the first field', () => {
    const records = parseCsvRecords('﻿"A","B"');
    expect(records[0][0]).toBe('A');
  });

  it('keeps a comma that sits inside a quoted field', () => {
    // The real preamble and the real firm "ARBUTHNOT LATHAM & CO., LIMITED"
    // both do this; split(',') turns each into two broken fields.
    const records = parseCsvRecords('"BETA EXAMPLE BANK, LIMITED","100002","BETA0000000000000002"');
    expect(records[0]).toEqual(['BETA EXAMPLE BANK, LIMITED', '100002', 'BETA0000000000000002']);
  });

  it('reads a doubled quote as one literal quote', () => {
    expect(parseCsvRecords('"say ""hi""",2')[0]).toEqual(['say "hi"', '2']);
  });

  it('does not let a newline inside quotes shift the following rows', () => {
    const records = parseCsvRecords('"one\ntwo",3\n"x",4');
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(['one\ntwo', '3']);
    expect(records[1]).toEqual(['x', '4']);
  });
});

describe('normaliseLei', () => {
  it('drops the Excel apostrophe the BoE file carries on at least one row', () => {
    expect(normaliseLei("'12345678901234567890")).toBe('12345678901234567890');
  });

  it('accepts a plain 20-character identifier and upper-cases it', () => {
    expect(normaliseLei('alpha000000000000001')).toBe('ALPHA000000000000001');
  });

  it('answers null rather than guessing at anything that is not an LEI', () => {
    // A stored null simply never joins. A mangled value would join the WRONG
    // firm, which is the failure this function exists to prevent.
    expect(normaliseLei('')).toBeNull();
    expect(normaliseLei(undefined)).toBeNull();
    expect(normaliseLei('TOO-SHORT')).toBeNull();
    expect(normaliseLei('ALPHA0000000000000012345')).toBeNull();
    expect(normaliseLei('ALPHA00000000000000 1')).toBeNull();
  });
});

describe('parsePraList', () => {
  const parsed = parsePraList(FIXTURE);

  it('reads the attribution month through the double space', () => {
    // "as at  01 August 2026" — two spaces. A literal-space regex fails here,
    // and the month is the condition of the Bank of England's permission.
    expect(parsed.list_month).toBe('2026-08');
  });

  it('keeps every firm and drops every spacer, heading and header row', () => {
    expect(parsed.rows).toHaveLength(7);
    expect(parsed.rows.map((r) => r.frn)).toEqual([
      '100001',
      '100002',
      '100003',
      '200001',
      '200002',
      '300001',
      '400001',
    ]);
  });

  it('assigns each firm to the section it was published under', () => {
    const bySection = parsed.rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.section] = (acc[r.section] ?? 0) + 1;
      return acc;
    }, {});
    expect(bySection).toEqual({
      uk_incorporated: 3,
      non_uk_branch: 2,
      gibraltar_branch: 1,
      eea_sro_branch: 1,
    });
  });

  it('records that the branch section publishes the HEAD OFFICE LEI', () => {
    // Read from the column header, not assumed from the section: this is the
    // fact that stops a Dutch parent's own BICs from inheriting a UK
    // deposit-taking authorisation.
    expect(parsed.rows.find((r) => r.frn === '100001')?.lei_basis).toBe('lei');
    expect(parsed.rows.find((r) => r.frn === '200001')?.lei_basis).toBe('head_office_lei');
  });

  it('keeps a firm name that contains a comma intact', () => {
    expect(parsed.rows.find((r) => r.frn === '100002')?.firm_name).toBe('BETA EXAMPLE BANK, LIMITED');
  });

  it('normalises the apostrophe-escaped LEI', () => {
    expect(parsed.rows.find((r) => r.frn === '200002')?.lei).toBe('12345678901234567890');
  });

  it('refuses a file whose preamble carries no date', () => {
    // No clock fallback anywhere. Publishing the attribution with a month we
    // invented is the one failure of this ingestion that cannot be undone.
    const undated = FIXTURE.replace('"List of PRA-regulated Banks as at  01 August 2026",,', ',,');
    expect(() => parsePraList(undated)).toThrow(/preamble/i);
  });

  it('fails loudly on a section heading it does not know', () => {
    // A heading swallowed in silence is a whole block of banks reported as
    // unknown. Better a red build than a quiet hole in the data.
    const extended = `${FIXTURE}\n,,\n"Banks incorporated on the Moon authorised to accept deposits",,\n,,\n"Firm Name","FRN","LEI"\n"Theta Example Bank Plc","500001","THETA000000000000007"`;
    expect(() => parsePraList(extended)).toThrow(/Unknown section heading/);
  });

  it('fails loudly on an LEI column header it does not know', () => {
    const relabelled = FIXTURE.replace('"Firm Name","FRN","Head Office LEI"', '"Firm Name","FRN","Parent LEI"');
    expect(() => parsePraList(relabelled)).toThrow(/LEI column header/);
  });
});

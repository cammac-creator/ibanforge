import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  readTable,
  detectColumns,
  auditTable,
  auditFile,
  previewRows,
  buildWorkbook,
  maskIban,
  tierFor,
  AuditFileError,
  AUDIT_MAX_ROWS,
} from './audit-file.js';

const VALID_CH = 'CH1000230000000012345';
const UNALLOCATED_CH = 'CH9300762011623852957';
const VALID_DE = 'DE89370400440532013000';
const BAD_CHECK = 'CH1000230000000012346';
const VALID_GB = 'GB29NWBK60161331926819';

function csv(lines: string[]): Buffer {
  return Buffer.from(lines.join('\n'), 'utf8');
}

function xlsx(aoa: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Feuil1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('readTable', () => {
  it('reads a semicolon CSV with a header', () => {
    const t = readTable(
      csv([
        'Nom;IBAN;BIC',
        `Alpha SA;${VALID_CH};POFICHBEXXX`,
        `Beta GmbH;${VALID_DE};COBADEFFXXX`,
      ]),
      'creanciers.csv',
    );
    expect(t.headers).toEqual(['Nom', 'IBAN', 'BIC']);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]![1]).toBe(VALID_CH);
  });

  it('reads an XLSX and keeps IBANs as text', () => {
    const t = readTable(
      xlsx([
        ['Creditor', 'IBAN'],
        ['Alpha', VALID_CH],
      ]),
      'file.xlsx',
    );
    expect(t.headers).toEqual(['Creditor', 'IBAN']);
    expect(t.rows[0]![1]).toBe(VALID_CH);
  });

  it('refuses an empty sheet and a header-only sheet', () => {
    expect(() => readTable(csv(['']), 'a.csv')).toThrow(AuditFileError);
    expect(() => readTable(csv(['IBAN']), 'a.csv')).toThrow(/no data rows/);
  });

  it('refuses more rows than the cap', () => {
    const lines = ['IBAN', ...Array.from({ length: AUDIT_MAX_ROWS + 1 }, () => VALID_CH)];
    expect(() => readTable(csv(lines), 'big.csv')).toThrow(/at most/);
  });
});

describe('detectColumns', () => {
  it('finds the IBAN column by header, in three languages', () => {
    expect(detectColumns(['Nom', 'IBAN', 'BIC'], []).iban).toBe(1);
    expect(detectColumns(['Empfänger', 'IBAN-Nr', 'PLZ', 'Ort'], [])).toMatchObject({
      iban: 1,
      name: 0,
      postal: 2,
      city: 3,
    });
    expect(detectColumns(['Supplier', 'Bank account IBAN', 'Country'], [])).toMatchObject({
      iban: 1,
      name: 0,
      country: 2,
    });
  });

  it('finds the IBAN column by content when no header says it', () => {
    const rows = [
      ['Alpha', VALID_CH, 'Lausanne'],
      ['Beta', VALID_DE, 'Berlin'],
    ];
    expect(detectColumns(['a', 'b', 'c'], rows).iban).toBe(1);
  });

  it('throws when nothing looks like an IBAN', () => {
    expect(() => detectColumns(['a', 'b'], [['x', 'y']])).toThrow(/No column holds IBANs/);
  });
});

describe('auditTable', () => {
  it('flags invalid, duplicate and BIC-mismatch rows and leaves clean rows OK', () => {
    const headers = ['Nom', 'IBAN', 'BIC'];
    const rows = [
      ['Alpha SA', VALID_CH, ''],
      ['Beta GmbH', VALID_DE, 'COBADEFFXXX'],
      ['Gamma', BAD_CHECK, ''],
      ['Alpha SA bis', VALID_CH, ''],
      ['Delta', '', ''],
      ['Epsilon', VALID_DE, 'DEUTDEFFXXX'],
      ['Zeta', UNALLOCATED_CH, ''],
    ];
    const res = auditTable(headers, rows);
    expect(res.summary.rows).toBe(7);
    const byLine = new Map(res.rows.map((r) => [r.line, r]));
    expect(byLine.get(1)!.status).toBe('ok');
    expect(byLine.get(1)!.bank_name).toBeTruthy();
    expect(byLine.get(3)!.findings.map((f) => f.code)).toContain('iban_invalid');
    expect(byLine.get(3)!.status).toBe('error');
    expect(byLine.get(4)!.findings.map((f) => f.code)).toContain('duplicate');
    expect(byLine.get(5)!.findings.map((f) => f.code)).toEqual(['iban_missing']);
    expect(byLine.get(6)!.findings.map((f) => f.code)).toContain('bic_mismatch');
    expect(byLine.get(7)!.findings.map((f) => f.code)).toContain('bank_code_not_allocated');
    expect(byLine.get(7)!.status).toBe('error');
    expect(res.summary.error).toBe(3);
    expect(res.summary.by_code.duplicate).toBe(2);
    expect(res.summary.tier).toBe('standard');
    expect(res.summary.price_chf).toBe(149);
  });

  it('checks the postal address against the Swiss structured rules when address columns exist', () => {
    const headers = ['Name', 'IBAN', 'Adresse', 'NPA', 'Ville', 'Pays'];
    const rows = [
      ['Alpha SA', VALID_CH, 'Rue du Lac 12', '1003', 'Lausanne', 'CH'],
      ['Beta SA', VALID_CH, 'Case postale', '', '', 'Suisse'],
      ['Gamma GmbH', VALID_DE, 'Hauptstrasse 1', '10115', 'Berlin', 'Suisse'],
    ];
    const res = auditTable(headers, rows);
    expect(res.summary.address_checked).toBe(true);
    expect(res.rows[0]!.address_verdict).toBe('pass');
    expect(res.rows[0]!.status).toBe('ok');
    expect(res.rows[1]!.address_verdict).toBe('fail');
    expect(res.rows[1]!.findings.map((f) => f.code)).toContain('address_not_structured');
    expect(res.rows[2]!.findings.map((f) => f.code)).toContain('country_mismatch');
  });

  it('flags a country mismatch between the address and the IBAN', () => {
    const res = auditTable(['IBAN', 'Pays'], [[VALID_DE, 'Suisse']]);
    expect(res.rows[0]!.findings.map((f) => f.code)).toContain('country_mismatch');
  });

  it('marks a GB account as outside SEPA reach only if the engine says so, never as an error', () => {
    const res = auditTable(['IBAN'], [[VALID_GB]]);
    expect(res.rows[0]!.status).not.toBe('error');
  });
});

describe('rendering', () => {
  it('masks IBANs in the preview and lists flagged rows first', () => {
    const res = auditTable(['IBAN'], [[VALID_CH], [BAD_CHECK]]);
    const p = previewRows(res, 20);
    expect(p[0]!.line).toBe(2);
    expect(p[0]!.iban_masked).toBe('CH10 **** 2346');
    expect(p[0]!.iban_masked).not.toContain('0023');
    expect(maskIban(null, '')).toBe('');
  });

  it('builds a workbook with the source columns, the audit columns and a summary sheet', () => {
    const res = auditFile(csv(['Nom;IBAN', `Alpha;${VALID_CH}`, `Gamma;${BAD_CHECK}`]), 'x.csv');
    const buf = buildWorkbook(res, 'fr');
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Audit', 'Synthèse']);
    const aoa = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Audit']!, { header: 1 });
    expect(aoa[0]!.slice(0, 4)).toEqual(['Nom', 'IBAN', 'Statut', 'Constats']);
    expect(aoa[2]![2]).toBe('Ne pas payer');
    expect(aoa[2]![3]).toContain('IBAN invalide');
  });

  it('tiers by row count', () => {
    expect(tierFor(5000).price_chf).toBe(149);
    expect(tierFor(5001).price_chf).toBe(349);
  });
});

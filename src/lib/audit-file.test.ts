import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { countLines } from './audit-file.js';
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
  SHEET_ROWS_CAP,
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
    expect(res.summary.price).toBe(149);
    expect(res.summary.currency).toBe('USD');
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
    expect(tierFor(5000).price).toBe(149);
    expect(tierFor(5001).price).toBe(349);
  });
});

/**
 * Audit of 22/09/2026: a clean line read the same whatever the country, so a
 * file of Italian creditors came back as green as a file of German ones —
 * although no Italian register was consulted at all. What a SILENCE is worth
 * is the whole question when the deliverable is "what would the bank refuse",
 * and it belongs in the free preview as much as in the paid workbook: hiding
 * it behind the paywall would sell the reassurance rather than the check.
 */
describe('the audit says, per country, whether a register settles an absence', () => {
  // Germany is authoritative (Bundesbank), San Marino partial (the BCSM lists
  // banks, not the allocation of the code space), Italy has no register here.
  const VALID_IT = 'IT60X0542811101000000123456';
  const VALID_SM = 'SM86U0322509800000000270100';

  it('carries the three states per row and counts them once in the summary', () => {
    const res = auditTable(['IBAN'], [[VALID_DE], [VALID_SM], [VALID_IT], [BAD_CHECK]]);
    const byLine = new Map(res.rows.map((r) => [r.line, r]));
    expect(byLine.get(1)!.register_basis).toBe('authoritative');
    expect(byLine.get(1)!.register).toContain('Bundesbank');
    expect(byLine.get(2)!.register_basis).toBe('partial');
    expect(byLine.get(3)!.register_basis).toBe('none');
    expect(byLine.get(3)!.register).toBeNull();
    // An IBAN that does not validate has no country, so no register question.
    expect(byLine.get(4)!.register_basis).toBe('none');

    const countries = new Map(res.summary.countries.map((c) => [c.code, c]));
    expect(countries.get('DE')!.register_basis).toBe('authoritative');
    expect(countries.get('SM')!.register_basis).toBe('partial');
    expect(countries.get('IT')!.register_basis).toBe('none');
    // San Marino and Italy: two rows no register could have contradicted. The
    // unreadable row is excluded — it has no country to judge.
    expect(res.summary.rows_without_authoritative_register).toBe(2);
  });

  it('puts it in the free preview, not only in the paid workbook', () => {
    const res = auditTable(['IBAN'], [[VALID_IT], [VALID_DE]]);
    const basis = previewRows(res, 20).map((p) => p.register_basis);
    expect(basis).toContain('none');
    expect(basis).toContain('authoritative');
  });

  it('gives the workbook a column and the summary sheet a line, in the page language', () => {
    const res = auditFile(csv(['IBAN', VALID_DE, VALID_IT]), 'x.csv');
    const wb = XLSX.read(buildWorkbook(res, 'fr'), { type: 'buffer' });
    const aoa = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Audit']!, { header: 1 });
    const col = aoa[0]!.indexOf('Registre national');
    expect(col).toBeGreaterThan(0);
    expect(aoa[1]![col]).toContain('non attribué');
    expect(aoa[2]![col]).toContain('aucun');

    const flat = XLSX.utils
      .sheet_to_json<string[]>(wb.Sheets['Synthèse']!, { header: 1 })
      .map((r) => r.join(' | '))
      .join('\n');
    expect(flat).toContain('Registres nationaux');
    expect(flat).toMatch(/IT — aucun/);
  });
});

/**
 * Adversarial review of 07/09/2026, A1: the row cap used to run after the
 * whole sheet had been parsed. Now the parser stops at the cap and text is
 * counted before it is decoded — an oversized file is refused for the price
 * of reading its size, not its content.
 */
describe('readTable — the cap is enforced before the parse', () => {
  it('refuses an XLSX far above the cap without materialising it', () => {
    const aoa: unknown[][] = [
      ['IBAN'],
      ...Array.from({ length: AUDIT_MAX_ROWS + 20_000 }, () => [VALID_CH]),
    ];
    const buffer = xlsx(aoa);
    // Le refus compte les lignes que l'analyseur a réellement matérialisées :
    // `SHEET_ROWS_CAP` moins l'en-tête, une de plus que le plafond, jamais les
    // quarante mille du fichier. Une lecture sans `sheetRows` les compterait
    // toutes. Vérifié par ce nombre et non plus par un chronomètre : une borne
    // de 1,5 s tombait dès que la machine était occupée, sans rien dire du code.
    expect(() => readTable(buffer, 'big.xlsx')).toThrow(
      `The sheet has ${SHEET_ROWS_CAP - 1} rows; the audit takes at most ${AUDIT_MAX_ROWS}.`,
    );
    expect(aoa.length - 1).toBeGreaterThan(SHEET_ROWS_CAP);
  });

  it('refuses a text file by its line count, before decoding it', () => {
    const lines = ['IBAN', ...Array.from({ length: AUDIT_MAX_ROWS + 1 }, () => VALID_CH)];
    expect(() => readTable(csv(lines), 'big.csv')).toThrow(/more than/);
    // Exactly at the cap: allowed, and parsed normally.
    const atCap = ['IBAN', ...Array.from({ length: AUDIT_MAX_ROWS }, () => VALID_CH)];
    expect(readTable(csv(atCap), 'cap.csv').rows.length).toBe(AUDIT_MAX_ROWS);
  });

  /**
   * The row guard throws INSIDE the try block that wraps the parser, so until
   * 22/09/2026 the catch below it relabelled a perfectly formed file as
   * `unreadable` — blaming the customer's export for a limit that is ours.
   * The code is what the site turns into "split the file", so the code is what
   * this pins; a message check would have passed throughout the bug.
   */
  it('keeps the too_many_rows CODE, in text and in a workbook', () => {
    const lines = ['IBAN', ...Array.from({ length: AUDIT_MAX_ROWS + 1 }, () => VALID_CH)];
    expect(() => readTable(csv(lines), 'big.csv')).toThrow(
      expect.objectContaining({ code: 'too_many_rows' }),
    );
    const aoa: unknown[][] = [
      ['IBAN'],
      ...Array.from({ length: AUDIT_MAX_ROWS + 5 }, () => [VALID_CH]),
    ];
    expect(() => readTable(xlsx(aoa), 'big.xlsx')).toThrow(
      expect.objectContaining({ code: 'too_many_rows' }),
    );
    // A genuinely broken file still gets the honest verdict.
    expect(() =>
      readTable(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]), 'broken.xlsx'),
    ).toThrow(expect.objectContaining({ code: 'unreadable' }));
  });

  it('counts lines on bytes, with and without a trailing newline', () => {
    expect(countLines(Buffer.from(''))).toBe(0);
    expect(countLines(Buffer.from('a'))).toBe(1);
    expect(countLines(Buffer.from('a\n'))).toBe(1);
    expect(countLines(Buffer.from('a\nb'))).toBe(2);
    expect(countLines(Buffer.from('a\r\nb\r\n'))).toBe(2);
  });
});

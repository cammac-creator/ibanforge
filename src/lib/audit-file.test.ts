import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';
import * as XLSX from 'xlsx';
import { countLines } from './audit-file.js';
import { SAMPLE_CREDITOR_CSV } from './audit-sample.js';
import {
  readTable,
  readDelimitedText,
  delimitedExtent,
  detectColumns,
  auditTable,
  auditFile,
  previewRows,
  buildWorkbook,
  findingLabel,
  maskIban,
  tierFor,
  AuditFileError,
  AUDIT_MAX_ROWS,
  AUDIT_MAX_CELLS,
  AUDIT_MAX_COLUMNS,
  AUDIT_MAX_UNZIPPED_BYTES,
  AUDIT_MAX_ZIP_ENTRIES,
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

  it('never leaves a line OK when its bank could not be consulted (29/09/2026)', () => {
    // Estonia is in the euro area and SEPA: no other finding would fire. Since
    // its bank-code data was withdrawn, nothing identifies the bank, and the
    // line must say so rather than read as a checked bank.
    const res = auditTable(['IBAN'], [['EE382200221020145685']]);
    const row = res.rows[0]!;
    expect(row.findings.map((f) => f.code)).toEqual(['bank_not_consulted']);
    expect(row.status).toBe('warning');
    expect(findingLabel('bank_not_consulted', 'fr')).toBe('Banque non consultée');
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
  // banks, not the allocation of the code space), Spain has no register here.
  // (L'Italie servait d'exemple « sans registre » jusqu'au 25/09/2026 ; elle a
  // depuis un registre partiel, celui de la Banca d'Italia.)
  const VALID_ES = 'ES9121000418450200051332';
  const VALID_SM = 'SM86U0322509800000000270100';

  it('carries the three states per row and counts them once in the summary', () => {
    const res = auditTable(['IBAN'], [[VALID_DE], [VALID_SM], [VALID_ES], [BAD_CHECK]]);
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
    expect(countries.get('ES')!.register_basis).toBe('none');
    // San Marino and Spain: two rows no register could have contradicted. The
    // unreadable row is excluded — it has no country to judge.
    expect(res.summary.rows_without_authoritative_register).toBe(2);
  });

  it('puts it in the free preview, not only in the paid workbook', () => {
    const res = auditTable(['IBAN'], [[VALID_ES], [VALID_DE]]);
    const basis = previewRows(res, 20).map((p) => p.register_basis);
    expect(basis).toContain('none');
    expect(basis).toContain('authoritative');
  });

  it('gives the workbook a column and the summary sheet a line, in the page language', () => {
    const res = auditFile(csv(['IBAN', VALID_DE, VALID_ES]), 'x.csv');
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
    expect(flat).toMatch(/ES — aucun/);
  });
});

/**
 * Adversarial review of 07/09/2026, A1: the row cap used to run after the
 * whole sheet had been parsed. Now the parser stops at the cap and text is
 * counted before it is decoded — an oversized file is refused for the price
 * of reading its size, not its content.
 */
describe('readTable — the cap is enforced before the parse', () => {
  // Fabriquer puis relire un classeur de quarante mille lignes prend plusieurs
  // secondes sur une machine occupée : 5,3 s mesurées le 23/09/2026 sous
  // charge, au-delà du délai par défaut de vitest. Ce délai explicite n'est
  // qu'un filet, la durée n'étant plus ce que le test affirme.
  const BIG_WORKBOOK_TIMEOUT_MS = 60_000;

  it(
    'refuses an XLSX far above the cap without materialising it',
    () => {
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
    },
    BIG_WORKBOOK_TIMEOUT_MS,
  );

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

/**
 * La clé de contrôle nationale (26/09/2026) : une ligne dont la clé RIB, les
 * chiffres belges, le CIN ou le DC ne concordent pas est un constat bloquant,
 * comme le contrôle britannique : la ligne passe à « Ne pas payer ».
 *
 * Les IBAN en échec sont ceux des tests du module (`national-check/*.test.ts`) :
 * les exemples officiels du registre IBAN, un chiffre du compte ou du code agence
 * altéré, chiffres ISO recalculés, calculés hors du code testé. Ils passent donc
 * le modulo 97 : c'est exactement le cas que la clé nationale attrape.
 */
describe('a failed national check key stops the row, like the UK check', () => {
  const GOOD_FR = 'FR1420041010050500013M02606';
  const FAILED: Array<[string, string]> = [
    ['FR', 'FR9620041010050500014M02606'],
    ['MC', 'MC7411222000010123456789130'],
    ['BE', 'BE34539007548034'],
    ['IT', 'IT68X0542811102000000123456'],
    ['SM', 'SM59U0322509800000000270101'],
    ['ES', 'ES6421000418450200051333'],
  ];

  it('flags each country as an error, with the detail of the module, and counts it once', () => {
    const res = auditTable(['IBAN'], [[GOOD_FR], ...FAILED.map(([, iban]) => [iban])]);
    const good = res.rows[0]!;
    expect(good.findings.map((f) => f.code)).not.toContain('national_check_digits_failed');
    expect(good.status).not.toBe('error');

    FAILED.forEach(([cc, iban], i) => {
      const row = res.rows[i + 1]!;
      expect(row.iban, cc).toBe(iban);
      const hits = row.findings.filter((f) => f.code === 'national_check_digits_failed');
      expect(hits, cc).toHaveLength(1);
      expect(hits[0]!.detail, cc).toMatch(/cannot have been issued as written/);
      expect(row.status, cc).toBe('error');
      // Le champ next_steps de la ligne (AuditRow, jamais servi : ni colonne du
      // classeur, ni aperçu) porte l'étape de l'API, telle quelle.
      expect(row.next_steps, cc).toContain('national_check_digits_failed');
    });
    expect(res.summary.by_code.national_check_digits_failed).toBe(FAILED.length);
    expect(res.summary.error).toBe(FAILED.length);
  });

  it('Germany: an official-level fail stops the row, a second-level fail only warns (06.10.2026)', () => {
    // 10070000 : méthode 63, vérifiée sur les numéros officiels (premier niveau).
    // 37040044 : méthode 13, publiée sans numéro de test (second niveau).
    const res = auditTable(
      ['IBAN'],
      [['DE90100700000123457600'], ['DE55370400440532014000'], ['DE89370400440532013000']],
    );
    const [official, second, good] = res.rows;
    expect(official!.findings.map((f) => f.code)).toContain('national_check_digits_failed');
    expect(official!.status).toBe('error');
    expect(second!.findings.map((f) => f.code)).toContain('national_check_digits_suspect');
    expect(second!.findings.map((f) => f.code)).not.toContain('national_check_digits_failed');
    expect(second!.status).not.toBe('error');
    expect(second!.next_steps).toContain('national_check_digits_suspect');
    const codes = good!.findings.map((f) => f.code);
    expect(codes).not.toContain('national_check_digits_suspect');
    expect(codes).not.toContain('national_check_digits_failed');
    expect(findingLabel('national_check_digits_suspect', 'en')).toBe(
      'German account check digit fails (warning)',
    );
    expect(findingLabel('national_check_digits_suspect', 'fr')).toBe(
      'Clé du compte allemand en échec (avertissement)',
    );
    expect(findingLabel('national_check_digits_suspect', 'de')).toBe(
      'Deutsche Kontoprüfziffer fehlgeschlagen (Warnung)',
    );
  });

  it('names the finding in the three languages, in the workbook and in the free preview', () => {
    expect(findingLabel('national_check_digits_failed', 'en')).toBe('National check key fails');
    expect(findingLabel('national_check_digits_failed', 'fr')).toBe(
      'Clé de contrôle nationale en échec',
    );
    expect(findingLabel('national_check_digits_failed', 'de')).toBe(
      'Nationale Prüfziffer fehlgeschlagen',
    );

    const res = auditFile(csv(['Nom;IBAN', `Alpha;${GOOD_FR}`, `Beta;${FAILED[0]![1]}`]), 'x.csv');
    const wb = XLSX.read(buildWorkbook(res, 'fr'), { type: 'buffer' });
    const aoa = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Audit']!, { header: 1 });
    expect(aoa[2]![2]).toBe('Ne pas payer');
    expect(aoa[2]![3]).toContain('Clé de contrôle nationale en échec');
    const summary = XLSX.utils
      .sheet_to_json<Array<string | number>>(wb.Sheets['Synthèse']!, { header: 1 })
      .map((r) => r.join(' | '))
      .join('\n');
    expect(summary).toContain('Clé de contrôle nationale en échec | 1');

    const preview = previewRows(res, 20);
    expect(preview[0]!.line).toBe(2);
    expect(preview[0]!.status).toBe('error');
    expect(preview[0]!.findings).toContain('national_check_digits_failed');
  });
});

/**
 * L'étape QR-IBAN de validate_iban (29.10.2026) arrive dans l'audit de fichier
 * par `row.next_steps`, qui recopie les codes d'étape de l'API. Ce champ n'est
 * servi nulle part : le classeur payant n'a pas de colonne next_steps, l'aperçu
 * gratuit et la synthèse ne le lisent pas. Une ligne QR-IBAN se lit donc
 * exactement comme l'IBAN ordinaire de la même banque : même état, mêmes
 * constats, mêmes cellules d'audit.
 */
describe('a QR-IBAN line reads like the ordinary IBAN of the same bank', () => {
  const QR = 'CH3130700123000889012'; // QR-IID 30700, attribué par SIX
  const PLAIN = 'CH0900700123000889012'; // IID 00700, même banque

  it('carries the step in row.next_steps only, and renders the same in workbook and preview', () => {
    const res = auditFile(csv(['Nom;IBAN', `Alpha;${QR}`, `Beta;${PLAIN}`]), 'x.csv');
    const [qr, plain] = res.rows;
    expect(qr!.next_steps).toContain('qr_iban_requires_qr_reference');
    expect(plain!.next_steps).not.toContain('qr_iban_requires_qr_reference');
    expect(qr!.status).toBe(plain!.status);
    expect(qr!.status).toBe('ok');
    expect(qr!.findings).toEqual(plain!.findings);
    expect(res.summary.ok).toBe(2);

    for (const lang of ['fr', 'de', 'en'] as const) {
      const wb = XLSX.read(buildWorkbook(res, lang), { type: 'buffer' });
      const aoa = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]!]!, {
        header: 1,
      });
      // Après les deux colonnes source (Nom, IBAN) : les colonnes d'audit.
      expect(aoa[1]!.slice(2), lang).toEqual(aoa[2]!.slice(2));
      const cells = wb.SheetNames.flatMap((name) =>
        XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name]!, { header: 1 }).flat(),
      ).map(String);
      expect(cells.join('\n'), lang).not.toContain('qr_iban_requires_qr_reference');
    }

    const preview = previewRows(res, 20);
    expect(preview).toHaveLength(2);
    for (const row of preview) expect(Object.keys(row)).not.toContain('next_steps');
    const strip = ({ line: _l, iban_masked: _m, ...rest }: (typeof preview)[number]) => rest;
    expect(strip(preview[0]!)).toEqual(strip(preview[1]!));
  });
});

// ---------------------------------------------------------------------------
// Garde de décompression (SEC-02, audit du 10.11.2026)
// ---------------------------------------------------------------------------

interface ZipPart {
  name: string;
  /** Le contenu réel de la partie. */
  data: Buffer;
  /** Le même contenu déjà compressé, pour ne compresser qu'une fois un gros contenu. */
  deflated?: Buffer;
  /** Méthode de l'archive : 8 (compressée, par défaut) ou 0 (stockée). */
  method?: 0 | 8;
  /** Taille décompressée annoncée par le répertoire central (vraie par défaut). */
  cdSize?: number;
  /** Taille décompressée annoncée par l'en-tête local (vraie par défaut). */
  localSize?: number;
  /** Bit 3 : tailles locales à zéro et descripteur de données, comme en écriture en flux. */
  streamed?: boolean;
  /** Un enregistrement du répertoire qui pointe sur les octets d'une partie précédente. */
  sameBytesAs?: number;
  /** Bloc « extra » de l'en-tête local. */
  localExtra?: Buffer;
  /** Bloc « extra » de l'enregistrement du répertoire central. */
  cdExtra?: Buffer;
}

/** Un petit écrivain zip, assez pour fabriquer en mémoire les archives que la garde doit lire. */
function zipOf(parts: ZipPart[]): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = Buffer.from(part.name, 'latin1');
    const method = part.method ?? 8;
    const body = method === 0 ? part.data : (part.deflated ?? deflateRawSync(part.data));
    const size = part.data.length;
    const crc = crc32(part.data);
    const flags = part.streamed ? 0x08 : 0;
    let at = offset;
    if (part.sameBytesAs === undefined) {
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0);
      head.writeUInt16LE(20, 4);
      head.writeUInt16LE(flags, 6);
      head.writeUInt16LE(method, 8);
      head.writeUInt32LE(part.streamed ? 0 : crc, 14);
      head.writeUInt32LE(part.streamed ? 0 : body.length, 18);
      head.writeUInt32LE(part.streamed ? 0 : (part.localSize ?? size), 22);
      head.writeUInt16LE(name.length, 26);
      const localExtra = part.localExtra ?? Buffer.alloc(0);
      head.writeUInt16LE(localExtra.length, 28);
      const pieces = [head, name, localExtra, body];
      if (part.streamed) {
        const descriptor = Buffer.alloc(16);
        descriptor.writeUInt32LE(0x08074b50, 0);
        descriptor.writeUInt32LE(crc, 4);
        descriptor.writeUInt32LE(body.length, 8);
        descriptor.writeUInt32LE(part.cdSize ?? size, 12);
        pieces.push(descriptor);
      }
      const local = Buffer.concat(pieces);
      locals.push(local);
      offset += local.length;
    } else {
      at = offsets[part.sameBytesAs]!;
    }
    offsets.push(at);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(flags, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(part.cdSize ?? size, 24);
    entry.writeUInt16LE(name.length, 28);
    const cdExtra = part.cdExtra ?? Buffer.alloc(0);
    entry.writeUInt16LE(cdExtra.length, 30);
    entry.writeUInt32LE(at, 42);
    directory.push(Buffer.concat([entry, name, cdExtra]));
  }
  const dir = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

/** Un flux deflate de `count` blocs Huffman dynamiques qui ne produisent rien. */
function emptyDynamicBlocks(count: number): Buffer {
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  const put = (value: number, length: number) => {
    for (let i = 0; i < length; i++) {
      acc |= ((value >> i) & 1) << bits;
      if (++bits === 8) {
        bytes.push(acc);
        acc = 0;
        bits = 0;
      }
    }
  };
  const putCode = (code: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) put((code >> i) & 1, 1);
  };
  const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  const lengthOf = (s: number) => (s >= 1 && s <= 15 ? 4 : s === 0 || s === 18 ? 5 : 0);
  const codeOf = (s: number) => (s >= 1 && s <= 15 ? s - 1 : s === 0 ? 30 : 31);
  for (let b = 0; b < count; b++) {
    put(b === count - 1 ? 1 : 0, 1);
    put(2, 2);
    put(0, 5);
    put(0, 5);
    put(15, 4);
    for (const s of order) put(lengthOf(s), 3);
    for (let s = 2; s <= 15; s++) putCode(codeOf(s), 4);
    putCode(codeOf(15), 4);
    putCode(codeOf(18), 5);
    put(127, 7);
    putCode(codeOf(18), 5);
    put(92, 7);
    putCode(codeOf(1), 4);
    putCode(codeOf(0), 5);
    put(0, 1);
  }
  if (bits) bytes.push(acc);
  return Buffer.from(bytes);
}

const SHEET_HEAD =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
const SHEET_TAIL = '</sheetData></worksheet>';

/** Une feuille en chaînes en ligne, sans table de chaînes partagées. */
function sheetXml(aoa: string[][]): Buffer {
  const col = (c: number) => String.fromCharCode(65 + c);
  const rows = aoa.map(
    (row, r) =>
      `<row r="${r + 1}">` +
      row
        .map((v, c) => `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t>${v}</t></is></c>`)
        .join('') +
      '</row>',
  );
  return Buffer.from(SHEET_HEAD + rows.join('') + SHEET_TAIL, 'utf8');
}

/** Les parties d'un classeur minimal ; `sheets` donne le nom et le contenu de chaque feuille. */
function workbookParts(sheets: Array<{ name: string; xml: Partial<ZipPart> & { data: Buffer } }>) {
  const rel = (i: number) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`;
  const parts: ZipPart[] = [
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          sheets
            .map(
              (_, i) =>
                `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
            )
            .join('') +
          '</Types>',
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
          sheets
            .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
            .join('') +
          '</sheets></workbook>',
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          sheets.map((_, i) => rel(i)).join('') +
          '</Relationships>',
      ),
    },
  ];
  sheets.forEach((s, i) => parts.push({ name: `xl/worksheets/sheet${i + 1}.xml`, ...s.xml }));
  return parts;
}

const MB = 1024 * 1024;

describe('la garde de décompression refuse un classeur qui gonfle au-delà du plafond', () => {
  // Une feuille qui dépasse le plafond une fois décompressée, compressée une
  // seule fois pour tout le bloc.
  const head = sheetXml([['IBAN'], [VALID_CH]]);
  const bigSheet = Buffer.concat([
    head.subarray(0, head.length - SHEET_TAIL.length),
    Buffer.alloc(61 * MB, 0x20),
    Buffer.from(SHEET_TAIL),
  ]);
  let bigDeflated: Buffer;
  beforeAll(() => {
    bigDeflated = deflateRawSync(bigSheet);
    expect(bigSheet.length).toBeGreaterThan(AUDIT_MAX_UNZIPPED_BYTES);
    expect(bigDeflated.length).toBeLessThan(MB);
  });

  function bomb(overrides: Partial<ZipPart> = {}): Buffer {
    return zipOf(
      workbookParts([
        { name: 'Feuil1', xml: { data: bigSheet, deflated: bigDeflated, ...overrides } },
      ]),
    );
  }

  function refusal(fn: () => unknown): AuditFileError {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(AuditFileError);
      return e as AuditFileError;
    }
    throw new Error('aucun refus');
  }

  it('refuse en file_too_large, en moins de 200 ms, une feuille de plus de 60 Mo aux tailles honnêtes', () => {
    const file = bomb();
    const started = performance.now();
    const e = refusal(() => auditFile(file, 'bombe.xlsx'));
    const elapsed = performance.now() - started;
    expect(e.code).toBe('file_too_large');
    expect(e.message).toBe(
      `The workbook expands to more than ${AUDIT_MAX_UNZIPPED_BYTES / MB} MB once unzipped; the audit reads at most that much.`,
    );
    expect(elapsed).toBeLessThan(200);
  });

  // Les tailles déclarées ne suffisent pas : la garde mesure la taille réelle.
  it('mesure la taille réelle quand les en-têtes la sous-déclarent', () => {
    const e = refusal(() => readTable(bomb({ cdSize: 1000, localSize: 1000 }), 'bombe.xlsx'));
    expect(e.code).toBe('file_too_large');
  });

  it('mesure la taille réelle d’une partie écrite en flux, tailles locales à zéro', () => {
    const e = refusal(() => readTable(bomb({ streamed: true, cdSize: 1000 }), 'bombe.xlsx'));
    expect(e.code).toBe('file_too_large');
  });

  it('refuse une taille locale sur-déclarée, que SheetJS réserverait d’emblée', () => {
    const tiny = sheetXml([['IBAN'], [VALID_CH]]);
    const file = zipOf(
      workbookParts([{ name: 'Feuil1', xml: { data: tiny, localSize: 0xfffffff0 } }]),
    );
    const e = refusal(() => readTable(file, 'petit.xlsx'));
    expect(e.code).toBe('file_too_large');
  });

  // Dans un zip régulier, chaque partie a ses propres octets.
  const OVERLAP = 'The file could not be read as CSV or XLSX (overlapping zip entries).';

  it('refuse des enregistrements qui relisent les octets d’une même partie', () => {
    const chunk = Buffer.alloc(2 * MB, 0x20);
    const parts = workbookParts([
      { name: 'Feuil1', xml: { data: sheetXml([['IBAN'], [VALID_CH]]) } },
    ]);
    const first = parts.length;
    parts.push({ name: 'xl/media/a.bin', data: chunk });
    for (let i = 0; i < 31; i++)
      parts.push({ name: `xl/media/b${i}.bin`, data: chunk, sameBytesAs: first });
    const e = refusal(() => readTable(zipOf(parts), 'recouvrement.xlsx'));
    expect(e.code).toBe('unreadable');
    expect(e.message).toBe(OVERLAP);
  });

  it('refuse aussi la relecture d’un flux qui ne produit rien', () => {
    const emptyBlock = Buffer.from([0x00, 0x00, 0x00, 0xff, 0xff]);
    const stream = Buffer.concat([
      ...Array.from({ length: Math.floor(MB / emptyBlock.length) }, () => emptyBlock),
      Buffer.from([0x03, 0x00]),
    ]);
    const parts = workbookParts([
      { name: 'Feuil1', xml: { data: sheetXml([['IBAN'], [VALID_CH]]) } },
    ]);
    const first = parts.length;
    parts.push({ name: 'xl/media/vide.bin', data: Buffer.alloc(0), deflated: stream });
    for (let i = 0; i < 64; i++)
      parts.push({
        name: `xl/media/v${i}.bin`,
        data: Buffer.alloc(0),
        deflated: stream,
        sameBytesAs: first,
      });
    const e = refusal(() => readTable(zipOf(parts), 'vide.xlsx'));
    expect(e.code).toBe('unreadable');
    expect(e.message).toBe(OVERLAP);
  });

  it('compte, pour une partie stockée, la taille compressée ZIP64 du répertoire', () => {
    // SheetJS retient cette taille-là quand l'en-tête local porte un bloc
    // « extra » : la vue qu'il garde va jusqu'à la fin de l'archive.
    const zip64 = Buffer.alloc(20);
    zip64.writeUInt16LE(0x0001, 0);
    zip64.writeUInt16LE(16, 2);
    zip64.writeUInt32LE(3, 4);
    zip64.writeUInt32LE(MB, 12);
    const unknownExtra = Buffer.from([0xfe, 0xca, 0x00, 0x00]);
    const stored: ZipPart = {
      name: 'xl/media/s.bin',
      data: Buffer.from('abc'),
      method: 0,
      localExtra: unknownExtra,
      cdExtra: zip64,
    };
    const parts = [
      stored,
      ...workbookParts([{ name: 'Feuil1', xml: { data: sheetXml([['IBAN'], [VALID_CH]]) } }]),
      { ...stored, name: 'xl/media/t.bin', sameBytesAs: 0 },
    ];
    const e = refusal(() => readTable(zipOf(parts), 'stockee.xlsx'));
    expect(e.code).toBe('unreadable');
    expect(e.message).toBe(OVERLAP);
  });

  /**
   * SheetJS décompresse avec zlib, comme la garde (11.11.2026). Le flux
   * ci-dessous, fait de blocs vides que zlib lit vite, prenait des secondes au
   * décodeur JavaScript de SheetJS, sans dépasser aucun plafond de la garde.
   */
  it('lit en quelques millisecondes une partie que le décodeur JavaScript lisait en secondes', () => {
    const parts = workbookParts([
      { name: 'Feuil1', xml: { data: sheetXml([['IBAN'], [VALID_CH]]) } },
    ]);
    parts.push({
      name: 'xl/media/x.bin',
      data: Buffer.alloc(0),
      deflated: emptyDynamicBlocks(10_000),
    });
    const file = zipOf(parts);
    const started = performance.now();
    const t = readTable(file, 'blocs.xlsx');
    const elapsed = performance.now() - started;
    expect(t.rows).toEqual([[VALID_CH]]);
    expect(elapsed).toBeLessThan(1000);
  });

  it('passe la garde même quand l’archive porte un nom de fichier texte', () => {
    const e = refusal(() => readTable(bomb(), 'bombe.csv'));
    expect(e.code).toBe('file_too_large');
  });

  it('refuse plus de parties qu’un classeur n’en compte', () => {
    const parts = workbookParts([
      { name: 'Feuil1', xml: { data: sheetXml([['IBAN'], [VALID_CH]]) } },
    ]);
    for (let i = 0; i < AUDIT_MAX_ZIP_ENTRIES; i++)
      parts.push({ name: `x/${i}`, data: Buffer.alloc(0) });
    expect(refusal(() => readTable(zipOf(parts), 'parties.xlsx')).code).toBe('file_too_large');
  });

  it('refuse un fichier Numbers et une archive qui n’est pas un classeur, en unreadable', () => {
    const numbers = zipOf([{ name: 'Index/Document.iwa', data: Buffer.from('x') }]);
    expect(refusal(() => readTable(numbers, 'f.numbers')).code).toBe('unreadable');
    // L'archive des modules Google Sheets que le site propose : même verdict et
    // même message que SheetJS rendait avant la garde.
    const dir = new URL('../../frontend/public/integrations/', import.meta.url);
    const name = readdirSync(dir).find((f) => /^ibanforge-sheets-.*\.zip$/.test(f));
    expect(name).toBeDefined();
    const e = refusal(() => readTable(readFileSync(new URL(name!, dir)), name!));
    expect(e.code).toBe('unreadable');
    expect(e.message).toBe('The file could not be read as CSV or XLSX (Unsupported ZIP file).');
  });

  it('lit un classeur légitime écrit en flux (tailles locales à zéro) comme le même en texte', () => {
    const aoa = SAMPLE_CREDITOR_CSV.split('\n').map((l) => l.split(';'));
    const parts = workbookParts([{ name: 'Feuil1', xml: { data: sheetXml(aoa) } }]).map((p) => ({
      ...p,
      streamed: true,
    }));
    const got = auditFile(zipOf(parts), 'flux.xlsx');
    const want = auditFile(Buffer.from(SAMPLE_CREDITOR_CSV, 'utf8'), 'exemple-creanciers.csv');
    expect(got.rows).toEqual(want.rows);
    expect(got.summary).toEqual(want.summary);
  });

  it('ne lit que la première feuille', () => {
    // Deux feuilles du même nom : SheetJS range chaque feuille lue sous son nom,
    // la seconde écraserait la première si elle était lue.
    const file = zipOf(
      workbookParts([
        { name: 'Feuil1', xml: { data: sheetXml([['IBAN'], [VALID_CH]]) } },
        { name: 'Feuil1', xml: { data: sheetXml([['IBAN'], [VALID_DE], [VALID_GB]]) } },
      ]),
    );
    const t = readTable(file, 'deux.xlsx');
    expect(t.rows).toEqual([[VALID_CH]]);
  });
});

/**
 * L'OpenDocument est refusé, zippé comme à plat (10.11.2026) : SheetJS y crée
 * des cellules sans borne, avant toute borne de plage. Les fichiers ci-dessous
 * restent petits : le refus se voit sans peser sur la suite.
 */
describe('l’OpenDocument est refusé, zippé comme à plat', () => {
  const NS =
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';
  const BODY =
    '<office:body><office:spreadsheet><table:table table:name="Feuil1">' +
    '<table:table-row><table:table-cell office:value-type="string"><text:p>IBAN</text:p></table:table-cell></table:table-row>' +
    '<table:table-row table:number-rows-repeated="200"><table:table-cell table:number-columns-repeated="1000" office:value-type="string">' +
    `<text:p>${VALID_CH}</text:p></table:table-cell></table:table-row>` +
    '</table:table></office:spreadsheet></office:body>';
  const flat = `<?xml version="1.0" encoding="UTF-8"?><office:document ${NS} office:version="1.2">${BODY}</office:document>`;

  function refusal(fn: () => unknown): AuditFileError {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(AuditFileError);
      return e as AuditFileError;
    }
    throw new Error('aucun refus');
  }

  it('refuse un .ods zippé, en unreadable', () => {
    const ods = zipOf([
      { name: 'mimetype', data: Buffer.from('application/vnd.oasis.opendocument.spreadsheet') },
      {
        name: 'META-INF/manifest.xml',
        data: Buffer.from(
          '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/></manifest:manifest>',
        ),
      },
      {
        name: 'styles.xml',
        data: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${NS} office:version="1.2"/>`,
        ),
      },
      {
        name: 'content.xml',
        data: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS} office:version="1.2">${BODY}</office:document-content>`,
        ),
      },
    ]);
    const e = refusal(() => readTable(ods, 'creanciers.ods'));
    expect(e.code).toBe('unreadable');
    expect(e.message).toBe('The file could not be read as CSV or XLSX (OpenDocument file).');
  });

  it('refuse un OpenDocument à plat, en UTF-8 sous tout nom, et en UTF-16', () => {
    for (const name of ['creanciers.fods', 'creanciers.xml', 'creanciers.csv']) {
      expect(refusal(() => readTable(Buffer.from(flat, 'utf8'), name)).code, name).toBe(
        'unreadable',
      );
    }
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    expect(refusal(() => readTable(Buffer.concat([bom, Buffer.from(flat)]), 'f.xml')).code).toBe(
      'unreadable',
    );
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('\n' + flat, 'utf16le')]);
    expect(refusal(() => readTable(utf16, 'f.xml')).code).toBe('unreadable');
  });

  // Le tableau HTML, lu ici jusqu'au 10.11.2026, est refusé avec tout fichier de
  // balisage : voir « seuls les formats annoncés sont lus » ci-dessous.
  it('lit toujours un texte qui mentionne le mot', () => {
    const text = readTable(csv(['IBAN;Note', `${VALID_CH};<document> joint`]), 'f.csv');
    expect(text.rows).toEqual([[VALID_CH, '<document> joint']]);
  });
});

/**
 * Seuls les formats annoncés sont lus (10.11.2026) : CSV, TSV et autre texte
 * délimité, XLSX, XLS. Un contenu qui n'est aucun des cinq est refusé avant
 * toute lecture, et un texte passe toujours par le lecteur de texte délimité :
 * la bibliothèque ne choisit plus un autre lecteur d'après ses premiers
 * caractères. Les fichiers ci-dessous sont minimaux : c'est le refus, ou le
 * lecteur choisi, qui est vérifié.
 */
describe('seuls les formats annoncés sont lus', () => {
  const ACCEPTED =
    'The audit reads CSV, TSV and other delimited text, XLSX and XLS: save the file as CSV or XLSX and upload it again.';
  const HTML = `<html><body><table><tr><td>IBAN</td></tr><tr><td>${VALID_CH}</td></tr></table></body></html>`;
  const XML_SPREADSHEET =
    '<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
    'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Feuil1"><Table>' +
    '<Row><Cell><Data ss:Type="String">IBAN</Data></Cell></Row>' +
    `<Row><Cell><Data ss:Type="String">${VALID_CH}</Data></Cell></Row>` +
    '</Table></Worksheet></Workbook>';
  const utf16 = (text: string) =>
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);

  function refusal(fn: () => unknown): AuditFileError {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(AuditFileError);
      return e as AuditFileError;
    }
    throw new Error('aucun refus');
  }

  function expectNotAccepted(fn: () => unknown, label: string) {
    const e = refusal(fn);
    expect(e.code, label).toBe('unreadable');
    expect(e.message, label).toContain(ACCEPTED);
  }

  it('refuse un fichier de balisage sous tout nom, en UTF-8 comme en UTF-16', () => {
    for (const [kind, markup] of [
      ['html', HTML],
      ['xml', XML_SPREADSHEET],
    ] as const) {
      for (const name of ['export.xls', 'export.csv', 'export.txt', 'export.xml', 'export']) {
        expectNotAccepted(() => readTable(Buffer.from(markup), name), `${kind} ${name}`);
      }
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      expectNotAccepted(
        () => readTable(Buffer.concat([bom, Buffer.from(markup)]), 'export.xls'),
        `${kind} bom`,
      );
      expectNotAccepted(() => readTable(utf16(markup), 'export.xls'), `${kind} utf-16`);
      expectNotAccepted(() => readTable(utf16(markup), 'export.txt'), `${kind} utf-16 txt`);
    }
  });

  it('décide sur le premier caractère après les blancs, pas sur un chevron ailleurs', () => {
    // Blancs et lignes vides en tête : toujours du balisage.
    expectNotAccepted(() => readTable(Buffer.from(`\r\n \t\n${HTML}`), 'export.xls'), 'blancs');
    // Choix assumé : un texte dont la toute première cellule commence par un
    // chevron est refusé avec le balisage ; un en-tête ne commence pas ainsi.
    expectNotAccepted(
      () => readTable(csv(['<IBAN>;Nom', `${VALID_CH};Alpha`]), 'f.csv'),
      'premiere cellule',
    );
    // Du balisage dans une cellule, même en tête d'une ligne suivante : lu.
    const t = readTable(
      csv([
        'Nom;IBAN;Description',
        `Alpha SA;${VALID_CH};<b>urgent</b>`,
        `<i>Beta</i> GmbH;${VALID_DE};<a href="x">lien</a>`,
      ]),
      'creanciers.csv',
    );
    expect(t.headers).toEqual(['Nom', 'IBAN', 'Description']);
    expect(t.rows).toEqual([
      ['Alpha SA', VALID_CH, '<b>urgent</b>'],
      ['<i>Beta</i> GmbH', VALID_DE, '<a href="x">lien</a>'],
    ]);
  });

  it('refuse le balisage avant de compter les lignes', () => {
    const lines = [HTML, ...Array.from({ length: AUDIT_MAX_ROWS + 1 }, () => '<tr></tr>')];
    expectNotAccepted(() => readTable(csv(lines), 'export.xls'), 'long');
  });

  /** Une petite base dBASE III : une colonne IBAN, une ligne. */
  function dbase(): Buffer {
    const width = VALID_CH.length;
    const headerLength = 32 + 32 + 1;
    const b = Buffer.alloc(headerLength + 1 + width + 1);
    b[0] = 0x03;
    b.writeUInt32LE(1, 4);
    b.writeUInt16LE(headerLength, 8);
    b.writeUInt16LE(1 + width, 10);
    b.write('IBAN', 32, 'latin1');
    b[32 + 11] = 0x43; // « C » : texte
    b[32 + 16] = width;
    b[headerLength - 1] = 0x0d;
    b.write(` ${VALID_CH}`, headerLength, 'latin1');
    b[b.length - 1] = 0x1a;
    return b;
  }

  it('refuse un contenu qui n’est ni une archive, ni un XLS, ni du texte', () => {
    for (const name of ['creanciers.dbf', 'creanciers.xls', 'creanciers']) {
      expectNotAccepted(() => readTable(dbase(), name), `dbase ${name}`);
    }
    const binary = Buffer.concat([Buffer.from([0x00, 0x00, 0x02, 0x00]), Buffer.alloc(60)]);
    expectNotAccepted(() => readTable(binary, 'export.xls'), 'binaire');
  });

  it('lit comme du texte délimité un texte qui commence comme un format de tableur ancien', () => {
    // Chacun de ces textes serait lu par un lecteur à part, d'après son début.
    // Lus comme du texte délimité, leur première ligne devient l'en-tête.
    const cases: Array<[string, string, string]> = [
      ['sylk', `ID;P\nC;Y1;X1;K"IBAN"\nC;Y2;X1;K"${VALID_CH}"\nE\n`, 'ID'],
      [
        'dif',
        `TABLE\n0,1\n""\nDATA\n0,0\n""\n-1,0\nBOT\n1,0\n"IBAN"\n-1,0\nBOT\n1,0\n"${VALID_CH}"\n-1,0\nEOD\n`,
        'TABLE',
      ],
      [
        'socialcalc',
        `socialcalc:version:1.5\ncell:A1:t:IBAN\ncell:A2:t:${VALID_CH}\n`,
        'socialcalc:version:1.5',
      ],
      ['rtf', `{\\rtf1\n\\trowd IBAN\\cell\\row\n\\trowd ${VALID_CH}\\cell\\row\n}\n`, '{\\rtf1'],
    ];
    for (const [kind, text, header] of cases) {
      const t = readTable(Buffer.from(text), 'export.csv');
      expect(t.headers[0], kind).toBe(header);
    }
    // Un TSV ordinaire dont le début ressemble, octet pour octet, à une base dBASE.
    const tsv = readTable(csv(['10\t\tIBAN', `2\t\t${VALID_CH}`]), 'export.tsv');
    expect(tsv.headers).toEqual(['10', 'col_2', 'IBAN']);
    expect(tsv.rows).toEqual([['2', '', VALID_CH]]);
    // Un en-tête « ID » reste un CSV ordinaire.
    const id = readTable(csv(['ID;Nom;IBAN', `1;Alpha SA;${VALID_CH}`]), 'creanciers.csv');
    expect(id.headers).toEqual(['ID', 'Nom', 'IBAN']);
    expect(id.rows).toEqual([['1', 'Alpha SA', VALID_CH]]);
  });

  it('lit un XLS binaire d’après son contenu, même sous un nom de fichier texte', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['IBAN'], [VALID_CH]]), 'Feuil1');
    const xls = XLSX.write(wb, { type: 'buffer', bookType: 'xls' }) as Buffer;
    for (const name of ['creanciers.xls', 'creanciers.csv']) {
      expect(readTable(xls, name).rows, name).toEqual([[VALID_CH]]);
    }
  });

  it('lit un texte UTF-16 avec sa marque d’ordre des octets comme le même texte en UTF-8', () => {
    const want = readTable(Buffer.from(SAMPLE_CREDITOR_CSV, 'utf8'), 'exemple-creanciers.csv');
    for (const name of ['exemple-creanciers.txt', 'exemple-creanciers.xls']) {
      expect(readTable(utf16(SAMPLE_CREDITOR_CSV), name), name).toEqual(want);
    }
  });

  /**
   * Le lecteur imposé lit un texte ordinaire exactement comme la bibliothèque le
   * lisait d'elle-même : même séparateur deviné, mêmes cellules. Chaque texte
   * ci-dessous commence par une lettre, pour que la bibliothèque, laissée à
   * elle-même, choisisse aussi le texte délimité.
   */
  it('lit un texte ordinaire comme la bibliothèque le lisait, séparateur compris', () => {
    const texts = [
      'Nom,IBAN;Pays\nAlpha,CH;FR\n', // égalité virgule et point-virgule
      'Nom;IBAN|Pays|Ville\nA;B|C|D\n', // la barre verticale l'emporte
      'Nom;"a,b,c,d";IBAN\nA;B;C\n', // séparateurs entre guillemets ignorés
      'Nom\tIBAN\tPays\r\nAlpha\tCH\tFR\r\n', // tabulation, CRLF
      'Nom|IBAN\nA|B\n',
      'IBAN\nCH\n', // aucun séparateur
      'é'.repeat(1022) + ';;' + ',,,,\nA,B\n', // la fenêtre compte des caractères
      'a'.repeat(1030) + ';;;\nA;B\n', // séparateur au-delà de la fenêtre
      'sep=|\nNom|IBAN\nA|B\n', // ligne sep= déjà présente
      '﻿sep=;\nNom;IBAN\nA;B\n', // marque d'ordre des octets, puis sep=
      '﻿Nom;IBAN\nA;B\n',
      'Nom;"IBAN\nsur deux lignes";x\nA;B;C\n',
      '',
    ];
    const options = {
      type: 'string',
      raw: true,
      sheetRows: SHEET_ROWS_CAP,
      cellFormula: false,
    } as const;
    for (const text of texts) {
      const want = XLSX.read(text, options);
      const got = readDelimitedText(text);
      expect(got.SheetNames, JSON.stringify(text.slice(0, 40))).toEqual(want.SheetNames);
      expect(got.Sheets[got.SheetNames[0]!], JSON.stringify(text.slice(0, 40))).toEqual(
        want.Sheets[want.SheetNames[0]!],
      );
    }
  });
});

/**
 * La plage lue est bornée en cases, pas seulement en lignes (10.11.2026). Sous
 * le plafond, la plage reste celle d'avant.
 */
describe('la plage lue est bornée en cases', () => {
  const ROWS = 2_000;

  function refusal(fn: () => unknown): AuditFileError {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(AuditFileError);
      return e as AuditFileError;
    }
    throw new Error('aucun refus');
  }

  it('refuse en file_too_large un CSV dont une seule cellule pousse la plage jusqu’à la colonne XFD', () => {
    const lines = [
      'IBAN' + ';'.repeat(16_383) + 'x',
      ...Array.from({ length: ROWS }, () => VALID_CH),
    ];
    const file = csv(lines);
    expect(file.length).toBeLessThan(100 * 1024);
    const e = refusal(() => readTable(file, 'large.csv'));
    expect(e.code).toBe('file_too_large');
    expect(e.message).toContain('16384 columns');
  });

  it('rogne une dimension annoncée à la dernière cellule réelle, au lieu de parcourir la plage', () => {
    const real = sheetXml([['IBAN'], [VALID_CH]]).toString('utf8');
    const announced = real.replace('<sheetData>', `<dimension ref="A1:XFD${ROWS}"/><sheetData>`);
    const file = zipOf(workbookParts([{ name: 'Feuil1', xml: { data: Buffer.from(announced) } }]));
    expect(file.length).toBeLessThan(4 * 1024);
    const t = readTable(file, 'dimension.xlsx');
    expect(t.headers).toEqual(['IBAN']);
    expect(t.rows).toEqual([[VALID_CH]]);
  });

  it('garde, sous le plafond, la plage d’avant, colonnes vides de fin comprises', () => {
    const real = sheetXml([
      ['IBAN', 'Nom'],
      [VALID_CH, 'Alpha'],
    ]).toString('utf8');
    const announced = real.replace('<sheetData>', '<dimension ref="A1:D2"/><sheetData>');
    const t = readTable(
      zipOf(workbookParts([{ name: 'Feuil1', xml: { data: Buffer.from(announced) } }])),
      'dimension.xlsx',
    );
    expect(t.headers).toEqual(['IBAN', 'Nom', 'col_3', 'col_4']);
    // Un CSV large mais court reste lu tel quel, toutes ses colonnes comprises.
    const wide = readTable(csv(['IBAN' + ';'.repeat(299) + 'x', VALID_CH]), 'court.csv');
    // Trois cents champs : « IBAN », deux cent quatre-vingt-dix-huit vides, « x ».
    expect(wide.headers).toHaveLength(300);
    expect(wide.headers.at(-1)).toBe('x');
    expect(wide.rows).toHaveLength(1);
  });
});

/**
 * La largeur est bornée en colonnes, quel que soit le nombre de lignes
 * (11.11.2026). Un texte est mesuré avant d'être lu ; un classeur, sur ses
 * cellules réelles, avant d'être parcouru. Les fichiers restent petits : c'est
 * le refus qui est vérifié.
 */
describe('la largeur est bornée en colonnes', () => {
  const TOO_WIDE = `The sheet has ${AUDIT_MAX_COLUMNS + 1} columns; the audit reads at most ${AUDIT_MAX_COLUMNS} columns.`;
  const letters = (c: number) => {
    let s = '';
    for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26))
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  /** « IBAN », puis des en-têtes nommés, sur `n` colonnes. */
  const header = (n: number) => ['IBAN', ...Array.from({ length: n - 1 }, (_, i) => `c${i + 2}`)];
  /** Une feuille de classeur en chaînes en ligne, colonnes au-delà de Z comprises. */
  const wideSheetXml = (aoa: string[][], dimension?: string) =>
    Buffer.from(
      SHEET_HEAD.replace(
        '<sheetData>',
        dimension ? `<dimension ref="${dimension}"/><sheetData>` : '<sheetData>',
      ) +
        aoa
          .map(
            (row, r) =>
              `<row r="${r + 1}">` +
              row
                .map(
                  (v, c) => `<c r="${letters(c)}${r + 1}" t="inlineStr"><is><t>${v}</t></is></c>`,
                )
                .join('') +
              '</row>',
          )
          .join('') +
        SHEET_TAIL,
    );

  function refusal(fn: () => unknown): AuditFileError {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(AuditFileError);
      return e as AuditFileError;
    }
    throw new Error('aucun refus');
  }

  it('refuse un texte d’une colonne de trop, même de deux lignes, et lit celui qui est au plafond', () => {
    const over = refusal(() =>
      readTable(csv([header(AUDIT_MAX_COLUMNS + 1).join(';'), VALID_CH]), 'large.csv'),
    );
    expect(over.code).toBe('file_too_large');
    expect(over.message).toContain(TOO_WIDE);
    const at = readTable(csv([header(AUDIT_MAX_COLUMNS).join(';'), VALID_CH]), 'large.csv');
    expect(at.headers).toHaveLength(AUDIT_MAX_COLUMNS);
    expect(at.rows).toHaveLength(1);
  });

  it('compte les colonnes remplies, pas les séparateurs vides de fin de ligne', () => {
    const pad = ';'.repeat(2 * AUDIT_MAX_COLUMNS);
    const t = readTable(csv([`IBAN;Nom${pad}`, `${VALID_CH};Alpha${pad}`]), 'export.csv');
    expect(t.headers).toEqual(['IBAN', 'Nom']);
    expect(t.rows).toEqual([[VALID_CH, 'Alpha']]);
  });

  it('garde le plafond de cases sur un texte, avec le même message', () => {
    // Une ligne au plafond de colonnes, puis assez de lignes pour dépasser celui
    // des cases ; chacune ne porte qu'un caractère.
    const rows = Math.floor(AUDIT_MAX_CELLS / AUDIT_MAX_COLUMNS);
    const lines = [header(AUDIT_MAX_COLUMNS).join(';'), ...Array.from({ length: rows }, () => 'x')];
    const e = refusal(() => readTable(csv(lines), 'haut.csv'));
    expect(e.code).toBe('file_too_large');
    expect(e.message).toContain(`The sheet spans ${rows + 1} rows by ${AUDIT_MAX_COLUMNS} columns`);
  });

  it('mesure un texte exactement comme le lecteur de texte délimité le lit', () => {
    // Des textes faits au hasard (graine fixe) de cellules, séparateurs,
    // guillemets et fins de ligne : l'étendue mesurée avant la lecture est celle
    // des cellules que SheetJS crée.
    let seed = 20261111;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const alphabet = ['a', 'b', ' ', ';', ',', '\t', '"', '"', '\n', '\r', '\r\n'];
    for (let i = 0; i < 2_000; i++) {
      let body = '';
      const length = Math.floor(random() * 30);
      for (let k = 0; k < length; k++) body += alphabet[Math.floor(random() * alphabet.length)];
      for (const separator of [';', ',', '\t']) {
        const wb = XLSX.read(`sep=${separator}\n${body}`, {
          type: 'string',
          raw: true,
          sheetRows: SHEET_ROWS_CAP,
        });
        const sheet = wb.Sheets[wb.SheetNames[0]!]!;
        let rows = 0;
        let columns = 0;
        for (const key of Object.keys(sheet)) {
          if (key.startsWith('!')) continue;
          const { r, c } = XLSX.utils.decode_cell(key);
          rows = Math.max(rows, r + 1);
          columns = Math.max(columns, c + 1);
        }
        expect(delimitedExtent(body, separator), JSON.stringify([body, separator])).toEqual({
          rows,
          columns,
        });
      }
    }
  });

  it('refuse un classeur d’une colonne de trop, même de deux lignes', () => {
    const xml = wideSheetXml([header(AUDIT_MAX_COLUMNS + 1), [VALID_CH]]);
    const e = refusal(() =>
      readTable(zipOf(workbookParts([{ name: 'Feuil1', xml: { data: xml } }])), 'large.xlsx'),
    );
    expect(e.code).toBe('file_too_large');
    expect(e.message).toContain(TOO_WIDE);
  });

  it('rogne aux cellules réelles un classeur annoncé plus large que le plafond', () => {
    const xml = wideSheetXml(
      [
        ['IBAN', 'Nom'],
        [VALID_CH, 'Alpha'],
      ],
      'A1:XFD2',
    );
    const t = readTable(
      zipOf(workbookParts([{ name: 'Feuil1', xml: { data: xml } }])),
      'export.xlsx',
    );
    expect(t.headers).toEqual(['IBAN', 'Nom']);
    expect(t.rows).toEqual([[VALID_CH, 'Alpha']]);
  });

  it('refuse un XLS dont une cellule est placée au-delà du plafond', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['IBAN', 'Nom'],
        [VALID_CH, 'Alpha'],
      ]),
      'Feuil1',
    );
    const xls = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xls' }) as Buffer);
    // L'enregistrement de la cellule B1 (ligne 0, colonne 1) : sa colonne est
    // repoussée au-delà du plafond, ce que le format admet sur seize bits.
    let at = -1;
    for (let i = 0; i + 8 <= xls.length && at < 0; i++) {
      if (
        xls.readUInt16LE(i) === 0x0204 &&
        xls.readUInt16LE(i + 4) === 0 &&
        xls.readUInt16LE(i + 6) === 1
      )
        at = i;
    }
    expect(at).toBeGreaterThan(0);
    xls.writeUInt16LE(AUDIT_MAX_COLUMNS, at + 6);
    const e = refusal(() => readTable(xls, 'large.xls'));
    expect(e.code).toBe('file_too_large');
    expect(e.message).toContain(TOO_WIDE);
  });

  it('lit un fichier légitime large : soixante colonnes sur deux mille lignes, en texte et en classeur', () => {
    const head = header(60);
    const row = [VALID_CH, ...Array.from({ length: 59 }, (_, i) => `v${i}`)];
    const text = readTable(
      csv([head.join(';'), ...Array.from({ length: 2_000 }, () => row.join(';'))]),
      'large.csv',
    );
    expect(text.headers).toEqual(head);
    expect(text.rows).toHaveLength(2_000);
    const book = readTable(xlsx([head, ...Array.from({ length: 2_000 }, () => row)]), 'large.xlsx');
    expect(book.headers).toEqual(head);
    expect(book.rows).toHaveLength(2_000);
  });
});

/**
 * Les formules ne sont pas analysées (11.11.2026) : l'audit lit les valeurs que
 * le classeur a gardées, et l'analyse des formules matricielles coûtait de plus
 * en plus cher à chaque cellule qui en portait une.
 */
describe('les formules ne sont pas analysées', () => {
  const col = (c: number) => {
    let s = '';
    for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26))
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };

  it('lit la valeur gardée d’une cellule à formule', () => {
    const xml = Buffer.from(
      SHEET_HEAD +
        '<row r="1"><c r="A1" t="inlineStr"><is><t>IBAN</t></is></c><c r="B1" t="inlineStr"><is><t>Total</t></is></c></row>' +
        `<row r="2"><c r="A2" t="inlineStr"><is><t>${VALID_CH}</t></is></c><c r="B2"><f>1+1</f><v>2</v></c></row>` +
        SHEET_TAIL,
    );
    const t = readTable(zipOf(workbookParts([{ name: 'Feuil1', xml: { data: xml } }])), 'f.xlsx');
    expect(t.rows).toEqual([[VALID_CH, '2']]);
  });

  // Trois cents lignes de cent formules : sous le plafond de colonnes
  // (11.11.2026), qui refuse la ligne unique de trente mille cases d'abord
  // écrite ici. SheetJS compare chaque cellule à toutes les formules
  // matricielles déjà lues de la feuille, quelle que soit leur ligne.
  it('lit en moins d’une seconde trente mille formules matricielles', () => {
    const rows: string[] = [];
    for (let r = 2; r <= 301; r++) {
      const cells: string[] = [];
      for (let c = 0; c < 100; c++) {
        const ref = `${col(c)}${r}`;
        cells.push(`<c r="${ref}"><f t="array" ref="${ref}:${ref}">1</f><v>1</v></c>`);
      }
      rows.push(`<row r="${r}">${cells.join('')}</row>`);
    }
    const xml = Buffer.from(
      SHEET_HEAD +
        '<row r="1"><c r="A1" t="inlineStr"><is><t>IBAN</t></is></c></row>' +
        rows.join('') +
        SHEET_TAIL,
    );
    const file = zipOf(workbookParts([{ name: 'Feuil1', xml: { data: xml } }]));
    const started = performance.now();
    const t = readTable(file, 'formules.xlsx');
    const elapsed = performance.now() - started;
    expect(t.rows).toHaveLength(300);
    expect(t.rows[0]![0]).toBe('1');
    expect(elapsed).toBeLessThan(1000);
  });
});

/**
 * Les fichiers d'exemple que le site propose passent comme avant (10.11.2026).
 *
 * Écrit AVANT la garde de décompression et la lecture de la seule première
 * feuille, et vert sur le code d'avant : le chemin texte n'est touché par aucune
 * des deux, il sert donc de référence. Le même contenu en classeur (compressé
 * comme Excel l'écrit, ou stocké comme SheetJS l'écrit par défaut) et le rapport
 * d'exemple de l'API, renvoyé tel quel par un visiteur, doivent donner le rapport
 * du fichier texte, ligne par ligne.
 */
describe('les fichiers d’exemple du site donnent le même rapport qu’avant', () => {
  const FIXED_DATE = new Date('2026-09-02T12:00:00Z');
  const asAoa = (text: string) => text.split('\n').map((line) => line.split(';'));
  const workbook = (aoa: unknown[][], compression: boolean) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Feuil1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression }) as Buffer;
  };
  const same = (got: ReturnType<typeof auditFile>, want: ReturnType<typeof auditFile>) => {
    expect(got.rows).toEqual(want.rows);
    expect(got.summary).toEqual(want.summary);
    expect(got.columns).toEqual(want.columns);
  };

  it('l’exemple de la page d’audit, en texte, en classeur compressé et en classeur stocké', () => {
    const reference = auditFile(Buffer.from(SAMPLE_CREDITOR_CSV, 'utf8'), 'exemple-creanciers.csv');
    expect(reference.summary.rows).toBe(8);
    for (const compression of [true, false]) {
      const book = workbook(asAoa(SAMPLE_CREDITOR_CSV), compression);
      const got = auditFile(book, 'exemple-creanciers.xlsx');
      expect(got.headers).toEqual(reference.headers);
      same(got, reference);
    }
  });

  it('le rapport d’exemple de l’API, deux feuilles, renvoyé tel quel', () => {
    const reference = auditFile(Buffer.from(SAMPLE_CREDITOR_CSV, 'utf8'), 'exemple-creanciers.csv');
    for (const lang of ['fr', 'de', 'en'] as const) {
      const report = buildWorkbook(reference, lang, FIXED_DATE);
      expect(XLSX.read(report, { type: 'buffer' }).SheetNames).toHaveLength(2);
      const got = auditFile(report, `ibanforge-exemple-audit-${lang}.xlsx`);
      // Les colonnes d'audit ajoutées par le rapport suivent les colonnes source.
      expect(got.headers.slice(0, reference.headers.length)).toEqual(reference.headers);
      same(got, reference);
    }
  });

  it('le fichier d’exemple des intégrations, en texte et en classeur', () => {
    const dir = new URL('../../frontend/public/integrations/', import.meta.url);
    const name = readdirSync(dir).find((f) => /^ibanforge-exemples-.*\.csv$/.test(f));
    expect(name, 'fichier d’exemple des intégrations introuvable').toBeDefined();
    const text = readFileSync(new URL(name!, dir));
    const reference = auditFile(text, name!);
    expect(reference.summary.rows).toBeGreaterThan(0);
    const lines = text.toString('utf8').trim().split(/\r?\n/);
    const got = auditFile(
      workbook(
        lines.map((l) => [l]),
        true,
      ),
      'exemples.xlsx',
    );
    same(got, reference);
  });
});

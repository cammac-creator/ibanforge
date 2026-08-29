import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import {
  parseWorksheetRows,
  parseRegisterDate,
  normaliseBic,
  parseBaeWorkbook,
  bankCodeCount,
  writeBgBae,
  createBgBaeTable,
  MIN_EXPECTED_ROWS,
  MIN_EXPECTED_BANK_CODES,
  type BgBaeParse,
} from './seed-bg-bae.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof import('better-sqlite3');

/**
 * Every provider below is invented — this repository is public, and a fixture
 * is where it has leaked real names from before. What is NOT invented is the
 * SHAPE: the column headings are the Bulgarian National Bank's own Cyrillic
 * strings (the parser matches on them, so a paraphrase would test nothing), and
 * every structural trap below is one the published workbook actually contains:
 *
 *  - a UTF-8 BOM before the XML declaration;
 *  - the effective date alone in a cell above everything else, dd.mm.yyyy;
 *  - a title row using ss:MergeAcross, which shifts the columns after it;
 *  - self-closing <Cell/> for every empty cell, including the whole of column A;
 *  - blank spacer rows between blocks;
 *  - head-office rows carrying a BIC, branch rows carrying none.
 *
 * One trap is added rather than copied: `ss:Index` on a sparse row. The current
 * export does not use it, but any SpreadsheetML writer may emit it at any time,
 * and a reader that ignores it shifts a whole row one column left — silently,
 * because the result is still a well-formed matrix.
 */
function row(cells: string, attrs = ''): string {
  return `<Row${attrs}>${cells}</Row>`;
}
const empty = '<Cell/>';
function cell(value: string, attrs = ''): string {
  return `<Cell${attrs}><Data ss:Type="String">${value}</Data></Cell>`;
}

function workbook(body: string): string {
  return (
    '﻿<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<?mso-application progid="Excel.Sheet"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
    'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n' +
    '<Styles><Style ss:ID="s40"><Font/></Style></Styles>\n' +
    '<Worksheet ss:Name="Information">\n<Table border="1">\n' +
    '<Column ss:Width="70.5"/><Column ss:Width="311.25"/>\n' +
    body +
    '\n</Table>\n</Worksheet>\n</Workbook>'
  );
}

const HEADER = row(
  empty + cell('Наименование на ДПУ') + cell('БАЕ код') + cell('BIC код (ЦУ)'),
);

const DATELINE = row(empty + empty + empty + cell('04.02.2026'));
const TITLE = row(cell('БАЕ кодове и BIC на банките', ' ss:MergeAcross="2"') + empty);
const SPACER = row(empty + empty + empty + empty);

const FIXTURE = workbook(
  [
    DATELINE,
    SPACER,
    TITLE,
    SPACER,
    HEADER,
    SPACER,
    // Head office, with the BIC the register publishes for it.
    row(empty + cell('Примерна Банка АД') + cell('XMPL9001') + cell('XMPLBGSF')),
    // A branch: same bank code, different branch digits, no BIC of its own.
    row(empty + cell('Примерна Банка АД, кл. Пример') + cell('XMPL7001')),
    // An ampersand, which arrives as an XML entity and must come back as "&".
    row(empty + cell('Втора &amp; Примерна ЕАД') + cell('ZZTB4001') + cell('ZZTBBGS1')),
    // A sparse row written with ss:Index instead of leading empty cells.
    row(
      cell('Трета Примерна АД', ' ss:Index="2"') + cell('QRTX4002') + cell('QRTXBGS2'),
    ),
  ].join('\n'),
);

describe('parseWorksheetRows', () => {
  const matrix = parseWorksheetRows(FIXTURE);

  it('strips the BOM instead of gluing it to the XML declaration', () => {
    // Left in place, the BOM sits before <?xml and the Worksheet regex still
    // matches — but every downstream string comparison against the first cell
    // fails for a reason nobody can see in a diff.
    expect(() => parseWorksheetRows(FIXTURE)).not.toThrow();
  });

  it('keeps a merged title cell from shifting the columns after it', () => {
    const title = matrix.find((r) => r[0].startsWith('БАЕ кодове'));
    expect(title).toBeDefined();
    // MergeAcross="2" spans three columns, so the next cell is column 4.
    expect(title).toHaveLength(4);
  });

  it('honours ss:Index rather than reading a sparse row one column left', () => {
    const sparse = matrix.find((r) => r[1] === 'Трета Примерна АД');
    expect(sparse).toBeDefined();
    // Column A stays empty; the name lands in B, exactly where the header says
    // names live. Without ss:Index support it would land in A and the BAE code
    // would be read out of the name column.
    expect(sparse![0]).toBe('');
    expect(sparse![2]).toBe('QRTX4002');
  });

  it('refuses a document with no worksheet rather than returning nothing', () => {
    expect(() => parseWorksheetRows('<Workbook></Workbook>')).toThrow(/Worksheet/);
  });
});

describe('parseRegisterDate', () => {
  it('reads the register dateline', () => {
    expect(parseRegisterDate('04.02.2026')).toBe('2026-02-04');
    expect(parseRegisterDate(' 31.12.2025 ')).toBe('2025-12-31');
  });

  it('answers null rather than falling back to a clock', () => {
    // as_of is the dated half of the attribution the Bulgarian National Bank's
    // terms require. A date invented from the wall clock claims a freshness the
    // publisher never stated — and this register is republished on request, not
    // on a calendar, so the wall clock would be wrong by months.
    for (const bad of ['', '2026-02-04', '4.2.2026', 'февруари', '31.02.2026', '04.13.2026']) {
      expect(parseRegisterDate(bad), bad).toBeNull();
    }
  });
});

describe('normaliseBic', () => {
  it('accepts a BG BIC8 and upper-cases it', () => {
    expect(normaliseBic('xmplbgsf')).toBe('XMPLBGSF');
    expect(normaliseBic('ZZTB BGS1')).toBe('ZZTBBGS1');
  });

  it('refuses a BIC whose country is not BG', () => {
    // Not pedantry: every BIC in a Bulgarian register is Bulgarian, so a
    // foreign one means the reader landed on the wrong column — the failure
    // that would otherwise be stored as fact.
    expect(normaliseBic('XMPLDEFF')).toBeNull();
  });

  it('refuses anything that is not eight characters of BIC', () => {
    for (const bad of ['', 'XMPL', 'XMPLBGSFXXX', 'XMPL-BGS']) {
      expect(normaliseBic(bad), bad).toBeNull();
    }
  });
});

describe('parseBaeWorkbook', () => {
  const parsed = parseBaeWorkbook(FIXTURE);

  it('reads the effective date from the file, above the header', () => {
    expect(parsed.as_of).toBe('2026-02-04');
  });

  it('keeps every register row and drops every spacer', () => {
    expect(parsed.rows.map((r) => r.bae)).toEqual([
      'XMPL9001',
      'XMPL7001',
      'ZZTB4001',
      'QRTX4002',
    ]);
    expect(parsed.rejected).toEqual([]);
  });

  it('splits a BAE code into the bank code and branch code the IBAN carries', () => {
    // A Bulgarian BBAN is 4!a4!n2!n8!c: the BAE code IS positions 5-12.
    const head = parsed.rows[0];
    expect(head.bank_code).toBe('XMPL');
    expect(head.branch_code).toBe('9001');
  });

  it('publishes the BIC on the head-office row only', () => {
    expect(parsed.rows[0].bic).toBe('XMPLBGSF');
    expect(parsed.rows[1].bic).toBeNull();
  });

  it('records the register’s own publication order', () => {
    // Load-bearing: it is what breaks the tie when a bank has more than one
    // head-office row, which the Bulgarian National Bank itself has.
    expect(parsed.rows.map((r) => r.ordinal)).toEqual([0, 1, 2, 3]);
  });

  it('decodes XML entities instead of storing them raw', () => {
    expect(parsed.rows[2].name).toBe('Втора & Примерна ЕАД');
  });

  it('stores institution names verbatim, in Cyrillic', () => {
    // The licence permits reproduction on condition that the data is not
    // altered or distorted. Transliterating a name here would be that
    // alteration, done by us and invisible to the reader.
    expect(parsed.rows[0].name).toBe('Примерна Банка АД');
  });

  it('counts distinct bank codes, which is the space the verdict is made on', () => {
    expect(bankCodeCount(parsed.rows)).toBe(3);
  });

  it('refuses a file with no dateline rather than dating it from the clock', () => {
    const undated = FIXTURE.replace(cell('04.02.2026'), empty);
    expect(() => parseBaeWorkbook(undated)).toThrow(/effective date/i);
  });

  it('does not mistake a date inside an institution name for the dateline', () => {
    // The dateline is searched ABOVE the header only. A provider called
    // "… 01.01.2020" further down must not re-date the whole register.
    const trap = workbook(
      [
        DATELINE,
        HEADER,
        row(empty + cell('Примерна Банка АД 01.01.2020') + cell('XMPL9001') + cell('XMPLBGSF')),
      ].join('\n'),
    );
    expect(parseBaeWorkbook(trap).as_of).toBe('2026-02-04');
  });

  it('fails loudly when the header row is gone', () => {
    // A layout change that silently produced zero rows would hit the sanity
    // floor anyway, but the message would blame the data instead of the format.
    const headerless = FIXTURE.replace(HEADER, SPACER);
    expect(() => parseBaeWorkbook(headerless)).toThrow(/Header row not found/);
  });

  it('fails loudly on a duplicated BAE code instead of picking one', () => {
    // Two institutions claiming one code means the file is not what we think it
    // is. Half-ingesting it is worse than keeping yesterday's table.
    const duplicated = workbook(
      [
        DATELINE,
        HEADER,
        row(empty + cell('Примерна Банка АД') + cell('XMPL9001') + cell('XMPLBGSF')),
        row(empty + cell('Друга Банка АД') + cell('XMPL9001') + cell('XMPLBGSF')),
      ].join('\n'),
    );
    expect(() => parseBaeWorkbook(duplicated)).toThrow(/appears twice/);
  });

  it('counts what it refuses rather than dropping it in silence', () => {
    // A silent drop is a distortion nobody can see. Each of these is a real
    // misalignment signature: a foreign BIC, and a BIC that does not open on
    // the bank code of the BAE beside it (an invariant the published file
    // satisfies on all 37 of its head-office rows).
    const dirty = workbook(
      [
        DATELINE,
        HEADER,
        row(empty + cell('Примерна Банка АД') + cell('XMPL9001') + cell('XMPLBGSF')),
        row(empty + cell('Чужда Банка') + cell('ZZTB4001') + cell('ZZTBDEFF')),
        row(empty + cell('Разместена Банка') + cell('QRTX4002') + cell('XMPLBGSF')),
        row(empty + cell('Без код') + cell('NOT-A-CODE')),
      ].join('\n'),
    );
    const messy = parseBaeWorkbook(dirty);
    expect(messy.rows.map((r) => r.bae)).toEqual(['XMPL9001']);
    expect(messy.rejected).toHaveLength(3);
    expect(messy.rejected.map((r) => r.reason).join(' | ')).toMatch(/BG BIC8/);
    expect(messy.rejected.map((r) => r.reason).join(' | ')).toMatch(/does not open on the bank code/);
  });
});

// ---------------------------------------------------------------------------
// The guard: a bad download never replaces good rows
// ---------------------------------------------------------------------------

describe('writeBgBae refuses to replace a good table with a short one', () => {
  /** A parse of the size the real register has, built from invented codes. */
  function fullSizedParse(): BgBaeParse {
    const rows = [];
    for (let i = 0; i < MIN_EXPECTED_ROWS + 10; i++) {
      // 40+ distinct bank codes, above the bank-code floor as well. All four
      // characters stay upper-case letters, which is what a Bulgarian bank code
      // is — a fixture that drifts off the real shape tests the wrong thing.
      const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const bank = `X${A[i % 26]}${A[Math.floor(i / 26) % 26]}L`;
      rows.push({
        bae: `${bank}${String(4000 + i).padStart(4, '0')}`,
        bank_code: bank,
        branch_code: String(4000 + i).padStart(4, '0'),
        name: `Примерна Банка ${i}`,
        bic: i % 26 === 0 ? `${bank}BGSF` : null,
        ordinal: i,
      });
    }
    return { as_of: '2026-02-04', rows, rejected: [] };
  }

  function freshDb(): import('better-sqlite3').Database {
    const db = new Database(':memory:');
    createBgBaeTable(db);
    return db;
  }

  it('writes a full-sized register', () => {
    const db = freshDb();
    const written = writeBgBae(db, fullSizedParse());
    expect(written).toBe(MIN_EXPECTED_ROWS + 10);
    expect((db.prepare('SELECT COUNT(*) c FROM bg_bae').get() as { c: number }).c).toBe(written);
    db.close();
  });

  it('leaves the existing rows standing when the new parse is truncated', () => {
    // The property this whole guard exists for. An unattended monthly cron must
    // never trade a good table for a short download — the rows it would replace
    // are the evidence behind an authoritative: true claim.
    const db = freshDb();
    writeBgBae(db, fullSizedParse());
    const before = db.prepare('SELECT bae FROM bg_bae ORDER BY bae').all();

    const truncated: BgBaeParse = { as_of: '2026-02-04', rows: fullSizedParse().rows.slice(0, 12), rejected: [] };
    expect(() => writeBgBae(db, truncated)).toThrow(/Refusing to replace/);

    const after = db.prepare('SELECT bae FROM bg_bae ORDER BY bae').all();
    expect(after).toEqual(before);
    db.close();
  });

  it('leaves them standing when the rows survive but the bank codes collapse', () => {
    // The failure a row count cannot see: a parse that kept every line but
    // folded them onto a handful of bank codes would deny most of Bulgaria
    // while passing any check on volume. The verdict is made on the bank code,
    // so the bank code is what has to be floored.
    const db = freshDb();
    writeBgBae(db, fullSizedParse());
    const before = db.prepare('SELECT COUNT(*) c FROM bg_bae').get() as { c: number };

    const collapsed: BgBaeParse = {
      as_of: '2026-02-04',
      rows: fullSizedParse().rows.map((r, i) => ({
        ...r,
        bank_code: 'XAPL',
        bae: `XAPL${String(1000 + i).padStart(4, '0')}`,
      })),
      rejected: [],
    };
    expect(() => writeBgBae(db, collapsed)).toThrow(
      new RegExp(`expected at least ${MIN_EXPECTED_BANK_CODES}`),
    );
    expect(db.prepare('SELECT COUNT(*) c FROM bg_bae').get()).toEqual(before);
    db.close();
  });

  it('stores the source and the effective date on every row', () => {
    // Both are licence terms, not decoration: the served surfaces read the
    // credit back out of these columns, so a row without them is a row that
    // would be served uncredited.
    const db = freshDb();
    writeBgBae(db, fullSizedParse());
    const odd = db
      .prepare("SELECT COUNT(*) c FROM bg_bae WHERE as_of != '2026-02-04' OR source NOT LIKE 'Bulgarian National Bank%'")
      .get() as { c: number };
    expect(odd.c).toBe(0);
    db.close();
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareItalianOnly } from './it-register-diff.js';

/**
 * La relecture hebdomadaire de l'Italie peut commiter les lignes italiennes et
 * rien d'autre. Chaque cas part de la même petite base (lignes inventées, le vrai
 * schéma des deux tables du registre et une table de l'annuaire) et change une
 * seule chose.
 */

const COLS = `country TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, bic TEXT,
  street TEXT, post_code TEXT, town TEXT, lei TEXT, source TEXT, as_of TEXT,
  PRIMARY KEY (country, code)`;
const RETIRED_COLS = `country TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
  retired_on TEXT NOT NULL, successor_code TEXT, successor_name TEXT, source TEXT, as_of TEXT,
  PRIMARY KEY (country, code)`;

let dir: string;
let before: string;
let after: string;

function seed(path: string): void {
  const db = new Database(path);
  db.exec(`CREATE TABLE national_bank_codes (${COLS});`);
  db.exec(`CREATE TABLE national_bank_codes_retired (${RETIRED_COLS});`);
  db.exec('CREATE TABLE bic_entries (id INTEGER PRIMARY KEY, bic11 TEXT, institution TEXT);');
  const ins = db.prepare(
    `INSERT INTO national_bank_codes (country, code, name, source, as_of) VALUES (?, ?, ?, ?, ?)`,
  );
  ins.run('IT', '10000', 'Banca di Esempio S.p.A.', 'Banca d’Italia (CC BY 4.0)', '2026-09-23');
  ins.run('CZ', '1000', 'Příkladová banka, a.s.', 'Zdroj: ČNB, …, verze 254', '2026-09-01');
  db.prepare(
    `INSERT INTO national_bank_codes_retired (country, code, name, retired_on, successor_code, as_of)
     VALUES ('IT', '50000', 'Banca Radiata S.p.A.', '2021-04-11', '10000', '2026-09-23')`,
  ).run();
  db.prepare('INSERT INTO bic_entries (bic11, institution) VALUES (?, ?)').run(
    'XMPLITMMXXX',
    'Société Alpha',
  );
  db.close();
}

function edit(sql: string): void {
  const db = new Database(after);
  db.exec(sql);
  db.close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'it-diff-'));
  before = join(dir, 'before.sqlite');
  after = join(dir, 'after.sqlite');
  seed(before);
  copyFileSync(before, after);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('compareItalianOnly', () => {
  it('sees no change when the Italian rows were rewritten identically, whatever the bytes', () => {
    edit(`DELETE FROM national_bank_codes WHERE country = 'IT';
      INSERT INTO national_bank_codes (country, code, name, source, as_of)
        VALUES ('IT', '10000', 'Banca di Esempio S.p.A.', 'Banca d’Italia (CC BY 4.0)', '2026-09-23');
      VACUUM;`);
    expect(readFileSync(before).equals(readFileSync(after))).toBe(false);
    expect(compareItalianOnly(before, after)).toMatchObject({
      italianChanged: false,
      outside: [],
    });
  });

  it('sees a new edition, and a code newly struck off', () => {
    edit(`UPDATE national_bank_codes SET as_of = '2026-10-01' WHERE country = 'IT';
      INSERT INTO national_bank_codes_retired (country, code, name, retired_on)
        VALUES ('IT', '50001', 'Altra Banca Radiata S.p.A.', '2026-09-30')`);
    const diff = compareItalianOnly(before, after);
    expect(diff).toMatchObject({ italianChanged: true, outside: [] });
    expect(diff.summary.join('\n')).toMatch(/edition 2026-09-23 -> 1 rows, edition 2026-10-01/);
  });

  it('refuses a change to another country of the same table', () => {
    edit(`UPDATE national_bank_codes SET name = 'Jiná banka, a.s.' WHERE country = 'CZ'`);
    expect(compareItalianOnly(before, after).outside).toEqual([
      'national_bank_codes: rows of another country',
    ]);
  });

  it('refuses a change to any other table', () => {
    edit(`UPDATE bic_entries SET institution = 'Société Beta'`);
    expect(compareItalianOnly(before, after).outside).toEqual(['bic_entries']);
  });

  it('refuses a change of schema', () => {
    edit('ALTER TABLE bic_entries ADD COLUMN city TEXT');
    expect(compareItalianOnly(before, after).outside).toEqual(['schema of table:bic_entries']);
  });

  it('accepts the table of retired codes appearing, with Italian rows only', () => {
    const db = new Database(before);
    db.exec('DROP TABLE national_bank_codes_retired');
    db.close();
    expect(compareItalianOnly(before, after)).toMatchObject({
      italianChanged: true,
      outside: [],
    });
    edit(
      `INSERT INTO national_bank_codes_retired (country, code, name, retired_on) VALUES ('SM', '99999', 'Banca Estera', '2020-01-01')`,
    );
    expect(compareItalianOnly(before, after).outside).toEqual([
      'national_bank_codes_retired: rows of another country',
    ]);
  });
});

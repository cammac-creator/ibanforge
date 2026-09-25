import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareCzechOnly } from './cz-register-diff.js';

/**
 * The daily Czech run may commit the Czech rows and nothing else. Every case
 * below starts from the same small database (invented rows, the real schema of
 * the two register tables and one directory table) and changes one thing.
 */

const COLS = `country TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, bic TEXT,
  street TEXT, post_code TEXT, town TEXT, lei TEXT, source TEXT, as_of TEXT,
  PRIMARY KEY (country, code)`;

let dir: string;
let before: string;
let after: string;

function seed(path: string): void {
  const db = new Database(path);
  db.exec(`CREATE TABLE national_bank_codes (${COLS});`);
  db.exec(`CREATE TABLE national_bank_codes_pending (${COLS});`);
  db.exec('CREATE TABLE bic_entries (id INTEGER PRIMARY KEY, bic11 TEXT, institution TEXT);');
  const ins = db.prepare(
    `INSERT INTO national_bank_codes (country, code, name, bic, source, as_of) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  ins.run(
    'CZ',
    '1000',
    'Příkladová banka, a.s.',
    'XMPLCZPP',
    'Zdroj: ČNB, …, verze 254',
    '2026-09-01',
  );
  ins.run('CZ', '1001', 'Druhá příkladová, a.s.', null, 'Zdroj: ČNB, …, verze 254', '2026-09-01');
  ins.run('SK', '0200', 'Príkladová banka, a.s.', 'XMPLSKBX', 'NBS, version 225', '2026-05-18');
  db.prepare('INSERT INTO bic_entries (bic11, institution) VALUES (?, ?)').run(
    'XMPLCZPPXXX',
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
  dir = mkdtempSync(join(tmpdir(), 'cz-diff-'));
  before = join(dir, 'before.sqlite');
  after = join(dir, 'after.sqlite');
  seed(before);
  copyFileSync(before, after);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('compareCzechOnly', () => {
  it('sees no change when the Czech rows were rewritten identically, whatever the bytes', () => {
    // What the seeder does every day when the ČNB has not moved: delete and
    // re-insert the same rows. The file changes; the content does not.
    edit(`DELETE FROM national_bank_codes WHERE country = 'CZ';
      INSERT INTO national_bank_codes (country, code, name, bic, source, as_of) VALUES
        ('CZ', '1001', 'Druhá příkladová, a.s.', NULL, 'Zdroj: ČNB, …, verze 254', '2026-09-01'),
        ('CZ', '1000', 'Příkladová banka, a.s.', 'XMPLCZPP', 'Zdroj: ČNB, …, verze 254', '2026-09-01');
      VACUUM;`);
    expect(readFileSync(before).equals(readFileSync(after))).toBe(false);
    expect(compareCzechOnly(before, after)).toMatchObject({ czechChanged: false, outside: [] });
  });

  it('sees a new edition in force', () => {
    edit(
      `UPDATE national_bank_codes SET source = 'Zdroj: ČNB, …, verze 255', as_of = '2026-10-01' WHERE country = 'CZ'`,
    );
    const diff = compareCzechOnly(before, after);
    expect(diff).toMatchObject({ czechChanged: true, outside: [] });
    expect(diff.summary.join('\n')).toMatch(/verze 254.*->.*verze 255/);
  });

  it('sees an announced edition written to the pending table', () => {
    edit(`INSERT INTO national_bank_codes_pending (country, code, name, source, as_of)
      VALUES ('CZ', '1002', 'Nová banka, a.s.', 'Zdroj: ČNB, …, verze 255', '2026-10-16')`);
    expect(compareCzechOnly(before, after)).toMatchObject({ czechChanged: true, outside: [] });
  });

  it('refuses a change to another country of the same table', () => {
    edit(`UPDATE national_bank_codes SET name = 'Iná banka, a.s.' WHERE country = 'SK'`);
    expect(compareCzechOnly(before, after).outside).toEqual([
      'national_bank_codes: rows of another country',
    ]);
  });

  it('refuses a change to any other table', () => {
    edit(`UPDATE bic_entries SET institution = 'Société Beta'`);
    expect(compareCzechOnly(before, after).outside).toEqual(['bic_entries']);
  });

  it('refuses a change of schema', () => {
    edit('ALTER TABLE bic_entries ADD COLUMN city TEXT');
    expect(compareCzechOnly(before, after).outside).toEqual(['schema of table:bic_entries']);
  });

  it('accepts the pending table appearing, with Czech rows only', () => {
    const db = new Database(before);
    db.exec('DROP TABLE national_bank_codes_pending');
    db.close();
    expect(compareCzechOnly(before, after)).toMatchObject({ czechChanged: false, outside: [] });
    edit(
      `INSERT INTO national_bank_codes_pending (country, code, name) VALUES ('SK', '9999', 'Iná banka, a.s.')`,
    );
    expect(compareCzechOnly(before, after).outside).toEqual([
      'national_bank_codes_pending: rows of another country',
    ]);
  });
});

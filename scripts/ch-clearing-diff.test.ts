import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareSwissClearingOnly } from './ch-clearing-diff.js';

/**
 * La relecture hebdomadaire de SIX peut commiter la table ch_clearing et rien
 * d'autre, et seulement quand son contenu a changé. Chaque cas part de la même
 * petite base (lignes inventées, le vrai schéma de ch_clearing tel que
 * scripts/seed-bc-nummer.ts le crée, et deux autres tables) et change une seule
 * chose.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SCRIPT = resolve(__dirname, 'ch-clearing-diff.ts');

/** Le CREATE TABLE de scripts/seed-bc-nummer.ts, recopié tel quel. */
const CH_CLEARING = `
    CREATE TABLE IF NOT EXISTS ch_clearing (
      iid              TEXT PRIMARY KEY,
      valid_on         TEXT,
      concatenation    INTEGER DEFAULT 0,
      redirect_iid     TEXT,
      sic_iid          TEXT,
      headquarters_iid TEXT,
      iid_type         INTEGER,
      qr_iid           TEXT,
      name             TEXT NOT NULL,
      street           TEXT,
      building_number  TEXT,
      post_code        TEXT,
      town             TEXT,
      country          TEXT DEFAULT 'CH',
      bic              TEXT,
      sic_participation       INTEGER DEFAULT 0,
      rtgs_chf               INTEGER DEFAULT 0,
      ip_chf                 INTEGER DEFAULT 0,
      eurosic_participation  INTEGER DEFAULT 0,
      lsv_bdd_chf           INTEGER DEFAULT 0,
      lsv_bdd_eur           INTEGER DEFAULT 0,
      updated_at       TEXT DEFAULT (datetime('now'))
    )
  `;

/** Deux établissements inventés, chacun sous son IID et son QR-IID. */
function rows(validOn: string, updatedAt: string, bicAlpha = 'ALPHCH22XXX'): string {
  return `INSERT INTO ch_clearing (iid, valid_on, headquarters_iid, iid_type, qr_iid, name, street,
      building_number, post_code, town, country, bic, sic_participation, ip_chf, updated_at) VALUES
    ('08001', '${validOn}', '08001', 1, '30001', 'Banque Alpha SA', 'Rue Exemple', '1', '1000', 'Lausanne', 'CH', '${bicAlpha}', 1, 1, '${updatedAt}'),
    ('30001', '${validOn}', '08001', 1, '30001', 'Banque Alpha SA', 'Rue Exemple', '1', '1000', 'Lausanne', 'CH', '${bicAlpha}', 1, 1, '${updatedAt}'),
    ('08002', '${validOn}', '08002', 1, NULL, 'Banque Beta AG', 'Beispielweg', '2', '8000', 'Zürich', 'CH', 'BETACH22XXX', 1, 0, '${updatedAt}')`;
}

let dir: string;
let before: string;
let after: string;

function seed(path: string): void {
  const db = new Database(path);
  db.exec(CH_CLEARING);
  db.exec('CREATE INDEX IF NOT EXISTS idx_ch_clearing_bic ON ch_clearing(bic)');
  db.exec(rows('2026-10-02', '2026-10-01 18:58:08'));
  db.exec('CREATE TABLE bic_entries (id INTEGER PRIMARY KEY, bic11 TEXT, institution TEXT);');
  db.prepare('INSERT INTO bic_entries (bic11, institution) VALUES (?, ?)').run(
    'ALPHCH22XXX',
    'Banque Alpha SA',
  );
  db.exec(
    'CREATE TABLE national_bank_codes (country TEXT, code TEXT, name TEXT, PRIMARY KEY (country, code));',
  );
  db.prepare('INSERT INTO national_bank_codes VALUES (?, ?, ?)').run(
    'IT',
    '10000',
    'Banca di Esempio S.p.A.',
  );
  db.close();
}

function edit(sql: string): void {
  const db = new Database(after);
  db.exec(sql);
  db.close();
}

/** Ce que fait le chargeur à chaque passage : la table supprimée, recréée, remplie. */
function reseed(validOn: string, updatedAt: string, bicAlpha?: string): void {
  edit(`DROP TABLE ch_clearing; ${CH_CLEARING};
    CREATE INDEX IF NOT EXISTS idx_ch_clearing_bic ON ch_clearing(bic);
    ${rows(validOn, updatedAt, bicAlpha)}; VACUUM;`);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ch-diff-'));
  before = join(dir, 'before.sqlite');
  after = join(dir, 'after.sqlite');
  seed(before);
  copyFileSync(before, after);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('compareSwissClearingOnly', () => {
  it('sees no change when SIX republished the same content under a newer file date', () => {
    reseed('2026-10-29', '2026-10-29 14:23:05');
    expect(readFileSync(before).equals(readFileSync(after))).toBe(false);
    const diff = compareSwissClearingOnly(before, after);
    expect(diff).toMatchObject({ changed: false, outside: [] });
    expect(diff.summary).toEqual([
      'ch_clearing: 3 rows, valid_on 2026-10-02 -> 3 rows, valid_on 2026-10-29',
    ]);
  });

  it('sees a new BIC, and names each IID whose BIC changed', () => {
    reseed('2026-10-29', '2026-10-29 14:23:05', 'RBABCH22ALP');
    const diff = compareSwissClearingOnly(before, after);
    expect(diff).toMatchObject({ changed: true, outside: [] });
    expect(diff.summary).toContain(
      'content: 0 IID added, 0 removed, 2 modified, of which 2 with a new BIC',
    );
    expect(diff.summary).toContain('  BIC of IID 08001: ALPHCH22XXX -> RBABCH22ALP');
    expect(diff.summary).toContain('  BIC of IID 30001: ALPHCH22XXX -> RBABCH22ALP');
  });

  it('sees a change of name or of rail participation', () => {
    edit(`UPDATE ch_clearing SET name = 'Banque Gamma SA' WHERE iid = '08002'`);
    expect(compareSwissClearingOnly(before, after).changed).toBe(true);
    copyFileSync(before, after);
    edit(`UPDATE ch_clearing SET ip_chf = 1 WHERE iid = '08002'`);
    expect(compareSwissClearingOnly(before, after).changed).toBe(true);
  });

  it('sees an IID added, and an IID removed', () => {
    edit(
      `INSERT INTO ch_clearing (iid, valid_on, name, bic) VALUES ('08003', '2026-10-02', 'Banque Delta SA', NULL)`,
    );
    expect(compareSwissClearingOnly(before, after).summary).toContain(
      'content: 1 IID added, 0 removed, 0 modified, of which 0 with a new BIC',
    );
    copyFileSync(before, after);
    edit(`DELETE FROM ch_clearing WHERE iid = '08002'`);
    const diff = compareSwissClearingOnly(before, after);
    expect(diff).toMatchObject({ changed: true, outside: [] });
    expect(diff.summary).toContain(
      'content: 0 IID added, 1 removed, 0 modified, of which 0 with a new BIC',
    );
  });

  it('refuses a change to any other table', () => {
    edit(`UPDATE bic_entries SET bic11 = 'RBABCH22ALP'`);
    expect(compareSwissClearingOnly(before, after).outside).toEqual(['bic_entries']);
    copyFileSync(before, after);
    edit(`DELETE FROM national_bank_codes`);
    expect(compareSwissClearingOnly(before, after).outside).toEqual(['national_bank_codes']);
  });

  it('refuses a change of schema, ch_clearing included, and a table that appears', () => {
    edit('ALTER TABLE ch_clearing ADD COLUMN canton TEXT');
    expect(compareSwissClearingOnly(before, after).outside).toEqual([
      'schema of table:ch_clearing',
    ]);
    copyFileSync(before, after);
    edit('CREATE TABLE ch_extra (iid TEXT)');
    expect(compareSwissClearingOnly(before, after).outside).toEqual(['schema of table:ch_extra']);
  });

  it('refuses a SIX file older than the one committed, even with the same content', () => {
    const db = new Database(before);
    db.exec(`UPDATE ch_clearing SET valid_on = '2026-10-29'`);
    db.close();
    const diff = compareSwissClearingOnly(before, after);
    expect(diff.changed).toBe(false);
    expect(diff.outside).toEqual([
      'ch_clearing: the SIX file read (valid_on 2026-10-02) is older than the one committed (valid_on 2026-10-29)',
    ]);
  });

  it('runs the real command: changed=true written for the workflow, a refusal exits non-zero', () => {
    reseed('2026-10-29', '2026-10-29 14:23:05', 'RBABCH22ALP');
    const output = join(dir, 'github-output');
    writeFileSync(output, '');
    const ok = spawnSync('npx', ['tsx', SCRIPT], {
      cwd: REPO,
      env: { ...process.env, CH_DIFF_BEFORE: before, CH_DIFF_AFTER: after, GITHUB_OUTPUT: output },
      encoding: 'utf-8',
      timeout: 110_000,
    });
    const out = `${ok.stdout ?? ''}${ok.stderr ?? ''}`;
    expect(ok.status, ok.error?.message ?? out).toBe(0);
    expect(out).toContain('Swiss clearing changed');
    expect(readFileSync(output, 'utf8')).toBe('changed=true\n');

    edit(`UPDATE bic_entries SET institution = 'Banque Epsilon SA'`);
    const refused = spawnSync('npx', ['tsx', SCRIPT], {
      cwd: REPO,
      env: { ...process.env, CH_DIFF_BEFORE: before, CH_DIFF_AFTER: after, GITHUB_OUTPUT: output },
      encoding: 'utf-8',
      timeout: 110_000,
    });
    const why = `${refused.stdout ?? ''}${refused.stderr ?? ''}`;
    expect(refused.status, refused.error?.message ?? why).toBe(1);
    expect(why).toContain('REFUSED: bic_entries');
    expect(readFileSync(output, 'utf8')).toBe('changed=true\n');
  }, 240_000);
});

/**
 * Le calendrier des écrivains de data/bic.sqlite, lu dans les fichiers eux-mêmes.
 * Un écrivain hors du groupe de concurrence ou deux crons identiques se
 * disputeraient le même binaire ; la relecture suisse ne doit lancer que le
 * chargeur SIX et ne commiter que ses deux fichiers ; le passage mensuel garde
 * son calendrier et relit toujours SIX.
 */
describe('the writers of data/bic.sqlite and their calendar', () => {
  const WORKFLOWS = join(REPO, '.github', 'workflows');
  const read = (name: string): string => readFileSync(join(WORKFLOWS, name), 'utf8');
  /** Le fichier sans ses lignes de commentaire, qui citent des commandes sans les lancer. */
  const code = (name: string): string =>
    read(name)
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
  const writers = readdirSync(WORKFLOWS)
    .filter((f) => f.endsWith('.yml'))
    .filter((f) => /git add [^\n]*data\/bic\.sqlite/.test(read(f)))
    .sort();
  const crons = (text: string): string[] =>
    [...text.matchAll(/^\s*- cron: '([^']+)'/gm)].map((m) => m[1]);

  it('knows the four writers, all in one concurrency group that cancels nobody', () => {
    expect(writers).toEqual([
      'refresh-bic.yml',
      'refresh-ch-clearing.yml',
      'refresh-cz-register.yml',
      'refresh-it-register.yml',
    ]);
    for (const name of writers) {
      const text = read(name);
      expect(text, name).toMatch(
        /concurrency:\s*\n\s*group: bic-sqlite-writer\s*\n\s*cancel-in-progress: false/,
      );
    }
  });

  it('gives no two writers the same cron', () => {
    const all = writers.flatMap((name) => crons(read(name)));
    expect(all.length).toBe(writers.length);
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps the monthly run on the 1st, still re-reading SIX with everything else', () => {
    const monthly = code('refresh-bic.yml');
    expect(crons(monthly)).toEqual(['0 3 1 * *']);
    for (const step of ['npm run db:seed', 'npm run bic:enrich', 'npm run db:seed-ch']) {
      expect(monthly).toContain(step);
    }
  });

  it('re-reads SIX once a week, and SIX only', () => {
    const weekly = code('refresh-ch-clearing.yml');
    const [cron, ...more] = crons(weekly);
    expect(more).toEqual([]);
    const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.split(' ');
    expect([dayOfMonth, month]).toEqual(['*', '*']);
    expect(dayOfWeek).toMatch(/^[0-6]$/);
    expect(Number(minute)).toBeLessThan(60);
    expect(Number(hour)).toBeLessThan(24);
    const seeders = [...weekly.matchAll(/npm run (?:db|bic):[\w-]+|scripts\/seed-[\w-]+\.ts/g)].map(
      (m) => m[0],
    );
    expect(seeders).toEqual(['npm run db:seed-ch']);
    expect(weekly).toContain('with:\n          ref: main');
  });

  it('judges, tests and exports before it commits, and commits its two files only', () => {
    const weekly = code('refresh-ch-clearing.yml');
    const order = [
      'npm run db:seed-ch',
      'npx tsx scripts/ch-clearing-diff.ts',
      'npx tsx scripts/refresh-diff.ts',
      'npm run test',
      'npm run pages:export -- CH',
      'git add data/bic.sqlite frontend/data/registers/ch-iid.json\n',
      'git push',
      'internal/heartbeat/refresh-ch-clearing',
    ].map((step) => weekly.indexOf(step));
    expect(
      order.every((i) => i >= 0),
      JSON.stringify(order),
    ).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect([...weekly.matchAll(/git add /g)].length).toBe(1);
  });

  it('does nothing on the 1st, when the monthly run re-reads SIX, except on a manual run', () => {
    const weekly = code('refresh-ch-clearing.yml');
    expect(weekly).toContain(
      'if [ "${GITHUB_EVENT_NAME}" = "schedule" ] && [ "$(date -u +%d)" = "01" ]; then',
    );
    const guarded = [...weekly.matchAll(/if: steps\.day\.outputs\.skip != 'true'/g)].length;
    expect(guarded).toBe(2);
    // Toutes les étapes qui écrivent ou commitent attendent `changed == 'true'`,
    // que le garde n'écrit pas quand il ne tourne pas.
    expect([...weekly.matchAll(/if: steps\.diff_ch\.outputs\.changed == 'true'/g)].length).toBe(4);
  });
});

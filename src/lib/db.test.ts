/**
 * La copie de l'état payant avant un changement de schéma de stats.sqlite (C18, OPS-25#1).
 *
 * Ce que ces tests tiennent, par l'ouverture réelle de db.ts sur des bases jetables créées
 * ici, à l'ancien schéma puis au nouveau (aucune base réelle) :
 *   - la copie ne contient QUE les tables de la sauvegarde (liste blanche), lignes entières,
 *     sans clé en clair, prises AVANT la migration ;
 *   - une base à jour, ou neuve, n'en laisse aucune : jamais une copie à chaque démarrage ;
 *   - deux copies au plus, aucune de plus de trente jours, aucune datée du futur ;
 *   - une copie impossible (borne de taille, place, échec) ne bloque pas la migration ;
 *   - une migration interrompue, ou annulée par SQLite en route, ne laisse pas la base à
 *     moitié migrée, et sa reprise est bornée dans le temps.
 *
 * Le module db.ts lit STATS_DB_PATH une fois à l'import : chaque cas repart d'un registre
 * de modules vierge, dans un dossier jetable effacé en entier. Fixtures inventées, ce
 * dépôt est public.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PRE_MIGRATION_COPIES_KEPT,
  beginStatsMigration,
  describePreMigrationCopy,
  listPreMigrationCopies,
  preMigrationCopyProblems,
} from './pre-migration-copy.js';
import { PAID_STATE_TABLES } from './paid-state.js';

/**
 * La place du volume est celle d'un disque rempli à 10 %, quel que soit le disque de la
 * machine qui lance les tests : sans ça, ces tests dépendraient du remplissage du poste.
 * Le cas « place insuffisante » est tenu plus bas, par sa propre mesure injectée.
 */
const volume = vi.hoisted(() => ({ usedShare: 0.1 }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const blocks = 1_000_000;
  return {
    ...actual,
    statfsSync: () => ({
      type: 0,
      bsize: 4096,
      blocks,
      bfree: Math.round(blocks * (1 - volume.usedShare)),
      bavail: Math.round(blocks * (1 - volume.usedShare)),
      files: 0,
      ffree: 0,
    }),
  };
});

const VERSION = (createRequire(import.meta.url)('../../package.json') as { version: string })
  .version;
const HERMETIC = process.env.STATS_DB_PATH;
const dirs: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibf-c18-'));
  dirs.push(dir);
  return dir;
}

async function openAt(path: string) {
  vi.resetModules();
  process.env.STATS_DB_PATH = path;
  return import('./db.js');
}

afterEach(() => {
  vi.useRealTimers();
  process.env.STATS_DB_PATH = HERMETIC;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * Une base d'avant : `api_keys` sous sa forme d'avril (six colonnes) et `audit_sales` avec
 * son ancienne colonne `price_chf`, que la migration du 16.09.2026 renomme en `price`.
 */
function writeOldBase(path: string): void {
  const raw = new Database(path);
  raw.exec(`
    CREATE TABLE api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_hash TEXT UNIQUE NOT NULL,
      key_prefix TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      active INTEGER DEFAULT 1
    );
    INSERT INTO api_keys (key_hash, key_prefix, email) VALUES ('h1', 'ifk_00000001', 'acme@example.com');
    CREATE TABLE audit_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      paid_at TEXT DEFAULT (datetime('now')),
      rows INTEGER NOT NULL,
      tier TEXT NOT NULL,
      price_chf INTEGER NOT NULL,
      amount_paid_minor INTEGER,
      amount_paid_currency TEXT,
      stripe_session_id TEXT,
      lang TEXT
    );
    INSERT INTO audit_sales (job_id, rows, tier, price_chf) VALUES ('job-alpha', 120, 'small', 90);
  `);
  raw.close();
}

function removeBase(path: string): void {
  for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
}

function columns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
}

function tablesOf(db: Database.Database): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
      name: string;
    }>
  )
    .map((r) => r.name)
    .sort();
}

function rowCount(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
}

function copyFiles(dir: string): string[] {
  return readdirSync(dir).filter((n) => n.includes('.pre-migration-'));
}

/** Le nom qu'une copie prend à cet instant (voir stampOf dans pre-migration-copy.ts). */
function copyNameAt(iso: string): string {
  return `stats.pre-migration-${VERSION}-${iso.replace(/[-:]/g, '')}.sqlite`;
}

/**
 * Des tables hors de la sauvegarde, dont la marque ne doit jamais se retrouver dans les
 * octets d'une copie : journal, identifiants soumis, audit, CRM, codes et sessions, et deux
 * tables créées hors d'openStatsDB, dont une qui n'existe pas encore dans le code.
 */
const OUTSIDE_THE_BACKUP = [
  'request_log',
  'operations',
  'audit_jobs',
  'email_messages',
  'prospects',
  'pending_verifications',
  'account_sessions',
  'lookup_gaps',
  'table_de_demain',
];

function atDate(iso: string): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

/**
 * Pose une ligne inventée dans n'importe quelle table, d'après son seul schéma : chaque
 * colonne obligatoire sans défaut, et chaque clé primaire qui n'est pas un rowid, reçoit
 * une valeur de son type, marquée du nom de la table pour la retrouver dans les octets.
 */
function insertInventedRow(db: Database.Database, table: string): void {
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
    pk: number;
  }>;
  const chosen = cols.filter(
    (c) =>
      (c.notnull === 1 && c.dflt_value === null && c.pk === 0) ||
      (c.pk > 0 && !/INT/i.test(c.type)),
  );
  const value = (type: string): unknown =>
    /INT/i.test(type)
      ? 1
      : /REAL|NUM/i.test(type)
        ? 1.5
        : /BLOB/i.test(type)
          ? Buffer.from(`marque-${table}`)
          : `marque-${table}`;
  if (chosen.length === 0) {
    db.prepare(`INSERT INTO "${table}" DEFAULT VALUES`).run();
    return;
  }
  db.prepare(
    `INSERT INTO "${table}" (${chosen.map((c) => `"${c.name}"`).join(', ')}) VALUES (${chosen.map(() => '?').join(', ')})`,
  ).run(...chosen.map((c) => value(c.type)));
}

describe('copie de l’état payant avant migration (C18)', () => {
  it('une base à l’ancien schéma laisse une copie lisible, prise AVANT la migration', async () => {
    const dir = freshDir();
    const path = join(dir, 'stats.sqlite');
    writeOldBase(path);

    const mod = await openAt(path);
    const live = mod.getStatsDB();
    const state = mod.getPreMigrationCopyState();
    expect(state.status).toBe('copied');
    expect(columns(live, 'api_keys')).toContain('tier');
    expect(columns(live, 'audit_sales')).toContain('price');
    mod.closeAll();

    const copies = listPreMigrationCopies(path);
    expect(copies).toHaveLength(1);
    const prefix = `stats.pre-migration-${VERSION}-`;
    expect(copies[0].startsWith(prefix)).toBe(true);
    expect(copies[0].slice(prefix.length)).toMatch(/^\d{8}T\d{6}\.\d{3}Z\.sqlite$/);
    expect(state.status === 'copied' && state.file).toBe(copies[0]);
    expect(copyFiles(dir)).toEqual(copies);
    const copy = new Database(join(dir, copies[0]), { readonly: true, fileMustExist: true });
    try {
      expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(preMigrationCopyProblems(copy)).toEqual([]);
      // L'état d'AVANT : api_keys n'a pas encore les colonnes que la migration ajoute.
      expect(columns(copy, 'api_keys')).not.toContain('tier');
      expect(copy.prepare('SELECT email FROM api_keys').all()).toEqual([
        { email: 'acme@example.com' },
      ]);
      // audit_sales n'est pas dans la sauvegarde : elle n'est pas dans la copie.
      expect(tablesOf(copy)).toEqual(['api_keys', 'sqlite_sequence']);
    } finally {
      copy.close();
    }
  });

  it('ne contient que les tables de la sauvegarde, entières, et aucune clé en clair', async () => {
    const dir = freshDir();
    const path = join(dir, 'stats.sqlite');
    // Une base au dernier schéma, une ligne inventée dans CHAQUE table, plus deux tables
    // créées hors d'openStatsDB (dont une « future ») : la liste blanche doit les ignorer
    // toutes sans les connaître. Puis une migration en attente.
    const first = await openAt(path);
    const db = first.getStatsDB();
    db.exec(`
      CREATE TABLE IF NOT EXISTS lookup_gaps (kind TEXT NOT NULL, country TEXT, code TEXT NOT NULL,
        outcome TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (kind, country, code, outcome));
      CREATE TABLE table_de_demain (adresse TEXT NOT NULL);
    `);
    // Une table à contrainte CHECK refuse la ligne inventée : elle est passée, mais toutes
    // celles que ce test vérifie plus bas doivent en avoir reçu une, sinon il ne prouve rien.
    const filled = new Set<string>();
    for (const table of tablesOf(db)) {
      if (table === 'sqlite_sequence') continue;
      try {
        insertInventedRow(db, table);
        filled.add(table);
      } catch {
        /* contrainte propre à la table : sans effet sur ce que le test vérifie */
      }
    }
    for (const table of [...PAID_STATE_TABLES, ...OUTSIDE_THE_BACKUP]) {
      expect(filled.has(table), table).toBe(true);
    }
    db.prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, raw_key_one_time_view)
       VALUES ('hash-alpha', 'ifk_0000000a', 'acme@example.com', 'ifk_cle_en_clair_inventee')`,
    ).run();
    db.exec('ALTER TABLE audit_sales RENAME COLUMN price TO price_chf');
    const liveCounts = Object.fromEntries(PAID_STATE_TABLES.map((t) => [t, rowCount(db, t)]));
    first.closeAll();

    const boot = await openAt(path);
    boot.getStatsDB();
    expect(boot.getPreMigrationCopyState().status).toBe('copied');
    boot.closeAll();

    const [name] = listPreMigrationCopies(path);
    const copy = new Database(join(dir, name), { readonly: true, fileMustExist: true });
    try {
      expect(preMigrationCopyProblems(copy)).toEqual([]);
      // Exactement la liste blanche, ni plus ni moins.
      expect(tablesOf(copy)).toEqual([...PAID_STATE_TABLES, 'sqlite_sequence'].sort());
      // Chaque table de l'état payant, entière.
      for (const table of PAID_STATE_TABLES) {
        expect(rowCount(copy, table), table).toBe(liveCounts[table]);
      }
      expect(
        copy.prepare("SELECT email FROM api_keys WHERE key_hash = 'hash-alpha'").get(),
      ).toEqual({ email: 'acme@example.com' });
      // La clé en clair : colonne gardée, valeur jamais écrite.
      expect(columns(copy, 'api_keys')).toContain('raw_key_one_time_view');
      expect(
        copy
          .prepare('SELECT COUNT(*) AS n FROM api_keys WHERE raw_key_one_time_view IS NOT NULL')
          .get(),
      ).toEqual({ n: 0 });
      // Les index suivent leur table.
      expect(
        (
          copy.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{
            name: string;
          }>
        ).map((r) => r.name),
      ).toContain('idx_api_keys_hash');
      expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      copy.close();
    }
    // Rien d'une table hors liste ne figure dans les octets du fichier, ni la clé en clair.
    const bytes = readFileSync(join(dir, name));
    for (const absent of [
      'ifk_cle_en_clair_inventee',
      ...OUTSIDE_THE_BACKUP.map((t) => `marque-${t}`),
    ]) {
      expect(bytes.includes(Buffer.from(absent)), absent).toBe(false);
    }
  });

  it('une base neuve, puis la même base à jour, n’en laissent aucune', async () => {
    const dir = freshDir();
    const path = join(dir, 'stats.sqlite');

    const first = await openAt(path);
    first.getStatsDB();
    expect(first.getPreMigrationCopyState()).toEqual({ status: 'not_needed' });
    first.closeAll();

    const second = await openAt(path);
    second.getStatsDB();
    expect(second.getPreMigrationCopyState()).toEqual({ status: 'not_needed' });
    second.closeAll();

    expect(copyFiles(dir)).toEqual([]);
  });

  it(`garde ${PRE_MIGRATION_COPIES_KEPT} copies au plus, les plus récentes`, async () => {
    const dir = freshDir();
    const path = join(dir, 'stats.sqlite');
    const boots = [
      '2026-11-01T08:00:00.000Z',
      '2026-11-02T08:00:00.000Z',
      '2026-11-03T08:00:00.000Z',
    ];
    for (const iso of boots) {
      removeBase(path);
      writeOldBase(path);
      atDate(iso);
      const mod = await openAt(path);
      mod.getStatsDB();
      expect(mod.getPreMigrationCopyState().status).toBe('copied');
      mod.closeAll();
      vi.useRealTimers();
    }
    expect(copyFiles(dir).sort()).toEqual([copyNameAt(boots[1]), copyNameAt(boots[2])].sort());
  });

  it('efface au démarrage une copie de plus de trente jours, même seule', async () => {
    const dir = freshDir();
    const path = join(dir, 'stats.sqlite');
    const ready = await openAt(path);
    ready.getStatsDB();
    ready.closeAll();

    // 31 jours : effacée par le démarrage (initStatsDB, que src/index.ts appelle avant
    // tout), alors qu'aucune migration ne suit.
    const old = copyNameAt('2026-10-09T08:00:00.000Z');
    writeFileSync(join(dir, old), 'copie de test');
    atDate('2026-11-10T08:00:00.000Z');
    const boot = await openAt(path);
    expect(boot.initStatsDB()).toEqual({ ok: true });
    expect(boot.getPreMigrationCopyState()).toEqual({ status: 'not_needed' });
    boot.closeAll();
    expect(copyFiles(dir)).toEqual([]);

    // 29 jours : gardée. C'est bien l'âge qui décide, pas la simple présence.
    const recent = copyNameAt('2026-10-12T08:00:00.000Z');
    writeFileSync(join(dir, recent), 'copie de test');
    const again = await openAt(path);
    again.initStatsDB();
    again.closeAll();
    expect(copyFiles(dir)).toEqual([recent]);

    // Et la purge du tick quotidien fait la même chose sans redémarrage.
    vi.setSystemTime(new Date('2026-11-12T08:00:00.000Z'));
    const tick = await openAt(path);
    expect(tick.purgeStatsPreMigrationCopies()).toEqual({ removed: [recent], failed: [] });
    expect(copyFiles(dir)).toEqual([]);
  });

  it('une copie datée du futur compte comme expirée', async () => {
    const dir = freshDir();
    const path = join(dir, 'stats.sqlite');
    atDate('2026-11-10T08:00:00.000Z');
    writeFileSync(join(dir, copyNameAt('2026-11-11T08:00:00.000Z')), 'copie de test');
    const boot = await openAt(path);
    boot.initStatsDB();
    boot.closeAll();
    expect(copyFiles(dir)).toEqual([]);
  });

  it('une copie impossible ne bloque pas la migration, et le dit', async () => {
    const dir = freshDir();
    const path = join(dir, 'stats.sqlite');
    writeOldBase(path);
    const iso = '2026-11-10T08:00:00.000Z';
    atDate(iso);
    // Un répertoire occupe le nom de la copie : le renommage final échoue.
    mkdirSync(join(dir, copyNameAt(iso), 'occupé'), { recursive: true });

    const mod = await openAt(path);
    const live = mod.getStatsDB();
    const state = mod.getPreMigrationCopyState();
    expect(state.status).toBe('failed');
    expect(columns(live, 'api_keys')).toContain('tier');
    expect(mod.getStatsDbState()).toEqual({ ok: true });
    mod.closeAll();
    expect(readdirSync(dir).filter((n) => n.includes('.partial'))).toEqual([]);
    const report = describePreMigrationCopy(state);
    expect(report.alert).toBe(true);
    expect(report.line).toMatch(/SANS copie préalable/);
  });

  it('après une ouverture ratée, la reprise attend trente secondes, puis réussit', async () => {
    const dir = freshDir();
    const path = join(dir, 'stats.sqlite');
    writeFileSync(path, 'ceci n’est pas une base SQLite');
    atDate('2026-11-10T08:00:00.000Z');
    const mod = await openAt(path);
    expect(() => mod.getStatsDB()).toThrow();
    const cause = mod.getStatsDbState().error;

    // Fichier réparé : la tentative suivante attend, sans rouvrir ni rejouer.
    removeBase(path);
    vi.setSystemTime(new Date('2026-11-10T08:00:20.000Z'));
    expect(() => mod.getStatsDB()).toThrow(cause);
    expect(readdirSync(dir).filter((n) => n.startsWith('stats.sqlite'))).toEqual([]);

    // Trente secondes plus tard : une vraie tentative, qui réussit.
    vi.setSystemTime(new Date('2026-11-10T08:00:31.000Z'));
    expect(() => mod.getStatsDB()).not.toThrow();
    expect(mod.getStatsDbState()).toEqual({ ok: true });
    mod.closeAll();
  });
});

describe('la transaction de migration (pre-migration-copy.ts)', () => {
  function oldRawBase(dir: string): { path: string; db: Database.Database } {
    const path = join(dir, 'stats.sqlite');
    writeOldBase(path);
    const db = new Database(path);
    db.pragma('journal_mode = WAL');
    return { path, db };
  }

  it('au-delà de la borne de taille : pas de copie, la migration est validée, l’alerte est due', () => {
    const { path, db } = oldRawBase(freshDir());
    const migration = beginStatsMigration(db, path, { Database, version: VERSION, maxBytes: 1 });
    db.exec('ALTER TABLE api_keys ADD COLUMN tier TEXT');
    const state = migration.finish();
    expect(state.status).toBe('skipped_too_large');
    expect(listPreMigrationCopies(path)).toEqual([]);
    expect(copyFiles(dirOf(path))).toEqual([]);
    expect(columns(db, 'api_keys')).toContain('tier');
    expect(db.inTransaction).toBe(false);
    expect(describePreMigrationCopy(state).alert).toBe(true);
    db.close();
  });

  it('sans place sur le volume : pas de copie, la migration est validée, l’alerte est due', () => {
    const { path, db } = oldRawBase(freshDir());
    const migration = beginStatsMigration(db, path, {
      Database,
      version: VERSION,
      // Un volume à 95 % : la copie le pousserait au-delà du plafond de 92 %.
      space: () => ({ free: 5 * 1_048_576, total: 100 * 1_048_576 }),
    });
    db.exec('ALTER TABLE audit_sales RENAME COLUMN price_chf TO price');
    const state = migration.finish();
    expect(state.status).toBe('skipped_no_space');
    expect(listPreMigrationCopies(path)).toEqual([]);
    expect(columns(db, 'audit_sales')).toContain('price');
    expect(db.inTransaction).toBe(false);
    expect(describePreMigrationCopy(state).alert).toBe(true);
    db.close();
  });

  it('SQLite annule la transaction en route : finish jette, rien n’est copié', () => {
    const { path, db } = oldRawBase(freshDir());
    const migration = beginStatsMigration(db, path, { Database, version: VERSION });
    db.exec('ALTER TABLE api_keys ADD COLUMN tier TEXT');
    // Ce que SQLite fait seul sur un disque plein ou une erreur d'entrée-sortie, dans une
    // étape rattrapée par un try/catch : la transaction entière est défaite…
    db.exec('ROLLBACK');
    // …et les étapes suivantes se valident une à une.
    db.exec('CREATE TABLE IF NOT EXISTS etape_suivante (x)');
    expect(() => migration.finish()).toThrow(/annulée par SQLite/);
    expect(columns(db, 'api_keys')).not.toContain('tier');
    expect(listPreMigrationCopies(path)).toEqual([]);
    db.close();
  });

  it('une migration qui jette en route ne laisse pas la base à moitié migrée', () => {
    const { path, db } = oldRawBase(freshDir());
    beginStatsMigration(db, path, { Database, version: VERSION });
    db.exec('ALTER TABLE audit_sales RENAME COLUMN price_chf TO price');
    // Ce que fait getStatsDB quand openStatsDB jette : fermer la connexion.
    db.close();
    const after = new Database(path);
    try {
      expect(columns(after, 'audit_sales')).toContain('price_chf');
      expect(columns(after, 'audit_sales')).not.toContain('price');
    } finally {
      after.close();
    }
    expect(listPreMigrationCopies(path)).toEqual([]);
  });
});

function dirOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'));
}

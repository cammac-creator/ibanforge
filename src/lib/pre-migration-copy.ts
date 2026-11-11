/**
 * La copie de l'état payant avant un changement de schéma de `stats.sqlite` (C18, OPS-25#1).
 *
 * ## Pourquoi
 *
 * Les migrations d'`openStatsDB` (src/lib/db.ts) se jouent au démarrage, sur l'unique
 * volume (railway.toml), sans préproduction, et l'ancien conteneur est arrêté avant que le
 * nouveau démarre (docs/handover.md §6). Une migration fautive, ou un retour à l'image
 * précédente après un `RENAME COLUMN`, n'avait aucun état d'avant auquel revenir.
 *
 * ## Ce que la copie contient : une liste blanche
 *
 * Les seules tables de l'état payant, `PAID_STATE_TABLES` (src/lib/paid-state.ts), la liste
 * même que la sauvegarde nocturne exporte (`exportPaidState`, src/lib/backup.ts), avec la
 * clé en clair d'`api_keys` remise à NULL sans jamais être écrite. Toute autre table,
 * présente ou future, en est absente par construction : ni journal des requêtes, ni
 * identifiants soumis, ni rapports d'audit, ni CRM. La copie a donc le périmètre des
 * sauvegardes que décrivent les textes publiés (politique §2, DPA 4.8).
 *
 * ## Comment, sans rien prédire
 *
 * Toute la migration se joue dans UNE transaction (`BEGIN IMMEDIATE`). À la fin, si
 * `PRAGMA schema_version` a bougé (SQLite l'incrémente à chaque changement réel du schéma,
 * jamais pour un `CREATE … IF NOT EXISTS` qui ne crée rien), une seconde connexion ouvre un
 * fichier neuf, y attache la base vivante et y recopie les tables de la liste, table par
 * table, avec leur définition et leurs index. En WAL, cette connexion lit l'état VALIDÉ,
 * celui d'avant la migration en cours. La copie est forcée sur le disque, fichier puis
 * dossier (11.11.2026), puis la transaction de migration est validée. La
 * copie se fait donc si et seulement si la migration a changé le schéma, jamais à chaque
 * démarrage. Une base neuve (aucune table) n'est jamais copiée.
 *
 * Sa durée dépend de l'état payant, pas du journal des requêtes, et elle est bornée :
 * au-delà de PRE_MIGRATION_COPY_MAX_BYTES, la copie est sautée (voir la constante).
 *
 * ## Quand une étape échoue
 *
 * - Une exception au milieu de la migration remonte jusqu'à `getStatsDB`, qui ferme la
 *   connexion : SQLite annule la transaction ouverte, la base n'est pas laissée à moitié
 *   migrée, et la migration est rejouée au plus une fois par STATS_REOPEN_RETRY_MS (db.ts).
 * - Une erreur que SQLite traite en annulant lui-même la transaction (disque plein, erreur
 *   d'entrée-sortie, mémoire) dans une étape que la migration rattrape (try/catch des
 *   rattrapages de lignées) défait TOUT ce qui précédait, puis les instructions suivantes
 *   se valident seules : la base n'a alors que les dernières étapes. `finish` le voit
 *   (plus de transaction ouverte) et jette, si bien que `getStatsDB` note l'échec, que
 *   /health répond 503 avec la cause, et que la migration entière est rejouée au plus une
 *   fois par STATS_REOPEN_RETRY_MS. Chaque étape étant rejouable, la reprise la complète.
 * - Place insuffisante, base trop grosse, ou copie en échec : la migration est VALIDÉE quand
 *   même, sans copie, et l'état est rendu à src/index.ts, qui lève l'alerte
 *   `db:pre-migration-copy`. Échouer fermé arrêterait l'API payante (clés, quotas, crédits)
 *   pour une copie de sécurité, sans préproduction ni ancien conteneur pour prendre le
 *   relais ; l'état des comptes a par ailleurs sa sauvegarde nocturne hors du volume. La
 *   copie n'écrit jamais dans la base vivante, et un fichier partiel est effacé.
 *
 * ## Durée de vie
 *
 * Deux copies au plus, aucune de plus de PRE_MIGRATION_COPY_MAX_AGE_DAYS jours : la purge
 * par âge passe au démarrage (`initStatsDB`), à chaque tick quotidien
 * (src/lib/pre-migration-copy-ops.ts) et juste avant d'écrire une copie, même pour une copie
 * seule. `scripts/forget-customer.cjs` ne connaît pas ces copies : une adresse effacée
 * après une copie peut y rester trente jours au plus, dans la limite des 90 jours que les
 * textes publiés promettent pour les sauvegardes.
 */
import {
  closeSync,
  fsyncSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
} from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type DatabaseType from 'better-sqlite3';
import { PAID_STATE_EXCLUDED_COLUMNS, PAID_STATE_TABLES } from './paid-state.js';

/** Deux copies au plus : la dernière migration, et celle d'avant pour comparer. */
export const PRE_MIGRATION_COPIES_KEPT = 2;

/**
 * Trente jours au plus, purgés même quand la copie est seule : les sauvegardes nocturnes
 * gardent déjà trente jours, et les textes publiés promettent qu'une adresse effacée sort
 * des sauvegardes en 90 jours au plus.
 */
export const PRE_MIGRATION_COPY_MAX_AGE_DAYS = 30;

/**
 * Remplissage du volume au-delà duquel la copie n'est pas faite : le seuil critique de la
 * sonde du volume (`probeVolume`, src/lib/ops-probes.ts), où un point de contrôle du WAL
 * peut déjà échouer faute de place.
 */
export const PRE_MIGRATION_COPY_MAX_VOLUME_USE = 0.92;

/**
 * La borne dure : au-delà de 64 Mio d'état payant (tables de la liste et leurs index, mesurés
 * par `dbstat` avant de rien écrire), la copie est sautée, avec l'alerte, et la migration
 * passe. La copie se fait avant que le service écoute, dans les 30 s que le contrôle de
 * santé de l'hébergeur laisse au démarrage, et l'ancien conteneur est déjà arrêté : une
 * copie trop lente ferait échouer chaque déploiement, en boucle.
 *
 * Mesuré le 11.11.2026 sur le SSD de développement, base synthétique de 289 Mo dont 50 Mo
 * d'état payant (le reste : journal des requêtes) : copie en 0,2 à 0,5 s, démarrage qui
 * migre et copie en 1 à 2,2 s ; l'ancienne copie de la base entière prenait 2,5 s à elle
 * seule. À 64 Mio, un volume réseau vingt fois plus lent resterait sous 15 s.
 */
export const PRE_MIGRATION_COPY_MAX_BYTES = 64 * 1_048_576;

/** La clé d'alerte d'exploitation levée par src/index.ts. */
export const PRE_MIGRATION_COPY_ALERT_KEY = 'db:pre-migration-copy';

export type PreMigrationCopyState =
  | { status: 'not_needed' }
  | { status: 'copied'; file: string; bytes: number; ms: number }
  | { status: 'skipped_too_large'; paid_state_bytes: number; max_bytes: number }
  | { status: 'skipped_no_space'; needed_bytes: number; free_bytes: number; total_bytes: number }
  | { status: 'failed'; error: string };

export interface VolumeSpace {
  free: number;
  total: number;
}

type DatabaseConstructor = typeof DatabaseType;

export interface MigrationCopyDeps {
  /** Le constructeur better-sqlite3, chargé paresseusement par db.ts. */
  Database: DatabaseConstructor;
  /** La version du service, écrite dans le nom de la copie. */
  version: string;
  now?: () => Date;
  /** Place du volume ; `null` si elle ne se lit pas (la copie est alors tentée). */
  space?: (dir: string) => VolumeSpace | null;
  /** Pour les tests : une autre borne que PRE_MIGRATION_COPY_MAX_BYTES. */
  maxBytes?: number;
}

const MS_PER_DAY = 86_400_000;

/** `<base>.pre-migration-` : la copie se range à côté de la base, sous son nom. */
function copyPrefix(dbPath: string): string {
  const base = basename(dbPath);
  const ext = extname(base);
  return `${ext ? base.slice(0, -ext.length) : base}.pre-migration-`;
}

/** 2026-11-10T08:00:00.123Z → 20261110T080000.123Z : triable, sans deux-points. */
function stampOf(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '');
}

function stampTime(stamp: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\.\d{3})?Z$/.exec(stamp);
  if (!m) return Number.NaN;
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? ''}Z`);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface CopyGroup {
  /** Nom du fichier principal de la copie. */
  name: string;
  stamp: string;
  /** Tous les fichiers du groupe : la copie, ses `-wal`/`-shm`/`-journal`, un `.partial`. */
  files: string[];
  /** Le fichier principal existe (sinon : un partiel abandonné ou des orphelins). */
  complete: boolean;
}

function listGroups(dbPath: string): CopyGroup[] {
  const dir = dirname(dbPath);
  const prefix = copyPrefix(dbPath);
  const pattern = new RegExp(
    `^(${escapeRegExp(prefix)}.+-(\\d{8}T\\d{6}(?:\\.\\d{3})?Z)\\.sqlite)(\\.partial)?(-wal|-shm|-journal)?$`,
  );
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const groups = new Map<string, CopyGroup>();
  for (const name of names) {
    const m = pattern.exec(name);
    if (!m) continue;
    const group = groups.get(m[1]) ?? { name: m[1], stamp: m[2], files: [], complete: false };
    group.files.push(name);
    if (!m[3] && !m[4]) group.complete = true;
    groups.set(m[1], group);
  }
  return [...groups.values()];
}

/** Les copies complètes d'une base, la plus récente d'abord (noms de fichiers). */
export function listPreMigrationCopies(dbPath: string): string[] {
  return listGroups(dbPath)
    .filter((g) => g.complete)
    .sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0))
    .map((g) => g.name);
}

export interface PurgeResult {
  removed: string[];
  failed: string[];
}

/**
 * Efface ce qui ne doit plus exister : les partiels abandonnés et les voisins orphelins,
 * les copies de plus de PRE_MIGRATION_COPY_MAX_AGE_DAYS jours (même seules), celles dont
 * l'horodatage est dans le FUTUR (une horloge reculée ou un nom fabriqué ne doit pas
 * soustraire une copie à la purge), puis tout ce qui dépasse les `keep` plus récentes. Ne
 * jette jamais : un fichier qui refuse de partir est rendu dans `failed`.
 */
export function purgePreMigrationCopies(
  dbPath: string,
  now: Date = new Date(),
  keep: number = PRE_MIGRATION_COPIES_KEPT,
): PurgeResult {
  const dir = dirname(dbPath);
  const result: PurgeResult = { removed: [], failed: [] };
  const drop = (group: CopyGroup): void => {
    for (const file of group.files) {
      try {
        rmSync(join(dir, file), { force: true });
        result.removed.push(file);
      } catch (err) {
        result.failed.push(file);
        console.error(
          '[db] copie avant migration non effacée :',
          file,
          err instanceof Error ? err.message : err,
        );
      }
    }
  };
  const maxAgeMs = PRE_MIGRATION_COPY_MAX_AGE_DAYS * MS_PER_DAY;
  const kept: CopyGroup[] = [];
  for (const group of listGroups(dbPath)) {
    const age = now.getTime() - stampTime(group.stamp);
    if (!group.complete || !(age >= 0 && age <= maxAgeMs)) drop(group);
    else kept.push(group);
  }
  kept.sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0));
  for (const group of kept.slice(Math.max(0, keep))) drop(group);
  return result;
}

function defaultSpace(dir: string): VolumeSpace | null {
  try {
    const s = statfsSync(dir);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bavail) * Number(s.bsize);
    return Number.isFinite(total) && total > 0 ? { free, total } : null;
  } catch {
    return null;
  }
}

function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * La taille de l'état payant dans la base attachée `live` : les pages de ses tables et de
 * leurs index, par `dbstat`, sans rien lire d'autre. Sans `dbstat`, la taille de la base
 * entière : une borne haute, qui saute la copie plutôt que de la risquer.
 */
function paidStateBytes(conn: DatabaseType.Database, tables: readonly string[]): number {
  const placeholders = tables.map(() => '?').join(', ');
  const objects = (
    conn
      .prepare(
        `SELECT name FROM live.sqlite_master WHERE tbl_name IN (${placeholders}) AND type IN ('table', 'index')`,
      )
      .all(...tables) as Array<{ name: string }>
  ).map((r) => r.name);
  try {
    let bytes = 0;
    const size = conn.prepare("SELECT pgsize FROM dbstat('live', 1) WHERE name = ?");
    for (const name of objects) {
      bytes += Number((size.get(name) as { pgsize: number } | undefined)?.pgsize ?? 0);
    }
    return bytes;
  } catch {
    const pageSize = Number(conn.pragma('live.page_size', { simple: true }));
    const pages = Number(conn.pragma('live.page_count', { simple: true }));
    return pageSize * pages;
  }
}

/**
 * Ce qu'une copie contient et ne devrait pas contenir : une table hors de la liste blanche,
 * ou une colonne exclue qui porte une valeur. Vide pour une copie conforme. Exporté pour
 * les tests.
 */
export function preMigrationCopyProblems(copy: DatabaseType.Database): string[] {
  const problems: string[] = [];
  const allowed = new Set<string>([...PAID_STATE_TABLES, 'sqlite_sequence']);
  const tables = (
    copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
      name: string;
    }>
  ).map((r) => r.name);
  for (const table of tables) if (!allowed.has(table)) problems.push(`table ${table}`);
  for (const [table, columns] of Object.entries(PAID_STATE_EXCLUDED_COLUMNS)) {
    if (!tables.includes(table)) continue;
    const present = new Set(
      (copy.prepare(`PRAGMA table_info(${quote(table)})`).all() as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
    for (const column of columns ?? []) {
      if (
        present.has(column) &&
        copy
          .prepare(`SELECT 1 FROM ${quote(table)} WHERE ${quote(column)} IS NOT NULL LIMIT 1`)
          .get()
      ) {
        problems.push(`${table}.${column}`);
      }
    }
  }
  return problems;
}

/**
 * Recopie les tables de la liste, présentes dans `live`, dans la base principale de `conn`
 * (le fichier neuf) : définition d'origine, lignes, puis index. Une seule transaction de
 * lecture sur `live`, donc un seul instantané cohérent de l'état payant. Les colonnes
 * exclues sont lues comme NULL : la clé en clair n'est jamais écrite dans la copie.
 */
function copyPaidState(conn: DatabaseType.Database, tables: readonly string[]): void {
  conn.exec('BEGIN');
  for (const table of tables) {
    const { sql } = conn
      .prepare("SELECT sql FROM live.sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { sql: string };
    conn.exec(sql);
    const excluded = new Set<string>(
      PAID_STATE_EXCLUDED_COLUMNS[table as keyof typeof PAID_STATE_EXCLUDED_COLUMNS] ?? [],
    );
    const columns = (
      conn.prepare(`PRAGMA live.table_info(${quote(table)})`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    const target = columns.map(quote).join(', ');
    const source = columns.map((c) => (excluded.has(c) ? 'NULL' : quote(c))).join(', ');
    conn.exec(
      `INSERT INTO main.${quote(table)} (${target}) SELECT ${source} FROM live.${quote(table)}`,
    );
  }
  const placeholders = tables.map(() => '?').join(', ');
  const indexes = conn
    .prepare(
      `SELECT sql FROM live.sqlite_master WHERE type = 'index' AND sql IS NOT NULL AND tbl_name IN (${placeholders})`,
    )
    .all(...tables) as Array<{ sql: string }>;
  for (const { sql } of indexes) conn.exec(sql);
  conn.exec('COMMIT');
}

/**
 * Force sur le disque ce qui a été écrit dans `path`, fichier ou dossier (11.11.2026).
 * La copie est écrite sans journal ni synchronisation (elle est jetée à la moindre
 * erreur) : avant que la migration soit validée, il faut qu'elle survive à une coupure.
 */
function syncToDisk(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function removeQuietly(path: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      rmSync(path + suffix, { force: true });
    } catch {
      /* déjà parti, ou un répertoire qu'on ne touche pas */
    }
  }
}

function copyCommittedState(dbPath: string, deps: MigrationCopyDeps): PreMigrationCopyState {
  const now = (deps.now ?? (() => new Date()))();
  const dir = dirname(dbPath);
  // Une seule ancienne copie gardée avant d'écrire, pour qu'il n'y en ait jamais plus de
  // PRE_MIGRATION_COPIES_KEPT. Si celle-ci échoue ensuite, l'ancienne la plus récente reste.
  purgePreMigrationCopies(dbPath, now, PRE_MIGRATION_COPIES_KEPT - 1);
  const version = deps.version.replace(/[^0-9A-Za-z.-]+/g, '_') || 'unknown';
  const target = join(dir, `${copyPrefix(dbPath)}${version}-${stampOf(now)}.sqlite`);
  // Écrite sous un nom provisoire puis renommée une fois relue : une copie interrompue ne
  // passe jamais pour une copie complète.
  const partial = `${target}.partial`;
  const maxBytes = deps.maxBytes ?? PRE_MIGRATION_COPY_MAX_BYTES;
  let conn: DatabaseType.Database | null = null;
  const started = performance.now();
  try {
    removeQuietly(partial);
    conn = new deps.Database(partial);
    // Fichier jeté à la moindre erreur : ni journal ni synchronisation pendant
    // l'écriture, une seule à la fin, avant le renommage (`syncToDisk`).
    conn.pragma('journal_mode = OFF');
    conn.pragma('synchronous = OFF');
    conn.prepare('ATTACH DATABASE ? AS live').run(dbPath);
    const present = new Set(
      (
        conn.prepare("SELECT name FROM live.sqlite_master WHERE type = 'table'").all() as Array<{
          name: string;
        }>
      ).map((r) => r.name),
    );
    const tables = PAID_STATE_TABLES.filter((t) => present.has(t));
    const bytes = paidStateBytes(conn, tables);
    if (bytes > maxBytes) {
      conn.close();
      conn = null;
      removeQuietly(partial);
      return { status: 'skipped_too_large', paid_state_bytes: bytes, max_bytes: maxBytes };
    }
    const space = (deps.space ?? defaultSpace)(dir);
    if (
      space &&
      (space.total - space.free + bytes) / space.total > PRE_MIGRATION_COPY_MAX_VOLUME_USE
    ) {
      conn.close();
      conn = null;
      removeQuietly(partial);
      return {
        status: 'skipped_no_space',
        needed_bytes: bytes,
        free_bytes: space.free,
        total_bytes: space.total,
      };
    }
    copyPaidState(conn, tables);
    conn.close();
    conn = null;
    // Relue avant d'exister : rien hors de la liste blanche, aucune clé en clair.
    const check = new deps.Database(partial, { readonly: true, fileMustExist: true });
    try {
      const problems = preMigrationCopyProblems(check);
      if (problems.length > 0) throw new Error(`copie non conforme : ${problems.join(', ')}`);
    } finally {
      check.close();
    }
    // Le fichier sur le disque, puis son nom dans le dossier : la migration n'est
    // validée qu'ensuite, par `finish`.
    syncToDisk(partial);
    renameSync(partial, target);
    try {
      syncToDisk(dir);
    } catch (err) {
      removeQuietly(target);
      throw err;
    }
    return {
      status: 'copied',
      file: basename(target),
      bytes: statSync(target).size,
      ms: Math.round(performance.now() - started),
    };
  } catch (err) {
    try {
      conn?.close();
    } catch {
      /* déjà fermée */
    }
    removeQuietly(partial);
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

export interface StatsMigration {
  /**
   * À appeler une fois la dernière instruction de migration jouée : copie l'état payant
   * d'avant si le schéma a changé, puis valide la transaction, que la copie ait réussi ou
   * non. Jette si SQLite a annulé la transaction en route (voir l'en-tête).
   */
  finish(): PreMigrationCopyState;
}

/**
 * Ouvre la transaction de migration sur `db`, déjà en WAL. Ne liste pas le dossier : la
 * purge par âge se fait au démarrage, au tick quotidien et juste avant d'écrire une copie.
 */
export function beginStatsMigration(
  db: DatabaseType.Database,
  dbPath: string,
  deps: MigrationCopyDeps,
): StatsMigration {
  const onDisk = dbPath !== '' && dbPath !== ':memory:' && !dbPath.startsWith('file:');
  db.exec('BEGIN IMMEDIATE');
  const hadSchema =
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
        .get() as { n: number }
    ).n > 0;
  const before = Number(db.pragma('schema_version', { simple: true }));
  return {
    finish(): PreMigrationCopyState {
      if (!db.inTransaction) {
        throw new Error(
          'stats.sqlite : la transaction de migration a été annulée par SQLite en route ' +
            '(disque plein, erreur d’entrée-sortie ou mémoire, dans une étape rattrapée) ; ' +
            'les étapes d’avant sont défaites, celles d’après validées seules. La migration ' +
            'entière est rejouée à la prochaine ouverture.',
        );
      }
      let state: PreMigrationCopyState = { status: 'not_needed' };
      const changed = Number(db.pragma('schema_version', { simple: true })) !== before;
      if (changed && hadSchema && onDisk) state = copyCommittedState(dbPath, deps);
      db.exec('COMMIT');
      return state;
    },
  };
}

/**
 * Ce que src/index.ts dit de la copie au démarrage : une ligne de journal, et s'il faut
 * lever l'alerte. Des noms de fichiers et des tailles, jamais une donnée de la base.
 */
export function describePreMigrationCopy(state: PreMigrationCopyState): {
  alert: boolean;
  line: string | null;
} {
  const mb = (bytes: number): string => (bytes / 1_048_576).toFixed(1);
  const without = 'Migration de stats.sqlite appliquée SANS copie préalable de l’état payant : ';
  switch (state.status) {
    case 'not_needed':
      return { alert: false, line: null };
    case 'copied':
      return {
        alert: false,
        line: `Copie de l’état payant avant migration écrite : ${state.file} (${mb(state.bytes)} Mo, ${state.ms} ms).`,
      };
    case 'skipped_too_large':
      return {
        alert: true,
        line:
          without +
          `${mb(state.paid_state_bytes)} Mo d’état payant, au-delà de la borne de ${mb(state.max_bytes)} Mo ` +
          '(la copie retarderait le démarrage au-delà du contrôle de santé).',
      };
    case 'skipped_no_space':
      return {
        alert: true,
        line:
          without +
          `place insuffisante (copie de ${mb(state.needed_bytes)} Mo, libre ${mb(state.free_bytes)} Mo ` +
          `sur ${mb(state.total_bytes)} Mo, plafond ${Math.round(PRE_MIGRATION_COPY_MAX_VOLUME_USE * 100)} %).`,
      };
    case 'failed':
      return { alert: true, line: without + state.error };
  }
}

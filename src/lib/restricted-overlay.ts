/**
 * La surcouche privée, au niveau des fichiers : contrôler, fusionner, extraire.
 *
 * ## Le montage
 *
 * `entrypoint.sh` recopie `bic.sqlite` et `compliance.sqlite` depuis l'image à
 * CHAQUE démarrage, par-dessus celles du disque. Des lignes ajoutées à la main
 * dans la copie du disque disparaîtraient donc au déploiement suivant. La
 * famille « sous conditions » (src/lib/restricted-family.ts) vit dans un FICHIER
 * SÉPARÉ par base, désigné par une variable ; au démarrage, l'API construit une
 * copie fusionnée à côté de ce fichier (base publique fraîche + surcouche) et
 * ouvre celle-là. La base publique n'est jamais modifiée, ni sur le disque du
 * serveur, ni dans `data/` du dépôt.
 *
 * ## La règle de fusion
 *
 * Pour chaque membre accepté, les lignes du membre dans la copie sont SUPPRIMÉES
 * puis remplacées par celles de la surcouche. La surcouche fait foi pour sa
 * famille : c'est ce qu'elle servira seule le jour où la base publique ne la
 * portera plus, et c'est ce que prouve le premier dépôt (Geste 4). Tant que la
 * base publique porte encore la famille, chaque membre dit s'il était identique
 * aux lignes publiques qu'il remplace (`identical_to_public`) : c'est le signal
 * qu'une surcouche extraite a pris du retard sur un rafraîchissement public.
 *
 * ## Deux pièges de SQLite, évités exprès
 *
 * - Les bases livrées sont en mode WAL. Renommer un fichier par-dessus un chemin
 *   qu'une connexion tient encore marierait le nouveau fichier avec les `-wal` et
 *   `-shm` de l'ancien. Chaque fusion écrit donc un fichier au NOM NEUF, en mode
 *   de journal DELETE (aucun fichier compagnon), et l'ancien n'est effacé
 *   qu'après la fermeture de sa connexion.
 * - Ouvrir une base WAL, même en lecture seule, peut créer ses compagnons à côté
 *   d'elle. L'extraction lit donc toujours une copie (voir
 *   scripts/restricted-overlay.ts), jamais `data/` du dépôt en place.
 */
import type DatabaseType from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import {
  RESTRICTED_TABLES,
  memberPredicate,
  membersOf,
  restrictedTable,
  type OverlayKind,
  type RestrictedMember,
  type RestrictedTable,
} from './restricted-family.js';

const require = createRequire(import.meta.url);

function openDatabase(path: string, options?: DatabaseType.Options): DatabaseType.Database {
  const Database = require('better-sqlite3') as typeof DatabaseType;
  return new Database(path, options);
}

/** Version du format de fichier. Un autre numéro est refusé, jamais deviné. */
export const OVERLAY_SCHEMA_VERSION = '1';
/** Clés du fichier (`schema`, `kind`, dates, empreinte de la base lue). */
export const OVERLAY_META_TABLE = 'overlay_meta';
/** Une ligne par membre : compte, empreinte du contenu, dates reprises de la base. */
export const OVERLAY_MEMBERS_TABLE = 'overlay_members';
/** Au-delà, ce n'est pas une surcouche : quelques Mo aujourd'hui pour les deux. */
const MAX_OVERLAY_BYTES = 256 * 1024 * 1024;

export interface MemberReport {
  id: string;
  table: string;
  state: 'applied' | 'refused';
  /** Lignes du membre dans la surcouche. */
  rows: number;
  /** Lignes réellement insérées dans la copie servie (un BIC11 public gagne). */
  inserted?: number;
  /** Lignes que la base publique portait pour ce membre avant la fusion. */
  public_rows?: number;
  /**
   * La base publique portait-elle exactement les mêmes lignes ? `null` quand
   * elle n'en portait aucune (cas normal une fois la famille retirée).
   */
  identical_to_public?: boolean | null;
  reason?: string;
}

export interface OverlayInspection {
  ok: boolean;
  /** Raison d'un refus du fichier entier. */
  error?: string;
  sha256?: string;
  bytes?: number;
  meta?: Record<string, string>;
  /** Membres dont le contenu a passé les contrôles, et ceux qui sont refusés. */
  members: MemberReport[];
}

export interface MergeResult {
  /** `applied` : tous les membres ; `partial` : certains refusés ; `refused` : aucun. */
  state: 'applied' | 'partial' | 'refused';
  /** Chemin du fichier fusionné, absent quand rien n'a été construit. */
  path?: string;
  sha256?: string;
  error?: string;
  members: MemberReport[];
  duration_ms: number;
}

/** Empreinte SHA-256 d'un fichier, en hexadécimal. */
export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Identifiant SQL inattendu : ${name}`);
  return `"${name}"`;
}

function tableColumns(db: DatabaseType.Database, schema: string, table: string): string[] {
  return (
    db.prepare(`PRAGMA ${schema}.table_info(${quoteIdent(table)})`).all() as Array<{
      name: string;
    }>
  ).map((c) => c.name);
}

function tableExists(db: DatabaseType.Database, schema: string, table: string): boolean {
  return !!db
    .prepare(`SELECT 1 AS ok FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
}

/** Colonnes recopiées d'une table : toutes, sauf l'alias du rowid. */
function copiedColumns(spec: RestrictedTable, columns: string[]): string[] {
  return columns.filter((c) => c !== spec.rowidAlias);
}

/** Le prédicat qui couvre plusieurs membres d'une même table. */
function unionPredicate(members: RestrictedMember[]): { sql: string; params: string[] } {
  if (members.some((m) => m.where === null)) return { sql: '1 = 1', params: [] };
  const parts = members.map(memberPredicate);
  return {
    sql: parts.map((p) => `(${p.sql})`).join(' OR '),
    params: parts.flatMap((p) => p.params),
  };
}

/**
 * Empreinte du CONTENU d'un membre : les valeurs des colonnes recopiées, dans
 * l'ordre des lignes. Sans l'alias du rowid, pour qu'une renumérotation ne la
 * change pas. Écrite dans la surcouche à l'extraction, recalculée au chargement.
 */
export function memberContentSha256(
  db: DatabaseType.Database,
  schema: string,
  member: RestrictedMember,
): string {
  const spec = restrictedTable(member.kind, member.table);
  const columns = copiedColumns(spec, tableColumns(db, schema, member.table));
  const predicate = memberPredicate(member);
  const hash = createHash('sha256');
  const stmt = db
    .prepare(
      `SELECT ${columns.map(quoteIdent).join(', ')} FROM ${schema}.${quoteIdent(member.table)}
       WHERE ${predicate.sql} ORDER BY rowid`,
    )
    .raw(true);
  for (const row of stmt.iterate(...predicate.params) as Iterable<unknown[]>) {
    hash.update(JSON.stringify(row));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function countMember(db: DatabaseType.Database, schema: string, member: RestrictedMember): number {
  const predicate = memberPredicate(member);
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM ${schema}.${quoteIdent(member.table)} WHERE ${predicate.sql}`,
      )
      .get(...predicate.params) as { n: number }
  ).n;
}

// ---------------------------------------------------------------------------
// Contrôle d'un fichier de surcouche
// ---------------------------------------------------------------------------

/**
 * Tous les contrôles d'une surcouche, sans rien écrire.
 *
 * Refus du FICHIER entier : absent, trop gros, illisible, intégrité SQLite,
 * format ou base inattendus, table inconnue, ou lignes hors de la famille (une
 * surcouche ne doit jamais pouvoir remplacer une donnée publique). Refus d'un
 * MEMBRE seul : table absente, colonnes manquantes, sous son plancher, compte ou
 * empreinte différents de ceux que l'extraction a écrits. Les autres membres
 * restent utilisables : une liste SM tombée sous trois banques n'éteint pas l'EPC.
 */
export function inspectOverlay(path: string, kind: OverlayKind): OverlayInspection {
  const members: MemberReport[] = [];
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return { ok: false, error: 'overlay_file_missing', members };
  }
  if (!stat.isFile()) return { ok: false, error: 'overlay_not_a_file', members };
  if (stat.size === 0 || stat.size > MAX_OVERLAY_BYTES)
    return { ok: false, error: 'overlay_size_out_of_bounds', bytes: stat.size, members };
  const sha256 = sha256File(path);
  let db: DatabaseType.Database | null = null;
  try {
    db = openDatabase(path, { readonly: true, fileMustExist: true });
    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') return { ok: false, error: 'overlay_integrity', sha256, members };
    if (
      !tableExists(db, 'main', OVERLAY_META_TABLE) ||
      !tableExists(db, 'main', OVERLAY_MEMBERS_TABLE)
    )
      return { ok: false, error: 'overlay_metadata_missing', sha256, members };
    const meta = Object.fromEntries(
      (
        db.prepare(`SELECT key, value FROM ${OVERLAY_META_TABLE}`).all() as Array<{
          key: string;
          value: string;
        }>
      ).map((r) => [r.key, r.value]),
    );
    if (meta.schema !== OVERLAY_SCHEMA_VERSION)
      return { ok: false, error: 'overlay_schema_version', sha256, meta, members };
    if (meta.kind !== kind)
      return { ok: false, error: 'overlay_wrong_kind', sha256, meta, members };

    const allowed = new Set([
      OVERLAY_META_TABLE,
      OVERLAY_MEMBERS_TABLE,
      'sqlite_sequence',
      ...RESTRICTED_TABLES[kind].map((t) => t.name),
    ]);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    const unknown = tables.filter((t) => !allowed.has(t));
    if (unknown.length > 0)
      return {
        ok: false,
        error: `overlay_unknown_tables:${unknown.join(',')}`,
        sha256,
        meta,
        members,
      };

    // Aucune ligne d'une table de la famille ne peut sortir des membres déclarés.
    for (const spec of RESTRICTED_TABLES[kind]) {
      if (!tables.includes(spec.name)) continue;
      const own = membersOf(kind).filter((m) => m.table === spec.name);
      const union = unionPredicate(own);
      const outside = (
        db
          .prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(spec.name)} WHERE NOT (${union.sql})`)
          .get(...union.params) as { n: number }
      ).n;
      if (outside > 0)
        return {
          ok: false,
          error: `overlay_rows_outside_family:${spec.name}`,
          sha256,
          meta,
          members,
        };
    }

    const recorded = new Map(
      (
        db
          .prepare(`SELECT member, table_name, rows, content_sha256 FROM ${OVERLAY_MEMBERS_TABLE}`)
          .all() as Array<{
          member: string;
          table_name: string;
          rows: number;
          content_sha256: string;
        }>
      ).map((r) => [r.member, r]),
    );

    for (const member of membersOf(kind)) {
      const report: MemberReport = {
        id: member.id,
        table: member.table,
        state: 'refused',
        rows: 0,
      };
      members.push(report);
      if (!tables.includes(member.table)) {
        report.reason = 'table_missing';
        continue;
      }
      const spec = restrictedTable(kind, member.table);
      const columns = tableColumns(db, 'main', member.table);
      const missing = spec.columns.filter((c) => !columns.includes(c));
      if (missing.length > 0) {
        report.reason = `columns_missing:${missing.join(',')}`;
        continue;
      }
      report.rows = countMember(db, 'main', member);
      const record = recorded.get(member.id);
      if (!record || record.table_name !== member.table) {
        report.reason = 'not_recorded';
        continue;
      }
      if (record.rows !== report.rows) {
        report.reason = 'row_count_mismatch';
        continue;
      }
      if (report.rows < member.minRows) {
        report.reason = `below_floor:${member.minRows}`;
        continue;
      }
      if (memberContentSha256(db, 'main', member) !== record.content_sha256) {
        report.reason = 'content_hash_mismatch';
        continue;
      }
      report.state = 'applied';
    }
    return { ok: true, sha256, bytes: stat.size, meta, members };
  } catch (err) {
    return {
      ok: false,
      error: `overlay_unreadable:${err instanceof Error ? err.message : String(err)}`,
      sha256,
      members,
    };
  } finally {
    db?.close();
  }
}

// ---------------------------------------------------------------------------
// Fusion : base publique + surcouche -> fichier servi
// ---------------------------------------------------------------------------

/** Préfixe des fichiers fusionnés construits à côté d'une surcouche. */
export function mergedPrefix(overlayPath: string): string {
  return `${basename(overlayPath).replace(/\.sqlite$/, '')}.merged-`;
}

/** Un nom neuf pour chaque fusion (voir le piège WAL en tête de fichier). */
export function nextMergedPath(overlayPath: string): string {
  return join(
    dirname(overlayPath),
    `${mergedPrefix(overlayPath)}${Date.now()}-${randomUUID().slice(0, 8)}.sqlite`,
  );
}

/**
 * Efface les fichiers fusionnés d'une surcouche, sauf ceux qu'on garde : restes
 * d'un démarrage interrompu (~36 Mo chacun) ou version remplacée par un
 * rechargement. Ne touche à rien d'autre dans le dossier.
 */
export function removeStaleMerged(overlayPath: string, keep: ReadonlySet<string>): string[] {
  const dir = dirname(overlayPath);
  const prefix = mergedPrefix(overlayPath);
  const removed: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const full = join(dir, name);
    if (keep.has(full)) continue;
    // Les compagnons d'un fichier gardé restent avec lui.
    if ([...keep].some((k) => full.startsWith(`${k}-`))) continue;
    rmSync(full, { force: true });
    removed.push(full);
  }
  return removed;
}

function fsyncFile(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Construit le fichier servi : copie de la base publique, membres acceptés
 * fusionnés, contrôle rapide, renommage atomique vers `outputPath`.
 *
 * Ne modifie JAMAIS `publicPath` ni la surcouche. En cas de refus, aucun
 * fichier n'est laissé derrière.
 */
export function buildMergedDatabase(options: {
  kind: OverlayKind;
  publicPath: string;
  overlayPath: string;
  outputPath: string;
}): MergeResult {
  const started = Date.now();
  const { kind, publicPath, outputPath } = options;
  // Contrôle et fusion lisent la MÊME copie figée : un dépôt en cours sur le
  // chemin de la surcouche ne peut pas glisser, entre les deux, un contenu que
  // personne n'a contrôlé.
  const frozen = `${outputPath}.overlay-${randomUUID()}`;
  try {
    copyFileSync(options.overlayPath, frozen);
  } catch {
    return {
      state: 'refused',
      error: 'overlay_file_missing',
      members: [],
      duration_ms: Date.now() - started,
    };
  }
  try {
    return mergeFrozen({ kind, publicPath, overlayPath: frozen, outputPath, started });
  } finally {
    rmSync(frozen, { force: true });
  }
}

function mergeFrozen(options: {
  kind: OverlayKind;
  publicPath: string;
  overlayPath: string;
  outputPath: string;
  started: number;
}): MergeResult {
  const { kind, publicPath, overlayPath, outputPath, started } = options;
  const inspection = inspectOverlay(overlayPath, kind);
  const finish = (result: Omit<MergeResult, 'duration_ms'>): MergeResult => ({
    ...result,
    duration_ms: Date.now() - started,
  });
  if (!inspection.ok)
    return finish({
      state: 'refused',
      error: inspection.error,
      sha256: inspection.sha256,
      members: inspection.members,
    });
  const members = inspection.members;
  const accepted = new Set(members.filter((m) => m.state === 'applied').map((m) => m.id));
  if (accepted.size === 0)
    return finish({
      state: 'refused',
      error: 'no_member_accepted',
      sha256: inspection.sha256,
      members,
    });

  const temporary = `${outputPath}.tmp-${randomUUID()}`;
  let db: DatabaseType.Database | null = null;
  try {
    copyFileSync(publicPath, temporary);
    db = openDatabase(temporary);
    // Aucun fichier compagnon : un nom neuf, un seul fichier (voir en tête).
    db.pragma('journal_mode = DELETE');
    db.prepare('ATTACH DATABASE ? AS ov').run(overlayPath);

    for (const spec of RESTRICTED_TABLES[kind]) {
      const tableMembers = membersOf(kind).filter(
        (m) => m.table === spec.name && accepted.has(m.id),
      );
      if (tableMembers.length === 0) continue;
      const reports = tableMembers.map((m) => members.find((r) => r.id === m.id)!);
      const refuseTable = (reason: string): void => {
        for (const r of reports) {
          r.state = 'refused';
          r.reason = reason;
          accepted.delete(r.id);
        }
      };

      db.exec('SAVEPOINT overlay_table');
      try {
        const table = quoteIdent(spec.name);
        if (!tableExists(db, 'main', spec.name)) {
          // La base publique ne porte plus la table : la surcouche apporte sa
          // définition et ses index, tels que la base d'origine les avait.
          const ddl = db
            .prepare(
              `SELECT type, sql FROM ov.sqlite_master
               WHERE tbl_name = ? AND sql IS NOT NULL AND type IN ('table', 'index')
               ORDER BY type = 'index', rowid`,
            )
            .all(spec.name) as Array<{ type: string; sql: string }>;
          for (const statement of ddl) db.exec(statement.sql);
        }
        const mainColumns = tableColumns(db, 'main', spec.name);
        const overlayColumns = tableColumns(db, 'ov', spec.name);
        if (mainColumns.join(',') !== overlayColumns.join(',')) {
          db.exec('ROLLBACK TO overlay_table');
          db.exec('RELEASE overlay_table');
          refuseTable('schema_differs_from_public');
          continue;
        }
        const columns = copiedColumns(spec, mainColumns).map(quoteIdent).join(', ');

        for (const [i, member] of tableMembers.entries()) {
          const predicate = memberPredicate(member);
          const report = reports[i];
          report.public_rows = countMember(db, 'main', member);
          if (report.public_rows === 0) {
            report.identical_to_public = null;
          } else {
            const except = (a: string, b: string): number =>
              (
                db!
                  .prepare(
                    `SELECT COUNT(*) AS n FROM (
                       SELECT ${columns} FROM ${a}.${table} WHERE ${predicate.sql}
                       EXCEPT
                       SELECT ${columns} FROM ${b}.${table} WHERE ${predicate.sql})`,
                  )
                  .get(...predicate.params, ...predicate.params) as { n: number }
              ).n;
            report.identical_to_public =
              report.public_rows === report.rows &&
              except('main', 'ov') === 0 &&
              except('ov', 'main') === 0;
          }
        }

        // Une seule insertion par table, dans l'ordre d'origine des lignes : les
        // membres d'une même table (OeNB, NBP, EBA STEP2) gardent l'ordre et la
        // préséance de la reconstruction mensuelle.
        const union = unionPredicate(tableMembers);
        db.prepare(`DELETE FROM main.${table} WHERE ${union.sql}`).run(...union.params);
        const verb = spec.onConflict === 'ignore' ? 'INSERT OR IGNORE' : 'INSERT';
        db.prepare(
          `${verb} INTO main.${table} (${columns})
           SELECT ${columns} FROM ov.${table} WHERE ${union.sql} ORDER BY rowid`,
        ).run(...union.params);
        for (const [i, member] of tableMembers.entries())
          reports[i].inserted = countMember(db, 'main', member);
        db.exec('RELEASE overlay_table');
      } catch (err) {
        db.exec('ROLLBACK TO overlay_table');
        db.exec('RELEASE overlay_table');
        refuseTable(`merge_failed:${err instanceof Error ? err.message : String(err)}`);
      }
    }

    db.exec('DETACH DATABASE ov');
    const check = db.pragma('quick_check', { simple: true });
    if (check !== 'ok') throw new Error(`quick_check: ${String(check)}`);
    db.close();
    db = null;
    if (accepted.size === 0) {
      rmSync(temporary, { force: true });
      return finish({
        state: 'refused',
        error: 'no_member_merged',
        sha256: inspection.sha256,
        members,
      });
    }
    fsyncFile(temporary);
    renameSync(temporary, outputPath);
    const state = members.every((m) => m.state === 'applied') ? 'applied' : 'partial';
    return finish({ state, path: outputPath, sha256: inspection.sha256, members });
  } catch (err) {
    try {
      db?.close();
    } catch {
      /* déjà fermée ou inutilisable : le fichier temporaire part quand même */
    }
    rmSync(temporary, { force: true });
    rmSync(`${temporary}-journal`, { force: true });
    return finish({
      state: 'refused',
      error: `merge_failed:${err instanceof Error ? err.message : String(err)}`,
      sha256: inspection.sha256,
      members,
    });
  }
}

// ---------------------------------------------------------------------------
// Extraction et retrait (scripts, tests, Geste 4)
// ---------------------------------------------------------------------------

/**
 * En dessous, un pourcentage ne veut rien dire : la ligne OeNB unique qui
 * disparaît (plancher 0), deux banques NBP fusionnées sur vingt et une, ou une
 * inscription ONU en moins sur cinq sont des mois ordinaires, pas une source
 * tronquée. Les planchers de chaque membre les gardent déjà.
 */
export const SHRINK_GUARD_MIN_ROWS = 50;

export interface ExtractResult {
  path: string;
  sha256: string;
  members: Array<{
    id: string;
    table: string;
    rows: number;
    loaded_at: string | null;
    as_of: string | null;
  }>;
}

/** La date du dernier chargement de la base lue, reprise d'elle et jamais inventée. */
function sourceRefresh(db: DatabaseType.Database, kind: OverlayKind): string | null {
  try {
    if (kind === 'compliance') {
      const row = db.prepare("SELECT value FROM src.metadata WHERE key = 'last_refresh'").get() as
        { value: string } | undefined;
      return row?.value ?? null;
    }
    const row = db.prepare('SELECT MAX(updated_at) AS d FROM src.bic_entries').get() as {
      d: string | null;
    };
    return row.d;
  } catch {
    return null;
  }
}

function memberDates(
  db: DatabaseType.Database,
  member: RestrictedMember,
  refresh: string | null,
): { loaded_at: string | null; as_of: string | null } {
  const columns = tableColumns(db, 'main', member.table);
  const predicate = memberPredicate(member);
  const max = (column: string): string | null =>
    columns.includes(column)
      ? ((
          db
            .prepare(
              `SELECT MAX(${quoteIdent(column)}) AS d FROM main.${quoteIdent(member.table)} WHERE ${predicate.sql}`,
            )
            .get(...predicate.params) as { d: string | null }
        ).d ?? null)
      : null;
  return {
    // La date de la ligne quand la table en porte une, sinon celle de la base.
    loaded_at: max('updated_at') ?? refresh,
    as_of: max('list_month') ?? max('as_of'),
  };
}

/**
 * Écrit la surcouche d'une base : exactement la famille, avec ses définitions de
 * tables et d'index, et ses métadonnées. N'écrit que `outPath`, par un fichier
 * temporaire renommé. Refuse sous un plancher, et (sauf `allowShrink`) une baisse
 * de plus de 10 % d'un membre d'au moins SHRINK_GUARD_MIN_ROWS lignes par rapport
 * à la surcouche précédente au même chemin : une source tronquée ne remplace pas
 * une édition entière.
 *
 * `sourcePath` est ouvert en lecture, par ATTACH : passer une COPIE (une base WAL
 * ouverte crée ses compagnons à côté d'elle).
 */
export function extractOverlay(options: {
  kind: OverlayKind;
  sourcePath: string;
  outPath: string;
  generator: string;
  allowShrink?: boolean;
}): ExtractResult {
  const { kind, sourcePath, outPath, generator } = options;
  if (!outPath.endsWith('.sqlite')) throw new Error('La surcouche doit finir par .sqlite');
  const previous = existsSync(outPath) ? inspectOverlay(outPath, kind) : null;
  const temporary = `${outPath}.tmp-${randomUUID()}`;
  const db = openDatabase(temporary);
  try {
    db.pragma('journal_mode = DELETE');
    db.prepare('ATTACH DATABASE ? AS src').run(sourcePath);
    const refresh = sourceRefresh(db, kind);
    const sourceSha = sha256File(sourcePath);
    db.exec(`CREATE TABLE ${OVERLAY_META_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    db.exec(`CREATE TABLE ${OVERLAY_MEMBERS_TABLE} (
      member TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      rows INTEGER NOT NULL,
      content_sha256 TEXT NOT NULL,
      loaded_at TEXT,
      as_of TEXT,
      label TEXT NOT NULL
    )`);

    const members: ExtractResult['members'] = [];
    db.transaction(() => {
      for (const spec of RESTRICTED_TABLES[kind]) {
        const own = membersOf(kind).filter((m) => m.table === spec.name);
        if (own.length === 0) continue;
        const ddl = db
          .prepare(
            `SELECT type, sql FROM src.sqlite_master
             WHERE tbl_name = ? AND sql IS NOT NULL AND type IN ('table', 'index')
             ORDER BY type = 'index', rowid`,
          )
          .all(spec.name) as Array<{ type: string; sql: string }>;
        if (!ddl.some((d) => d.type === 'table'))
          throw new Error(`Table absente de la base lue : ${spec.name}`);
        for (const statement of ddl) db.exec(statement.sql);
        const union = unionPredicate(own);
        // Les identifiants d'origine sont gardés DANS la surcouche : ils portent
        // l'ordre des lignes, que la fusion reproduit (ORDER BY rowid).
        db.prepare(
          `INSERT INTO main.${quoteIdent(spec.name)} SELECT * FROM src.${quoteIdent(spec.name)}
           WHERE ${union.sql} ORDER BY rowid`,
        ).run(...union.params);
      }
      const insertMember = db.prepare(
        `INSERT INTO ${OVERLAY_MEMBERS_TABLE} (member, table_name, rows, content_sha256, loaded_at, as_of, label)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const member of membersOf(kind)) {
        const rows = countMember(db, 'main', member);
        if (rows < member.minRows)
          throw new Error(
            `${member.id} : ${rows} lignes, plancher ${member.minRows}. Surcouche non écrite.`,
          );
        const before = previous?.members.find((m) => m.id === member.id);
        if (
          !options.allowShrink &&
          before &&
          before.rows >= SHRINK_GUARD_MIN_ROWS &&
          rows < before.rows * 0.9
        )
          throw new Error(
            `${member.id} : ${before.rows} -> ${rows} lignes, baisse de plus de 10 %. ` +
              'Contrôle manuel requis (--allow-shrink).',
          );
        const dates = memberDates(db, member, refresh);
        insertMember.run(
          member.id,
          member.table,
          rows,
          memberContentSha256(db, 'main', member),
          dates.loaded_at,
          dates.as_of,
          member.label,
        );
        members.push({ id: member.id, table: member.table, rows, ...dates });
      }
      const insertMeta = db.prepare(`INSERT INTO ${OVERLAY_META_TABLE} (key, value) VALUES (?, ?)`);
      insertMeta.run('schema', OVERLAY_SCHEMA_VERSION);
      insertMeta.run('kind', kind);
      insertMeta.run('created_at', new Date().toISOString());
      insertMeta.run('generator', generator);
      insertMeta.run('source_sha256', sourceSha);
      if (refresh) insertMeta.run('source_refresh', refresh);
    })();
    db.exec('DETACH DATABASE src');
    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`integrity_check: ${String(integrity)}`);
    db.close();
    chmodSync(temporary, 0o600);
    fsyncFile(temporary);
    // La surcouche écrite doit passer le contrôle du chargeur avant de remplacer
    // quoi que ce soit : jamais un fichier que l'API refuserait.
    const check = inspectOverlay(temporary, kind);
    const refused = check.members.filter((m) => m.state !== 'applied');
    if (!check.ok || refused.length > 0)
      throw new Error(
        `Surcouche refusée par son propre contrôle : ${check.error ?? refused.map((m) => `${m.id}=${m.reason}`).join(', ')}`,
      );
    renameSync(temporary, outPath);
    return { path: outPath, sha256: sha256File(outPath), members };
  } catch (err) {
    if (db.open) db.close();
    rmSync(temporary, { force: true });
    rmSync(`${temporary}-journal`, { force: true });
    throw err;
  }
}

/**
 * Retire la famille d'une base, en place : la « base publique » de demain. Pour
 * les tests, la preuve d'équivalence et la chaîne des seeders (on part d'une
 * copie publique SANS la famille, comme la reconstruction mensuelle part d'une
 * table vide). `dropTables` supprime en plus les tables devenues vides, pour
 * éprouver la fusion sur une base qui ne les porte plus du tout.
 */
export function stripFamily(
  path: string,
  kind: OverlayKind,
  options?: { dropTables?: boolean },
): void {
  const db = openDatabase(path);
  try {
    db.transaction(() => {
      for (const spec of RESTRICTED_TABLES[kind]) {
        const own = membersOf(kind).filter((m) => m.table === spec.name);
        if (own.length === 0 || !tableExists(db, 'main', spec.name)) continue;
        const union = unionPredicate(own);
        db.prepare(`DELETE FROM ${quoteIdent(spec.name)} WHERE ${union.sql}`).run(...union.params);
        const left = (
          db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(spec.name)}`).get() as { n: number }
        ).n;
        if (options?.dropTables && left === 0) db.exec(`DROP TABLE ${quoteIdent(spec.name)}`);
      }
    })();
  } finally {
    db.close();
  }
}

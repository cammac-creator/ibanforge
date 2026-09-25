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
 * ## La règle de fusion : la donnée la plus fraîche sert, membre par membre
 *
 * Tant que la base publique porte encore la famille (jusqu'à l'étape du
 * retrait), un robot public la rafraîchit chaque semaine (EPC, ONU) et chaque
 * mois (le reste), pendant que la surcouche reste celle du dernier dépôt. Une
 * surcouche qui remplacerait toujours les lignes publiques servirait donc, dès
 * le premier rafraîchissement public, des lignes plus anciennes qu'aujourd'hui
 * (relecture de la PR 252, R10). Pour chaque membre, avant de toucher à quoi que
 * ce soit :
 *
 *   (a) la base publique n'a aucune ligne du membre : la surcouche sert ;
 *   (b) la surcouche est STRICTEMENT plus récente, datée de la même façon des
 *       deux côtés (`freshness` dans la constante) : la surcouche sert ;
 *   (c) les contenus sont identiques : la surcouche sert (c'est la preuve du
 *       premier dépôt, extrait de la base déployée) ;
 *   (d) sinon la base publique est gardée (`kept_public`), date égale ou absente
 *       comprise : AT et BE ne sont datés par personne.
 *
 * Les membres de `bic_entries` (OeNB, NBP, EBA STEP2) se décident ensemble
 * (`decideTogether`). Quand un membre est servi par la surcouche en (a) ou (b),
 * la date `last_refresh` de la copie servie descend à la sienne si elle est plus
 * ancienne : `meta.sanctions_as_of` et la sonde d'âge ne surestiment jamais la
 * fraîcheur de ce qui est servi.
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
 *   scripts/restricted-overlay.ts), jamais `data/` du dépôt en place, et la copie
 *   figée d'une surcouche part avec ses compagnons.
 *
 * ## Jamais le SQL de la surcouche
 *
 * Les tables sont créées avec la définition de la constante (`ddl`), exécutée
 * instruction par instruction : une surcouche forgée ne peut rien faire exécuter
 * (R4). Une vue ou un déclencheur dans le fichier le fait refuser.
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

/**
 * Version du format de fichier. Un autre numéro est refusé, jamais deviné.
 * 2 (25/09/2026) : tables créées depuis la constante, dates de la base nommées
 * pour ce qu'elles sont (`source_last_refresh`, `source_bic_entries_updated_at`).
 */
export const OVERLAY_SCHEMA_VERSION = '2';
/** Clés du fichier (`schema`, `kind`, dates, empreinte de la base lue). */
export const OVERLAY_META_TABLE = 'overlay_meta';
/** Une ligne par membre : compte, empreinte du contenu, dates reprises de la base. */
export const OVERLAY_MEMBERS_TABLE = 'overlay_members';
/** Au-delà, ce n'est pas une surcouche : quelques Mo aujourd'hui pour les deux. */
const MAX_OVERLAY_BYTES = 256 * 1024 * 1024;

/** Ce qu'il advient d'un membre : servi par la surcouche, gardé du public, ou refusé. */
export type MemberState = 'applied' | 'kept_public' | 'refused';

/** Pourquoi un membre accepté est servi par la surcouche, ou laissé au public. */
export type MemberDecision =
  'public_empty' | 'overlay_newer' | 'identical' | 'public_newer_or_undated';

export interface MemberReport {
  id: string;
  table: string;
  state: MemberState;
  /** Lignes du membre dans la surcouche. */
  rows: number;
  /** Lignes du membre dans la copie servie, après fusion. */
  inserted?: number;
  /** Lignes que la base publique portait pour ce membre avant la fusion. */
  public_rows?: number;
  /**
   * La base publique portait-elle exactement les mêmes lignes ? `null` quand
   * elle n'en portait aucune (cas normal une fois la famille retirée).
   */
  identical_to_public?: boolean | null;
  decision?: MemberDecision;
  /** La date du membre des deux côtés, calculée de la même façon (voir `freshness`). */
  overlay_date?: string | null;
  public_date?: string | null;
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

/**
 * `applied` : chaque membre servi par la surcouche ; `kept_public` : aucun refus,
 * mais au moins un membre laissé au public, plus récent ; `partial` : au moins un
 * membre refusé ; `refused` : rien de la surcouche n'est utilisable.
 */
export type MergeState = 'applied' | 'kept_public' | 'partial' | 'refused';

export interface MergeResult {
  state: MergeState;
  /**
   * Chemin du fichier fusionné. Absent quand rien n'a été construit : refus, ou
   * aucun membre servi par la surcouche (la base publique est alors servie telle
   * quelle).
   */
  path?: string;
  sha256?: string;
  error?: string;
  members: MemberReport[];
  duration_ms: number;
  /** `last_refresh` de la copie servie, quand il a été ramené à celui d'un membre servi. */
  lowered_last_refresh?: string;
  /**
   * Avec `keepFrozen` : la copie figée du fichier, contrôlée et servie, que
   * l'appelant garde comme « dernière surcouche acceptée » ou efface
   * (promoteAcceptedCopy / discardFrozenCopy).
   */
  frozen_path?: string;
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

/** Crée une table de la famille et ses index depuis la constante, une instruction à la fois. */
function createFromConstant(db: DatabaseType.Database, spec: RestrictedTable): void {
  // prepare() refuse plus d'une instruction : même la constante ne peut pas en glisser deux.
  for (const statement of spec.ddl) db.prepare(statement).run();
}

/** Colonnes recopiées d'une table : toutes, sauf l'alias du rowid. */
function copiedColumns(spec: RestrictedTable, columns: readonly string[]): string[] {
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

function countWhere(
  db: DatabaseType.Database,
  schema: string,
  table: string,
  predicate: { sql: string; params: string[] },
): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS n FROM ${schema}.${quoteIdent(table)} WHERE ${predicate.sql}`)
      .get(...predicate.params) as { n: number }
  ).n;
}

function countMember(db: DatabaseType.Database, schema: string, member: RestrictedMember): number {
  return countWhere(db, schema, member.table, memberPredicate(member));
}

function maxWhere(
  db: DatabaseType.Database,
  schema: string,
  table: string,
  column: string,
  predicate: { sql: string; params: string[] },
): string | null {
  if (!tableColumns(db, schema, table).includes(column)) return null;
  const row = db
    .prepare(
      `SELECT MAX(${quoteIdent(column)}) AS d FROM ${schema}.${quoteIdent(table)} WHERE ${predicate.sql}`,
    )
    .get(...predicate.params) as { d: string | null };
  return row.d ?? null;
}

/** Un instant ISO 8601 normalisé, ou null : les deux côtés se comparent en texte. */
function normalizeInstant(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

/**
 * La date d'un groupe de membres dans une base, selon la règle de sa table
 * (`freshness`). Même calcul pour la surcouche et pour la base publique ;
 * `baseRefresh` est la date du dernier rafraîchissement de la base de
 * conformité lue (métadonnées de la surcouche, ou `metadata` de la base publique).
 */
function groupFreshness(
  db: DatabaseType.Database,
  schema: string,
  spec: RestrictedTable,
  group: RestrictedMember[],
  baseRefresh: string | null,
): string | null {
  const union = unionPredicate(group);
  switch (spec.freshness) {
    case 'base_last_refresh':
      return normalizeInstant(baseRefresh);
    case 'max_updated_at':
      return maxWhere(db, schema, spec.name, 'updated_at', union);
    case 'max_as_of':
      return maxWhere(db, schema, spec.name, 'as_of', union);
    case 'list_month_then_updated_at': {
      const month = maxWhere(db, schema, spec.name, 'list_month', union);
      if (!month) return null;
      return `${month}|${maxWhere(db, schema, spec.name, 'updated_at', union) ?? ''}`;
    }
  }
}

/** Le `last_refresh` d'une base de conformité, ou null si elle n'en porte pas. */
function metadataLastRefresh(db: DatabaseType.Database, schema: string): string | null {
  if (!tableExists(db, schema, 'metadata')) return null;
  const row = db
    .prepare(`SELECT value FROM ${schema}.metadata WHERE key = 'last_refresh'`)
    .get() as { value: string } | undefined;
  return row?.value ?? null;
}

// ---------------------------------------------------------------------------
// Contrôle d'un fichier de surcouche
// ---------------------------------------------------------------------------

/**
 * Tous les contrôles d'une surcouche, sans rien écrire.
 *
 * Refus du FICHIER entier : absent, trop gros, illisible, intégrité SQLite,
 * format ou base inattendus, table inconnue, vue ou déclencheur, ou lignes hors
 * de la famille (une surcouche ne doit jamais pouvoir remplacer une donnée
 * publique). Refus d'un MEMBRE seul : table absente, colonnes différentes de
 * celles de la constante, sous son plancher, compte ou empreinte différents de
 * ceux que l'extraction a écrits. Les autres membres restent utilisables : une
 * liste SM tombée sous trois banques n'éteint pas l'EPC.
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
    const objects = db
      .prepare("SELECT type, name FROM sqlite_master WHERE type IN ('view', 'trigger')")
      .all() as Array<{ type: string; name: string }>;
    if (objects.length > 0)
      return { ok: false, error: 'overlay_unexpected_objects', sha256, members };
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
      if (tableColumns(db, 'main', member.table).join(',') !== spec.columns.join(',')) {
        report.reason = 'columns_unexpected';
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
 * La dernière surcouche acceptée, gardée à côté du fichier privé : reprise au
 * démarrage si le fichier désigné par la variable est refusé (R3).
 */
export function acceptedCopyPath(overlayPath: string): string {
  return join(
    dirname(overlayPath),
    `${basename(overlayPath).replace(/\.sqlite$/, '')}.accepted.sqlite`,
  );
}

/** Efface un fichier SQLite et ses compagnons (`-wal`, `-shm`, `-journal`). */
export function removeFileWithCompanions(path: string): void {
  for (const f of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`])
    rmSync(f, { force: true });
}

/**
 * Efface les fichiers fusionnés d'une surcouche, sauf ceux qu'on garde : restes
 * d'un démarrage interrompu (~36 Mo chacun) ou version remplacée par un
 * rechargement. Ne touche à rien d'autre dans le dossier (ni la surcouche, ni
 * sa copie acceptée).
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
    rmSync(full, { force: true, recursive: true });
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

/** Garde la copie figée comme dernière surcouche acceptée, par renommage atomique. */
export function promoteAcceptedCopy(frozenPath: string, acceptedPath: string): void {
  for (const f of [`${frozenPath}-wal`, `${frozenPath}-shm`, `${frozenPath}-journal`])
    rmSync(f, { force: true });
  chmodSync(frozenPath, 0o600);
  renameSync(frozenPath, acceptedPath);
}

/** Efface une copie figée que l'appelant ne garde pas. */
export function discardFrozenCopy(frozenPath: string | undefined): void {
  if (frozenPath) removeFileWithCompanions(frozenPath);
}

/**
 * Construit le fichier servi : copie de la base publique, décision membre par
 * membre, fusion, contrôle rapide, renommage atomique vers `outputPath`.
 *
 * Ne modifie JAMAIS `publicPath` ni la surcouche. En cas de refus, aucun
 * fichier n'est laissé derrière (copie figée et compagnons compris).
 */
export function buildMergedDatabase(options: {
  kind: OverlayKind;
  publicPath: string;
  overlayPath: string;
  outputPath: string;
  /** Garder la copie figée d'une surcouche acceptée (voir MergeResult.frozen_path). */
  keepFrozen?: boolean;
}): MergeResult {
  const started = Date.now();
  const { kind, publicPath, outputPath } = options;
  // Contrôle et fusion lisent la MÊME copie figée : un dépôt en cours sur le
  // chemin de la surcouche ne peut pas glisser, entre les deux, un contenu que
  // personne n'a contrôlé.
  const frozen = `${outputPath}.overlay-${randomUUID()}`;
  try {
    copyFileSync(options.overlayPath, frozen);
  } catch (err) {
    removeFileWithCompanions(frozen);
    // Le code seul, jamais le message : il porte des chemins complets, et ce
    // texte part dans le journal et l'alerte. ENOENT : le fichier (ou son
    // dossier) a disparu ; le reste (volume plein, en lecture seule, droits)
    // n'est pas un fichier manquant, et un nouveau dépôt n'y changerait rien.
    const code = (err as NodeJS.ErrnoException).code;
    return {
      state: 'refused',
      error:
        code === 'ENOENT' ? 'overlay_file_missing' : `overlay_copy_failed:${code ?? 'unknown'}`,
      members: [],
      duration_ms: Date.now() - started,
    };
  }
  let keep = false;
  try {
    const result = mergeFrozen({ kind, publicPath, overlayPath: frozen, outputPath, started });
    keep = !!options.keepFrozen && result.state !== 'refused';
    return keep ? { ...result, frozen_path: frozen } : result;
  } finally {
    // L'inspection ouvre la copie en lecture seule : si elle est en WAL, ses
    // compagnons restent après la fermeture. Ils partent avec elle (R6).
    if (keep) {
      for (const f of [`${frozen}-wal`, `${frozen}-shm`, `${frozen}-journal`])
        rmSync(f, { force: true });
    } else removeFileWithCompanions(frozen);
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
  const report = (id: string): MemberReport => members.find((r) => r.id === id)!;
  if (!members.some((m) => m.state === 'applied'))
    return finish({
      state: 'refused',
      error: 'no_member_accepted',
      sha256: inspection.sha256,
      members,
    });

  const temporary = `${outputPath}.tmp-${randomUUID()}`;
  let db: DatabaseType.Database | null = null;
  let anyServed = false;
  let loweredLastRefresh: string | undefined;
  try {
    copyFileSync(publicPath, temporary);
    db = openDatabase(temporary);
    // Aucun fichier compagnon : un nom neuf, un seul fichier (voir en tête).
    db.pragma('journal_mode = DELETE');
    db.prepare('ATTACH DATABASE ? AS ov').run(overlayPath);
    const overlayRefresh = inspection.meta?.source_last_refresh ?? null;
    const publicRefresh = kind === 'compliance' ? metadataLastRefresh(db, 'main') : null;
    /** Dates des membres servis par la surcouche en (a) ou (b), pour `last_refresh`. */
    const servedDates: string[] = [];

    for (const spec of RESTRICTED_TABLES[kind]) {
      const tableMembers = membersOf(kind).filter((m) => m.table === spec.name);
      const candidates = tableMembers.filter((m) => report(m.id).state === 'applied');
      if (candidates.length === 0) continue;
      const refuse = (ids: string[], reason: string): void => {
        for (const id of ids) {
          const r = report(id);
          r.state = 'refused';
          r.reason = reason;
        }
      };

      db.exec('SAVEPOINT overlay_table');
      try {
        const table = quoteIdent(spec.name);
        // La base publique ne porte plus la table : elle est recréée depuis la
        // constante, jamais depuis la surcouche (R4).
        if (!tableExists(db, 'main', spec.name)) createFromConstant(db, spec);
        const mainColumns = tableColumns(db, 'main', spec.name);
        if (
          mainColumns.join(',') !== spec.columns.join(',') ||
          tableColumns(db, 'ov', spec.name).join(',') !== spec.columns.join(',')
        ) {
          db.exec('ROLLBACK TO overlay_table');
          db.exec('RELEASE overlay_table');
          refuse(
            candidates.map((m) => m.id),
            'schema_differs_from_public',
          );
          continue;
        }
        const columns = copiedColumns(spec, mainColumns).map(quoteIdent).join(', ');
        const except = (a: string, b: string, predicate: { sql: string; params: string[] }) =>
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

        const groups = spec.decideTogether ? [tableMembers] : tableMembers.map((m) => [m]);
        const served: RestrictedMember[] = [];
        for (const group of groups) {
          const refusedInGroup = group.filter((m) => report(m.id).state !== 'applied');
          if (refusedInGroup.length > 0) {
            // Un groupe se sert entier ou pas du tout : le public reste en place.
            if (group.length > 1)
              refuse(
                group.filter((m) => report(m.id).state === 'applied').map((m) => m.id),
                `group_member_refused:${refusedInGroup.map((m) => m.id).join(',')}`,
              );
            continue;
          }
          for (const member of group) {
            const r = report(member.id);
            const predicate = memberPredicate(member);
            r.public_rows = countMember(db, 'main', member);
            r.identical_to_public =
              r.public_rows === 0
                ? null
                : r.public_rows === r.rows &&
                  except('main', 'ov', predicate) === 0 &&
                  except('ov', 'main', predicate) === 0;
          }
          const publicRows = group.reduce((n, m) => n + (report(m.id).public_rows ?? 0), 0);
          // Un membre vide des deux côtés (la ligne OeNB unique peut disparaître)
          // n'empêche pas le groupe d'être identique.
          const identical = group.every((m) => {
            const r = report(m.id);
            return r.identical_to_public === true || (r.public_rows === 0 && r.rows === 0);
          });
          const overlayDate = groupFreshness(db, 'ov', spec, group, overlayRefresh);
          const publicDate = groupFreshness(db, 'main', spec, group, publicRefresh);
          const decision: MemberDecision =
            publicRows === 0
              ? 'public_empty'
              : overlayDate !== null && publicDate !== null && overlayDate > publicDate
                ? 'overlay_newer'
                : identical
                  ? 'identical'
                  : 'public_newer_or_undated';
          for (const member of group) {
            const r = report(member.id);
            r.decision = decision;
            r.overlay_date = overlayDate;
            r.public_date = publicDate;
            r.state = decision === 'public_newer_or_undated' ? 'kept_public' : 'applied';
          }
          if (decision === 'public_newer_or_undated') continue;
          served.push(...group);
          if (
            spec.freshness === 'base_last_refresh' &&
            decision !== 'identical' &&
            overlayDate !== null
          )
            servedDates.push(overlayDate);
        }

        if (served.length > 0) {
          // Une seule insertion par table, dans l'ordre d'origine des lignes : les
          // membres d'une même table (OeNB, NBP, EBA STEP2) gardent l'ordre et la
          // préséance de la reconstruction mensuelle.
          const union = unionPredicate(served);
          db.prepare(`DELETE FROM main.${table} WHERE ${union.sql}`).run(...union.params);
          const verb = spec.onConflict === 'ignore' ? 'INSERT OR IGNORE' : 'INSERT';
          db.prepare(
            `${verb} INTO main.${table} (${columns})
             SELECT ${columns} FROM ov.${table} WHERE ${union.sql} ORDER BY rowid`,
          ).run(...union.params);
          anyServed = true;
        }
        for (const member of tableMembers) {
          const r = report(member.id);
          if (r.state !== 'refused') r.inserted = countMember(db, 'main', member);
        }
        db.exec('RELEASE overlay_table');
      } catch (err) {
        db.exec('ROLLBACK TO overlay_table');
        db.exec('RELEASE overlay_table');
        refuse(
          candidates.map((m) => m.id),
          `merge_failed:${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // `last_refresh` ne dit jamais plus frais que le plus ancien membre servi en
    // (a) ou (b) : en (c), le contenu est celui du public, daté par lui.
    if (kind === 'compliance' && servedDates.length > 0 && publicRefresh) {
      const oldest = servedDates.sort()[0];
      const current = normalizeInstant(publicRefresh);
      if (current && oldest < current) {
        db.prepare("UPDATE main.metadata SET value = ? WHERE key = 'last_refresh'").run(oldest);
        loweredLastRefresh = oldest;
      }
    }

    db.exec('DETACH DATABASE ov');
    const check = db.pragma('quick_check', { simple: true });
    if (check !== 'ok') throw new Error(`quick_check: ${String(check)}`);
    db.close();
    db = null;

    const refused = members.filter((m) => m.state === 'refused').length;
    const kept = members.filter((m) => m.state === 'kept_public').length;
    const applied = members.filter((m) => m.state === 'applied').length;
    if (applied + kept === 0) {
      removeFileWithCompanions(temporary);
      return finish({
        state: 'refused',
        error: 'no_member_merged',
        sha256: inspection.sha256,
        members,
      });
    }
    const state: MergeState = refused > 0 ? 'partial' : kept > 0 ? 'kept_public' : 'applied';
    if (!anyServed) {
      // Rien de la surcouche n'est servi (tout le public est plus récent) : la
      // base publique est servie telle quelle, sans copie de 36 Mo.
      removeFileWithCompanions(temporary);
      return finish({ state, sha256: inspection.sha256, members });
    }
    fsyncFile(temporary);
    renameSync(temporary, outputPath);
    return finish({
      state,
      path: outputPath,
      sha256: inspection.sha256,
      members,
      ...(loweredLastRefresh ? { lowered_last_refresh: loweredLastRefresh } : {}),
    });
  } catch (err) {
    try {
      db?.close();
    } catch {
      /* déjà fermée ou inutilisable : le fichier temporaire part quand même */
    }
    removeFileWithCompanions(temporary);
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

/**
 * Les dates d'un membre, lues dans ses propres lignes. `loaded_at` : la date de
 * chargement quand la table en porte une (`updated_at`) ; pour la conformité,
 * dont les tables n'en ont pas, le `last_refresh` de la base lue ; sinon rien.
 * Jamais la date d'une autre table (relecture R11 : les registres nationaux
 * recevaient celle de `bic_entries`).
 */
function memberDates(
  db: DatabaseType.Database,
  member: RestrictedMember,
  lastRefresh: string | null,
): { loaded_at: string | null; as_of: string | null } {
  const predicate = memberPredicate(member);
  const updated = maxWhere(db, 'main', member.table, 'updated_at', predicate);
  return {
    loaded_at: updated ?? (member.kind === 'compliance' ? lastRefresh : null),
    as_of:
      maxWhere(db, 'main', member.table, 'list_month', predicate) ??
      maxWhere(db, 'main', member.table, 'as_of', predicate),
  };
}

/**
 * Écrit la surcouche d'une base : exactement la famille, dans des tables créées
 * depuis la constante, avec ses métadonnées. N'écrit que `outPath`, par un
 * fichier temporaire renommé. Refuse sous un plancher, et (sauf `allowShrink`)
 * une baisse de plus de 10 % d'un membre d'au moins SHRINK_GUARD_MIN_ROWS lignes
 * par rapport à la surcouche précédente au même chemin : une source tronquée ne
 * remplace pas une édition entière.
 *
 * `sourcePath` est ouvert par ATTACH : passer une COPIE (une base WAL ouverte
 * crée ses compagnons à côté d'elle).
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
    const lastRefresh = kind === 'compliance' ? metadataLastRefresh(db, 'src') : null;
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
        if (!tableExists(db, 'src', spec.name))
          throw new Error(`Table absente de la base lue : ${spec.name}`);
        const sourceColumns = tableColumns(db, 'src', spec.name);
        if (sourceColumns.join(',') !== spec.columns.join(','))
          throw new Error(
            `${spec.name} : colonnes de la base lue différentes de la constante ` +
              '(src/lib/restricted-family.ts) : la mettre à jour d’abord.',
          );
        createFromConstant(db, spec);
        const union = unionPredicate(own);
        const columns = spec.columns.map(quoteIdent).join(', ');
        // Les identifiants d'origine sont gardés DANS la surcouche : ils portent
        // l'ordre des lignes, que la fusion reproduit (ORDER BY rowid).
        db.prepare(
          `INSERT INTO main.${quoteIdent(spec.name)} (${columns})
           SELECT ${columns} FROM src.${quoteIdent(spec.name)} WHERE ${union.sql} ORDER BY rowid`,
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
        const dates = memberDates(db, member, lastRefresh);
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
      // Nommées pour ce qu'elles sont (R11) : la date du dernier rafraîchissement
      // de la base de conformité lue, ou la plus récente date de chargement de
      // la table `bic_entries` de la base BIC lue (pas celle des registres).
      if (kind === 'compliance' && lastRefresh) insertMeta.run('source_last_refresh', lastRefresh);
      if (kind === 'bic') {
        const updated = (
          db.prepare('SELECT MAX(updated_at) AS d FROM src.bic_entries').get() as {
            d: string | null;
          }
        ).d;
        if (updated) insertMeta.run('source_bic_entries_updated_at', updated);
      }
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
    removeFileWithCompanions(temporary);
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

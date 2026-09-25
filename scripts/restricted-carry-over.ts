/**
 * La reprise membre par membre de la surcouche BIC.
 *
 * ## Pourquoi ce fichier existe
 *
 * Le passage mensuel du dépôt privé (`npm run overlay -- seed --kind bic`,
 * scripts/restricted-overlay.ts) reconstruit la famille « sous conditions » à
 * partir d'une copie publique qui ne la porte plus. Jusqu'au 25/09/2026, une
 * seule source en panne (EBA STEP2, la liste PRA, un registre AT, BE ou SM, NBP,
 * l'OeNB) laissait son membre vide, le plancher refusait la surcouche entière, et
 * rien n'était publié ce mois-là : même les membres frais attendaient le mois
 * suivant. La base de conformité reprenait déjà une liste en panne
 * (scripts/compliance-carry-over.ts) ; ce module étend le principe à la base BIC,
 * membre par membre.
 *
 * ## Un membre « non rafraîchi »
 *
 * Chaque seeder dit ce qu'il a fait de chaque membre (scripts/seed-report.ts). Un
 * membre n'est pas rafraîchi quand son seeder dit `failed` (téléchargement,
 * lecture, plancher du seeder), quand il reste sous son plancher après les
 * seeders (EBA STEP2 et NBP ne se contrôlent pas eux-mêmes), ou quand sa source
 * a répondu un fichier vide (`processed` à 0 : l'OeNB, dont le plancher est 0, ne
 * se verrait pas autrement). Un membre dont aucun seeder n'a rien dit est une
 * faute de code, pas une panne : refus. Une baisse de plus de 10 % n'est PAS une
 * panne : elle reste un contrôle manuel (`--allow-shrink`), comme avant.
 *
 * ## La reprise, telle quelle
 *
 * Les lignes du membre sont copiées de la surcouche précédente (celle que le
 * dépôt privé pose au chemin de sortie avant la reconstruction), TOUTES colonnes
 * comprises : `updated_at`, `as_of` et `list_month` gardent leur valeur. L'API
 * choisit la donnée la plus fraîche membre par membre
 * (src/lib/restricted-overlay.ts) : une ligne reprise ne doit jamais y passer
 * pour neuve. Dans `bic_entries`, les lignes de la famille sont réinsérées dans
 * l'ordre de la reconstruction (RESTRICTED_BIC_INSERT_ORDER : OeNB, NBP, EBA
 * STEP2), chacune par INSERT OR IGNORE : un NBP repris garde sur EBA STEP2 la
 * préséance qu'il aurait eue si sa source avait répondu, et une ligne que
 * l'annuaire public porte désormais lui cède, comme au passage normal.
 *
 * ## La date d'origine, d'une reprise à l'autre
 *
 * Chaque surcouche écrite par `seed` note l'instant de début du passage
 * (`seed_started_at`, avant tout téléchargement) et, pour chaque membre repris,
 * la date d'origine de ses lignes (`carried_over`). La date d'un membre de la
 * surcouche précédente est donc celle que note `carried_over` s'il y était déjà
 * repris (une seconde reprise ne rajeunit rien), sinon `seed_started_at`. Pour
 * un fichier écrit avant ces clés (la release du 25/09/2026) : la date de ses
 * lignes quand la table en porte une (`updated_at`, `as_of` de Saint-Marin),
 * sinon, si un passage `seed` l'a écrit (chaque source lue ce jour-là), sa date de
 * création, à quelques secondes près ; sinon la date est inconnue et la reprise
 * refusée. Les dates SQLite (`datetime('now')`, en UTC sans fuseau) sont lues en
 * UTC, jamais à l'heure locale de la machine.
 *
 * Contrairement à la reprise de conformité, dont la borne de 21 jours lit la
 * date de la base précédente (qui repart de zéro à chaque reprise), l'âge ici
 * ne repart jamais de zéro.
 *
 * ## Les bornes
 *
 * - CARRY_OVER_MAX_AGE_DAYS (45 jours). Le passage est mensuel (le 1er : 28 à 31
 *   jours d'écart). 45 jours couvrent UN passage manqué, jamais deux (56 jours et
 *   plus) : une source en panne deux mois de suite fait échouer le passage, et
 *   l'alerte d'échec part.
 * - La liste PRA : son mois doit tenir dans la fenêtre que le seeder accepte d'un
 *   téléchargement du jour (le mois du passage et les PRA_LIST_MONTHS_BACK
 *   précédents, en UTC). La permission de la Bank of England
 *   (docs/data-sources.md, 25/08/2026) exige l'attribution à la Bank of England
 *   et au mois de la liste : la reprise copie `list_month` tel quel, le mois
 *   servi reste le vrai. La fenêtre garantit en plus qu'une liste reprise n'est
 *   jamais plus ancienne que celle que le seeder publierait lui-même ce jour-là.
 *   Plus étroite, elle rendrait la reprise inopérante : le 1er du mois, la liste
 *   normale est déjà celle du mois précédent.
 *
 * ## Les refus (rien n'est écrit, la release précédente reste la dernière)
 *
 * Aucun membre rafraîchi ; pas de surcouche précédente (première publication :
 * le comportement d'avant) ; précédente refusée, ou membre refusé dans la
 * précédente ; date d'origine inconnue ou au-delà de la borne ; liste PRA hors de
 * la fenêtre. Tous les motifs sont dits en une fois, avec des codes et des dates,
 * jamais une ligne de données.
 */
import Database from 'better-sqlite3';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  PRA_LIST_MONTHS_BACK,
  RESTRICTED_BIC_INSERT_ORDER,
  RESTRICTED_TABLES,
  memberPredicate,
  membersOf,
  restrictedTable,
  type OverlayKind,
  type RestrictedMember,
  type RestrictedTable,
} from '../src/lib/restricted-family.js';
import {
  OVERLAY_META_SEED_STARTED_AT,
  carriedOverFromMeta,
  inspectOverlay,
  type CarriedOverMember,
  type OverlayInspection,
} from '../src/lib/restricted-overlay.js';
import type { SeedMemberReport } from './seed-report.js';

/** Au-delà, une donnée reprise n'est plus un pont sur un mois de panne : refus. */
export const CARRY_OVER_MAX_AGE_DAYS = 45;
const DAY_MS = 86_400_000;

/** La surcouche précédente, figée dans le dossier de travail et contrôlée. */
export interface PreviousOverlay {
  /** La copie figée : jamais le fichier posé à la sortie, que l'extraction remplacera. */
  path: string;
  inspection: OverlayInspection;
}

/** Un membre repris : ce que disent la sortie de `seed`, le fichier et le manifeste. */
export interface CarriedMember extends CarriedOverMember {
  member: string;
  /** Âge de la donnée reprise au moment du passage, en jours entiers. */
  age_days: number;
}

export interface CarryOverPlan {
  /** Les membres rafraîchis par leur source. */
  fresh: string[];
  /** Les membres à reprendre de la surcouche précédente. */
  carried: CarriedMember[];
  /**
   * Les listes statiques (`staticList`) recopiées telles quelles de la surcouche
   * précédente : ni reprise, ni borne d'âge, ni annonce (leur date est celle de
   * la liste).
   */
  statics: string[];
  /**
   * Les membres `mayBeAbsent` que ce passage ne portera pas : source en panne (ou
   * liste statique) et rien à reprendre, la surcouche précédente ne les portant
   * pas encore. Jamais un membre que la précédente servait.
   */
  absent: string[];
}

/** La cause qu'un seeder rapporte pour une liste statique (scripts/seed-curated-map.ts). */
export const STATIC_LIST_REPORT = 'static_list';

/**
 * Une date lue en UTC, en instant ISO 8601 : `YYYY-MM-DD HH:MM:SS` (SQLite,
 * `datetime('now')`, UTC sans fuseau ; la forme à « T » aussi, comme SQLite la
 * lit), `YYYY-MM-DD` (minuit UTC), ou un instant qui porte son fuseau. `null`
 * pour toute autre forme. Jamais `new Date()` sur une date sans fuseau : elle
 * serait lue à l'heure locale, deux heures d'écart entre le Mac et la CI.
 */
export function utcInstant(value: string | null | undefined): string | null {
  if (!value) return null;
  let text: string;
  const sqlite = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)$/.exec(value);
  if (sqlite) text = `${sqlite[1]}T${sqlite[2]}Z`;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) text = `${value}T00:00:00Z`;
  else if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) text = value;
  else return null;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function quote(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Identifiant SQL inattendu : ${name}`);
  return `"${name}"`;
}

function tableExists(db: Database.Database, schema: string, table: string): boolean {
  return !!db
    .prepare(`SELECT 1 AS ok FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
}

/** Le prédicat de plusieurs membres d'une même table. */
function unionOf(members: readonly RestrictedMember[]): { sql: string; params: string[] } {
  if (members.some((m) => m.where === null)) return { sql: '1 = 1', params: [] };
  const parts = members.map(memberPredicate);
  return {
    sql: parts.map((p) => `(${p.sql})`).join(' OR '),
    params: parts.flatMap((p) => p.params),
  };
}

function countMember(db: Database.Database, member: RestrictedMember): number {
  if (!tableExists(db, 'main', member.table)) return 0;
  const p = memberPredicate(member);
  return (
    db
      .prepare(`SELECT COUNT(*) AS n FROM main.${quote(member.table)} WHERE ${p.sql}`)
      .get(...p.params) as { n: number }
  ).n;
}

function maxOf(db: Database.Database, member: RestrictedMember, column: string): string | null {
  const p = memberPredicate(member);
  const row = db
    .prepare(`SELECT MAX(${quote(column)}) AS d FROM main.${quote(member.table)} WHERE ${p.sql}`)
    .get(...p.params) as { d: string | null };
  return row.d ?? null;
}

/** La date des lignes d'un membre, selon la façon dont sa table les date. */
function rowDate(
  db: Database.Database,
  spec: RestrictedTable,
  member: RestrictedMember,
): string | null {
  switch (spec.freshness) {
    case 'max_updated_at':
    case 'list_month_then_updated_at':
      return utcInstant(maxOf(db, member, 'updated_at'));
    case 'max_as_of':
      return utcInstant(maxOf(db, member, 'as_of'));
    case 'base_last_refresh':
      return null;
  }
}

/**
 * La date d'origine d'un membre de la surcouche précédente (voir l'en-tête), ou
 * `null` quand elle ne peut pas être établie.
 */
export function previousMemberDate(
  previous: PreviousOverlay,
  member: RestrictedMember,
): string | null {
  const meta = previous.inspection.meta ?? {};
  const carried = carriedOverFromMeta(meta)[member.id];
  if (carried) return carried.source_date;
  const started = utcInstant(meta[OVERLAY_META_SEED_STARTED_AT]);
  if (started) return started;
  // Un fichier écrit avant la reprise : la date de ses lignes, sinon sa création
  // s'il vient d'un passage `seed`.
  const db = new Database(previous.path, { readonly: true, fileMustExist: true });
  try {
    const fromRows = rowDate(db, restrictedTable(member.kind, member.table), member);
    if (fromRows) return fromRows;
  } finally {
    db.close();
  }
  return meta.generator === 'seed' ? utcInstant(meta.created_at) : null;
}

/** Le mois de la liste PRA de la surcouche précédente (`YYYY-MM`), ou null. */
function previousListMonth(previous: PreviousOverlay, member: RestrictedMember): string | null {
  const db = new Database(previous.path, { readonly: true, fileMustExist: true });
  try {
    return maxOf(db, member, 'list_month');
  } finally {
    db.close();
  }
}

/** Combien de mois séparent le mois `YYYY-MM` du mois de `now` (UTC) ; null si illisible. */
function monthsBefore(month: string | null, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  if (!m) return null;
  return now.getUTCFullYear() * 12 + now.getUTCMonth() - (Number(m[1]) * 12 + Number(m[2]) - 1);
}

/**
 * La surcouche que le dépôt privé a posée à la sortie avant la reconstruction,
 * copiée dans le dossier de travail AVANT les seeders, puis contrôlée comme le
 * chargeur de l'API la contrôle. `null` quand il n'y en a pas (première
 * publication).
 */
export function freezePrevious(
  outPath: string,
  scratch: string,
  kind: OverlayKind,
): PreviousOverlay | null {
  if (!existsSync(outPath)) return null;
  const path = join(scratch, `precedente-${kind}.sqlite`);
  copyFileSync(outPath, path);
  return { path, inspection: inspectOverlay(path, kind) };
}

/**
 * Qui est frais, qui est repris, et avec quelle date. Lève une seule erreur qui
 * liste tous les motifs de refus (voir l'en-tête) ; ne modifie rien.
 */
export function planCarryOver(options: {
  kind: OverlayKind;
  workPath: string;
  report: ReadonlyMap<string, SeedMemberReport>;
  previous: PreviousOverlay | null;
  now: Date;
}): CarryOverPlan {
  const { kind, report, previous, now } = options;
  const members = membersOf(kind);
  const ids = new Set(members.map((m) => m.id));
  const silent = members.filter((m) => !report.has(m.id)).map((m) => `${m.id} sans rapport`);
  const unknown = [...report.keys()].filter((id) => !ids.has(id)).map((id) => `${id} inconnu`);
  if (silent.length > 0 || unknown.length > 0)
    throw new Error(
      `Rapport des seeders incomplet, une faute de code et non une panne (${[...silent, ...unknown].join(', ')}). Rien n’est écrit.`,
    );

  const fresh: string[] = [];
  const pending: Array<{ member: RestrictedMember; cause: string }> = [];
  const statics: RestrictedMember[] = [];
  const work = new Database(options.workPath, { readonly: true, fileMustExist: true });
  try {
    for (const member of members) {
      const r = report.get(member.id)!;
      // Une liste statique que le seeder n'a pas rechargée : recopiée plus bas.
      if (member.staticList && r.state === 'failed' && r.cause === STATIC_LIST_REPORT) {
        statics.push(member);
        continue;
      }
      const cause =
        r.state === 'failed'
          ? (r.cause ?? 'error')
          : countMember(work, member) < member.minRows
            ? 'below_floor'
            : r.processed === 0
              ? 'empty_source'
              : null;
      if (cause) pending.push({ member, cause });
      else fresh.push(member.id);
    }
  } finally {
    work.close();
  }

  const problems: string[] = [];
  const absent: string[] = [];
  const staticCopied: string[] = [];
  const beforeOf = (id: string) =>
    previous?.inspection.ok ? previous.inspection.members.find((m) => m.id === id) : undefined;
  // Les listes statiques : recopiées si la précédente les sert, absentes si elle
  // ne les porte pas (ou s'il n'y a pas de précédente : rien à recopier).
  for (const member of statics) {
    const before = beforeOf(member.id);
    if (before?.state === 'applied') staticCopied.push(member.id);
    else if (!previous || before?.state === 'absent') absent.push(member.id);
    else if (!previous.inspection.ok)
      problems.push(
        `${member.id} : liste statique à recopier d'une surcouche précédente refusée (${previous.inspection.error ?? 'erreur'})`,
      );
    else
      problems.push(`${member.id} refusé dans la surcouche précédente (${before?.reason ?? '?'})`);
  }
  if (pending.length === 0) {
    if (problems.length > 0)
      throw new Error(`Reprise impossible, rien n’est écrit : ${problems.join(' ; ')}.`);
    return { fresh, carried: [], statics: staticCopied, absent };
  }

  const down = pending.map((p) => `${p.member.id} ${p.cause}`).join(', ');
  if (fresh.length === 0) problems.push(`aucun membre rafraîchi (${down})`);
  if (!previous)
    problems.push(`aucune surcouche précédente à reprendre, première publication (${down})`);
  else if (!previous.inspection.ok)
    problems.push(
      `la surcouche précédente est refusée par le contrôle (${previous.inspection.error ?? 'erreur'})`,
    );

  const carried: CarriedMember[] = [];
  if (previous?.inspection.ok) {
    for (const { member, cause } of pending) {
      const before = previous.inspection.members.find((m) => m.id === member.id);
      // Un membre venu après la première surcouche, que la précédente ne porte pas
      // encore : rien à reprendre, il reste absent, sans empêcher la publication
      // des autres (la liste PRA et sa condition de mois comprises).
      if (member.mayBeAbsent && before?.state === 'absent') {
        absent.push(member.id);
        continue;
      }
      if (before?.state !== 'applied') {
        problems.push(
          `${member.id} refusé dans la surcouche précédente (${before?.reason ?? 'absent'})`,
        );
        continue;
      }
      let date: string | null;
      try {
        date = previousMemberDate(previous, member);
      } catch {
        problems.push(`${member.id} : dates de la surcouche précédente illisibles`);
        continue;
      }
      if (!date) {
        problems.push(`${member.id} : date d'origine inconnue dans la surcouche précédente`);
        continue;
      }
      const ageMs = now.getTime() - Date.parse(date);
      const ageDays = Math.max(0, Math.floor(ageMs / DAY_MS));
      if (ageMs > CARRY_OVER_MAX_AGE_DAYS * DAY_MS) {
        problems.push(
          `${member.id} : donnée du ${date}, ${ageDays} jours, au-delà de la borne de ${CARRY_OVER_MAX_AGE_DAYS} jours`,
        );
        continue;
      }
      if (member.table === 'pra_banks') {
        const month = previousListMonth(previous, member);
        const back = monthsBefore(month, now);
        if (back === null || back > PRA_LIST_MONTHS_BACK) {
          problems.push(
            `${member.id} : liste de ${month ?? 'mois inconnu'}, hors de la fenêtre du seeder (le mois du passage et les ${PRA_LIST_MONTHS_BACK} précédents)`,
          );
          continue;
        }
      }
      carried.push({ member: member.id, source_date: date, age_days: ageDays, cause });
    }
  }
  if (problems.length > 0)
    throw new Error(`Reprise impossible, rien n’est écrit : ${problems.join(' ; ')}.`);
  return { fresh, carried, statics: staticCopied, absent };
}

/**
 * La ligne qui annonce un membre absent de la surcouche écrite : une annotation
 * GitHub, des codes seulement. Les réponses qui en dépendent disent « non
 * consulté » jusqu'au passage qui le rapportera.
 */
export function absentAnnotation(kind: OverlayKind, memberId: string): string {
  return (
    `::warning title=Surcouche ${kind} membre absent::${memberId} absent de la surcouche écrite ` +
    '(source en panne ou liste statique jamais chargée, et rien à reprendre de la précédente). ' +
    'Les réponses qui en dépendent disent non consulté.'
  );
}

/** L'ordre de réinsertion des membres d'une table en INSERT OR IGNORE. */
function insertOrder(spec: RestrictedTable, tableMembers: RestrictedMember[]): RestrictedMember[] {
  const order: readonly string[] = spec.name === 'bic_entries' ? RESTRICTED_BIC_INSERT_ORDER : [];
  const byId = new Map(tableMembers.map((m) => [m.id, m]));
  if (order.length !== byId.size || order.some((id) => !byId.has(id)))
    throw new Error(`${spec.name} : ordre d'insertion inconnu, reprise impossible`);
  return order.map((id) => byId.get(id)!);
}

/**
 * Copie dans la base de travail, telles quelles, les lignes des membres repris
 * (voir l'en-tête). Une seule transaction : tout ou rien.
 */
export function applyCarryOver(options: {
  kind: OverlayKind;
  workPath: string;
  previousPath: string;
  members: readonly string[];
}): void {
  const carriedIds = new Set(options.members);
  if (carriedIds.size === 0) return;
  const db = new Database(options.workPath);
  try {
    db.prepare('ATTACH DATABASE ? AS prev').run(options.previousPath);
    db.transaction(() => {
      for (const spec of RESTRICTED_TABLES[options.kind]) {
        const tableMembers = membersOf(options.kind).filter((m) => m.table === spec.name);
        const carried = tableMembers.filter((m) => carriedIds.has(m.id));
        if (carried.length === 0) continue;
        // Une table que la base de travail n'a plus (seeder en panne avant de la
        // créer) : recréée depuis la constante, jamais depuis la surcouche.
        if (!tableExists(db, 'main', spec.name))
          for (const statement of spec.ddl) db.prepare(statement).run();
        const table = quote(spec.name);
        const columns = spec.columns
          .filter((c) => c !== spec.rowidAlias)
          .map(quote)
          .join(', ');
        if (spec.onConflict === 'ignore') {
          // bic_entries : toute la famille de la table est réinsérée dans l'ordre
          // de la reconstruction, fraîche ou reprise selon le membre.
          const union = unionOf(tableMembers);
          db.exec(`CREATE TEMP TABLE carry_fresh AS SELECT ${columns} FROM main.${table} WHERE 0`);
          db.prepare(
            `INSERT INTO temp.carry_fresh (${columns})
             SELECT ${columns} FROM main.${table} WHERE ${union.sql} ORDER BY rowid`,
          ).run(...union.params);
          db.prepare(`DELETE FROM main.${table} WHERE ${union.sql}`).run(...union.params);
          for (const member of insertOrder(spec, tableMembers)) {
            const p = memberPredicate(member);
            const from = carriedIds.has(member.id) ? `prev.${table}` : 'temp.carry_fresh';
            db.prepare(
              `INSERT OR IGNORE INTO main.${table} (${columns})
               SELECT ${columns} FROM ${from} WHERE ${p.sql} ORDER BY rowid`,
            ).run(...p.params);
          }
          db.exec('DROP TABLE temp.carry_fresh');
        } else {
          for (const member of carried) {
            const p = memberPredicate(member);
            db.prepare(`DELETE FROM main.${table} WHERE ${p.sql}`).run(...p.params);
            db.prepare(
              `INSERT INTO main.${table} (${columns})
               SELECT ${columns} FROM prev.${table} WHERE ${p.sql} ORDER BY rowid`,
            ).run(...p.params);
          }
        }
      }
    })();
    db.exec('DETACH DATABASE prev');
  } finally {
    db.close();
  }
}

/**
 * La ligne qui annonce un membre repris : une annotation GitHub (le dépôt privé
 * la montre sur la page du passage), des codes et des dates seulement. Le titre
 * ne porte ni `:` ni `,` (séparateurs des propriétés d'une annotation).
 */
export function carryOverAnnotation(kind: OverlayKind, carried: CarriedMember): string {
  return (
    `::warning title=Surcouche ${kind} membre repris::${carried.member} repris tel quel ` +
    `de la surcouche précédente (donnée du ${carried.source_date}, ${carried.age_days} jours, ` +
    `cause ${carried.cause}). Les membres rafraîchis sont publiés ; au-delà de ` +
    `${CARRY_OVER_MAX_AGE_DAYS} jours, le passage échouera.`
  );
}

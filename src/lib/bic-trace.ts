/**
 * Un BIC figure-t-il encore dans une liste rafraîchie ce cycle ?
 *
 * ## Pourquoi ce module existe
 *
 * Une part de l'annuaire BIC vient d'une copie publique figée des années avant
 * son import (src/lib/source-vintage.ts). Dater cette copie ne suffit pas : un
 * lecteur veut savoir si le BIC qu'on lui sert apparaît encore AILLEURS, dans une
 * source que quelqu'un a republiée ce mois-ci. C'est la « trace courante ».
 *
 * Sont une trace : les lignes de `bic_entries` dont la source n'a pas de
 * millésime (GLEIF, les registres et listes relus chaque mois), les colonnes BIC
 * des registres nationaux resemés chaque mois (`de_blz`, `national_bank_codes`,
 * `bg_bae`, `ch_clearing`) et les registres EPC de la base de conformité
 * (`sepa_participants`, `vop_participants`). Ne sont PAS une trace : les
 * transcriptions statiques (la carte composite, la liste finlandaise, la liste
 * néerlandaise des émetteurs) et le registre luxembourgeois privé, qui n'expose
 * aucune énumération.
 *
 * ## Ce que la trace ne prouve pas
 *
 * Qu'une liste de ce cycle porte encore un BIC8 ne dit pas que la banque existe
 * toujours sous ce nom : une liste de place peut garder l'ancien nom d'une banque
 * absorbée. La trace dit « quelqu'un le liste encore », rien de plus.
 *
 * ## « Non consulté » n'est jamais « absent »
 *
 * Même règle que les registres EPC depuis le 25/09/2026 : une table qui manque,
 * qui ne se lit pas, ou un membre de la famille sous conditions
 * (src/lib/restricted-family.ts) servi sans une seule ligne, rend l'index
 * INCOMPLET. Un BIC absent d'un index incomplet répond alors `null`, jamais
 * `false` : il a peut-être une trace dans ce que nous n'avons pas lu.
 *
 * Et aujourd'hui l'index n'est JAMAIS complet : les listes EBA STEP2 et NBP ne
 * sont lues qu'à travers l'annuaire dédoublonné, qui perd une partie de ce
 * qu'elles portent (voir listsReadThroughDeduplicatedRows). `false` reste
 * inatteignable jusqu'à la correction durable.
 *
 * Aucune dépendance vers bic-lookup.ts (qui vide le mémo d'ici) : pas de cycle.
 */
import type DatabaseType from 'better-sqlite3';
import { getBicDB } from './db.js';
import { getComplianceDB } from './compliance-db.js';
import { frozenSources } from './source-vintage.js';
import { RESTRICTED_FAMILY, restrictedBicSources, restrictedTable } from './restricted-family.js';

export interface TraceIndex {
  /** Les BIC8 qu'au moins une source de ce cycle porte. */
  bic8s: Set<string>;
  /** Faux dès qu'une source de trace n'a pas pu être lue EN ENTIER. */
  complete: boolean;
  /** Les sources lues, pour le diagnostic. */
  sources_read: string[];
  /** Pourquoi l'index n'est pas complet (vide quand il l'est), pour le diagnostic. */
  incomplete_reasons: string[];
}

/**
 * Les listes de ce cycle que l'index ne lit qu'À TRAVERS l'annuaire dédoublonné,
 * et qui ne peuvent donc pas être lues en entier (relecture de la PR 254, R1).
 *
 * Les lignes EBA STEP2, NBP et OeNB entrent dans `bic_entries` par
 * `INSERT OR IGNORE`, après la copie figée : à l'import mensuel
 * (scripts/enrich-bic-database.ts) comme à la fusion de la surcouche privée
 * (`onConflict: 'ignore'` de la table dans restricted-family.ts). Un BIC11 que la
 * copie figée portait déjà garde sa seule ligne figée, et sa présence dans la
 * liste de ce cycle n'est écrite nulle part : mesuré le 25/09/2026, plus d'une
 * centaine de BIC8 portés par STEP2 ou NBP répondaient « absent de toute liste à
 * jour ».
 * Tant que c'est ainsi, l'index ne se déclare jamais complet :
 * `listed_in_current_source` vaut `true` ou `null`, jamais un `false` non
 * prouvé (règle « non consulté » de la PR 249).
 *
 * Lu dans la constante de la famille, jamais recopié. Les lignes Bundesbank et
 * SIX passent aussi par `INSERT OR IGNORE`, mais leurs registres entiers
 * (`de_blz`, `ch_clearing`) sont lus comme trace : rien ne s'y perd.
 *
 * La correction durable, étape suivante : écrire les BIC8 lus dans ces listes
 * dans une petite table de trace, hors de l'`INSERT OR IGNORE`, membre de la
 * famille sous conditions, la lire ici, et vider cette liste.
 */
export function listsReadThroughDeduplicatedRows(): string[] {
  if (restrictedTable('bic', 'bic_entries').onConflict !== 'ignore') return [];
  return [...restrictedBicSources()].sort();
}

export interface FrozenSourceTrace {
  source: string;
  /** Millésime de la source, lu dans source-vintage.ts. */
  source_as_of: string;
  rows: number;
  bic8: number;
  /** Nul quand l'index est incomplet : un compte d'absences sur un index partiel mentirait. */
  rows_without_current_trace: number | null;
  bic8_without_current_trace: number | null;
  complete: boolean;
}

/** Une requête de trace sur une colonne BIC d'une table. */
interface TraceQuery {
  db: 'bic' | 'compliance';
  table: string;
  sql: string;
}

/**
 * Les registres et tables de conformité lus comme trace. Le SQL est écrit ici,
 * jamais construit à partir d'une entrée.
 */
const TABLE_QUERIES: readonly TraceQuery[] = [
  {
    db: 'bic',
    table: 'de_blz',
    sql: "SELECT DISTINCT UPPER(SUBSTR(bic, 1, 8)) AS bic8 FROM de_blz WHERE bic IS NOT NULL AND bic != ''",
  },
  {
    db: 'bic',
    table: 'national_bank_codes',
    sql: "SELECT DISTINCT UPPER(SUBSTR(bic, 1, 8)) AS bic8 FROM national_bank_codes WHERE bic IS NOT NULL AND bic != ''",
  },
  {
    db: 'bic',
    table: 'bg_bae',
    sql: "SELECT DISTINCT UPPER(SUBSTR(bic, 1, 8)) AS bic8 FROM bg_bae WHERE bic IS NOT NULL AND bic != ''",
  },
  {
    db: 'bic',
    table: 'ch_clearing',
    sql: "SELECT DISTINCT UPPER(SUBSTR(bic, 1, 8)) AS bic8 FROM ch_clearing WHERE bic IS NOT NULL AND bic != ''",
  },
  {
    db: 'compliance',
    table: 'sepa_participants',
    sql: 'SELECT DISTINCT UPPER(bic8) AS bic8 FROM sepa_participants',
  },
  {
    db: 'compliance',
    table: 'vop_participants',
    sql: 'SELECT DISTINCT UPPER(bic8) AS bic8 FROM vop_participants',
  },
];

/** Les tables que lit la trace : celles ci-dessus, plus `bic_entries`. */
const TRACE_TABLES = new Set(['bic_entries', ...TABLE_QUERIES.map((q) => q.table)]);

/**
 * Un membre de la famille sous conditions que la trace lit, et qui DEVRAIT porter
 * des lignes, n'en porte aucune sur la base servie : ses traces n'ont pas été
 * lues. La liste des membres est lue dans la constante, jamais recopiée. Un
 * membre dont le plancher est zéro (l'OeNB) peut être vide légitimement.
 */
function missingRestrictedMember(
  bicDb: DatabaseType.Database,
  complianceDb: DatabaseType.Database,
): boolean {
  for (const member of RESTRICTED_FAMILY) {
    if (!TRACE_TABLES.has(member.table) || member.minRows <= 0) continue;
    const db = member.kind === 'bic' ? bicDb : complianceDb;
    // Table et colonne viennent de la constante ; la valeur est liée.
    const row = member.where
      ? db
          .prepare(`SELECT 1 AS hit FROM ${member.table} WHERE ${member.where.column} = ? LIMIT 1`)
          .get(member.where.value)
      : db.prepare(`SELECT 1 AS hit FROM ${member.table} LIMIT 1`).get();
    if (!row) return true;
  }
  return false;
}

/**
 * L'index des BIC8 portés par une source de ce cycle, sur deux connexions.
 *
 * Pure : aucune connexion globale, aucun mémo. Chaque lecture est gardée ; une
 * table absente ou illisible rend l'index incomplet sans lever.
 *
 * @param frozen Les sources millésimées, dont les lignes ne sont PAS une trace.
 *   Par défaut celles de source-vintage.ts ; un test peut en injecter d'autres.
 * @param deduplicated Les listes lues seulement à travers l'annuaire dédoublonné
 *   (listsReadThroughDeduplicatedRows) : tant qu'il en reste une, l'index n'est
 *   pas complet. Un test passe `[]` pour éprouver la mécanique d'un index
 *   complet, celle que la correction durable rendra réelle.
 */
export function measureTraceIndex(
  bicDb: DatabaseType.Database,
  complianceDb: DatabaseType.Database,
  frozen: readonly string[] = frozenSources().map((f) => f.source),
  deduplicated: readonly string[] = listsReadThroughDeduplicatedRows(),
): TraceIndex {
  const bic8s = new Set<string>();
  const sourcesRead: string[] = [];
  const reasons: string[] = [];

  const add = (rows: unknown[]): void => {
    for (const r of rows as Array<{ bic8: string | null }>) if (r.bic8) bic8s.add(r.bic8);
  };

  try {
    // Les sources de l'annuaire sans millésime. `NOT IN ()` vide est du SQL
    // invalide : sans source figée, toutes les lignes sont une trace.
    const placeholders = frozen.map(() => '?').join(', ');
    const sql = frozen.length
      ? `SELECT DISTINCT UPPER(bic8) AS bic8 FROM bic_entries WHERE COALESCE(source, '') NOT IN (${placeholders})`
      : 'SELECT DISTINCT UPPER(bic8) AS bic8 FROM bic_entries';
    add(bicDb.prepare(sql).all(...frozen));
    sourcesRead.push('bic_entries');
  } catch {
    reasons.push('unreadable:bic_entries');
  }

  for (const q of TABLE_QUERIES) {
    try {
      add((q.db === 'bic' ? bicDb : complianceDb).prepare(q.sql).all());
      sourcesRead.push(q.table);
    } catch {
      reasons.push(`unreadable:${q.table}`);
    }
  }

  try {
    if (missingRestrictedMember(bicDb, complianceDb)) reasons.push('restricted_member_empty');
  } catch {
    reasons.push('restricted_member_unreadable');
  }

  for (const list of deduplicated) reasons.push(`deduplicated_list_rows:${list}`);

  return {
    bic8s,
    complete: reasons.length === 0,
    sources_read: sourcesRead,
    incomplete_reasons: reasons,
  };
}

/**
 * Pour chaque source millésimée : ses lignes, ses BIC8, et combien d'entre eux
 * aucune source de ce cycle ne porte plus.
 */
export function measureFrozenTrace(
  bicDb: DatabaseType.Database,
  complianceDb: DatabaseType.Database,
  frozen: ReadonlyArray<{ source: string; as_of: string }> = frozenSources(),
  index: TraceIndex = measureTraceIndex(
    bicDb,
    complianceDb,
    frozen.map((f) => f.source),
  ),
): FrozenSourceTrace[] {
  const stmt = bicDb.prepare('SELECT UPPER(bic8) AS bic8 FROM bic_entries WHERE source = ?');
  return frozen.map(({ source, as_of }) => {
    const rows = stmt.all(source) as Array<{ bic8: string }>;
    const all = new Set<string>();
    const untraced = new Set<string>();
    let untracedRows = 0;
    for (const { bic8 } of rows) {
      all.add(bic8);
      if (!index.bic8s.has(bic8)) {
        untracedRows += 1;
        untraced.add(bic8);
      }
    }
    return {
      source,
      source_as_of: as_of,
      rows: rows.length,
      bic8: all.size,
      rows_without_current_trace: index.complete ? untracedRows : null,
      bic8_without_current_trace: index.complete ? untraced.size : null,
      complete: index.complete,
    };
  });
}

// ---------------------------------------------------------------------------
// Mémo pour la vie du processus
// ---------------------------------------------------------------------------

// Les deux bases sont en lecture seule et changent avec un déploiement (ou un
// rechargement de la surcouche privée, qui passe par resetStatements() et
// resetComplianceStatements(), lesquels vident ce mémo).
let indexMemo: TraceIndex | undefined;
let frozenMemo: FrozenSourceTrace[] | undefined;

/** L'index des bases servies, calculé une fois. */
export function traceIndex(): TraceIndex {
  if (!indexMemo) indexMemo = measureTraceIndex(getBicDB(), getComplianceDB());
  return indexMemo;
}

/** Les lignes figées sans trace des bases servies, calculées une fois. */
export function frozenTrace(): FrozenSourceTrace[] {
  if (!frozenMemo) {
    frozenMemo = measureFrozenTrace(getBicDB(), getComplianceDB(), frozenSources(), traceIndex());
  }
  return frozenMemo;
}

/** Vide les deux mémos : une base rouverte peut porter d'autres lignes. */
export function resetTraceIndex(): void {
  indexMemo = undefined;
  frozenMemo = undefined;
}

/**
 * Le BIC8 figure-t-il dans une liste rafraîchie ce cycle ?
 *
 * `true` dès qu'une source lue le porte, même sur un index incomplet (une trace
 * trouvée reste une trace). `false` seulement sur un index complet. `null`
 * quand il est absent de ce qui a été lu et que tout n'a pas pu l'être, ou
 * quand l'index lui-même ne se construit pas.
 */
export function listedInCurrentSource(bic8: string): boolean | null {
  let index: TraceIndex;
  try {
    index = traceIndex();
  } catch {
    return null;
  }
  return listedIn(index, bic8);
}

/** La même réponse sur un index donné (pure, pour les tests). */
export function listedIn(index: TraceIndex, bic8: string): boolean | null {
  const key = bic8.trim().toUpperCase().slice(0, 8);
  if (index.bic8s.has(key)) return true;
  return index.complete ? false : null;
}

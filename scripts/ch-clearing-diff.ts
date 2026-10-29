/**
 * Le clearing suisse (SIX BankMaster) a-t-il changé, et RIEN D'AUTRE n'a-t-il changé ?
 *
 * =====================================================================
 * CONTRAT DE LA LIGNE DE COMMANDE
 * =====================================================================
 *
 *   npx tsx scripts/ch-clearing-diff.ts
 *
 *   CH_DIFF_AFTER   la base à juger. Par défaut : data/bic.sqlite.
 *   CH_DIFF_BEFORE  la base de comparaison. Par défaut : non définie, c'est-à-dire
 *                   `git show HEAD:data/bic.sqlite`, l'état commité, comme
 *                   scripts/refresh-diff.ts et scripts/it-register-diff.ts.
 *
 * Codes de sortie :
 *   0  rien ne diffère hors de la table ch_clearing. `changed=true|false` est
 *      écrit dans $GITHUB_OUTPUT quand il existe, et affiché dans tous les cas.
 *   1  REFUSÉ : quelque chose diffère hors de ch_clearing (une autre table, le
 *      schéma, ch_clearing comprise), le fichier SIX lu est plus ancien que celui
 *      déjà commité, ou une base ne se lit pas. Ne rien commiter.
 *
 * =====================================================================
 *
 * POURQUOI
 *
 * .github/workflows/refresh-ch-clearing.yml relit chaque semaine le fichier
 * BankMaster de SIX, seul, et commite data/bic.sqlite, le binaire d'où l'API est
 * déployée. Il doit commiter la table ch_clearing et jamais rien d'autre. Même
 * raisonnement que it-register-diff.ts, dont ce fichier est le jumeau : un
 * `git diff` ne dit pas QUELLES lignes ont bougé, donc les deux bases sont
 * comparées par contenu, table par table.
 *
 * DEUX COLONNES NE COMPTENT PAS POUR DÉCIDER D'UN COMMIT
 *
 * scripts/seed-bc-nummer.ts supprime et recrée la table à chaque passage :
 * `updated_at` (valeur par défaut `datetime('now')`) change donc toujours, et
 * `valid_on` porte la date du fichier SIX, la même sur toutes les lignes, qui
 * avance chaque jour ouvrable (mesuré le 29.10.2026 : 1 164 lignes « Valid on
 * 2026-10-29 », fichier horodaté 202610281630000). Les compter ferait commiter
 * et redéployer l'API chaque semaine pour rien. `changed` ne regarde donc que le
 * reste : l'ensemble des IID, les noms, adresses, BIC, QR-IID, sièges, fusions et
 * participations aux systèmes de paiement. Quand rien d'autre n'a bougé, la base
 * commitée garde son `valid_on` : une date plus ancienne que la relecture, jamais
 * plus récente que le fichier dont viennent les lignes.
 *
 * Un fichier dont la date est ANTÉRIEURE à celle déjà commitée est refusé : il
 * remettrait en service des BIC que SIX a déjà remplacés.
 */
import Database from 'better-sqlite3';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** La seule table que la relecture suisse peut changer. */
export const SWISS_TABLE = 'ch_clearing';

/** Colonnes réécrites à chaque passage sans que le contenu change (voir plus haut). */
export const VOLATILE_COLUMNS = ['valid_on', 'updated_at'] as const;

/** Nombre de changements de BIC recopiés dans le journal, au plus. */
const LISTED_BIC_CHANGES = 20;

export interface SwissClearingDiff {
  /** Le contenu de ch_clearing (hors valid_on et updated_at) diffère. */
  changed: boolean;
  /** Tout ce qui diffère ailleurs, ou ce qui interdit le commit. Doit être vide pour commiter. */
  outside: string[];
  /** Ce que le journal du workflow affiche : décomptes, dates du fichier, BIC changés. */
  summary: string[];
}

const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** Lignes présentes d'un côté et pas de l'autre (EXCEPT dans les deux sens), sur `columns`. */
function differs(db: Database.Database, table: string, columns = '*'): boolean {
  const t = quote(table);
  const a = `SELECT ${columns} FROM prev.${t}`;
  const b = `SELECT ${columns} FROM main.${t}`;
  const row = db
    .prepare(
      `SELECT EXISTS (${a} EXCEPT ${b}) AS gone, EXISTS (${b} EXCEPT ${a}) AS added,
              (SELECT COUNT(*) FROM prev.${t}) AS n_before,
              (SELECT COUNT(*) FROM main.${t}) AS n_after`,
    )
    .get() as { gone: number; added: number; n_before: number; n_after: number };
  return row.gone === 1 || row.added === 1 || row.n_before !== row.n_after;
}

function schema(db: Database.Database, alias: 'main' | 'prev'): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT type || ':' || name AS k, IFNULL(sql, '') AS sql FROM ${alias}.sqlite_master WHERE name NOT LIKE 'sqlite_%'`,
    )
    .all() as Array<{ k: string; sql: string }>;
  return new Map(rows.map((r) => [r.k, r.sql]));
}

function fileDates(
  db: Database.Database,
  alias: 'main' | 'prev',
): { n: number; first: string | null; last: string | null } {
  return db
    .prepare(
      `SELECT COUNT(*) AS n, MIN(valid_on) AS first, MAX(valid_on) AS last FROM ${alias}.${quote(SWISS_TABLE)}`,
    )
    .get() as { n: number; first: string | null; last: string | null };
}

function editionOf(d: { n: number; first: string | null; last: string | null }): string {
  const dates = d.first === d.last ? `valid_on ${d.last}` : `valid_on ${d.first}..${d.last}`;
  return `${d.n} rows, ${dates}`;
}

/** Compare deux fichiers de base par leur contenu. Pur, lecture mise à part. */
export function compareSwissClearingOnly(beforePath: string, afterPath: string): SwissClearingDiff {
  const db = new Database(afterPath, { readonly: true });
  try {
    db.prepare('ATTACH DATABASE ? AS prev').run(beforePath);
    const outside: string[] = [];
    const before = schema(db, 'prev');
    const after = schema(db, 'main');
    for (const k of new Set([...before.keys(), ...after.keys()])) {
      if (before.get(k) !== after.get(k)) outside.push(`schema of ${k}`);
    }
    if (outside.length > 0) return { changed: false, outside, summary: [] };
    if (!after.has(`table:${SWISS_TABLE}`)) {
      return { changed: false, outside: [`no ${SWISS_TABLE} table`], summary: [] };
    }

    const tables = [...after.keys()]
      .filter((k) => k.startsWith('table:'))
      .map((k) => k.slice('table:'.length));
    for (const table of tables) {
      if (table !== SWISS_TABLE && differs(db, table)) outside.push(table);
    }

    const columns = (
      db.prepare(`SELECT name FROM main.pragma_table_info(?)`).all(SWISS_TABLE) as Array<{
        name: string;
      }>
    )
      .map((c) => c.name)
      .filter((c) => !(VOLATILE_COLUMNS as readonly string[]).includes(c));
    const content = columns.map(quote).join(', ');
    const changed = differs(db, SWISS_TABLE, content);

    const was = fileDates(db, 'prev');
    const now = fileDates(db, 'main');
    const summary = [`${SWISS_TABLE}: ${editionOf(was)} -> ${editionOf(now)}`];
    // Comparaison de chaînes ISO (AAAA-MM-JJ) : l'ordre lexical est l'ordre des dates.
    if (was.last && now.last && now.last < was.last) {
      outside.push(
        `${SWISS_TABLE}: the SIX file read (valid_on ${now.last}) is older than the one committed (valid_on ${was.last})`,
      );
    }

    if (changed) {
      const t = quote(SWISS_TABLE);
      const counts = db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM main.${t} WHERE iid NOT IN (SELECT iid FROM prev.${t})) AS added,
             (SELECT COUNT(*) FROM prev.${t} WHERE iid NOT IN (SELECT iid FROM main.${t})) AS removed,
             (SELECT COUNT(*) FROM main.${t} m JOIN prev.${t} p USING (iid)
                WHERE ${columns
                  .filter((c) => c !== 'iid')
                  .map((c) => `m.${quote(c)} IS NOT p.${quote(c)}`)
                  .join(' OR ')}) AS modified`,
        )
        .get() as { added: number; removed: number; modified: number };
      const bics = db
        .prepare(
          `SELECT m.iid AS iid, p.bic AS before, m.bic AS after FROM main.${t} m
             JOIN prev.${t} p USING (iid) WHERE m.bic IS NOT p.bic ORDER BY m.iid`,
        )
        .all() as Array<{ iid: string; before: string | null; after: string | null }>;
      summary.push(
        `content: ${counts.added} IID added, ${counts.removed} removed, ${counts.modified} modified, of which ${bics.length} with a new BIC`,
      );
      for (const b of bics.slice(0, LISTED_BIC_CHANGES)) {
        summary.push(`  BIC of IID ${b.iid}: ${b.before ?? '(none)'} -> ${b.after ?? '(none)'}`);
      }
      if (bics.length > LISTED_BIC_CHANGES) {
        summary.push(`  ... and ${bics.length - LISTED_BIC_CHANGES} more`);
      }
    }
    return { changed, outside, summary };
  } finally {
    db.close();
  }
}

function main(): number {
  const after = process.env.CH_DIFF_AFTER ?? resolve(__dirname, '../data/bic.sqlite');
  let before = process.env.CH_DIFF_BEFORE ?? null;
  let tmp: string | null = null;
  try {
    if (!before) {
      tmp = mkdtempSync(join(tmpdir(), 'ch-clearing-diff-'));
      before = join(tmp, 'bic-head.sqlite');
      writeFileSync(
        before,
        execFileSync('git', ['show', 'HEAD:data/bic.sqlite'], { maxBuffer: 512 * 1024 * 1024 }),
      );
    }
    const diff = compareSwissClearingOnly(before, after);
    for (const line of diff.summary) console.log(`  ${line}`);
    if (diff.outside.length > 0) {
      console.error(
        `REFUSED: ${diff.outside.join('; ')}. Nothing may be committed by the Swiss clearing run.`,
      );
      return 1;
    }
    console.log(
      diff.changed
        ? 'Swiss clearing changed'
        : 'Swiss clearing unchanged (valid_on and updated_at aside): nothing to commit',
    );
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `changed=${diff.changed}\n`);
    }
    return 0;
  } catch (e) {
    console.error(`REFUSED: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const code = main();
  if (code !== 0) process.exitCode = code;
}

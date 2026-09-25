/**
 * Le registre italien a-t-il changé, et RIEN D'AUTRE n'a-t-il changé ?
 *
 * =====================================================================
 * CONTRAT DE LA LIGNE DE COMMANDE
 * =====================================================================
 *
 *   npx tsx scripts/it-register-diff.ts
 *
 *   IT_DIFF_AFTER   la base à juger. Par défaut : data/bic.sqlite.
 *   IT_DIFF_BEFORE  la base de comparaison. Par défaut : non définie, c'est-à-dire
 *                   `git show HEAD:data/bic.sqlite`, l'état commité, comme
 *                   scripts/refresh-diff.ts et scripts/cz-register-diff.ts.
 *
 * Codes de sortie :
 *   0  rien ne diffère hors des lignes italiennes. `changed=true|false` est écrit
 *      dans $GITHUB_OUTPUT quand il existe, et affiché dans tous les cas.
 *   1  REFUSÉ : quelque chose diffère hors des lignes italiennes (une table, une
 *      ligne d'un autre pays, le schéma), ou une base ne se lit pas. Ne rien
 *      commiter.
 *
 * =====================================================================
 *
 * POURQUOI
 *
 * .github/workflows/refresh-it-register.yml relit le registre italien seul,
 * chaque semaine, et commite data/bic.sqlite, un binaire d'où le service Railway
 * est déployé. Il doit commiter les lignes italiennes et jamais rien d'autre.
 * Même raisonnement que cz-register-diff.ts, dont ce fichier est le jumeau : un
 * `git diff` ne sert à rien (SQLite réécrit ses pages à chaque suppression et
 * réinsertion identiques, et des octets ne disent pas QUELLES lignes ont bougé),
 * donc les deux bases sont comparées par contenu, table par table, les lignes
 * italiennes des deux tables du registre mises à part.
 *
 * Le jumeau tchèque reste tel quel : les deux relectures ne touchent ni les mêmes
 * pays ni les mêmes tables, et chacune refuse ce que l'autre écrit.
 */
import Database from 'better-sqlite3';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Les deux tables dont les lignes italiennes peuvent changer ici. */
const ITALIAN_TABLES = ['national_bank_codes', 'national_bank_codes_retired'] as const;

/** La seule table qui peut apparaître : celle des codes radiés, créée par le premier chargement. */
const MAY_APPEAR = `table:${ITALIAN_TABLES[1]}`;

export interface ItalianOnlyDiff {
  /** Les lignes italiennes de l'une des deux tables diffèrent. */
  italianChanged: boolean;
  /** Tout le reste qui diffère. Doit être vide pour commiter. */
  outside: string[];
  /** Une ligne par table du registre : lignes italiennes et édition, avant → après. */
  summary: string[];
}

const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** Lignes présentes d'un côté et pas de l'autre (EXCEPT dans les deux sens), sous `where`. */
function differs(db: Database.Database, table: string, where: string): boolean {
  const t = quote(table);
  const a = `SELECT * FROM prev.${t} ${where}`;
  const b = `SELECT * FROM main.${t} ${where}`;
  const row = db
    .prepare(
      `SELECT EXISTS (${a} EXCEPT ${b}) AS gone, EXISTS (${b} EXCEPT ${a}) AS added,
              (SELECT COUNT(*) FROM prev.${t} ${where}) AS n_before,
              (SELECT COUNT(*) FROM main.${t} ${where}) AS n_after`,
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

function italianEdition(db: Database.Database, alias: 'main' | 'prev', table: string): string {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n, MAX(as_of) AS as_of FROM ${alias}.${quote(table)} WHERE country = 'IT'`,
    )
    .get() as { n: number; as_of: string | null };
  return r.n === 0 ? 'none' : `${r.n} rows, edition ${r.as_of}`;
}

/** Compare deux fichiers de base par leur contenu. Pur, lecture mise à part. */
export function compareItalianOnly(beforePath: string, afterPath: string): ItalianOnlyDiff {
  const db = new Database(afterPath, { readonly: true });
  try {
    db.prepare('ATTACH DATABASE ? AS prev').run(beforePath);
    const outside: string[] = [];
    const before = schema(db, 'prev');
    const after = schema(db, 'main');
    for (const k of new Set([...before.keys(), ...after.keys()])) {
      if (before.get(k) === after.get(k)) continue;
      if (k === MAY_APPEAR && !before.has(k)) continue;
      outside.push(`schema of ${k}`);
    }
    if (outside.length > 0) return { italianChanged: false, outside, summary: [] };

    let italianChanged = false;
    const summary: string[] = [];
    const tables = [...after.keys()]
      .filter((k) => k.startsWith('table:'))
      .map((k) => k.slice('table:'.length));
    for (const table of tables) {
      const isItalianTable = (ITALIAN_TABLES as readonly string[]).includes(table);
      if (!before.has(`table:${table}`)) {
        // Seule la table des codes radiés peut arriver ici (vérifié plus haut) ;
        // ses lignes sont italiennes ou un refus.
        const other = db
          .prepare(`SELECT COUNT(*) AS n FROM main.${quote(table)} WHERE country <> 'IT'`)
          .get() as { n: number };
        if (other.n > 0) outside.push(`${table}: rows of another country`);
        const it = db
          .prepare(`SELECT COUNT(*) AS n FROM main.${quote(table)} WHERE country = 'IT'`)
          .get() as { n: number };
        if (it.n > 0) italianChanged = true;
        summary.push(`${table}: none -> ${italianEdition(db, 'main', table)}`);
        continue;
      }
      if (isItalianTable) {
        if (differs(db, table, "WHERE country <> 'IT'"))
          outside.push(`${table}: rows of another country`);
        if (differs(db, table, "WHERE country = 'IT'")) italianChanged = true;
        summary.push(
          `${table}: ${italianEdition(db, 'prev', table)} -> ${italianEdition(db, 'main', table)}`,
        );
      } else if (differs(db, table, '')) {
        outside.push(table);
      }
    }
    return { italianChanged, outside, summary };
  } finally {
    db.close();
  }
}

function main(): number {
  const after = process.env.IT_DIFF_AFTER ?? resolve(__dirname, '../data/bic.sqlite');
  let before = process.env.IT_DIFF_BEFORE ?? null;
  let tmp: string | null = null;
  try {
    if (!before) {
      tmp = mkdtempSync(join(tmpdir(), 'it-register-diff-'));
      before = join(tmp, 'bic-head.sqlite');
      writeFileSync(
        before,
        execFileSync('git', ['show', 'HEAD:data/bic.sqlite'], { maxBuffer: 512 * 1024 * 1024 }),
      );
    }
    const diff = compareItalianOnly(before, after);
    for (const line of diff.summary) console.log(`  ${line}`);
    if (diff.outside.length > 0) {
      console.error(
        `REFUSED: something other than the Italian rows differs: ${diff.outside.join('; ')}. Nothing may be committed by the Italian run.`,
      );
      return 1;
    }
    console.log(diff.italianChanged ? 'Italian register changed' : 'Italian register unchanged');
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `changed=${diff.italianChanged}\n`);
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

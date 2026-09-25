/**
 * Did the Czech register change, and did NOTHING ELSE change?
 *
 * =====================================================================
 * CLI CONTRACT
 * =====================================================================
 *
 *   npx tsx scripts/cz-register-diff.ts
 *
 *   CZ_DIFF_AFTER   the database to judge. Default: data/bic.sqlite.
 *   CZ_DIFF_BEFORE  the database to compare against. Default: unset, which
 *                   means `git show HEAD:data/bic.sqlite`, the committed state,
 *                   exactly as scripts/refresh-diff.ts reads it.
 *
 * Exit codes:
 *   0  nothing outside the Czech rows differs. `changed=true|false` is written
 *      to $GITHUB_OUTPUT when it is set, and printed either way.
 *   1  REFUSED: something outside the Czech rows differs (a table, a row of
 *      another country, the schema), or a database could not be read. Do NOT
 *      commit.
 *
 * =====================================================================
 *
 * WHY THIS EXISTS
 *
 * The Czech register switches editions on dates the monthly refresh does not
 * follow (251 took effect on 16 March 2026, and the refresh runs on the 1st),
 * so .github/workflows/refresh-cz-register.yml runs the Czech seeder alone,
 * daily. That workflow commits data/bic.sqlite, a binary the Railway service
 * is deployed from, and it must commit the Czech rows and never anything else:
 * no other source is re-read there, and nothing else may ride along.
 *
 * Two facts make a plain `git diff` useless for that. SQLite rewrites pages on
 * a DELETE and INSERT of identical rows, so the file's bytes change on every
 * run even when the edition has not: committing on a byte change would commit
 * and redeploy every day. And bytes cannot say WHICH rows changed. So the two
 * databases are compared by content, table by table, with the Czech rows of the
 * two register tables set apart.
 */
import Database from 'better-sqlite3';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The two tables whose Czech rows this run may change. */
const CZECH_TABLES = ['national_bank_codes', 'national_bank_codes_pending'] as const;

export interface CzechOnlyDiff {
  /** The Czech rows of either register table differ. */
  czechChanged: boolean;
  /** Everything else that differs. Must be empty for a commit. */
  outside: string[];
  /** One line per register table: Czech rows and edition, before → after. */
  summary: string[];
}

const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/**
 * Rows of `table` present on one side and not the other, restricted by
 * `where`. Set semantics (EXCEPT), both ways: enough to tell "same content"
 * from "different content", which is the only question asked.
 */
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

function czechEdition(db: Database.Database, alias: 'main' | 'prev', table: string): string {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n, MAX(source) AS source, MAX(as_of) AS as_of FROM ${alias}.${quote(table)} WHERE country = 'CZ'`,
    )
    .get() as { n: number; source: string | null; as_of: string | null };
  return r.n === 0 ? 'none' : `${r.n} rows, ${r.source} (${r.as_of})`;
}

/** Compare two database files by content. Pure apart from reading them. */
export function compareCzechOnly(beforePath: string, afterPath: string): CzechOnlyDiff {
  const db = new Database(afterPath, { readonly: true });
  try {
    db.prepare('ATTACH DATABASE ? AS prev').run(beforePath);
    const outside: string[] = [];
    const before = schema(db, 'prev');
    const after = schema(db, 'main');
    // The announced-edition table may appear on a database seeded before it
    // existed; nothing else may appear, vanish or change shape.
    const pendingKey = `table:${CZECH_TABLES[1]}`;
    for (const k of new Set([...before.keys(), ...after.keys()])) {
      if (before.get(k) === after.get(k)) continue;
      if (k === pendingKey && !before.has(k)) continue;
      outside.push(`schema of ${k}`);
    }
    if (outside.length > 0) return { czechChanged: false, outside, summary: [] };

    let czechChanged = false;
    const summary: string[] = [];
    const tables = [...after.keys()]
      .filter((k) => k.startsWith('table:'))
      .map((k) => k.slice('table:'.length));
    for (const table of tables) {
      const isCzechTable = (CZECH_TABLES as readonly string[]).includes(table);
      if (!before.has(`table:${table}`)) {
        // Only the pending table can get here (checked above); rows in it are
        // Czech rows or a refusal.
        const other = db
          .prepare(`SELECT COUNT(*) AS n FROM main.${quote(table)} WHERE country <> 'CZ'`)
          .get() as { n: number };
        if (other.n > 0) outside.push(`${table}: rows of another country`);
        const cz = db
          .prepare(`SELECT COUNT(*) AS n FROM main.${quote(table)} WHERE country = 'CZ'`)
          .get() as { n: number };
        if (cz.n > 0) czechChanged = true;
        summary.push(`${table}: none -> ${czechEdition(db, 'main', table)}`);
        continue;
      }
      if (isCzechTable) {
        if (differs(db, table, "WHERE country <> 'CZ'"))
          outside.push(`${table}: rows of another country`);
        if (differs(db, table, "WHERE country = 'CZ'")) czechChanged = true;
        summary.push(
          `${table}: ${czechEdition(db, 'prev', table)} -> ${czechEdition(db, 'main', table)}`,
        );
      } else if (differs(db, table, '')) {
        outside.push(table);
      }
    }
    return { czechChanged, outside, summary };
  } finally {
    db.close();
  }
}

function main(): number {
  const after = process.env.CZ_DIFF_AFTER ?? resolve(__dirname, '../data/bic.sqlite');
  let before = process.env.CZ_DIFF_BEFORE ?? null;
  let tmp: string | null = null;
  try {
    if (!before) {
      tmp = mkdtempSync(join(tmpdir(), 'cz-register-diff-'));
      before = join(tmp, 'bic-head.sqlite');
      writeFileSync(
        before,
        execFileSync('git', ['show', 'HEAD:data/bic.sqlite'], { maxBuffer: 512 * 1024 * 1024 }),
      );
    }
    const diff = compareCzechOnly(before, after);
    for (const line of diff.summary) console.log(`  ${line}`);
    if (diff.outside.length > 0) {
      console.error(
        `REFUSED: something other than the Czech rows differs: ${diff.outside.join('; ')}. Nothing may be committed by the Czech run.`,
      );
      return 1;
    }
    console.log(diff.czechChanged ? 'Czech register changed' : 'Czech register unchanged');
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `changed=${diff.czechChanged}\n`);
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

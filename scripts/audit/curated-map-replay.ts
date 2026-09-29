/**
 * Replay what the API answers for every bank code of the composite map, so a
 * change to src/db/bic_data.json can be measured country by country before it
 * ships (29/09/2026, withdrawal of the map keys whose publishers grant no right
 * to reuse them).
 *
 *   tsx scripts/audit/curated-map-replay.ts snapshot <out.json> [keys.json ...]
 *   tsx scripts/audit/curated-map-replay.ts compare <before.json> <after.json> [CC,CC,...]
 *
 * `snapshot` runs the real enrichment path (resolveBank, the bank-code verdict,
 * the issuer) on one answer per (country, bank code), in-process, against the
 * database of this checkout. The codes are the keys of the map files named on
 * the command line (the current map when none is named), every Italian code the
 * Banca d'Italia lists (in force and struck off), and, for the countries whose
 * bank code is read against the start of a BIC, every such prefix of the
 * directory. Each answer starts from the country's registry example, validated
 * once, with only its bank code replaced: the national check digits of a forged
 * IBAN would otherwise stop the enrichment before it reads the map. Run the two
 * snapshots in the same environment (no RESTRICTED_* overlay, no
 * LU_REGISTER_PATH), on the same day.
 *
 * `compare` prints, per country, how many codes kept the whole answer, the same
 * BIC, a different BIC, lost or gained one, and exits 1 if any country outside
 * the list named as touched changed at all. Counts only: a snapshot holds
 * code-to-BIC pairings, some of them from sources this repository may not
 * redistribute, so it is written outside the repository (the script refuses a
 * path inside it) and never committed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

type Answer = Record<string, unknown>;
interface Snapshot {
  generated_at: string;
  revision: string;
  answers: Record<string, Answer>;
}

function outsideRepository(path: string): string {
  const abs = resolve(path);
  if (abs === repoRoot || abs.startsWith(`${repoRoot}/`)) {
    throw new Error(`refusing to write a snapshot inside the repository: ${abs}`);
  }
  return abs;
}

/** Countries whose IBAN bank code is read against the first characters of a BIC. */
const PREFIX_COUNTRIES: Record<string, number> = {
  RO: 4,
  IE: 4,
  LV: 4,
  BG: 4,
  GB: 4,
  GE: 2,
  MD: 2,
};

async function snapshot(out: string, keyFiles: string[]): Promise<void> {
  process.env.STATS_DB_PATH ??= resolve(tmpdir(), `curated-map-replay-${process.pid}.sqlite`);
  const { validateIBAN } = await import('../../src/lib/iban.js');
  const { enrichResult } = await import('../../src/lib/enrich.js');
  const { EXAMPLE_IBANS } = await import('../../src/lib/countries.js');
  const { getBicDB } = await import('../../src/lib/db.js');

  const codes = new Set<string>();
  const files = keyFiles.length > 0 ? keyFiles : [resolve(repoRoot, 'src/db/bic_data.json')];
  for (const file of files) {
    for (const key of Object.keys(JSON.parse(readFileSync(file, 'utf8')) as object)) codes.add(key);
  }
  const db = getBicDB();
  for (const table of ['national_bank_codes', 'national_bank_codes_retired']) {
    const rows = db.prepare(`SELECT code FROM ${table} WHERE country = 'IT'`).all() as Array<{
      code: string;
    }>;
    for (const r of rows) codes.add(`IT:${r.code}`);
  }
  for (const [cc, width] of Object.entries(PREFIX_COUNTRIES)) {
    const rows = db
      .prepare('SELECT DISTINCT substr(bic8, 1, ?) AS p FROM bic_entries WHERE country_code = ?')
      .all(width, cc) as Array<{ p: string }>;
    for (const r of rows) codes.add(`${cc}:${r.p}`);
  }

  const examples = new Map<string, ReturnType<typeof validateIBAN>>();
  const answers: Record<string, Answer> = {};
  for (const key of [...codes].sort()) {
    const cc = key.slice(0, key.indexOf(':'));
    const code = key.slice(cc.length + 1);
    let base = examples.get(cc);
    if (!base) {
      const example = (EXAMPLE_IBANS as Record<string, string | undefined>)[cc];
      if (!example) continue;
      base = validateIBAN(example);
      examples.set(cc, base);
    }
    if (!base.valid || !base.bban) continue;
    const result = structuredClone(base);
    result.bban = { ...result.bban!, bank_code: code };
    enrichResult(result);
    answers[key] = JSON.parse(JSON.stringify(result)) as Answer;
  }

  const revision = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const snap: Snapshot = { generated_at: new Date().toISOString(), revision, answers };
  writeFileSync(outsideRepository(out), JSON.stringify(snap));
  console.log(`${Object.keys(answers).length} answers written to ${resolve(out)}`);
}

function bicOf(a: Answer | undefined): string | null {
  const bic = a?.bic as { code?: string } | null | undefined;
  return bic?.code ?? null;
}

function compare(beforePath: string, afterPath: string, touchedArg: string | undefined): void {
  const before = (JSON.parse(readFileSync(beforePath, 'utf8')) as Snapshot).answers;
  const after = (JSON.parse(readFileSync(afterPath, 'utf8')) as Snapshot).answers;
  const touched = new Set((touchedArg ?? '').split(',').filter(Boolean));
  const rows = new Map<string, Record<string, number>>();
  const bump = (cc: string, col: string) => {
    const row = rows.get(cc) ?? {};
    row[col] = (row[col] ?? 0) + 1;
    rows.set(cc, row);
  };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const cc = key.slice(0, key.indexOf(':'));
    const b = before[key];
    const a = after[key];
    bump(cc, 'codes');
    const bb = bicOf(b);
    const ab = bicOf(a);
    if (bb) bump(cc, 'bic_before');
    if (ab) bump(cc, 'bic_after');
    if (JSON.stringify(b) === JSON.stringify(a)) {
      bump(cc, 'identical');
      continue;
    }
    if (bb && ab) bump(cc, bb === ab ? 'same_bic' : 'other_bic');
    else if (bb) bump(cc, 'bic_lost');
    else if (ab) bump(cc, 'bic_gained');
    else bump(cc, 'no_bic_either');
    const status = (x: Answer | undefined) => {
      const check = x?.bank_code_check as { status?: string; reason?: string } | undefined;
      return `${check?.status ?? '-'}/${check?.reason ?? '-'}`;
    };
    if (status(b) !== status(a)) bump(cc, `verdict ${status(b)} -> ${status(a)}`);
  }

  const columns = [
    'codes',
    'bic_before',
    'bic_after',
    'identical',
    'same_bic',
    'other_bic',
    'bic_lost',
    'bic_gained',
    'no_bic_either',
  ];
  const changed: string[] = [];
  console.log(`| country | ${columns.join(' | ')} |`);
  console.log(`|---|${columns.map(() => '---:').join('|')}|`);
  for (const cc of [...rows.keys()].sort()) {
    const row = rows.get(cc)!;
    if (row.identical !== row.codes) changed.push(cc);
    if (!touched.has(cc) && row.identical === row.codes) continue;
    console.log(`| ${cc} | ${columns.map((c) => row[c] ?? 0).join(' | ')} |`);
  }
  console.log('\nVerdict changes (status/reason, before -> after):');
  for (const cc of [...rows.keys()].sort()) {
    for (const [col, n] of Object.entries(rows.get(cc)!)) {
      if (col.startsWith('verdict ')) console.log(`  ${cc} ${col.slice(8)}: ${n}`);
    }
  }
  const untouched = [...rows.keys()].filter((cc) => !touched.has(cc));
  const strays = changed.filter((cc) => !touched.has(cc));
  const totalUntouched = untouched.reduce((n, cc) => n + (rows.get(cc)!.codes ?? 0), 0);
  console.log(
    `\nUntouched countries: ${untouched.length}, codes replayed: ${totalUntouched}, countries with any change: ${strays.length}${strays.length ? ` (${strays.join(', ')})` : ''}`,
  );
  if (strays.length > 0) process.exitCode = 1;
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'snapshot' && args[0]) {
  await snapshot(args[0], args.slice(1));
} else if (mode === 'compare' && args[0] && args[1]) {
  compare(args[0], args[1], args[2]);
} else {
  console.error(
    'usage: curated-map-replay.ts snapshot <out.json> [keys.json ...] | compare <before.json> <after.json> [CC,CC,...]',
  );
  process.exitCode = 2;
}

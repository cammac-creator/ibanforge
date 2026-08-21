import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

/**
 * The guard that stops a truncated source from being committed.
 *
 * These build small synthetic databases rather than copying the real 33 MB
 * bic.sqlite: what is under test is the decision — which deltas block and which
 * are waved through — and a synthetic pair pins every band exactly, in
 * milliseconds, without depending on whatever the last refresh happened to
 * produce. The thresholds themselves were calibrated on a real month
 * (121,610 -> 121,716 between two crons) before being written into the script.
 *
 * Each case asserts the EXIT CODE, because that is the whole contract the
 * workflow consumes: 0 = commit, non-zero = refuse.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, 'refresh-diff.ts');
const REPO = resolve(__dirname, '..');

let tmp: string;

/** A plausible database: one big source, one small one, and the side tables. */
function build(path: string, opts: {
  gleif?: number;
  swiftcodes?: number;
  ebaStep2?: number;
  chClearing?: number;
  tinyCountryRows?: number;
} = {}): void {
  const {
    gleif = 4000, swiftcodes = 8000, ebaStep2 = 180, chClearing = 1165, tinyCountryRows = 3,
  } = opts;
  rmSync(path, { force: true });
  const db = new Database(path);
  db.exec(`
    CREATE TABLE bic_entries (bic8 TEXT, bic11 TEXT, country_code TEXT, source TEXT, updated_at TEXT);
    CREATE TABLE ch_clearing (iid TEXT);
    CREATE TABLE de_blz (blz TEXT);
    CREATE TABLE national_bank_codes (country TEXT, code TEXT);
  `);
  const ins = db.prepare('INSERT INTO bic_entries VALUES (?, ?, ?, ?, ?)');
  const add = db.transaction((n: number, source: string, cc: string) => {
    for (let i = 0; i < n; i++) ins.run(`AAAA${cc}${i}`, `AAAA${cc}${i}XXX`, cc, source, '2026-08-01');
  });
  add(gleif, 'gleif', 'GB');
  add(swiftcodes, 'swiftcodes', 'IT');
  add(ebaStep2, 'eba_step2', 'FR');
  // A country holding a handful of rows: its disappearance must NOT block, or
  // the guard cries wolf on ordinary churn in the long tail.
  add(tinyCountryRows, 'gleif', 'VA');
  const insCh = db.prepare('INSERT INTO ch_clearing VALUES (?)');
  db.transaction((n: number) => { for (let i = 0; i < n; i++) insCh.run(String(i).padStart(5, '0')); })(chClearing);
  db.close();
}

function run(before: string, after: string): { status: number; out: string } {
  const r = spawnSync('npx', ['tsx', SCRIPT], {
    cwd: REPO,
    env: { ...process.env, BIC_DIFF_BEFORE: before, BIC_DIFF_AFTER: after },
    encoding: 'utf-8',
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('refresh-diff refuses a damaged refresh and passes a normal one', () => {
  beforeAll(() => { tmp = mkdtempSync(resolve(tmpdir(), 'refreshdiff-test-')); });
  afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

  const p = (n: string) => resolve(tmp, `${n}.sqlite`);

  it('passes when nothing changed', () => {
    build(p('a')); build(p('b'));
    const { status, out } = run(p('a'), p('b'));
    expect(out).toContain('Quality diff OK.');
    expect(status).toBe(0);
  });

  it('passes ordinary month-to-month churn', () => {
    build(p('a'), { gleif: 4000, swiftcodes: 8000, ebaStep2: 183 });
    build(p('b'), { gleif: 4030, swiftcodes: 7990, ebaStep2: 180 });
    const { status } = run(p('a'), p('b'));
    expect(status).toBe(0);
  });

  it('BLOCKS a large source truncated to a tenth — the GLEIF failure mode', () => {
    build(p('a'), { gleif: 4000 });
    build(p('b'), { gleif: 400 });
    const { status, out } = run(p('a'), p('b'));
    expect(out).toContain('Refusing to commit');
    expect(out).toContain('source gleif');
    expect(status).toBe(1);
  });

  it('BLOCKS a source that vanishes entirely', () => {
    build(p('a'), { ebaStep2: 183 });
    build(p('b'), { ebaStep2: 0 });
    const { status, out } = run(p('a'), p('b'));
    expect(out).toContain('source eba_step2: 183 -> 0');
    expect(status).toBe(1);
  });

  it('BLOCKS a small source losing more rows than a small source ever loses', () => {
    // Below 200 rows a percentage is noise, so the band is an absolute delta.
    build(p('a'), { ebaStep2: 183 });
    build(p('b'), { ebaStep2: 150 });
    const { status } = run(p('a'), p('b'));
    expect(status).toBe(1);
  });

  it('BLOCKS an emptied side table', () => {
    build(p('a'), { chClearing: 1165 });
    build(p('b'), { chClearing: 0 });
    const { status, out } = run(p('a'), p('b'));
    expect(out).toContain('ch_clearing: 1165 -> 0');
    expect(status).toBe(1);
  });

  it('does NOT block a long-tail country losing its handful of rows', () => {
    build(p('a'), { tinyCountryRows: 3 });
    build(p('b'), { tinyCountryRows: 0 });
    const { status } = run(p('a'), p('b'));
    expect(status).toBe(0);
  });

  it('REFUSES rather than passing when a database cannot be read', () => {
    // A guard that exits 0 because it crashed is worse than no guard: the
    // workflow would read that as a cleared refresh.
    build(p('a'));
    const { status, out } = run(p('a'), resolve(tmp, 'does-not-exist.sqlite'));
    expect(out).toContain('could not run');
    expect(status).toBe(1);
  });
});

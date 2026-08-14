import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * UK modulus checking on the sorting code and account number a GB IBAN carries.
 *
 * WHAT IT ADDS THAT mod97 DOES NOT
 *
 * The ISO 13616 check digits prove the IBAN was transcribed correctly. They say
 * nothing about whether the bank that owns that sorting code could ever have
 * issued that account number — each UK institution applies its own checksum over
 * the pair, and Vocalink publishes the weights. A GB IBAN can be perfectly valid
 * under mod97 and still name an account that cannot exist. This is the second,
 * genuinely independent check, and it is the one gap a competitor named publicly
 * as ours.
 *
 * SCOPE, DELIBERATELY NARROW
 *
 * Checksum only. It does not say the account exists, name its holder, or resolve
 * a bank from a bare sorting code — no more than a mod97 pass proves an IBAN is
 * open. A pass means "possible"; a fail means "impossible".
 *
 * WHERE THE TABLE LIVES AND WHY IT IS NOT HERE
 *
 * Vocalink (Mastercard) publishes the weight table for implementers without
 * granting a written redistribution right. It therefore never enters this public
 * repository nor the published npm package: scripts/seed-uk-modulus.ts fetches it
 * onto the server, and only a computed boolean is ever served. No endpoint, flag
 * or error message returns the weights, the method, or the exception number —
 * serving a boolean is a far weaker claim on their data than serving the table.
 *
 * An absent table degrades to "not supported", the same failure posture de-blz.ts
 * takes for a missing register: a country losing an enrichment, never a throw and
 * never a fabricated verdict.
 */

/** One row of the weight table: a sorting-code range, a method, 14 weights. */
export interface WeightRow {
  start: string;
  end: string;
  algorithm: 'MOD10' | 'MOD11' | 'DBLAL';
  weights: number[];
  exception: number | null;
}

export interface ModulusTable {
  harvested: string;
  source: string;
  rows: WeightRow[];
  /** Exception 5 sorting-code substitutions, from scsubtab.txt. */
  substitutions: Record<string, string>;
}

export interface UkModulusResult {
  /**
   * Whether the published table covers this sorting code at all. Vocalink's own
   * instruction for an uncovered code is to presume the pair valid, so `passed`
   * is null rather than false here: no check was possible, and a false would be
   * read as a failed one.
   */
  checked: boolean;
  passed: boolean | null;
  /** Provenance, so a caller can see the claim is not ours to invent. */
  source: string;
  /** The day the table was harvested, so a stale server is visible. */
  as_of: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_LABEL = 'Vocalink modulus weight table (published for Pay.UK)';

let table: ModulusTable | null = null;
let loadAttempted = false;

function tablePath(): string {
  // dist/lib/uk-modulus.js and src/lib/uk-modulus.ts both sit two levels below
  // the project root, so one relative path serves the built and the dev tree.
  return process.env.UK_MODULUS_PATH ?? resolve(__dirname, '../../data/uk-modulus.json');
}

function load(): ModulusTable | null {
  if (loadAttempted) return table;
  loadAttempted = true;
  try {
    const parsed = JSON.parse(readFileSync(tablePath(), 'utf8')) as ModulusTable;
    table = Array.isArray(parsed.rows) && parsed.rows.length > 0 ? parsed : null;
  } catch {
    table = null;
  }
  return table;
}

/** Whether the check can be offered at all, so callers can decline to claim. */
export function ukModulusAvailable(): boolean {
  return load() !== null;
}

/** Reset cached state (tests, or after a refresh). */
export function resetUkModulus(): void {
  table = null;
  loadAttempted = false;
}

// --------------------------------------------------------------- the algorithm
//
// Positions are named u v w x y z a b c d e f g h in the specification: the six
// sorting-code digits, then the eight account digits a..h. So within the account
// number a is index 0, c is 2, g is 6 and h is 7 — the letters the exceptions are
// written in. Across the full fourteen, b sits at index 7, which is where the
// "zeroise weighting positions u-b" rules stop.
const WEIGHT_B = 7;

function digitSum(n: number): number {
  let total = 0;
  for (const ch of String(Math.abs(n))) total += Number(ch);
  return n < 0 ? -total : total;
}

function weightedTotal(digits: number[], weights: number[], doubleAlternate: boolean): number {
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const product = digits[i] * weights[i];
    // The double alternate check adds the DIGITS of each product (2 x 7 = 14
    // contributes 1 + 4), which is what makes it different from a plain
    // weighted sum and is the step naive implementations skip.
    total += doubleAlternate ? digitSum(product) : product;
  }
  return total;
}

/**
 * Run one row of the table. Returns null when the row cannot decide — today only
 * exception 6, where a foreign-currency account is explicitly not checkable.
 */
function runRow(row: WeightRow, sortCode: string, account: string, subs: Record<string, string>): boolean | null {
  const ex = row.exception;
  const acc = account.split('').map(Number);
  let weights = [...row.weights];
  let effectiveSort = sortCode;

  // Exception 6 — these ranges may hold foreign-currency accounts, which carry
  // no usable checksum. Neither pass nor fail: undecidable.
  if (ex === 6 && acc[0] >= 4 && acc[0] <= 8 && acc[6] === acc[7]) return null;

  // Exception 8 — check against a fixed sorting code instead of the real one.
  if (ex === 8) effectiveSort = '090126';

  // Exception 5 — substitute the sorting code when scsubtab names a replacement.
  if (ex === 5) effectiveSort = subs[sortCode] ?? sortCode;

  // Exception 9 — the Lloyds euro branch. The pair (2, 9) exists because the
  // customer may quote their sterling branch for a euro account.
  if (ex === 9) effectiveSort = '309634';

  // Exception 2 — Lloyds euro accounts replace the published weights, and which
  // replacement depends on the account number itself.
  //
  // Only exception 2, never its partner 9: the published row for the second
  // check already carries the weights belonging to sorting code 309634, so
  // substituting again produces the wrong total. Official vector 20 is the case
  // that distinguishes the two readings, and it only passes this way.
  if (ex === 2) {
    if (acc[0] !== 0 && acc[6] !== 9) weights = [0, 0, 1, 2, 5, 3, 6, 4, 8, 7, 10, 9, 3, 1];
    else if (acc[0] !== 0 && acc[6] === 9) weights = [0, 0, 0, 0, 0, 0, 0, 0, 8, 7, 10, 9, 3, 1];
  }

  // Exception 7 — zeroise u..b when g is 9.
  if (ex === 7 && acc[6] === 9) for (let i = 0; i <= WEIGHT_B; i++) weights[i] = 0;

  // Exception 10 — zeroise u..b when the account opens 09 or 99 and g is 9.
  if (ex === 10 && (acc[0] * 10 + acc[1] === 9 || acc[0] * 10 + acc[1] === 99) && acc[6] === 9) {
    for (let i = 0; i <= WEIGHT_B; i++) weights[i] = 0;
  }

  const digits = (effectiveSort + account).split('').map(Number);
  const doubleAlternate = row.algorithm === 'DBLAL';
  let total = weightedTotal(digits, weights, doubleAlternate);

  // Exception 1 — as if the institution number 580149 preceded the pair.
  if (ex === 1) total += 27;

  // Exception 4 — the remainder must equal the two-digit check digit gh, rather
  // than being zero.
  if (ex === 4) return total % 11 === acc[6] * 10 + acc[7];

  // Exception 5 — the check digit is a single digit taken from the account
  // number, and the pass rule is a comparison rather than a zero remainder.
  if (ex === 5) {
    if (row.algorithm === 'DBLAL') {
      const r = total % 10;
      return r === 0 ? acc[7] === 0 : 10 - r === acc[7];
    }
    const r = total % 11;
    if (r === 1) return false;
    return r === 0 ? acc[6] === 0 : 11 - r === acc[6];
  }

  const modulus = row.algorithm === 'MOD11' ? 11 : 10;
  return total % modulus === 0;
}

/**
 * Exception 14 (Coutts) — when the standard modulus 11 check fails, retry once on
 * a modified account number: drop the eighth digit, which must be 0, 1 or 9, and
 * prepend a zero.
 */
function exception14(row: WeightRow, sortCode: string, account: string): boolean {
  const eighth = Number(account[7]);
  if (eighth !== 0 && eighth !== 1 && eighth !== 9) return false;
  const modified = `0${account.slice(0, 7)}`;
  const digits = (sortCode + modified).split('').map(Number);
  return weightedTotal(digits, row.weights, false) % 11 === 0;
}

/**
 * Check a sorting code and account number against the published table.
 *
 * Both must be exactly six and eight digits: an IBAN always carries them that
 * way, and normalising a short number here would be inventing the customer's
 * account. Returns null when the inputs are not that shape or the table is
 * absent, so a caller never has to distinguish "failed" from "not attempted".
 */
export function checkUkModulus(sortCode: string, accountNumber: string): UkModulusResult | null {
  const t = load();
  if (!t) return null;
  if (!/^\d{6}$/.test(sortCode) || !/^\d{8}$/.test(accountNumber)) return null;

  const rows = t.rows.filter((r) => sortCode >= r.start && sortCode <= r.end);
  const base: Omit<UkModulusResult, 'checked' | 'passed'> = { source: SOURCE_LABEL, as_of: t.harvested };

  // No range covers the code. Vocalink's instruction is to presume the pair
  // valid, so we report that no check was possible rather than inventing one.
  if (rows.length === 0) return { checked: false, passed: null, ...base };

  const first = rows[0];
  const second = rows[1];
  const acc = accountNumber.split('').map(Number);

  // Exception 14 carries its own retry rather than a second table row.
  if (first.exception === 14) {
    const passed = runRow(first, sortCode, accountNumber, t.substitutions);
    if (passed === null) return { checked: false, passed: null, ...base };
    return { checked: true, passed: passed || exception14(first, sortCode, accountNumber), ...base };
  }

  const firstResult = runRow(first, sortCode, accountNumber, t.substitutions);
  if (firstResult === null) return { checked: false, passed: null, ...base };

  // Exception 3 — when c is 6 or 9 the double alternate check is not performed.
  // The table carries the marker on the SECOND row, the double alternate one,
  // not on the standard check that precedes it.
  const skipSecond = second?.exception === 3 && (acc[2] === 6 || acc[2] === 9);
  if (!second || skipSecond) return { checked: true, passed: firstResult, ...base };

  // Pairs where EITHER check passing is enough: (2, 9) Lloyds euro accounts,
  // (10, 11) some Lloyds and TSB accounts, (12, 13). Everywhere else both must
  // pass, which is the default the specification states.
  const eitherPasses =
    (first.exception === 2 && second.exception === 9) ||
    (first.exception === 10 && second.exception === 11) ||
    (first.exception === 12 && second.exception === 13);

  if (eitherPasses && firstResult) return { checked: true, passed: true, ...base };
  if (!eitherPasses && !firstResult) return { checked: true, passed: false, ...base };

  const secondResult = runRow(second, sortCode, accountNumber, t.substitutions);
  if (secondResult === null) return { checked: true, passed: firstResult, ...base };
  return { checked: true, passed: eitherPasses ? firstResult || secondResult : firstResult && secondResult, ...base };
}

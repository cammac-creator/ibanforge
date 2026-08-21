/**
 * Measuring the 30/09 kill-line, against its own wording.
 *
 * ⚠️ THE WORDING THIS IMPLEMENTS IS A PROPOSAL AND HAS NOT BEEN RATIFIED.
 * It is drafted, it is not decided. Nothing here may be reported as "the
 * project passes" or "the project fails" until the owner adopts the criterion.
 * This module exists so the decision is taken against a measurement instead of
 * against a memory, which is the only thing that was missing.
 *
 * Why it exists at all: the previous criterion required "at least one software
 * vendor", and that is an identity, not a behaviour. It sat at zero and could
 * not move, and a criterion nothing can satisfy stops being a decision rule and
 * becomes a way of never deciding. The replacement asks the same question in
 * observable terms: is anyone building our API into a product that serves
 * other people?
 *
 * 🚨 The point of encoding it is that it must NOT be reopened because the
 * answer is unwelcome. Re-reading the rule when you dislike its output is
 * exactly what the rewrite was meant to prevent. This file is the rule; move
 * the date or the thresholds only deliberately, never mid-measurement.
 */
import { getStatsDB } from './db.js';

/** Distinct days with at least one served call. */
export const INTEGRATOR_MIN_ACTIVE_DAYS = 10;
/** Of those, how many must fall inside the recent window: an integration lives. */
export const INTEGRATOR_MIN_RECENT_DAYS = 3;
export const INTEGRATOR_RECENT_WINDOW_DAYS = 14;
/** A pack big enough that burning half of it is a commitment, in minor units. */
export const INTEGRATOR_MIN_PACK_MINOR = 2_000;
/** Two of the three proofs. Never one: one proof is a coincidence. */
export const INTEGRATOR_PROOFS_REQUIRED = 2;

/** Floor (A): paying customers and cumulative revenue, in minor units. */
export const FLOOR_MIN_PAYING = 3;
export const FLOOR_MIN_REVENUE_MINOR = 15_000;

export interface IntegratorProofs {
  /** Served calls spread over enough distinct days, recently enough. */
  sustained_use: boolean;
  /** Paid more than once, or burned more than half of a substantial pack. */
  paid_again: boolean;
  /**
   * Said so in writing, naming their own product as a consumer of the API.
   *
   * ⚠️ `null` and NOT false by default. This one cannot be read from a table:
   * it is a human reading a thread. Returning false would quietly count an
   * unexamined customer as having failed a test nobody ran — the same error as
   * calling an unused key "not leaked".
   */
  said_so: boolean | null;
}

export interface IntegratorCandidate {
  key_prefix: string;
  proofs: IntegratorProofs;
  /** Proofs actually established. `said_so: null` counts as not established. */
  proofs_met: number;
  qualifies: boolean;
  /** Distinct days served, and how many were recent. Shown so a human can check. */
  active_days: number;
  recent_days: number;
  payments: number;
  pack_minor: number | null;
  pack_burned_ratio: number | null;
}

/**
 * Whether one key looks like an integration, from what the tables can see.
 *
 * `saidSo` is passed in, never guessed: the operator supplies it after reading
 * the thread, or leaves it null. A candidate can already qualify on the two
 * measurable proofs alone, which is deliberate — a quiet integrator who pays
 * and calls every day should not need to have written to us.
 */
export function assessIntegrator(keyPrefix: string, saidSo: boolean | null = null): IntegratorCandidate {
  const db = getStatsDB();

  const days = db
    .prepare(
      `SELECT COUNT(DISTINCT date(created_at)) n
         FROM request_log
        WHERE key_prefix = ? AND status < 400`,
    )
    .get(keyPrefix) as { n: number } | undefined;

  const recent = db
    .prepare(
      `SELECT COUNT(DISTINCT date(created_at)) n
         FROM request_log
        WHERE key_prefix = ? AND status < 400
          AND created_at >= datetime('now', ?)`,
    )
    .get(keyPrefix, `-${INTEGRATOR_RECENT_WINDOW_DAYS} days`) as { n: number } | undefined;

  const activeDays = days?.n ?? 0;
  const recentDays = recent?.n ?? 0;

  // Distinct payments carried by this address. A rotated key keeps its address,
  // so counting rows here counts purchases, not key generations.
  const owner = db.prepare('SELECT email FROM api_keys WHERE key_prefix = ?').get(keyPrefix) as
    | { email: string }
    | undefined;

  let payments = 0;
  let packMinor: number | null = null;
  let burned: number | null = null;

  if (owner?.email) {
    const paid = db
      .prepare(
        `SELECT amount_paid_minor, credits_total, credits_remaining
           FROM api_keys
          WHERE email = ?
            AND (stripe_session_id IS NOT NULL OR x402_payment_ref IS NOT NULL OR amount_paid_minor IS NOT NULL)`,
      )
      .all(owner.email) as Array<{
      amount_paid_minor: number | null;
      credits_total: number | null;
      credits_remaining: number | null;
    }>;
    payments = paid.length;

    // The largest substantial pack, and how much of it was actually used.
    for (const row of paid) {
      const amount = row.amount_paid_minor;
      if (amount == null || amount < INTEGRATOR_MIN_PACK_MINOR) continue;
      if (packMinor == null || amount > packMinor) {
        packMinor = amount;
        const total = row.credits_total ?? 0;
        burned = total > 0 ? (total - (row.credits_remaining ?? 0)) / total : null;
      }
    }
  }

  const proofs: IntegratorProofs = {
    sustained_use: activeDays >= INTEGRATOR_MIN_ACTIVE_DAYS && recentDays >= INTEGRATOR_MIN_RECENT_DAYS,
    paid_again: payments >= 2 || (packMinor != null && burned != null && burned > 0.5),
    said_so: saidSo,
  };

  const met = (proofs.sustained_use ? 1 : 0) + (proofs.paid_again ? 1 : 0) + (proofs.said_so === true ? 1 : 0);

  return {
    key_prefix: keyPrefix,
    proofs,
    proofs_met: met,
    qualifies: met >= INTEGRATOR_PROOFS_REQUIRED,
    active_days: activeDays,
    recent_days: recentDays,
    payments,
    pack_minor: packMinor,
    pack_burned_ratio: burned,
  };
}

/**
 * The verdict, as a pure function of three facts.
 *
 * Extracted from the query so it can be checked on all eight combinations
 * rather than through a database that also holds every key ever minted in
 * development. The rule it encodes:
 *
 * - GO only when the floor is met AND someone qualifies as an integrator;
 * - `null` while a candidate sits one UNREAD thread away from qualifying,
 *   because declaring NO-GO then would be a measurement pretending to be a
 *   verdict, and the reading costs one minute;
 * - `false` otherwise — which is a real answer and must be allowed to stand.
 *
 * ⚠️ `awaitingReading` outranks the floor deliberately. A project one email
 * short of its own criterion deserves the email to be read before it is
 * buried, and reading it is cheap. It does NOT soften the criterion: once
 * read, the answer is false again unless the proof is there.
 */
export function decideGo(floorMet: boolean, anyQualifies: boolean, awaitingReading: boolean): boolean | null {
  if (floorMet && anyQualifies) return true;
  if (awaitingReading) return null;
  return false;
}

export interface KillLineState {
  /** ⚠️ Always true here: this criterion is drafted, not ratified. */
  criterion_is_a_proposal: true;
  floor: { paying: number; revenue_minor: number; met: boolean };
  integrators: IntegratorCandidate[];
  /**
   * `null` when the floor is met but no candidate has been examined for the
   * "said so" proof — the answer is genuinely not known yet, and a `false`
   * would read as "we checked and nobody qualifies".
   */
  go: boolean | null;
}

/**
 * Where the kill-line stands right now.
 *
 * `saidSoByPrefix` carries the operator's own reading of the threads. Anything
 * absent from it stays `null`, and a key that qualifies on the two measurable
 * proofs qualifies without it.
 */
export function killLineState(saidSoByPrefix: Record<string, boolean> = {}): KillLineState {
  const db = getStatsDB();

  const paying = db
    .prepare(
      `SELECT COUNT(DISTINCT email) n, COALESCE(SUM(amount_paid_minor), 0) revenue
         FROM api_keys
        WHERE amount_paid_minor IS NOT NULL AND amount_paid_minor > 0
          AND COALESCE(no_recredit, 0) = 0`,
    )
    .get() as { n: number; revenue: number } | undefined;

  const payingCount = paying?.n ?? 0;
  const revenue = paying?.revenue ?? 0;
  const floorMet = payingCount >= FLOOR_MIN_PAYING && revenue >= FLOOR_MIN_REVENUE_MINOR;

  // Only paying keys are candidates: the criterion asks for a customer.
  const candidates = db
    .prepare(
      `SELECT key_prefix FROM api_keys
        WHERE amount_paid_minor IS NOT NULL AND amount_paid_minor > 0
          AND COALESCE(no_recredit, 0) = 0`,
    )
    .all() as Array<{ key_prefix: string }>;

  const integrators = candidates.map((c) => assessIntegrator(c.key_prefix, saidSoByPrefix[c.key_prefix] ?? null));
  const anyQualifies = integrators.some((i) => i.qualifies);

  /**
   * A candidate one proof short, whose third proof nobody has read yet. It is
   * the whole reason `go` can be null: declaring NO-GO while someone sits one
   * unread email thread away from qualifying would be a measurement pretending
   * to be a verdict.
   */
  const awaitingReading = integrators.some(
    (i) => !i.qualifies && i.proofs_met === INTEGRATOR_PROOFS_REQUIRED - 1 && i.proofs.said_so === null,
  );

  return {
    criterion_is_a_proposal: true,
    floor: { paying: payingCount, revenue_minor: revenue, met: floorMet },
    integrators,
    go: decideGo(floorMet, anyQualifies, awaitingReading),
  };
}

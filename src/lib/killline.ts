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
import { isInternal } from './lifecycle-radar.js';
import { accountUsd } from './business-summary.js';

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
 * Whether ONE KEY looks like an integration, from what the tables can see.
 *
 * `saidSo` is passed in, never guessed: the operator supplies it after reading
 * the thread, or leaves it null. A candidate can already qualify on the two
 * measurable proofs alone, which is deliberate — a quiet integrator who pays
 * and calls every day should not need to have written to us.
 *
 * ⚠️ This is the SINGLE-KEY view, for inspecting one key on its own. The
 * kill-line itself is decided per CUSTOMER by `killLineState`, and the two
 * legitimately disagree for a customer holding several keys: ten active days
 * split across two keys is one qualifying customer here and two non-qualifying
 * keys there. When they differ, `killLineState` is the criterion — this
 * function answers a narrower question and must not be used to decide.
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
  floor: {
    paying: number;
    revenue_minor: number;
    met: boolean;
    /**
     * True when at least one amount was inferred from the pack price rather
     * than read from a stored charge. The figure is then an estimate, and a
     * criterion decided on an estimate must say so.
     */
    revenue_partly_deduced: boolean;
  };
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

  /**
   * What counts as a purchase, measured against what production actually holds.
   *
   * 🚨 The first version of this filtered on `amount_paid_minor > 0` and
   * reported ZERO paying customers against a floor of three. That column is
   * recent: every purchase made before it existed has it NULL, which is most of
   * them. An instrument that answers "nobody has ever paid you" is worse than
   * no instrument, because it reads like a verdict.
   *
   * So the marker is any evidence of a purchase, and the amount comes from
   * `accountUsd`, which prefers a stored figure and falls back to the pack
   * price while saying that it did.
   */
  const rows = db
    .prepare(
      `SELECT key_prefix, email, credits_total, credits_remaining,
              amount_paid_minor, amount_paid_currency
         FROM api_keys
        WHERE COALESCE(no_recredit, 0) = 0
          AND (
            COALESCE(credits_total, 0) > 0
            OR stripe_session_id IS NOT NULL
            OR stripe_subscription_id IS NOT NULL
            OR x402_payment_ref IS NOT NULL
            OR (amount_paid_minor IS NOT NULL AND amount_paid_minor > 0)
          )`,
    )
    .all() as Array<{
    key_prefix: string;
    email: string;
    credits_total: number | null;
    credits_remaining: number | null;
    amount_paid_minor: number | null;
    amount_paid_currency: string | null;
  }>;

  // ⚠️ Our own accounts hold paid keys too: pilot keys, the operator's own
  // address, example.com fixtures. Counting them towards a survival criterion
  // would let the project pass its own test on its own money.
  const external = rows.filter((r) => !isInternal(r.email));

  const owners = new Set(external.map((r) => r.email.trim().toLowerCase()));
  const payingCount = owners.size;

  let revenueUsd = 0;
  let anyDeduced = false;
  for (const r of external) {
    const a = accountUsd(r);
    revenueUsd += a.usd;
    if (a.source === 'deduced') anyDeduced = true;
  }
  const revenue = Math.round(revenueUsd * 100);
  const floorMet = payingCount >= FLOOR_MIN_PAYING && revenue >= FLOOR_MIN_REVENUE_MINOR;


  /**
   * One candidate per CUSTOMER, not per key.
   *
   * 🚨 The first version built one candidate per key and produced thousands of
   * them for three customers, at three seconds a call. Both halves of that were
   * wrong. A customer who rotated their key held several, and evaluating each
   * separately split their history: ten days of use across two keys became two
   * candidates of five, and neither reached the bar. The criterion asks for a
   * customer who integrated, so the customer is the unit.
   *
   * Distinct active days are therefore counted across all of that customer's
   * keys at once, in one grouped pass rather than four queries per candidate.
   */
  const activeByOwner = new Map<string, number>();
  for (const row of db
    .prepare(
      `SELECT k.email AS email, COUNT(DISTINCT date(r.created_at)) n
         FROM request_log r JOIN api_keys k ON k.key_prefix = r.key_prefix
        WHERE r.status < 400
        GROUP BY k.email`,
    )
    .all() as Array<{ email: string; n: number }>) {
    activeByOwner.set((row.email ?? '').trim().toLowerCase(), row.n);
  }

  const recentByOwner = new Map<string, number>();
  for (const row of db
    .prepare(
      `SELECT k.email AS email, COUNT(DISTINCT date(r.created_at)) n
         FROM request_log r JOIN api_keys k ON k.key_prefix = r.key_prefix
        WHERE r.status < 400 AND r.created_at >= datetime('now', ?)
        GROUP BY k.email`,
    )
    .all(`-${INTEGRATOR_RECENT_WINDOW_DAYS} days`) as Array<{ email: string; n: number }>) {
    recentByOwner.set((row.email ?? '').trim().toLowerCase(), row.n);
  }

  const byOwner = new Map<string, typeof external>();
  for (const r of external) {
    const owner = r.email.trim().toLowerCase();
    const list = byOwner.get(owner) ?? [];
    list.push(r);
    byOwner.set(owner, list);
  }

  const integrators: IntegratorCandidate[] = [...byOwner.entries()].map(([owner, owned]) => {
    const activeDays = activeByOwner.get(owner) ?? 0;
    const recentDays = recentByOwner.get(owner) ?? 0;

    let packMinor: number | null = null;
    let burned: number | null = null;
    for (const o of owned) {
      const minor = Math.round(accountUsd(o).usd * 100);
      if (minor < INTEGRATOR_MIN_PACK_MINOR) continue;
      if (packMinor == null || minor > packMinor) {
        packMinor = minor;
        const total = o.credits_total ?? 0;
        burned = total > 0 ? (total - (o.credits_remaining ?? 0)) / total : null;
      }
    }

    // The customer is named by the prefix the operator would recognise: the
    // one they hold now, which is the most recent.
    const shown = owned[owned.length - 1].key_prefix;
    const saidSo = owned.map((o) => saidSoByPrefix[o.key_prefix]).find((v) => v !== undefined) ?? null;

    const proofs: IntegratorProofs = {
      sustained_use: activeDays >= INTEGRATOR_MIN_ACTIVE_DAYS && recentDays >= INTEGRATOR_MIN_RECENT_DAYS,
      paid_again: owned.length >= 2 || (packMinor != null && burned != null && burned > 0.5),
      said_so: saidSo,
    };
    const met = (proofs.sustained_use ? 1 : 0) + (proofs.paid_again ? 1 : 0) + (proofs.said_so === true ? 1 : 0);

    return {
      key_prefix: shown,
      proofs,
      proofs_met: met,
      qualifies: met >= INTEGRATOR_PROOFS_REQUIRED,
      active_days: activeDays,
      recent_days: recentDays,
      payments: owned.length,
      pack_minor: packMinor,
      pack_burned_ratio: burned,
    };
  });

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
    floor: {
      paying: payingCount,
      revenue_minor: revenue,
      met: floorMet,
      revenue_partly_deduced: anyDeduced,
    },
    integrators,
    go: decideGo(floorMet, anyQualifies, awaitingReading),
  };
}

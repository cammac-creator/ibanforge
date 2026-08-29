/**
 * The first-call machine, decision half.
 *
 * A key created at least 48 h ago that has never made a call gets exactly one
 * message, ever, carrying the 30-second path.
 *
 * Everything here is pure: windows, exclusions, predicates, selection. The
 * database, the mail relay and the cadence live in
 * ./activation-nudge-server.ts, the same split the cohort and lifecycle radars
 * already use.
 */
import { isInternalEmail } from './internal-accounts.js';

// ---------------------------------------------------------------------------
// Windows and ceilings
// ---------------------------------------------------------------------------

/** Below this age the reader may simply not have got to it yet. */
export const NUDGE_MIN_AGE_HOURS = 48;

/**
 * Above this age the message becomes untrue in tone. "Your key has not made its
 * first call yet, here is the 30-second path" written to someone who signed up
 * five months ago is not a nudge, it is a reproach about a decision they made
 * long ago. The bound is about honesty first, deliverability second.
 */
export const NUDGE_MAX_AGE_DAYS = 30;

/**
 * Ceiling per pass. The very first run after deploy faces the whole backlog of
 * never-called keys at once; a hundred identical messages leaving one mailbox
 * in one minute is how a domain earns its spam reputation. The backlog drains
 * over a few days instead, newest first, where the message is truest.
 */
export const NUDGE_MAX_PER_PASS = 25;

// ---------------------------------------------------------------------------
// Exclusions
// ---------------------------------------------------------------------------

/**
 * Wider than isInternalEmail(), and deliberately so.
 *
 * The shared filter matches anchored shapes (`test-`, `-test`, `@test.`,
 * `-probe@`, `smoke`, `audit`). Outbound needs the blunt version: any address
 * carrying `test`, `probe` or `smoke` anywhere, plus the `-pilot@` convention
 * used for pilot accounts (there is no `issued_by_us` column to read).
 *
 * The asymmetry is on purpose. Excluding someone by mistake costs one useful
 * message never sent. Including a probe by mistake costs credibility, in the
 * one channel where credibility is the entire product. When in doubt, stay
 * silent.
 */
const OUTBOUND_EXCLUDED_RE = /(test|probe|smoke|-pilot@)/i;

export function isExcludedFromOutreach(email: string | null | undefined): boolean {
  if (!email || !email.includes('@')) return true;
  if (isInternalEmail(email)) return true;
  return OUTBOUND_EXCLUDED_RE.test(email.toLowerCase());
}

// ---------------------------------------------------------------------------
// Candidate selection
// ---------------------------------------------------------------------------

/** One key, with everything needed to decide whether it ever made a call. */
export interface NudgeCandidateRow {
  key_prefix: string;
  email: string;
  created_at: string;
  /** SUM(api_usage.count) for this key. The monthly-quota ledger. */
  usage_units: number;
  /** credits_total - credits_remaining. The prepaid ledger. */
  credits_used: number;
  /** Rows in request_log for this prefix, whatever their status. */
  logged_calls: number;
}

/**
 * "Never called" is three silences at once, and the third is stricter than the
 * brief asked for.
 *
 * used_all_time reads the two billing ledgers, which both stay at zero for a
 * caller whose every request answered 400 or 402. That person HAS called, has
 * probably struggled, and telling them they never tried would be false and
 * insulting. request_log carries a row per authenticated call whatever the
 * status, so it is the honest third condition.
 */
export function neverCalled(row: NudgeCandidateRow): boolean {
  return row.usage_units <= 0 && row.credits_used <= 0 && row.logged_calls <= 0;
}

/**
 * Picks the keys to nudge from an already age-bounded and already
 * never-nudged-before set.
 *
 * Newest first, one per address, capped. The per-address collapse is the rule
 * the database index cannot express: three unused keys behind one mailbox are
 * one person and get one message.
 */
export function selectNudgeCandidates(
  rows: NudgeCandidateRow[],
  limit: number = NUDGE_MAX_PER_PASS,
): NudgeCandidateRow[] {
  const seen = new Set<string>();
  const out: NudgeCandidateRow[] = [];
  for (const row of [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))) {
    if (out.length >= limit) break;
    const email = row.email.trim().toLowerCase();
    if (seen.has(email)) continue;
    if (isExcludedFromOutreach(email)) continue;
    if (!neverCalled(row)) continue;
    seen.add(email);
    out.push(row);
  }
  return out;
}

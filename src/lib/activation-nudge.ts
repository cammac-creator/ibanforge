/**
 * The first-call machine, decision half.
 *
 * Two things happen once a day, and only one of them ever leaves on its own:
 *
 *   1. NUDGE (automatic). A key created at least 48 h ago that has never made a
 *      call gets exactly one message, ever, carrying the 30-second path.
 *   2. FOUNDER DRAFT (never sent alone). A key created in the last day or two
 *      gets a CRM draft written in the founder's voice, waiting in the
 *      dashboard for Claude-Alain to read, edit and send by hand.
 *
 * Everything here is pure: predicates, selection, draft composition, draft id.
 * The database, the mail relay and the cadence live in
 * ./activation-nudge-server.ts, the same split the cohort and lifecycle radars
 * already use.
 */
import { createHash } from 'node:crypto';
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

/** How far back the founder draft looks. Wider than a day so a missed pass (redeploy, restart) still catches its keys; the "no existing thread" guard is what makes it idempotent, not the window. */
export const DRAFT_LOOKBACK_HOURS = 48;

/** Ceiling per pass, same reasoning as the nudge: drafts are cheap, but a hundred of them at once turns the CRM into a queue nobody reads. */
export const DRAFT_MAX_PER_PASS = 25;

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

// ---------------------------------------------------------------------------
// The founder draft
// ---------------------------------------------------------------------------

/**
 * Same id the CRM uses for its own drafts (frontend/app/api/crm/draft-message):
 * one draft per address, so nothing ever piles up. Reproduced here rather than
 * imported because the frontend is a separate build; the two must stay in step.
 */
export function draftId(email: string): string {
  return `draft-${createHash('md5').update(email.trim().toLowerCase()).digest('hex')}`;
}

export interface FounderDraft {
  subject: string;
  body: string;
}

/**
 * The founder's own note, one day in. It is the message with by far the best
 * answer rate, and the point of this pass is to make it systematic without
 * making it automatic: what is created here is a DRAFT, and nothing in this
 * codebase can send it.
 *
 * Two questions, one of which ("how did you find us") is the acquisition
 * question that was until now asked by hand or not at all. Short, no product
 * pitch, no link farm: the reply is the goal, not the click.
 */
export function buildFounderDraft(): FounderDraft {
  const body =
    `Hello,\n\n` +
    `I am Claude-Alain Martin, I build IBANforge. You created an API key yesterday,\n` +
    `so this is a note from a person and not from a sequence.\n\n` +
    `Two questions, and a one-line answer to either is genuinely useful to me:\n\n` +
    `  1. What are you trying to do with it?\n` +
    `  2. How did you find us?\n\n` +
    `And an offer: if the first integration is fiddly, send me the call you are\n` +
    `making and I will tell you what comes back and why. I read every reply myself.\n\n` +
    `Claude-Alain Martin\n` +
    `IBANforge`;
  return { subject: 'Two questions about your IBANforge key', body };
}

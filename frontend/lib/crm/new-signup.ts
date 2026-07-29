/**
 * A key minted recently enough that its owner is still a new customer.
 *
 * ## What this fixes
 *
 * buildContacts hid any client key that had never been used and carried no mail
 * thread, under the rule "hide keys that never did anything". For a dead key
 * from May that is right. For someone who signed up this morning it is exactly
 * backwards: a fresh signup has no calls and no thread BY DEFINITION, so the
 * single most valuable row in the CRM was the one row guaranteed to be missing.
 * Nineteen customers were invisible on 29/07/2026, one of them from a cluster
 * being actively worked.
 *
 * ## Why a window rather than showing them all
 *
 * Lifting the rule outright would surface every never-used key back to May and
 * bury the new arrivals under the dead ones, which is the same problem inverted.
 * Fourteen days is long enough that a weekly look still catches everyone and
 * short enough that the list stays a list of people worth writing to.
 *
 * ## Why a string and an explicit `now`
 *
 * The caller is a Server Component and the chip that reads the result is a
 * Client Component. Deriving "recent" on both sides would let the two renders
 * disagree, exactly as situation.ts warns for its own dates, so the answer is
 * computed once against one clock and travels as a boolean.
 */

/** How long a signup stays new. */
export const NEW_SIGNUP_DAYS = 14;

const DAY_MS = 86_400_000;

/**
 * Parse the two shapes the keys endpoint really returns: 'YYYY-MM-DD HH:MM:SS'
 * for rows written by the API, a full ISO string for rows written elsewhere.
 * The space form is not ISO, so it is normalised rather than trusted to Date.
 */
function parseCreated(raw: string | null | undefined): Date | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const normalized = raw.includes('T') ? raw : raw.trim().replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function signedUpRecently(createdAt: string | null | undefined, now: Date): boolean {
  const at = parseCreated(createdAt);
  if (!at) return false;
  const age = now.getTime() - at.getTime();
  // A future date is clock skew, not a new customer. Announcing it would put a
  // permanent badge on the row the operator trusts most.
  if (age < 0) return false;
  return age <= NEW_SIGNUP_DAYS * DAY_MS;
}

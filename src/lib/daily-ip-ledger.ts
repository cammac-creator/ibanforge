/**
 * The counter behind every free allowance that is measured per address and per
 * day: the MCP tool calls, the MCP session openings, and the keyless REST trial
 * on POST /v1/iban/validate.
 *
 * Extracted from src/routes/mcp-http.ts on 2026-09-06, unchanged in behaviour.
 * The REST trial needed exactly the same bookkeeping, and the alternative was a
 * second Map with a second sweep and a second off-by-one to get wrong — the two
 * would have drifted the first time one of them learned about month boundaries.
 *
 * 🚨 It lives in memory, per instance. Two containers behind a load balancer
 * hand out two allowances, and a redeploy forgets everything. That is the same
 * limit the MCP allowance has always carried and it is documented wherever the
 * allowance is announced: the ceiling is a taster's brake, not a security
 * boundary. The security boundaries are the paywall and the API key.
 *
 * Every caller passes a NAMESPACED key (`rest:<ip>`, `init:<ip>`, a bare `<ip>`
 * for MCP tool calls) so three allowances share one Map without sharing one
 * budget.
 */

/** `count` is units spent today; `date` is the UTC day it was spent on. */
const counts = new Map<string, { count: number; date: string }>();

/** The UTC calendar day, which is the unit every allowance here resets on. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface DailyCount {
  /** False once the day's spend has passed the ceiling. */
  allowed: boolean;
  /** Units spent today INCLUDING this call — it keeps growing past the limit. */
  used: number;
  remaining: number;
}

/**
 * Spend `units` against `key`'s daily allowance and say whether it fits.
 *
 * The spend happens even when it does not fit, on purpose: a refused caller
 * that kept its slot back would be free to retry the cheap request forever,
 * and `used` is what the refusal message quotes. This is the exact shape
 * `checkMcpRateLimit` had before the extraction — the MCP tests pin it.
 */
export function countDailyUnits(key: string, units = 1, limit = 10): DailyCount {
  const day = today();
  const entry = counts.get(key);
  if (!entry || entry.date !== day) {
    counts.set(key, { count: units, date: day });
    return { allowed: units <= limit, used: units, remaining: Math.max(0, limit - units) };
  }
  entry.count += units;
  const allowed = entry.count <= limit;
  return { allowed, used: entry.count, remaining: Math.max(0, limit - entry.count) };
}

/**
 * Hand a slot back, for the reason `api-key.ts` refunds a quota slot on a 4xx:
 * an allowance the caller never got an answer out of is an allowance nobody
 * spent. Floors at zero and never resurrects yesterday's entry — a refund that
 * lands after midnight belongs to nobody.
 */
export function refundDailyUnits(key: string, units = 1): void {
  const entry = counts.get(key);
  if (!entry || entry.date !== today()) return;
  entry.count = Math.max(0, entry.count - units);
}

/** Drop yesterday's rows. Called from the callers' own sweep tick. */
export function sweepDailyLedger(): void {
  const day = today();
  for (const [key, val] of counts) {
    if (val.date !== day) counts.delete(key);
  }
}

/**
 * Test seam. The Map is module-level and shared by two suites; without this,
 * whichever ran second would inherit the other's spend.
 *
 * ⚠️ It clears ALL THREE namespaces, not the caller's own: a test that resets
 * the REST trial also resets the MCP tool calls and the session openings of
 * whatever else runs in that worker. Harmless today (no MCP test asserts a
 * count accumulated across cases), and worth knowing before one does.
 */
export function resetDailyLedger(): void {
  counts.clear();
}

// The sweep the MCP route used to run inside its own tick. Kept here so the
// ledger owns the lifetime of its own rows; mcp-http keeps its interval for
// the session store, whose lifetime is unrelated and must not be tied to this.
setInterval(sweepDailyLedger, 10 * 60 * 1000).unref();

/**
 * The self-service report behind a customer's own API key.
 *
 * Until now a key holder could read four numbers from `/v1/keys/usage` — used,
 * limit, remaining, month — and nothing else. Everything that would let them
 * answer "why did that call fail" lived in the operator's dashboard, reachable
 * only with ADMIN_SECRET. So the only way for a customer to understand their
 * own traffic was to write to us, and most of them simply did not write.
 *
 * The auth here is the key itself: hold it, read your own figures. Nothing in
 * this module may return a row belonging to another key — every query is
 * filtered on `key_prefix` and the prefix is derived from the presented key,
 * never taken from the request.
 */
import { getStatsDB } from './db.js';

/** Distinct networks a key was called from, and how that reads. */
export interface KeyFootprint {
  distinct_networks: number;
  /**
   * `null`, never `false`, when there is nothing to judge on: a key with no
   * calls has not "passed" a leak check, it simply has no history. Saying
   * "unusual: no" to someone whose key leaked yesterday would be worse than
   * saying nothing.
   */
  unusual: boolean | null;
}

export interface KeyErrorGroup {
  path: string;
  status: number;
  count: number;
  /**
   * Plain-language cause, written for the customer, not for us. In English:
   * the site speaks three languages but the API is one product surface, and
   * our paying customers are Finnish, Spanish and German before they are
   * French. A message a customer cannot read is a message we did not send.
   */
  meaning: string;
  /** What to do about it. Empty when we genuinely do not know. */
  fix: string;
}

export interface KeyReport {
  window_days: number;
  total: number;
  ok: number;
  failed: number;
  avg_ms: number | null;
  first_seen: string | null;
  last_seen: string | null;
  days: Array<{ day: string; count: number; failed: number }>;
  endpoints: Array<{ path: string; count: number }>;
  errors: KeyErrorGroup[];
  footprint: KeyFootprint;
}

/**
 * Above this many distinct networks in the window, a key is worth a second
 * look. Chosen from what a normal integration looks like: one server, a laptop,
 * a CI runner, a staging box — four is comfortable, and a key seen from more
 * than eight networks is either a widely deployed client or a key that got out.
 *
 * ⚠️ Deliberately a HINT and nothing else. The key farms of 19/08 rotated
 * addresses freely, so a low count proves nothing, and a legitimate customer
 * behind a mobile network can produce a high one. It is never used to refuse,
 * throttle or bill — only to be shown to the person who can recognise their
 * own infrastructure.
 */
export const UNUSUAL_NETWORK_COUNT = 8;

/**
 * Turn a status code on a path into something a customer can act on.
 *
 * A bare "400 × 312" tells the customer they have a problem and not what it
 * is. The four codes below are the ones a key holder actually meets; anything
 * else falls through to a truthful non-answer rather than an invented cause.
 */
export function explainStatus(status: number, path: string): { meaning: string; fix: string } {
  if (status === 400) {
    return {
      meaning: 'Rejected before processing: an IBAN or a parameter was not in the expected shape.',
      fix: 'The response body names the offending field. These calls are not charged against your quota.',
    };
  }
  if (status === 401) {
    return {
      meaning: 'Key missing, revoked, or sent in a way we could not read.',
      fix: 'The key travels in a header: Authorization: Bearer ifk_…',
    };
  }
  if (status === 402) {
    return {
      meaning: 'The call reached a priced endpoint with no payment attached.',
      fix: 'A key with quota, or an x402 settlement, opens this path.',
    };
  }
  if (status === 429) {
    return {
      meaning: 'Monthly quota exhausted, or too many requests in a burst.',
      fix: 'The RateLimit-Reset header gives the delay before the window reopens.',
    };
  }
  if (status === 404) {
    return {
      meaning: `Nothing matched what was asked for on ${path}.`,
      fix: 'An empty result is not an outage: the code looked up may simply not exist.',
    };
  }
  if (status >= 500) {
    return {
      meaning: 'This failure is ours, not your call.',
      fix: 'These are safe to replay. If it persists, write to us with the date and the path.',
    };
  }
  return { meaning: `Status ${status} on ${path}.`, fix: '' };
}

/**
 * Everything a key holder may know about their own traffic.
 *
 * `days` is returned sparse (only the days with calls). Filling the gaps is the
 * caller's job — the browser knows the reader's timezone and the server does
 * not, and a zero-filled axis built on the wrong day boundary is worse than no
 * axis at all.
 */
export function getKeyReport(keyPrefix: string, windowDays = 30): KeyReport {
  const db = getStatsDB();
  const since = `-${windowDays} days`;

  const totals = db
    .prepare(
      `SELECT COUNT(*) total,
              SUM(CASE WHEN status < 400 THEN 1 ELSE 0 END) ok,
              AVG(response_ms) avg_ms,
              MIN(created_at) first_seen,
              MAX(created_at) last_seen
         FROM request_log
        WHERE key_prefix = ? AND created_at >= datetime('now', ?)`,
    )
    .get(keyPrefix, since) as {
    total: number;
    ok: number | null;
    avg_ms: number | null;
    first_seen: string | null;
    last_seen: string | null;
  };

  const total = totals.total ?? 0;
  const ok = totals.ok ?? 0;

  const days = db
    .prepare(
      `SELECT date(created_at) day,
              COUNT(*) count,
              SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) failed
         FROM request_log
        WHERE key_prefix = ? AND created_at >= datetime('now', ?)
        GROUP BY date(created_at) ORDER BY day ASC`,
    )
    .all(keyPrefix, since) as Array<{ day: string; count: number; failed: number }>;

  const endpoints = db
    .prepare(
      `SELECT path, COUNT(*) count FROM request_log
        WHERE key_prefix = ? AND created_at >= datetime('now', ?)
        GROUP BY path ORDER BY count DESC LIMIT 10`,
    )
    .all(keyPrefix, since) as Array<{ path: string; count: number }>;

  const errorRows = db
    .prepare(
      `SELECT path, status, COUNT(*) count FROM request_log
        WHERE key_prefix = ? AND status >= 400 AND created_at >= datetime('now', ?)
        GROUP BY path, status ORDER BY count DESC LIMIT 10`,
    )
    .all(keyPrefix, since) as Array<{ path: string; status: number; count: number }>;

  const networks = db
    .prepare(
      `SELECT COUNT(DISTINCT ip_hash) n FROM request_log
        WHERE key_prefix = ? AND ip_hash IS NOT NULL AND created_at >= datetime('now', ?)`,
    )
    .get(keyPrefix, since) as { n: number };

  const distinct = networks?.n ?? 0;

  return {
    window_days: windowDays,
    total,
    ok,
    failed: total - ok,
    avg_ms: totals.avg_ms != null ? Math.round(totals.avg_ms) : null,
    first_seen: totals.first_seen,
    last_seen: totals.last_seen,
    days,
    endpoints,
    errors: errorRows.map((r) => ({ ...r, ...explainStatus(r.status, r.path) })),
    footprint: {
      distinct_networks: distinct,
      // No traffic means no judgement, not a clean bill of health.
      unusual: total === 0 ? null : distinct > UNUSUAL_NETWORK_COUNT,
    },
  };
}

/**
 * "Never expect an answer from this correspondent" — the standing rule behind
 * the per-message « Rien à répondre » gesture.
 *
 * One gesture marks one message; this list is what makes the SAME judgement
 * apply to that correspondent's future inbound mail, so a ticket robot or an
 * acknowledgement address stops asking for a click every week.
 *
 * 🚨 Whole addresses, lowercased, never fragments — the rule the whole module
 * is built around. src/lib/internal-accounts.ts documents what fragment
 * matching costs: a pattern short enough to be convenient swallowed entire
 * customer domains there, and the mislabelling went unnoticed for weeks. The
 * same slip here would bury an authority's mail on arrival, and the symptom of
 * that failure is silence, which nobody reports.
 *
 * A separate module rather than inline SQL in the route because the ingester
 * and the two admin endpoints must read the exact same list, the same way: one
 * definition, like email-aliases.ts next door.
 */
import { getStatsDB } from './db.js';

/** Normalised as stored and as compared. The single place that decides it. */
export function normalizeSenderAddress(raw: string): string {
  return raw.trim().toLowerCase();
}

export function listNoReplySenders(): Array<{ address: string; created_at: string }> {
  return getStatsDB()
    .prepare('SELECT address, created_at FROM no_reply_senders ORDER BY created_at DESC')
    .all() as Array<{ address: string; created_at: string }>;
}

/**
 * The set the ingester matches against — read once per batch, like the alias
 * map, because the alternative is one query per message on a full mailbox sync.
 */
export function loadNoReplySenders(): Set<string> {
  return new Set(listNoReplySenders().map((r) => r.address));
}

/**
 * Add or remove one address. Idempotent in both directions: the UI can only
 * offer a checkbox, and a checkbox re-sent is not an error worth a 4xx.
 */
export function setNoReplySender(rawAddress: string, value: boolean): void {
  const address = normalizeSenderAddress(rawAddress);
  const db = getStatsDB();
  if (value) {
    db.prepare('INSERT INTO no_reply_senders (address) VALUES (?) ON CONFLICT(address) DO NOTHING').run(address);
  } else {
    db.prepare('DELETE FROM no_reply_senders WHERE address = ?').run(address);
  }
}

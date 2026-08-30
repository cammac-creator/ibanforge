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

/**
 * Addresses a standing rule may be set on: the ones that are never a person.
 *
 * Mirrors ROBOT_SENDER in frontend/lib/crm/automated.ts, duplicated for the
 * same reason INTERNAL_EMAIL_RE mirrors the CRM's own pattern — the two sides
 * cannot import each other — so keep them in step.
 *
 * ## Why the rule is refused on anything else
 *
 * A standing rule marks mail that has not been written yet, sight unseen. The
 * 30/08/2026 adversarial review built the case on a live database: a rule
 * accepted on an ordinary human correspondent stamped his NEXT message — a
 * real "production returns 500, help" — as needing no answer, which took the
 * thread out of « À répondre » and out of « Relances », with nothing left to
 * bring it back. That is the defect automated.ts records as having ALREADY
 * happened on this mailbox once ("filtering by sender would have thrown away
 * the human reply"), and a persistent stamp is its worse form.
 *
 * Narrowing to addresses that are robots BY SHAPE closes it at the door
 * instead of guarding every consumer: a desk address a human might one day
 * answer from can still be marked message by message, which is the gesture
 * this whole feature is about.
 */
const ROBOT_SENDER =
  /^(no-?reply|do-?not-?reply|noreply|mailer-daemon|postmaster|bounces?|notifications?|automated)[@+]/i;

export function isRuleEligibleSender(rawAddress: string): boolean {
  const address = normalizeSenderAddress(rawAddress);
  // An address without a mailbox part is not an address, and a fragment must
  // never reach the store: see the file note.
  if (!address.includes('@') || address.startsWith('@')) return false;
  return ROBOT_SENDER.test(address);
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

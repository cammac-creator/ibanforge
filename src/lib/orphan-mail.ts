import { getStatsDB } from './db.js';

/**
 * Mail that reached us about IBANforge from an address the CRM cannot attach to
 * anyone.
 *
 * WHY THIS EXISTS
 *
 * The sync builds a list of known addresses — API-key holders and prospects —
 * and asks the mail database for their threads. Anything from an address not on
 * that list is dropped, silently and by design. It worked until a paying
 * customer answered from his personal Gmail instead of the address his key is
 * registered under: the reply landed in the inbox, never reached the CRM, and
 * nothing anywhere said a message had been set aside.
 *
 * A message attached to nobody must be VISIBLE, not invisible. That is the same
 * rule the false "never contacted" taught us: a query returning zero rows is not
 * evidence that nothing happened.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not guess. Attaching the Gmail to the customer is a human decision —
 * this only makes the decision possible by putting the message where it will be
 * seen.
 */

/** How a message earned its place in the queue. Ordered by how likely it is human. */
export type OrphanKind = 'reply' | 'first_contact';

export interface OrphanMail {
  /** Stable hash of the source message, so a re-run corrects instead of duplicating. */
  id: string;
  sender: string;
  subject: string | null;
  snippet: string | null;
  msg_date: string;
  kind: OrphanKind;
  /** Set once the operator has dealt with it, so the queue can empty. */
  resolved: 0 | 1;
  /** Which customer it was attached to, when it was. */
  resolved_as: string | null;
}

export function isOrphanKind(v: unknown): v is OrphanKind {
  return v === 'reply' || v === 'first_contact';
}

export interface OrphanInput {
  id: string;
  sender: string;
  subject?: string | null;
  snippet?: string | null;
  msg_date: string;
  kind: OrphanKind;
}

/**
 * Record one unattachable message. Idempotent by message id: the sync re-sends
 * the same window every day, and a queue that grew a duplicate per run would be
 * abandoned within a week.
 *
 * A row already marked resolved stays resolved — re-seeing a message is not a
 * reason to re-open a decision that was made.
 */
export function recordOrphan(input: OrphanInput): void {
  getStatsDB()
    .prepare(
      `INSERT INTO orphan_mail (id, sender, subject, snippet, msg_date, kind)
       VALUES (@id, @sender, @subject, @snippet, @msg_date, @kind)
       ON CONFLICT(id) DO UPDATE SET
         sender = excluded.sender,
         subject = excluded.subject,
         snippet = excluded.snippet,
         msg_date = excluded.msg_date,
         kind = excluded.kind`,
    )
    .run({
      id: input.id,
      sender: input.sender.trim().toLowerCase(),
      subject: input.subject ?? null,
      snippet: input.snippet ?? null,
      msg_date: input.msg_date,
      kind: input.kind,
    });
}

/**
 * The queue, unresolved first and newest first within that.
 *
 * Replies come before first contacts: a reply is answering something we sent, so
 * somebody is waiting. `limit` keeps a runaway sync from turning the panel into
 * a wall.
 */
export function getOrphans(includeResolved = false, limit = 40): OrphanMail[] {
  const where = includeResolved ? '' : 'WHERE resolved = 0';
  return getStatsDB()
    .prepare(
      `SELECT id, sender, subject, snippet, msg_date, kind, resolved, resolved_as
         FROM orphan_mail ${where}
        ORDER BY resolved ASC,
                 CASE kind WHEN 'reply' THEN 0 ELSE 1 END ASC,
                 msg_date DESC
        LIMIT ?`,
    )
    .all(limit) as OrphanMail[];
}

/**
 * Mark one as dealt with. `attachedTo` records which customer it belonged to,
 * which is what a later alias feature will read rather than re-deciding.
 */
export function resolveOrphan(id: string, attachedTo: string | null): boolean {
  const res = getStatsDB()
    .prepare('UPDATE orphan_mail SET resolved = 1, resolved_as = ? WHERE id = ?')
    .run(attachedTo, id);
  return res.changes > 0;
}

/** How many are waiting, for a badge that does not need the whole list. */
export function countPendingOrphans(): number {
  const row = getStatsDB()
    .prepare('SELECT COUNT(*) AS n FROM orphan_mail WHERE resolved = 0')
    .get() as { n: number };
  return row.n;
}

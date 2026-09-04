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
  /**
   * Two or three French sentences saying who writes and what they want,
   * generated once from subject and snippet. NULL until the dashboard asked
   * for it. The original text stays the reference; this is the reading aid.
   */
  gist_fr: string | null;
  /** The original text, as the sync sends it (6,000 characters at most). */
  body: string | null;
  /** Its French translation, written once on demand. */
  body_fr: string | null;
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
  body?: string | null;
  /** The French translation, when the sync already made it (new rows only). */
  body_fr?: string | null;
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
      `INSERT INTO orphan_mail (id, sender, subject, snippet, msg_date, kind, body, body_fr)
       VALUES (@id, @sender, @subject, @snippet, @msg_date, @kind, @body, @body_fr)
       ON CONFLICT(id) DO UPDATE SET
         sender = excluded.sender,
         subject = excluded.subject,
         snippet = excluded.snippet,
         msg_date = excluded.msg_date,
         kind = excluded.kind,
         -- A run that sends no body or no translation keeps the ones already held.
         body = COALESCE(excluded.body, orphan_mail.body),
         body_fr = COALESCE(orphan_mail.body_fr, excluded.body_fr)`,
    )
    .run({
      id: input.id,
      sender: input.sender.trim().toLowerCase(),
      subject: input.subject ?? null,
      snippet: input.snippet ?? null,
      msg_date: input.msg_date,
      kind: input.kind,
      body: input.body ? input.body.slice(0, 6000) : null,
      body_fr: input.body_fr ? input.body_fr.slice(0, 12000) : null,
    });
}

/**
 * The queue, unresolved first and OLDEST first within each kind.
 *
 * Replies come before first contacts: a reply is answering something we sent, so
 * somebody is waiting. Oldest first because this is a queue, not an inbox — the
 * message that has waited longest is the one to deal with, and `limit` (which
 * keeps a runaway sync from turning the panel into a wall) must cut the NEWEST
 * rows, never the ones the wait has made urgent. Newest-first here once meant
 * that past `limit` pending rows, the oldest were exactly the silently absent
 * ones.
 */
export function getOrphans(includeResolved = false, limit = 40): OrphanMail[] {
  const where = includeResolved ? '' : 'WHERE resolved = 0';
  return getStatsDB()
    .prepare(
      `SELECT id, sender, subject, snippet, msg_date, kind, resolved, resolved_as, gist_fr, body, body_fr
         FROM orphan_mail ${where}
        ORDER BY resolved ASC,
                 CASE kind WHEN 'reply' THEN 0 ELSE 1 END ASC,
                 msg_date ASC
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

/**
 * Put one back in the queue.
 *
 * The undo of resolveOrphan, and the half that was missing: dismissing was a
 * one-click gesture with no way back, so a mail filed by mistake was gone with
 * no trace. `resolved_as` is cleared too — the attachment it recorded is being
 * withdrawn, and a later reader must not find a customer named on a row that
 * is waiting again. Only a resolved row can be reopened; a pending one answers
 * false, so the caller can tell "already waiting" from "unknown id".
 */
export function reopenOrphan(id: string): boolean {
  const res = getStatsDB()
    .prepare(
      'UPDATE orphan_mail SET resolved = 0, resolved_as = NULL WHERE id = ? AND resolved = 1',
    )
    .run(id);
  return res.changes > 0;
}

/** How many are waiting, for a badge that does not need the whole list. */
export function countPendingOrphans(): number {
  const row = getStatsDB()
    .prepare('SELECT COUNT(*) AS n FROM orphan_mail WHERE resolved = 0')
    .get() as { n: number };
  return row.n;
}

/**
 * Store the French gist, once. A gist already present is kept: the writer is
 * not asked twice for the same message, and a later reader trusts the first.
 */
export function setOrphanGist(id: string, gist: string): boolean {
  const res = getStatsDB()
    .prepare('UPDATE orphan_mail SET gist_fr = ? WHERE id = ? AND gist_fr IS NULL')
    .run(gist, id);
  return res.changes > 0;
}

/** Store the French translation of the full text, once; same rule as the gist. */
export function setOrphanTranslation(id: string, bodyFr: string): boolean {
  const res = getStatsDB()
    .prepare('UPDATE orphan_mail SET body_fr = ? WHERE id = ? AND body_fr IS NULL')
    .run(bodyFr, id);
  return res.changes > 0;
}

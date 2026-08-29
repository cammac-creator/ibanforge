import { isAutomated } from './automated';
import type { Contact } from './types';

/**
 * Whether a contact's dossier is CLOSED for the day's queues.
 *
 * The gesture this serves: the operator records « pas intéressé » or
 * « mauvaise personne » on a thread and expects it to stop coming back in
 * « À répondre » and « Relances ». Until now those two verdicts were stored
 * and displayed but decided nothing — only 'pas_maintenant' acted, through
 * its wake-up date — so a dead thread returned to the queue every ten days
 * to be dismissed again, which is the exact cycle the snooze was built to
 * break, one verdict over.
 *
 * ## The reopening rule, and why it is on the verdict's own clock
 *
 * A closed dossier is not a tomb. A HUMAN inbound message dated after the
 * verdict reopens it: the person the operator judged uninterested has since
 * written, so the judgement is stale and hiding their message would be the
 * one failure this CRM exists to prevent (same doctrine as archived.ts,
 * where correspondence outranks the stored status, and automated.ts, whose
 * whole point is that a support robot's acknowledgement is NOT such a
 * message — a ticket bot must not resurrect a dossier the operator
 * deliberately closed).
 *
 * Only their message reopens. Our own outbound after the verdict changes
 * nothing (writing to someone does not make them interested), drafts decide
 * nothing anywhere, and undatable messages cannot be placed against the
 * verdict so they cannot overturn it.
 *
 * ## Why a missing outcomeAt declines to close
 *
 * The comparison needs the verdict's instant. Without it there are two wrong
 * choices — close forever (a later reply disappears) or reopen on any old
 * reply (every replied thread ignores the verdict) — and one honest one:
 * decline, and show the row. Showing a row that could be hidden is
 * recoverable; hiding one that should be shown is not. The PATCH route
 * stamps outcome_at whenever an outcome is set, so this case is legacy rows
 * only.
 *
 * A plain module with no directive, same as archived.ts and buckets.ts and
 * for the same reason: the page is a Server Component, the mail list a
 * Client Component, and both must apply this exact rule.
 */
const TERMINAL_OUTCOMES: ReadonlySet<string> = new Set(['pas_interesse', 'mauvaise_personne']);

export function isClosed(c: Contact): boolean {
  const s = c.sourcing;
  if (!s?.outcome || !TERMINAL_OUTCOMES.has(s.outcome)) return false;
  if (!s.outcomeAt) return false;
  const verdictAt = new Date(s.outcomeAt);
  if (Number.isNaN(verdictAt.getTime())) return false;
  return !c.messages.some((m) => {
    if (m.direction !== 'in' || isAutomated(m)) return false;
    if (!m.msg_date) return false;
    const at = new Date(m.msg_date);
    return !Number.isNaN(at.getTime()) && at.getTime() > verdictAt.getTime();
  });
}

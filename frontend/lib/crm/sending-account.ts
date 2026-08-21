/**
 * Which of OUR mailboxes a message leaves from.
 *
 * ## Why this is not `draft.counterparty || contact.account`
 *
 * That is what it was, and on 29/07/2026 it put an unsendable draft in front of
 * the operator. `counterparty` is written by the IMAP sync, where it means the
 * OTHER end of the conversation: for an inbound message it is the customer. A
 * draft posted through the admin API carried the customer's own address there,
 * the card handed it to the send path as the FROM mailbox, and the VPS answered
 * `no active account pilot@example.com` at the moment of sending.
 *
 * The field was doing two jobs with one name, so the failure could only surface
 * at send time, on a real customer thread. The fix is to stop trusting the
 * string: the sending mailbox has to BE one of ours, and anything else falls
 * back rather than travelling down to SMTP. There is no acceptable empty answer
 * here, so the last resort is a real mailbox, not ''.
 */

/** Mailbox used for a contact we have never emailed. */
export const COLD_ACCOUNT = 'claude-alain@ibanforge.com';
/**
 * Mailbox that carries the existing warm threads.
 *
 * A personal address, so it is read from CRM_WARM_ACCOUNT rather than
 * committed to this public repository. Absent, only the cold mailbox is
 * recognised as ours, and a warm draft falls back to it — the same fallback
 * this module already applies to any address it does not recognise, so the
 * failure mode is one we already handle rather than a new one.
 */
export function warmAccount(): string {
  return (process.env.CRM_WARM_ACCOUNT ?? '').trim().toLowerCase();
}

/**
 * Read at call time, not at import: the value comes from the environment, and
 * a module-level constant would freeze whatever was set when the bundle was
 * first evaluated — which is how a test, or a server restarted before its
 * variables were in place, ends up asserting against an empty mailbox.
 */
export function ourMailboxes(): readonly string[] {
  const warm = warmAccount();
  return warm ? [COLD_ACCOUNT, warm] : [COLD_ACCOUNT];
}

function ours(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return ourMailboxes().includes(normalized) ? normalized : null;
}

/**
 * @param pinned  the mailbox a draft asks to leave from, if any
 * @param filed   the mailbox the contact is filed under
 */
export function sendingAccount(pinned: string | null | undefined, filed: string | null | undefined): string {
  return ours(pinned) ?? ours(filed) ?? COLD_ACCOUNT;
}

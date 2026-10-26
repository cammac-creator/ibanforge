/**
 * Which of OUR mailboxes a message leaves from.
 *
 * ## Only ever a mailbox of the company domain (26/10/2026)
 *
 * Until that date a contact with an existing thread was "warm", and its mails
 * left from the owner's personal mailbox, configured in CRM_WARM_ACCOUNT, on
 * the idea that a reply should leave from the mailbox that carried the thread.
 * The owner ended that rule: IBANforge correspondence leaves from an
 * @ibanforge.com address, a reply to an old thread included. The thread still
 * holds together in the recipient's mailbox, because a reply keeps its subject.
 * CRM_WARM_ACCOUNT is no longer read anywhere.
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

/** The mailbox every message of this dashboard leaves from. */
export const SENDING_ACCOUNT = 'claude-alain@ibanforge.com';

const COMPANY_DOMAIN = 'ibanforge.com';

/**
 * The mailboxes a message may leave from: each one must also exist on the VPS
 * that sends, which is why this is a list and not the whole domain. A public
 * address of the domain that is not a mailbox there would fail at send time.
 */
export function ourMailboxes(): readonly string[] {
  return [SENDING_ACCOUNT];
}

/**
 * True for exactly one address of the company domain, and nothing else.
 *
 * The routes that relay to the VPS ask this before relaying: whatever a page
 * open since before 26/10/2026 still holds, a mail never leaves from a personal
 * mailbox. Strict on purpose: one `@`, the domain itself, no subdomain, so that
 * `x@ibanforge.com.evil.test` or `x@mail.ibanforge.com` is not ours.
 */
export function isCompanyMailbox(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  const at = normalized.indexOf('@');
  if (at <= 0 || at !== normalized.lastIndexOf('@')) return false;
  return normalized.slice(at + 1) === COMPANY_DOMAIN;
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
  return ours(pinned) ?? ours(filed) ?? SENDING_ACCOUNT;
}

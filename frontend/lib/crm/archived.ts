import type { Contact, Situation } from './types';

/**
 * Whether a contact is archived FOR FILTERING, which is not the same question
 * as what the database stores. Two rules, both taken from the page this
 * replaces rather than invented:
 *
 * 1. Only a prospect can be archived. `sourcing` is attached to a client too,
 *    for any matching non-rejected prospect row (build-contacts.ts), and two
 *    prospect rows may share one address. Reading the status without checking
 *    the kind meant that archiving a stale duplicate row hid the paying
 *    customer behind it: gone from the Clients card, gone from the revenue
 *    sum, and unreachable, since the status control only renders for
 *    prospects. The Clients page had no archive concept at all.
 *
 * 2. Correspondence outranks the stored status. Legacy displayStatus tested
 *    `replied` and `contacted` BEFORE `status === 'archive'`, and its 'actifs'
 *    filter dropped a row only once the derived status came out 'archive'. So
 *    the old page hid archived prospects with an empty thread, and an inbound
 *    reply pulled the row straight back into the active list. That matters
 *    because 'archive' is terminal in the database: the ingester flips only
 *    'a_mailer' and 'a_enrichir' to 'contacte', so nothing ever clears it.
 *    Without this rule a prospect archived after silence who answers two
 *    months later is unread and ball-in-court yet invisible everywhere but the
 *    Archivés chip, which is the exact failure this CRM exists to prevent.
 *
 *    Keyed on `messageCount`, from the situation the page already computes. It
 *    is equivalent to legacy `replied || contacted`: between them those two
 *    covered every thread holding any non-draft message, since a thread whose
 *    last message is inbound is 'replied' and any outbound at all makes it
 *    'contacted'. Contact.messages carries exactly that set, drafts and
 *    undatable rows already dropped by build-contacts, and messageCount counts
 *    it.
 *
 * A plain module with no directive on purpose. The page is a Server Component
 * and the list is a Client Component, and both need this exact rule: a second
 * copy would be free to drift, while exporting it from the client file would
 * turn it into a client reference the server cannot call.
 */
export function isArchived(c: Contact, s: Situation | undefined): boolean {
  if (c.kind !== 'prospect') return false;
  if (c.sourcing.status !== 'archive') return false;
  // An unknown situation means we cannot tell whether the thread is empty.
  // Showing a row that should be hidden is recoverable; hiding one that should
  // be shown is the failure this whole rule exists to prevent.
  return s !== undefined && s.messageCount === 0;
}

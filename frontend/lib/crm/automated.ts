import type { Message } from './types';

/**
 * Is this inbound message a machine talking, rather than a person?
 *
 * ## Why this exists
 *
 * Every inbound row used to count as a human reply. Measured on the real
 * mailbox on 27/07/2026: five of sixteen inbound messages were support-desk
 * automation, and they were corrupting the single most action-driving signal
 * in the CRM. Two companies were listed as "ont répondu" when nobody had
 * written a word, and the "Tu as la balle" card showed five threads of which
 * one actually wanted an answer. The tool was not merely hiding information,
 * it was manufacturing it: sending the operator to answer robots and making
 * the campaign look like it converted better than it did.
 *
 * ## Why the test is on the text and not on the sender
 *
 * The obvious implementation, a list of robot addresses, is wrong here and the
 * real data says so. One company's desk sent four messages from ONE address:
 * an acknowledgement, then a genuine human reply, then an automated nag, then
 * a satisfaction survey. Filtering by sender would have thrown away the human
 * reply along with the three robots, turning a company that answered into a
 * company due for a follow-up. That is a worse defect than the one being
 * fixed, because a false positive is visible in the thread and a false
 * negative is not.
 *
 * So the decision is per message, and it reads the text.
 *
 * Sender still contributes, but only for addresses that are never a person:
 * `no-reply@`, `mailer-daemon@` and their kin. A desk address like `hello@` or
 * `support@` proves nothing, since that is exactly where the human reply in
 * the case above came from.
 *
 * ## The bias, stated
 *
 * Every marker below is a transactional formula that a person writing to you
 * would have no reason to produce. When in doubt the answer is "human": a
 * robot shown as a person costs one glance, while a person silently reclassed
 * as a robot drops out of `hasEverReplied`, out of the ball-in-court test and
 * out of the reply count, which is exactly the invisible failure this module
 * exists to prevent. Nothing here matches on politeness ("thank you for
 * reaching out" opens both robot and human mail in this very mailbox) or on
 * the subject alone, since desks quote the subject we sent them.
 */

/** Addresses that are never a person. A desk address is NOT one of these. */
const ROBOT_SENDER =
  /^(no-?reply|do-?not-?reply|noreply|mailer-daemon|postmaster|bounces?|notifications?|automated)[@+]/i;

/**
 * Transactional formulas. Each one was taken from a message actually received,
 * or is the standard wording of the class that message belongs to, and each is
 * checked against the human replies in the same mailbox before being added.
 */
const AUTO_MARKERS: RegExp[] = [
  // Ticket acknowledgements, English and French.
  /\bticket\s*(?:number|no\.?|#)\s*#?\s*\d+/i,
  /\b(?:a|your)\s+ticket\s+(?:has been|was)\s+(?:created|opened)/i,
  /un ticket a (?:bien )?[ée]t[ée] cr[ée][ée]/i,
  /\bwe(?:'ve|’ve| have)\s+received\s+your\s+(?:message|request|e-?mail|enquiry|inquiry)/i,
  /\byour\s+request\s*\(?#?\s*\d{3,}\)?\s+has\s+been\s+received/i,
  /nous avons bien re[çc]u votre\s+(?:message|demande|e-?mail|courriel)/i,
  /merci de nous avoir contact[ée]s/i,
  /\bthank you for contacting\b[^.]{0,60}\bteam\b/i,

  // Satisfaction surveys.
  /\brate your\s+(?:\w+\s+){0,3}experience/i,
  /\bhow was your\b[^?]{0,60}\bexperience\b/i,

  // Desk nags: the robot chasing US about a support request we never opened.
  /\bregarding your support request\b/i,
  /\bstill need (?:any )?(?:assistance|help)\b/i,

  // Explicit self-declaration.
  /\bthis is an automated\s+(?:reply|response|message|e-?mail)/i,
  /\b(?:do not|don'?t|please do not) reply to this\s+(?:e-?mail|message)/i,
  /ne pas r[ée]pondre [àa] ce\s+(?:message|courriel|e-?mail)/i,
  /\bmessage automatique\b/i,

  // Out of office.
  /\bout of (?:the )?office\b/i,
  /\bon (?:annual |parental )?leave until\b/i,
  /absence du bureau|actuellement en cong[ée]/i,

  // Bounces and delivery reports.
  /\bmail delivery (?:failed|subsystem)\b/i,
  /\bdelivery status notification\b/i,
  /\bundeliverable\b/i,
];

/**
 * Cap on the text scanned per message. Bodies arrive from outside and carry
 * whole quoted histories; the formulas above all appear in the opening lines,
 * so scanning further only adds cost and, worse, lets a quoted copy of an
 * earlier robot message reclassify a human reply that quotes it.
 */
const SCAN_CHARS = 600;

/** Only inbound mail can be automated: our own sends and drafts are ours. */
export function isAutomated(m: Message): boolean {
  if (m.direction !== 'in') return false;

  const from = (m.counterparty ?? '').trim();
  if (from && ROBOT_SENDER.test(from)) return true;

  // Subject and body are joined with a newline rather than a space so that the
  // end of one and the start of the other cannot form a phrase neither
  // contains. Same reasoning as the guardrails.
  const text = `${m.subject ?? ''}\n${(m.body || m.snippet || '').slice(0, SCAN_CHARS)}`;
  return AUTO_MARKERS.some((re) => re.test(text));
}

/** The messages that count as correspondence with a person. */
export function humanOnly(messages: Message[]): Message[] {
  return messages.filter((m) => !isAutomated(m));
}

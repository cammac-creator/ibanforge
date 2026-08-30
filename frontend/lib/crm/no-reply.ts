import type { Contact, Message, Situation } from './types';

/**
 * Exchanges that will not go any further, and the one gesture that ends them.
 *
 * ## The gap this fills
 *
 * Nothing in the CRM could say « rien à répondre ». A thank-you from a
 * supervisory desk, an acknowledgement of receipt, a ticket robot the text
 * rules did not catch: every one of them is an inbound message, so the ball is
 * in our court, so the thread sits in « À répondre » for ever. The operator
 * cannot answer "merci !", and cannot make the row leave either.
 *
 * The classification that existed, OutcomeControl, could not serve. Two
 * reasons, and they are different reasons:
 *   - It renders only for a contact carrying a prospect row, so a self-service
 *     customer and an institutional correspondent had no control at all.
 *   - Its four values describe a COMMERCIAL RELATIONSHIP. A warm thank-you is
 *     neither « pas intéressé » nor « mauvaise personne », and filing it under
 *     one of those would be false about the person and would corrupt the
 *     counters that read those verdicts.
 *
 * ## Why the marker is on the MESSAGE and never on the contact
 *
 * Because it buys the reopening for free. The thread leaves the queues while
 * its last inbound message carries the flag; write to us next week and the last
 * inbound is a fresh unmarked one, so the thread is back with no rule to run.
 *
 * closed.ts, one day older, had to pay for the same guarantee in cash: a
 * verdict instant to store, a date comparison, and an exception so a support
 * robot's acknowledgement could not resurrect a dossier. None of that exists
 * here. It also works for EVERY kind of contact, because messages are keyed on
 * the address and owe nothing to a prospect row — which is the half of the
 * problem OutcomeControl could not reach.
 *
 * ## What decides, and what deliberately does not
 *
 * Drafts are not correspondence, and a message with no readable date cannot be
 * placed in the thread, so it cannot be the last of anything. Automated inbound
 * DOES count, unlike in situationOf, and lastInboundMessage carries the whole
 * reason why: the safe failure runs the other way once a marker is involved.
 *
 * A plain module with no directive, same as archived.ts, closed.ts and
 * buckets.ts, and for the same reason: the page is a Server Component, the mail
 * list a Client Component, and both apply this rule.
 */

/**
 * The inbound message a « rien à répondre » applies to: the last one that can
 * decide anything at all.
 *
 * Exported and used by BOTH the predicate below and the button in the drawer,
 * so the message the operator marks is by construction the message the rule
 * then reads. Two selectors would be free to disagree, and the way that
 * disagreement shows up is a button that appears to do nothing.
 *
 * Ties are broken by thread order, i.e. the last of them wins, and the tie is
 * not hypothetical: `msg_date` is free-form TEXT and a day-granularity date
 * makes every message of one day share an instant. Thread order is the order
 * build-contacts sorted them in and the order the drawer prints them in, so the
 * message chosen here is the last bubble the operator is looking at.
 *
 * ## Why automated inbound is NOT skipped here
 *
 * It was, on the reasoning that a ticket robot answering after a marked
 * thank-you would become "the last inbound", unmarked, and drag the thread
 * back into the queue. That reasoning is right about the noise and wrong about
 * the risk, and the 30/08/2026 adversarial review built the case that settles
 * it: isAutomated matches on TEXT, so a real customer whose mail opens "nous
 * avons bien reçu votre message" before asking why production returns 500 is
 * read as a robot. Skipping it here left the old marker standing, the thread
 * out of « À répondre », out of « Relances » too — and nothing to bring it
 * back. A false positive that used to cost a mislabelled row now cost the row
 * itself.
 *
 * So the LAST datable inbound decides, robots included. The house rule chooses
 * for us and is written on archived.ts in the same words: a row shown that
 * could have been hidden costs one glance, a row hidden that should have been
 * shown is the failure this CRM exists to prevent. The noise this readmits has
 * its own answer one file over — a sender rule marks a genuine robot's mail on
 * arrival, so the thread it walks into is already quiet.
 */
export function lastInboundMessage(c: Contact): Message | null {
  let best: Message | null = null;
  let bestAt = -Infinity;
  for (const m of c.messages) {
    if (m.direction !== 'in') continue;
    if (!m.msg_date) continue;
    const at = new Date(m.msg_date).getTime();
    if (Number.isNaN(at) || at < bestAt) continue;
    best = m;
    bestAt = at;
  }
  return best;
}

/**
 * Whether the last thing they said needs no answer.
 *
 * False whenever there is nothing to read — no inbound message, or one the API
 * serves without the column. Declining beats guessing here for the usual
 * reason: a row shown that could have been hidden costs one glance, a row
 * hidden that should have been shown is the failure this CRM exists to prevent.
 */
export function lastInboundNeedsNoReply(c: Contact): boolean {
  return lastInboundMessage(c)?.no_reply_needed === 1;
}

/**
 * Whether the marker is doing work RIGHT NOW: they spoke last, so the thread
 * would be in « À répondre », and the marker is the only thing keeping it out.
 *
 * The predicate above stays true after we write back, which is correct — the
 * marker belongs to their message, and answering does not un-say what they
 * said. But it is the wrong question for anything that EXPLAINS the queue. A
 * thread where they thanked, we answered and we are now waiting on them would
 * otherwise wear a badge saying "rien à répondre" over a row that is simply
 * waiting, and the band would say it in a drawer whose thread ends with our own
 * mail.
 *
 * One definition for both surfaces rather than the same conjunction written
 * twice: the badge in the list and the band in the drawer are read in the same
 * minute, on the same contact, and two copies of a rule are two rules.
 */
export function noReplyHolds(c: Contact, s: Situation | undefined): boolean {
  return s?.ballInCourt === 'us' && lastInboundNeedsNoReply(c);
}

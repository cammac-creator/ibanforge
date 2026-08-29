import { isArchived } from './archived';
import { isClosed } from './closed';
import type { Contact, Situation } from './types';

/**
 * The two buckets a day's work is made of, written once each.
 *
 * Three places read them and they must agree to the digit: the counted
 * filters of the mail list (mail-rows.ts), the context line of the Contacts
 * page and the overview's cards (both through snapshot.ts). A card that says
 * 3 while the matching filter says 4 costs the operator his trust in both
 * numbers at once, and the only way that cannot happen is for there to be a
 * single copy of each rule rather than three that are free to drift.
 *
 * Excluding archived contacts is part of the rule, not the caller's job, even
 * though it currently changes no answer. isArchived only fires on a thread
 * with no datable message, and situationOf answers ballInCourt 'none' and
 * followupDue false for exactly that thread, so the two can never both hold
 * today. The term stays because that is an accident of two rules in two other
 * files agreeing, not something these predicates state: loosen isArchived and
 * the day's queue would silently fill with rows only "Tous" is meant to show.
 * It also keeps these identical to the filters they replaced.
 *
 * A plain module with no directive, same as archived.ts and for the same
 * reason: the page is a Server Component while the mail list is a Client
 * Component, and both call these. Exported from a client file they would
 * become client references the server cannot call.
 *
 * The situation may be missing: the page builds one entry per contact id, so
 * an absent one is a programming error rather than data, and a predicate that
 * declines to claim the row beats one that throws in the operator's face.
 */

/**
 * Their last message is inbound: they are waiting on us.
 *
 * Deliberately blind to the snooze. Someone who writes while asleep has
 * overtaken their own "call me in September", and burying that message would
 * hide the one event that proves the snooze wrong.
 *
 * NOT blind to a closed dossier, and the two rules do not conflict: isClosed
 * carries its own version of the same doctrine. A human inbound dated after
 * the « pas intéressé » / « mauvaise personne » verdict reopens the dossier
 * inside isClosed itself, so the one event that proves the verdict wrong is
 * never buried — while a support robot's acknowledgement, which proves
 * nothing, cannot resurrect a thread the operator deliberately closed.
 */
export function ballWithUs(c: Contact, s: Situation | undefined): boolean {
  return !isArchived(c, s) && !isClosed(c) && s?.ballInCourt === 'us';
}

/**
 * Our last mail has gone unanswered past FOLLOWUP_DAYS, and the contact is not
 * asleep until a date. The snooze is the whole point of the outcome
 * 'pas_maintenant': without this term the row would come back every ten days
 * to be dismissed by hand, which is exactly the cycle it exists to break.
 */
export function followupDue(c: Contact, s: Situation | undefined, snoozed: boolean = false): boolean {
  return !snoozed && !isArchived(c, s) && !isClosed(c) && s?.followupDue === true;
}

/**
 * Everything the day owes. The two buckets cannot overlap, since followupDue
 * requires the ball to be in their court, so a count of this is exactly the
 * sum of the two counts above. The rail and the chip that used to read it are
 * gone; it stays, pinned by its tests, as the one-line definition of the day
 * the two buckets add up to.
 */
export function dueToday(c: Contact, s: Situation | undefined, snoozed: boolean = false): boolean {
  return ballWithUs(c, s) || followupDue(c, s, snoozed);
}

/**
 * A prospect no mail has ever gone out to.
 *
 * These rows sit in no other bucket by construction: nothing is due today
 * because nobody is waiting on anybody, and no follow-up is due because there
 * is nothing to follow up. So the only way to reach them was to scroll the
 * whole list and read the small "jamais contacté" line under each row, which is
 * how a queue of first mails becomes invisible work.
 *
 * The named filter that read this is gone; today mail-rows.ts reads it to put
 * these rows at the head of "Tous", the reduced form of the same gesture.
 *
 * Clients are excluded on purpose. A client with no stored thread is a mail-sync
 * gap, not somebody to cold-mail, and putting one in this bucket would invite
 * exactly the wrong send.
 *
 * The snooze is honoured, unlike in ballWithUs: someone who said "come back in
 * September" has not been contacted either, and a cold first mail is precisely
 * what must not resurface before that date.
 */
export function neverContacted(c: Contact, s: Situation | undefined, snoozed: boolean = false): boolean {
  return !snoozed && c.kind === 'prospect' && !isArchived(c, s) && !isClosed(c) && s?.nextAction === 'first_mail';
}

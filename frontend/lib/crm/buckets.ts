import { isArchived } from './archived';
import type { Contact, Situation } from './types';

/**
 * The two buckets a day's work is made of, written once each.
 *
 * Three places read them and they must agree to the digit: the counted filter
 * chips in the contact list, the stat cards on the page, and the two sections
 * of the day rail. A rail section that says 3 while the matching chip says 4
 * costs the operator his trust in both numbers at once, and the only way that
 * cannot happen is for there to be a single copy of each rule rather than
 * three that are free to drift.
 *
 * Excluding archived contacts is part of the rule, not the caller's job, even
 * though it currently changes no answer. isArchived only fires on a thread
 * with no datable message, and situationOf answers ballInCourt 'none' and
 * followupDue false for exactly that thread, so the two can never both hold
 * today. The term stays because that is an accident of two rules in two other
 * files agreeing, not something these predicates state: loosen isArchived and
 * the day's queue would silently fill with rows every chip but Archivés
 * refuses to show. It also keeps these identical to the chips they replace.
 *
 * A plain module with no directive, same as archived.ts and for the same
 * reason: the page is a Server Component while the list and the rail are
 * Client Components, and all three call these. Exported from a client file
 * they would become client references the server cannot call.
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
 */
export function ballWithUs(c: Contact, s: Situation | undefined): boolean {
  return !isArchived(c, s) && s?.ballInCourt === 'us';
}

/**
 * Our last mail has gone unanswered past FOLLOWUP_DAYS, and the contact is not
 * asleep until a date. The snooze is the whole point of the outcome
 * 'pas_maintenant': without this term the row would come back every ten days
 * to be dismissed by hand, which is exactly the cycle it exists to break.
 */
export function followupDue(c: Contact, s: Situation | undefined, snoozed: boolean = false): boolean {
  return !snoozed && !isArchived(c, s) && s?.followupDue === true;
}

/**
 * Everything the day owes. The two buckets cannot overlap, since followupDue
 * requires the ball to be in their court, so a count of this is exactly the
 * sum of the two counts above, which is what lets the rail's two section
 * badges be read against the Aujourd'hui chip.
 */
export function dueToday(c: Contact, s: Situation | undefined, snoozed: boolean = false): boolean {
  return ballWithUs(c, s) || followupDue(c, s, snoozed);
}

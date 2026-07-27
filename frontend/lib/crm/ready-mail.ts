import type { Contact, ReadyMail } from './types';

/** A prospect that still has an unsent pre-written mail waiting for it. */
type ProspectWithReadyMail = Extract<Contact, { kind: 'prospect' }> & { readyMail: ReadyMail };

/**
 * May the pre-written mail be loaded into the composer for this contact?
 *
 * Only while nothing has been written to them yet, and that third term is the
 * whole point of this rule.
 *
 * `prospects.mail_body_*` is written once, when the row is seeded, and never
 * rewritten afterwards. It is therefore the text of the FIRST mail, for as
 * long as the row lives. On a prospect already written to, the button that
 * loads it put the mail already sent back into the composer, byte for byte,
 * one click away from the button that sends it: that is the "creating a
 * follow-up returns the mail already sent" the owner reported, and it is not
 * the generator at all.
 *
 * A type predicate rather than a plain boolean so the caller that then reads
 * `readyMail` is narrowed by the same check that decided the button exists,
 * instead of repeating it and being free to repeat it differently.
 *
 * Read on `messages`, which holds correspondence only and never drafts: a
 * parked draft is not a mail that went out, and it must not close the way in
 * on a prospect nobody has written to. The situation is deliberately not
 * consulted, though `nextAction === 'first_mail'` would look equivalent: the
 * composer takes its situation as an optional prop, so a page that failed to
 * derive one would silently reopen exactly the hole this closes.
 */
export function canLoadReadyMail(c: Contact): c is ProspectWithReadyMail {
  return c.kind === 'prospect' && !!c.readyMail && c.messages.length === 0;
}

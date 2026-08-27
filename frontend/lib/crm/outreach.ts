import type { Contact } from './types';

/**
 * Who was WON by outbound prospecting, as opposed to who signed up on their own.
 *
 * ## Why the rule needs a causal proof, and not just a dossier
 *
 * The obvious rule — "a client that also carries a sourcing dossier came from
 * prospecting" — is wrong on this data, and it is wrong in the expensive
 * direction: it dresses organic signups as conquests, which is precisely the
 * number nobody can afford to inflate, since it is the one that says whether
 * the outbound effort is worth continuing.
 *
 * It broke twice over, and each break is a clause below.
 *
 * 1. **Every organic signup carries a dossier.** A script files an
 *    `auto-enrich` prospect row AFTER an inbound signup, to enrich a company
 *    from its domain. That row is bookkeeping about somebody who arrived by
 *    themselves, not the trace of a campaign. Without the exclusion, every
 *    single organic customer would wear the badge.
 *
 * 2. **The stored sourcing status lies about it.** Those machine-filed rows are
 *    written with a `contacte` status hardcoded — it means "this dossier is
 *    complete", not "we wrote to them". The investigation that froze this rule
 *    started on exactly that: a client whose dossier said `contacte` while the
 *    thread held no outbound mail at all, because none had ever been sent. A
 *    status is a field somebody set; a sent mail is an event that happened.
 *
 * So the rule reads the THREAD, and it reads it causally: we wrote to them
 * BEFORE they minted their key. An outbound mail dated after the key is
 * customer support, onboarding or an upsell — real correspondence, but it did
 * not win anybody, and counting it would quietly re-admit every organic client
 * the moment we answered their first question.
 *
 * ## Precision of the comparison
 *
 * The proof is trustworthy at DAY scale, not at hour scale, and deliberately so.
 * `apiKey.createdAt` is stored as `YYYY-MM-DD HH:MM:SS`, which `Date` reads as
 * LOCAL time, while `msg_date` is free-form TEXT the ingester fills and is often
 * ISO with a `Z`, which reads as UTC. A server in UTC and a browser in Zurich
 * therefore disagree by the offset, so a mail sent within a couple of hours of
 * the key can land on either side of it. That margin is accepted rather than
 * papered over: a mail that won a customer precedes their signup by days, and
 * every alternative (truncating to the day, allowing a tolerance) would blur the
 * one thing the rule is for — telling "we wrote first" from "they came first".
 */

/**
 * The `source` the enrichment script stamps on the dossier it opens for an
 * inbound signup. Exported so the three places that must recognise those rows
 * — this rule, the reservoir's harvest date, the "deduced by AI" warning on the
 * contact sheet — read one spelling instead of three string literals that can
 * drift apart one rename at a time.
 */
export const AUTO_ENRICH = 'auto-enrich';

/**
 * Same parse as `situation.ts` and `build-contacts.ts`, and a local copy for the
 * same reason they each keep one: `msg_date` is free-form TEXT, so the format is
 * not guaranteed and a raw string comparison is not an order. `null` for
 * anything that cannot be placed in time at all.
 */
function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Whether this contact is a customer our own outbound mail went and got.
 *
 * Four clauses, all required, in the order that makes the cheapest test fail
 * first. Anything missing — no key, no dossier, a machine-filed dossier, no
 * outbound mail predating the key — is a `false`, never a maybe: the badge this
 * feeds is a claim about causality, and a claim of that kind is either proven
 * on the thread or not made.
 */
export function wonByOutreach(c: Contact): boolean {
  // A key holder, paid or free alike. The badge answers "did prospecting win
  // them", which quota tier they landed on is a different question.
  if (c.kind !== 'client') return false;
  const sourcing = c.sourcing;
  // No dossier at all: nobody ever sourced them, so nobody can have won them.
  if (!sourcing) return false;
  // Clause 1 above: the machine's dossier for an organic arrival.
  if (sourcing.source === AUTO_ENRICH) return false;
  const keyAt = parseDate(c.apiKey.createdAt);
  // Undatable key: there is no "before" to be on the right side of. A prospect
  // that never converted has no key either and stops here.
  if (keyAt === null) return false;
  return c.messages.some((m) => {
    if (m.direction !== 'out') return false;
    const at = parseDate(m.msg_date);
    return at !== null && at.getTime() < keyAt.getTime();
  });
}

import { accountUsd } from './account-usd';
import { isArchived } from './archived';
import { ballWithUs as isBallWithUs, followupDue as isFollowupDue } from './buckets';
import { buildContacts, type BuildInput } from './build-contacts';
import { countSentToday } from './sent-today';
import { situationOf } from './situation';
import { snoozedMap, wokeMap } from './snooze';
import type { Contact, Situation } from './types';


/**
 * One reading of the contact base, taken against one instant.
 *
 * Two pages draw from it. The overview watches the base and the Contacts page
 * works in it, and between them they show the same figures: how many contacts
 * are followed, how many wait on an answer, how many follow-ups have come due.
 * A figure with two origins is a figure free to disagree with itself, and two
 * pages quoting different numbers for the same thing costs the operator his
 * trust in both at once. So there is one origin, here, and both pages import
 * it rather than each deriving its own.
 */
export interface CrmSnapshot {
  /** Every contact, archived ones included: the CRM list decides what to show. */
  contacts: Contact[];
  /** Keyed by Contact.id, one entry per contact. */
  situations: Record<string, Situation>;
  /** Keyed by Contact.id: asleep until a date, on the snapshot's calendar day. */
  snoozed: Record<string, boolean>;
  /** Keyed by Contact.id: wake date arrived within the return window. */
  woke: Record<string, boolean>;
  /** The snapshot's instant as a UTC day, which is the day the podium reads. */
  todayUtc: string;
  /** What the CRM still counts as live. Every count below reads this, or a predicate. */
  active: Contact[];
  /** Threads whose last message is inbound: they are waiting on us. */
  ballWithUs: number;
  /** Our last mail unanswered past the threshold, snoozed contacts excluded. */
  followupDue: number;
  /** Live contacts asleep until a date, hence absent from followupDue. */
  asleep: number;
  prospects: number;
  clients: number;
  /**
   * Live institutional correspondents. Counted so that `active` still adds up:
   * it is the sum of the three, and without this line a reader checking
   * `clients + prospects` against it would find a gap and take it for a bug.
   * No money and no funnel figure reads this set.
   */
  institutions: number;
  /** Real outbound mails dated today. The day's cadence, against the caps. */
  sentToday: number;
  /** Stripe pack revenue of the live client set, in USD. */
  revenueUsd: number;
  /**
   * True when at least one account in that total was priced from the pack size
   * rather than from what was actually charged (findings DASH-12 and DASH-17,
   * 2026-09-01). It is the case for EVERY account today: GET /v1/admin/keys
   * does not serve amount_paid_minor, so the whole figure is a deduction.
   *
   * Shown rather than kept quiet: a deduced total is a good enough answer to
   * "roughly how much came in", and a very bad answer to "what did this
   * customer pay". A reader who cannot tell which one he is holding will use it
   * for both.
   */
  revenuePartlyDeduced: boolean;
  /** Free keys that actually call the API: the conversion candidates. */
  freeActive: number;
}

/**
 * Read the whole contact base once, from the admin payloads.
 *
 * `now` is an argument and every derivation below is passed the same value.
 * Two reasons, both load-bearing:
 *
 *   1. situationOf reads the current instant, and it parses msg_date, which is
 *      stored without a timezone, so new Date() reads it as local time. A UTC
 *      server and a browser in Europe/Zurich therefore place the same message
 *      two hours apart, and any thread whose silence boundary falls in that
 *      window yields a different silenceDays on each side. The list is
 *      server-rendered then hydrated, so that difference is a hydration
 *      mismatch, and it also flips followupDue, hence the filter counts, the
 *      default filter's membership and the sort order.
 *   2. One clock for the whole page. Thirty calls each taking their own
 *      new Date() could straddle midnight and disagree with each other.
 *
 * It also makes the whole snapshot deterministic under test.
 */
export function crmSnapshot(data: BuildInput, now: Date = new Date()): CrmSnapshot {
  const contacts = buildContacts(data, now);

  const situations: Record<string, Situation> = {};
  for (const c of contacts) situations[c.id] = situationOf(c.messages, now);

  // Same clock, same reason. A contact put to sleep until a date is compared
  // against the server's calendar day once, rather than each component asking
  // the runtime what day it is and two of them disagreeing across midnight.
  const snoozed = snoozedMap(contacts, now);
  const woke = wokeMap(contacts, now);

  const todayUtc = now.toISOString().slice(0, 10);

  // Counted over the raw messages rather than over the contacts, so a mail sent
  // to an address buildContacts drops (an internal one, or a key it treats as
  // an evaluation pilot) still counts against the day. That errs towards a
  // slightly high number, which is the harmless direction for a figure whose
  // only job is to say when to stop sending.
  const sentToday = countSentToday(data.messages, now);

  // Every counter below reads the active contacts, never the raw list, so a
  // figure can never advertise a number the matching filter chip refuses to
  // show. The two day buckets go one step further and call the very predicates
  // the chips call, and those exclude archived rows themselves, so the same
  // figure appears in every place that shows it or in none.
  const active = contacts.filter((c) => !isArchived(c, situations[c.id]));
  const ballWithUs = contacts.filter((c) => isBallWithUs(c, situations[c.id])).length;
  const followupDue = contacts.filter((c) =>
    isFollowupDue(c, situations[c.id], snoozed[c.id]),
  ).length;
  const asleep = contacts.filter((c) => snoozed[c.id] && !isArchived(c, situations[c.id])).length;

  // One pass for what the live set is made of and what it is worth. The money
  // reads the same list as the head count, which is the point: a client counted
  // here and priced elsewhere would be two answers about one set. The overview's
  // own money card is x402 USDC, which cannot be attributed per client; this one
  // is the Stripe pack revenue, and the two are complementary, not duplicates.
  let prospects = 0;
  let clients = 0;
  let institutions = 0;
  let revenueUsd = 0;
  let revenuePartlyDeduced = false;
  let freeActive = 0;
  for (const c of active) {
    if (c.kind === 'prospect') {
      prospects += 1;
      continue;
    }
    // Before the client count, not after it. An authority is neither a customer
    // nor a lead: counted as one it would inflate "clients" on the overview, a
    // figure the owner reads daily, and it would then be asked for a revenue
    // and a free-tier verdict it can never have.
    if (c.kind === 'institution') {
      institutions += 1;
      continue;
    }
    clients += 1;
    if (c.apiKey.paid && c.apiKey.creditsTotal != null) {
      // What was charged when we have it, the pack price when we do not, and
      // an unknown bundle priced pro rata rather than dropped to zero. The
      // whole rule, and the reasons for each half, live in account-usd.ts.
      const money = accountUsd(c.apiKey);
      revenueUsd += money.usd;
      if (money.source === 'deduced') revenuePartlyDeduced = true;
    } else if (!c.apiKey.paid && c.apiKey.usedAllTime > 0) {
      freeActive += 1;
    }
  }

  return {
    contacts,
    situations,
    snoozed,
    woke,
    todayUtc,
    active,
    ballWithUs,
    followupDue,
    asleep,
    prospects,
    clients,
    institutions,
    sentToday,
    // Rounded to the cent: a pro rata price can carry a float tail, and a
    // revenue line is money, not a measurement.
    revenueUsd: Math.round(revenueUsd * 100) / 100,
    revenuePartlyDeduced,
    freeActive,
  };
}

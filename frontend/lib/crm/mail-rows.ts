import { isArchived } from './archived';
import { ballWithUs, followupDue, neverContacted } from './buckets';
import { chipOf, replyGroupOf, type BusinessChip, type ReplyGroup } from './business';
import { heatOf } from './heat';
import { NEXT_ACTION_LABEL } from './situation';
import type { Contact, Message, Situation } from './types';

export type MailFilterKey = 'reply' | 'followup' | 'new' | 'paying' | 'dormant' | 'clients' | 'prospect' | 'all';

export interface RowsInput {
  contacts: Contact[];
  situations: Record<string, Situation | undefined>;
  snoozed: Record<string, boolean>;
  /**
   * Recently-woken sleepers (lib/crm/snooze.ts wokeMap), computed by the page
   * against the same clock as `snoozed`. Optional because only the CRM page
   * carries the gesture; absent means nobody is waking up.
   */
  woke?: Record<string, boolean>;
}

export interface MailRow {
  id: string;
  who: string;
  subject: string;
  preview: string;
  age: string;
  urgent: boolean;
  unread: boolean;
  /** The one business word the row carries (chipOf), or null for calm rows. */
  chip: BusinessChip | null;
  /** Shelf inside the reply filter; null on every other filter. */
  group: ReplyGroup | null;
  /** Heat score 0-100 (lib/crm/heat.ts) — the flame and the business sorts read it. */
  heat: number;
  /** Prospect row id when one exists — the quick snooze/archive gestures need it. */
  prospectId: string | null;
  email: string;
  /** Next-action label for the hover preview card. */
  next: string | null;
  /** Sourcing confidence, shown on the prospecting filter in place of the age. */
  confidence: 'high' | 'medium' | 'low' | null;
  /** A sleeper whose wake date just arrived — the list marks the return. */
  woke: boolean;
  /**
   * What searchRows matches: the company and the address, in one string, which
   * is exactly what the deleted contact list's search matched. `who` cannot
   * serve here, it collapses to one of the two, and a contact whose company is
   * on the row must stay findable by its address.
   */
  search: string;
}

export interface MailFilter {
  key: MailFilterKey;
  label: string;
  count: number;
}

/**
 * One predicate per filter, used BOTH to count and to select. That shape is
 * inherited from the list this replaces and is the whole point: a filter cannot
 * advertise a number the rows then fail to show, because there is no second copy
 * of the rule to drift from.
 *
 * The two bucket rules come from buckets.ts rather than being spelled out again,
 * which extends the guarantee one ring outwards: the page's own counters read
 * those very functions.
 *
 * `urgent` is a property of the filter, not of the contact. Everything under
 * "À répondre" deserves the accent colour by definition; nothing under "Tous"
 * does, or the colour would stop meaning anything.
 */
const FILTERS: Array<{
  key: MailFilterKey;
  label: string;
  urgent: boolean;
  test: (c: Contact, s: Situation | undefined, snoozed: boolean) => boolean;
}> = [
  { key: 'reply', label: 'À répondre', urgent: true, test: ballWithUs },
  { key: 'followup', label: 'Relances', urgent: false, test: followupDue },
  {
    key: 'new',
    label: 'Nouveaux',
    urgent: false,
    test: (c) => c.kind === 'client' && c.apiKey.isNew,
  },
  // Both business filters read the activation join, never the monthly `used`
  // counter: packs is what makes a buyer a buyer (their paid key's counter
  // stays at zero by construction), and dormant is the API's own verdict.
  { key: 'paying', label: 'Payants', urgent: false, test: (c) => (c.business?.packs ?? 0) > 0 },
  { key: 'dormant', label: 'Endormis', urgent: false, test: (c) => c.business?.status === 'dormant' },
  // The prospecting queue: everyone never written to, the "who do I open
  // with today" view. Same predicate as the overview's sendable-stock figure.
  { key: 'prospect', label: 'À prospecter', urgent: false, test: neverContacted },
  { key: 'clients', label: 'Clients', urgent: false, test: (c) => c.kind === 'client' },
  { key: 'all', label: 'Tous', urgent: false, test: () => true },
];

function pick(input: RowsInput, key: MailFilterKey): Contact[] {
  const filter = FILTERS.find((f) => f.key === key);
  if (!filter) return [];
  return input.contacts.filter((c) => {
    const s = input.situations[c.id];
    // Archived rows surface only under "Tous". They were set aside on purpose,
    // and one reappearing in a work filter undoes the gesture. Today every
    // predicate enforces that on its own (ballWithUs and followupDue test
    // isArchived themselves, "new" and "clients" require a kind only a
    // non-archivable contact can have), so this line decides nothing yet: it
    // states the rule once, filter-side, so a sixth filter or a widened
    // predicate cannot lose it by omission.
    if (key !== 'all' && isArchived(c, s)) return false;
    return filter.test(c, s, input.snoozed[c.id] ?? false);
  });
}

/** The last message carrying the field, searched from the end. */
function lastWith(messages: Message[], field: 'subject' | 'snippet' | 'msg_date'): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const value = messages[i]?.[field];
    if (value) return value;
  }
  return null;
}

/**
 * Days come from the situation, never computed here. `msg_date` carries no
 * timezone and this module runs on the server before the subtree is hydrated, so
 * a UTC server and a browser in Zurich would print two different labels for the
 * same row.
 */
function ageLabel(s: Situation | undefined): string {
  const days = s?.silenceDays;
  if (days === null || days === undefined) return '';
  // Typographic apostrophe, as the page's own context line writes it: two
  // glyphs for the same word on one screen read as a mistake.
  if (days <= 0) return 'aujourd’hui';
  return `${days} j`;
}

function toRow(
  c: Contact,
  s: Situation | undefined,
  urgent: boolean,
  grouped: boolean,
  woke: boolean,
): MailRow {
  return {
    id: c.id,
    // The email is the fallback, not a placeholder: an address is something the
    // operator can act on, whereas "sans nom" is not.
    who: c.company || c.email,
    subject: lastWith(c.messages, 'subject') ?? 'Aucun échange',
    preview: lastWith(c.messages, 'snippet') ?? '',
    age: ageLabel(s),
    urgent,
    chip: chipOf(c),
    // Groups are bands over the reply sort, not a second ordering: unread
    // first then longest silence already lays the rows out urgent → week →
    // later, so the shelf labels can only ever cut that sequence, never
    // contradict it.
    group: grouped ? replyGroupOf(c.unread, s?.silenceDays ?? null) : null,
    heat: heatOf(c, s).score,
    // Projected on every filter, not just "À répondre", so a thread nobody has
    // opened reads the same wherever it is met. `crm-app.tsx` already clears the
    // flag optimistically the moment a row is opened, machinery that had been
    // left running with nothing on the other end of it.
    unread: c.unread,
    prospectId: c.sourcing?.prospectId ?? null,
    woke,
    confidence:
      c.sourcing?.confidence === 'high' || c.sourcing?.confidence === 'medium' || c.sourcing?.confidence === 'low'
        ? c.sourcing.confidence
        : null,
    email: c.email,
    next: s ? NEXT_ACTION_LABEL[s.nextAction] : null,
    // Folded at build time, matched folded: name, address, and the whole
    // thread's subjects and snippets, so "batch" finds the batch conversation.
    search: fold(
      `${c.company ?? ''} ${c.email} ${c.messages.map((m) => `${m.subject ?? ''} ${m.snippet ?? ''}`).join(' ')}`,
    ),
  };
}

/**
 * Fold a string for matching: lowercase, accents stripped. Normalised on BOTH
 * sides — a folded haystack against a raw query silently un-matches every
 * accented search, the exact SQLite LOWER/LIKE lesson learned elsewhere.
 */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Narrow rows to the ones matching the operator's query.
 *
 * Two deliberate widenings over the original list's search: accents fold
 * ("societe" now finds "Société"), and the haystack includes every subject
 * and snippet of the thread, so "batch" retrieves the conversation about
 * batching without remembering who it was with.
 *
 * It narrows rows and never counters. mailFilters() does not read the query,
 * so the counted filters hold still while the operator types; a count that
 * dropped to zero on every keystroke would stop being a way to navigate.
 *
 * A blank or whitespace query returns the rows untouched.
 */
export function searchRows(rows: MailRow[], query: string): MailRow[] {
  const term = fold(query.trim());
  if (!term) return rows;
  return rows.filter((r) => r.search.includes(term));
}

export function mailFilters(input: RowsInput): MailFilter[] {
  return FILTERS.map((f) => ({
    key: f.key,
    label: f.label,
    count: pick(input, f.key).length,
  }));
}

function byId(a: Contact, b: Contact): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function mailRows(input: RowsInput, active: MailFilterKey): MailRow[] {
  const filter = FILTERS.find((f) => f.key === active);
  if (!filter) return [];

  const sorted = [...pick(input, active)].sort((a, b) => {
    // A returned sleeper leads the two queues where its date means "now":
    // the prospecting queue ("call me back in September" has arrived) and the
    // follow-up queue. It was put to sleep WITH a date; the date outranks the
    // standing order, or the wake gesture would bury its own result.
    if (active === 'prospect' || active === 'followup') {
      const wokeA = input.woke?.[a.id] ?? false;
      const wokeB = input.woke?.[b.id] ?? false;
      if (wokeA !== wokeB) return wokeA ? -1 : 1;
    }
    if (active === 'reply') {
      // Unread wins outright, ahead of silence. Both rules existed before this
      // module and only one of them survived the first draft, which inverted the
      // filter: a reply that landed this morning has zero days of silence, so
      // longest-silence-first sent it to the bottom of the very filter meant to
      // catch it. The list this replaces compared unread first for that reason.
      if (a.unread !== b.unread) return a.unread ? -1 : 1;
      // Then longest silence: the thread that has waited longest is closest to
      // being lost. This is the one thing the removed day rail did that the list
      // did not, so it survives here as this filter's behaviour.
      const gap =
        (input.situations[b.id]?.silenceDays ?? 0) - (input.situations[a.id]?.silenceDays ?? 0);
      if (gap !== 0) return gap;
      return byId(a, b);
    }
    if (active === 'prospect') {
      const rank = (c: Contact) =>
        c.sourcing?.confidence === 'high' ? 3 : c.sourcing?.confidence === 'medium' ? 2 : c.sourcing?.confidence === 'low' ? 1 : 0;
      const confGap = rank(b) - rank(a);
      if (confGap !== 0) return confGap;
      const heatGap = heatOf(b, input.situations[b.id]).score - heatOf(a, input.situations[a.id]).score;
      if (heatGap !== 0) return heatGap;
      return byId(a, b);
    }
    if (active === 'clients' || active === 'paying' || active === 'dormant') {
      // Money views rank by heat: the client burning credits outranks the one
      // whose last mail happens to be newer. Date breaks ties.
      const heatGap = heatOf(b, input.situations[b.id]).score - heatOf(a, input.situations[a.id]).score;
      if (heatGap !== 0) return heatGap;
    }
    if (active === 'all') {
      // A prospect never written to leads "Tous", ahead of the recency order.
      // This is the gesture "who have I never written to": it was a named
      // filter ("Jamais contactés") on the deleted list, and with the five
      // keys fixed the owner ruled it a sort under this one filter rather than
      // a sixth key. These rows have no message, so recency alone sinks them
      // dead last, which is how a queue of first mails becomes invisible work;
      // the overview still counts them, and this is the only place left that
      // says WHO. neverContacted is the very predicate the deleted filter
      // read, so its exclusions carry over unchanged: archived rows and
      // snoozed ones stay down, and a client with no thread is a mail-sync
      // gap, not somebody to cold-mail first.
      const coldA = neverContacted(a, input.situations[a.id], input.snoozed[a.id] ?? false);
      const coldB = neverContacted(b, input.situations[b.id], input.snoozed[b.id] ?? false);
      if (coldA !== coldB) return coldA ? -1 : 1;
      // Inside each half, heat first: the warm half ranks like the money
      // views, and the never-contacted half puts the hottest lead on top.
      const heatGap = heatOf(b, input.situations[b.id]).score - heatOf(a, input.situations[a.id]).score;
      if (heatGap !== 0) return heatGap;
    }
    const dateA = lastWith(a.messages, 'msg_date') ?? '';
    const dateB = lastWith(b.messages, 'msg_date') ?? '';
    // ISO-ish strings compare correctly as strings, and comparing them as
    // strings is what keeps this function free of a Date, for the reason
    // ageLabel gives.
    if (dateA !== dateB) return dateA < dateB ? 1 : -1;
    return byId(a, b);
  });

  return sorted.map((c) =>
    toRow(c, input.situations[c.id], filter.urgent, active === 'reply', input.woke?.[c.id] ?? false),
  );
}

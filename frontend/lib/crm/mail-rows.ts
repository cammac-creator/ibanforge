import { isArchived } from './archived';
import { ballWithUs, followupDue, neverContacted } from './buckets';
import { chipOf, replyGroupOf, type BusinessChip, type ReplyGroup } from './business';
import { heatOf } from './heat';
import { nextActionLabel } from './situation';
import type { Contact, Message, NextAction, Situation } from './types';

export type MailFilterKey =
  | 'reply'
  | 'followup'
  | 'new'
  | 'paying'
  | 'dormant'
  | 'drafts'
  | 'clients'
  | 'prospect'
  | 'prospects'
  | 'institution'
  | 'all';

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
  /**
   * What the contact IS, carried onto the row so the table can paint its
   * colour rail without re-opening the union. Three kinds, three colours: the
   * one thing every row says about itself even when it carries no chip, since
   * chips are deliberately rare (see business.ts).
   */
  kind: Contact['kind'];
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
  /**
   * The raw state `next` is a naming of, null when the page built no situation
   * for this contact.
   *
   * Carried as well as the label because the table's Statut column needs both
   * a SHORT name for the same five states and a tone, and neither can be read
   * back off a French sentence. Tone in particular must not be taken from
   * `urgent`: that is a property of the active filter, so under the reply tile
   * every row would go amber at once and the colour would stop meaning
   * anything.
   */
  nextAction: NextAction | null;
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
  // The kind guard is load-bearing, not decorative: institutions only lack a
  // `business` block because build-contacts happens not to join activation for
  // them today. The day that changes, a supervisor must still never land in a
  // money queue.
  { key: 'paying', label: 'Payants', urgent: false, test: (c) => c.kind === 'client' && (c.business?.packs ?? 0) > 0 },
  { key: 'dormant', label: 'Endormis', urgent: false, test: (c) => c.kind === 'client' && c.business?.status === 'dormant' },
  // A draft written and never sent is a follow-up that silently never left:
  // this queue makes every waiting draft countable and findable.
  { key: 'drafts', label: 'Brouillons', urgent: false, test: (c) => c.draft !== null },
  // The prospecting QUEUE: everyone never written to, the "who do I open with
  // today" view. Same predicate as the overview's sendable-stock figure.
  //
  // ⚠ Singular. Its neighbour `prospects` (plural, below) is the POPULATION,
  // everyone whose kind is prospect, written or not. Two different questions
  // one letter apart; the toolbar puts them in two different groups on
  // purpose, this one as a refining chip and the plural as a segment.
  { key: 'prospect', label: 'À prospecter', urgent: false, test: neverContacted },
  { key: 'clients', label: 'Clients', urgent: false, test: (c) => c.kind === 'client' },
  /**
   * The prospect POPULATION, the counterpart of `clients` and `institution`:
   * everyone of that kind, whatever the state of their thread.
   *
   * ⚠ Plural. `prospect` (singular, above) is the never-contacted queue and is
   * a strict subset of this one. The segment needs the whole population, or
   * "Prospects" would silently hide every prospect already written to — which
   * is most of them once a campaign has run.
   */
  { key: 'prospects', label: 'Prospects', urgent: false, test: (c) => c.kind === 'prospect' },
  /**
   * The written correspondence with institutions: authorities, central banks,
   * payment schemes, registries, suppliers. The answer to "where is the reply
   * to the permission letter we sent them", which nothing else on this page
   * could answer, since these threads sat in no filter but "Tous".
   *
   * What this key is NOT is as deliberate as what it is. An institution enters
   * neither "Clients" nor "À prospecter": the first tests the kind, and the
   * second reads neverContacted, which requires a prospect, so a supervisor can
   * never appear in a queue of cold first mails. Nor does it reach the two
   * money filters, which read the activation join a correspondent has no row in.
   *
   * It DOES stay in "À répondre" and "Relances", and that is the point rather
   * than an oversight: an authority that answered and is waiting on us is the
   * most expensive thing on this page to forget, and those two predicates ask
   * about the thread, not about who is on the other end.
   */
  { key: 'institution', label: 'Correspondances', urgent: false, test: (c) => c.kind === 'institution' },
  { key: 'all', label: 'Tous', urgent: false, test: () => true },
];

/** Every key there is, in the order the filters are declared above. */
export const MAIL_FILTER_KEYS: MailFilterKey[] = FILTERS.map((f) => f.key);

/**
 * The contacts satisfying EVERY key handed in — one predicate per key, joined
 * by AND. One key is the old single-filter reading; several is the toolbar's,
 * where a population, a work queue and a refining chip narrow each other.
 *
 * `bare` is "nothing is being asked of this view": the whole base, no queue, no
 * chip. Archived rows surface there and nowhere else. They were set aside on
 * purpose, and one reappearing in a work filter undoes the gesture. Today every
 * predicate enforces that on its own (ballWithUs and followupDue test
 * isArchived themselves, "new" and "clients" require a kind only a
 * non-archivable contact can have), so this line decides nothing yet: it states
 * the rule once, filter-side, so a further filter or a widened predicate cannot
 * lose it by omission.
 *
 * An unknown key yields nothing rather than being skipped: skipping would
 * WIDEN the answer, which is the dangerous direction for a queue of people to
 * write to.
 */
function pickBy(input: RowsInput, keys: MailFilterKey[], bare: boolean): Contact[] {
  const chosen = keys.map((k) => FILTERS.find((f) => f.key === k));
  if (chosen.some((f) => f === undefined)) return [];
  const tests = chosen.filter((f) => f !== undefined);
  return input.contacts.filter((c) => {
    const s = input.situations[c.id];
    if (!bare && isArchived(c, s)) return false;
    const snoozed = input.snoozed[c.id] ?? false;
    return tests.every((f) => f.test(c, s, snoozed));
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
/**
 * What `age` says of a message dated today. Typographic apostrophe, as the
 * page's own context line writes it: two glyphs for the same word on one screen
 * read as a mistake.
 *
 * Exported so the table's abbreviated form can RECOGNISE this label instead of
 * spelling the French a second time and un-matching the day somebody fixes the
 * apostrophe here.
 */
export const AGE_TODAY = 'aujourd’hui';

function ageLabel(s: Situation | undefined): string {
  const days = s?.silenceDays;
  if (days === null || days === undefined) return '';
  if (days <= 0) return AGE_TODAY;
  return `${days} j`;
}

/** What a correspondent adds to the search haystack, and nothing for anyone else. */
function institutionSearch(c: Contact): string {
  if (c.kind !== 'institution') return '';
  const i = c.institution;
  return [i.category, i.role ?? '', i.dossier ?? ''].join(' ');
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
    kind: c.kind,
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
    next: s ? nextActionLabel(s.nextAction, c.kind) : null,
    nextAction: s?.nextAction ?? null,
    // Folded at build time, matched folded: name, address, and the whole
    // thread's subjects and snippets, so "batch" finds the batch conversation.
    //
    // A correspondent adds its category and its file line. That is what the
    // operator actually remembers about an authority months later — "the
    // registry we asked about redistribution" — rather than the desk's address
    // or the subject a clerk chose.
    search: fold(
      `${c.company ?? ''} ${c.email} ${institutionSearch(c)} ${c.messages.map((m) => `${m.subject ?? ''} ${m.snippet ?? ''}`).join(' ')}`,
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

/**
 * One count per key, each read against the WHOLE base rather than against
 * whatever the toolbar currently shows.
 *
 * Deliberate, and the reason the tiles can be trusted: "À répondre 9" means
 * nine threads are waiting on us, full stop. A count that moved when a segment
 * was pressed would say "nine among the clients", which is a different sentence
 * and one nobody asked. It is also what makes "Brouillons only when > 0" a
 * well-defined rule instead of a flicker.
 */
export function mailFilters(input: RowsInput): MailFilter[] {
  return FILTERS.map((f) => ({
    key: f.key,
    label: f.label,
    count: pickBy(input, [f.key], f.key === 'all').length,
  }));
}

function byId(a: Contact, b: Contact): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * What the toolbar is asking for: three independent axes, exactly as the
 * approved layout draws them.
 *
 * One population at all times (the segmented control cannot be empty), at most
 * one work queue (the counted tiles, which toggle) and at most one refining
 * chip. They narrow each other — "the clients whose follow-up is due" is one
 * question the old single-key list could not ask at all.
 */
export interface RowSelection {
  /** The segmented control: 'all' | 'clients' | 'prospects' | 'institution'. */
  population: MailFilterKey;
  /** A pressed work tile, or nothing. */
  work?: MailFilterKey | null;
  /** A pressed refining chip, or nothing. */
  refine?: MailFilterKey | null;
}

/**
 * Which single key decides the ORDER, the urgency accent and the reply shelves
 * when several are active.
 *
 * The narrowest wins, and narrowest here means "the one that answers a
 * question": a pressed tile is the day's work, then a chip, and the population
 * only if neither is pressed. Pressing "À répondre" while standing on Clients
 * must still sort unread-first — that ordering is the whole value of the queue,
 * and it would be lost if the population decided.
 */
function dominantKey(sel: RowSelection): MailFilterKey {
  return sel.work ?? sel.refine ?? sel.population;
}

/**
 * The rows the toolbar's current state selects.
 *
 * Additive to mailRows rather than a replacement: every predicate, every
 * comparator and every projection below is the same code the single-key
 * reading uses, so the counted tiles and the composed table cannot drift.
 * `selectedRows(input, { population: 'all', work: k })` is `mailRows(input, k)`
 * for every k, and a test pins exactly that.
 */
export function selectedRows(input: RowsInput, sel: RowSelection): MailRow[] {
  const keys = [sel.population, sel.work, sel.refine].filter((k): k is MailFilterKey => !!k);
  const active = dominantKey(sel);
  if (!FILTERS.some((f) => f.key === active)) return [];
  // "Nothing is being asked": the whole base, no queue, no chip. Written as
  // "every key is 'all'" rather than "population is 'all' and the other two are
  // empty", so that asking for 'all' twice stays the same question as asking
  // for it once — which is what makes the bridge to mailRows hold for EVERY
  // key, 'all' included. See pickBy.
  const bare = keys.every((k) => k === 'all');
  return project(input, order(input, pickBy(input, keys, bare), active), active);
}

export function mailRows(input: RowsInput, active: MailFilterKey): MailRow[] {
  if (!FILTERS.some((f) => f.key === active)) return [];
  return project(input, order(input, pickBy(input, [active], active === 'all'), active), active);
}

/** The one ordering, read by both readings above. */
function order(input: RowsInput, contacts: Contact[], active: MailFilterKey): Contact[] {
  return [...contacts].sort((a, b) => {
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
    if (active === 'institution') {
      // Unread first, then the date fall-through below. Heat is deliberately
      // not consulted, and NOT because it is zero here: heatFromFacts scores
      // conversation facts that have nothing to do with the kind — an active
      // exchange, a ball in our court, a long silence — so a correspondent we
      // write to regularly carries a real score. It is not consulted because
      // that score measures a COMMERCIAL temperature, how close somebody is to
      // buying, and no arrangement of it says anything about which authority to
      // answer first. "Which of these answered, and which answered longest ago"
      // is the whole question this filter is opened with.
      if (a.unread !== b.unread) return a.unread ? -1 : 1;
    }
    if (active === 'clients' || active === 'paying' || active === 'dormant') {
      // Money views rank by heat: the client burning credits outranks the one
      // whose last mail happens to be newer. Date breaks ties.
      const heatGap = heatOf(b, input.situations[b.id]).score - heatOf(a, input.situations[a.id]).score;
      if (heatGap !== 0) return heatGap;
    }
    // 'prospects' rides with 'all' rather than falling through to recency, and
    // for the reason spelled out below: a prospect never written to has no
    // message, so recency alone sinks the entire point of the segment to the
    // bottom of its own list.
    if (active === 'all' || active === 'prospects') {
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
}

/**
 * The one projection, read by both readings above.
 *
 * `urgent` and the reply shelves are properties of the ACTIVE key, never of the
 * contact — see the note on FILTERS. Under the composed reading that key is the
 * dominant one, so "the clients whose reply is due" wears the accent and the
 * shelves exactly as the plain reply queue does.
 */
function project(input: RowsInput, contacts: Contact[], active: MailFilterKey): MailRow[] {
  const filter = FILTERS.find((f) => f.key === active);
  if (!filter) return [];
  return contacts.map((c) =>
    toRow(c, input.situations[c.id], filter.urgent, active === 'reply', input.woke?.[c.id] ?? false),
  );
}

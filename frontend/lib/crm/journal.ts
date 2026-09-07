import type { MessageRow } from './build-contacts';
import { dayLabel, isoDay, shiftDay } from './format';
import { fold } from './mail-rows';
import type { Contact, Message } from './types';

/**
 * The mail journal: every message of every contact on one antichronological
 * list, instead of one thread at a time behind a contact you have to think of
 * first.
 *
 * ## Why it exists
 *
 * Since 07/09/2026 part of the mail leaves without a click: the agent writes to
 * the authorities from the operator's mailbox and records each send as an
 * ordinary 'out' row. The CRM could show every one of those letters — inside
 * the fiche of the correspondent it was written to, which is the one place you
 * only reach if you already suspect there is something to see. "What went out
 * today, and did I send it or did it send itself" had no screen.
 *
 * ## The one rule worth stating twice
 *
 * An origin is a property of a DEPARTURE. A received message has no sender on
 * our side and a draft has not left, so both carry `origin: null` here, and the
 * origin filter therefore only ever narrows what went out. The alternative —
 * folding "no origin recorded" into "the mailbox" for every row — would make
 * "messagerie" select the whole inbox and mean nothing.
 *
 * ## No Date, anywhere
 *
 * Every date in this module is the stored string. The page decides the day once
 * (Europe/Zurich) and hands it down as `todayIso`; the window and the shelves
 * compare 'YYYY-MM-DD' as text. The list is server-rendered and then filtered
 * again in the browser after hydration, so a `new Date()` in here would give
 * two different answers on the two sides of that boundary — the defect
 * lib/crm/format.ts and lib/crm/snapshot.ts each carry a header about.
 */

/** What a line is: mail that arrived, mail that left, mail still unsent. */
export type JournalDirection = 'in' | 'out' | 'draft';

/**
 * Who pressed send.
 *
 * 'mailbox' is the fallback for a departure carrying no `origin`: a copy the
 * nightly IMAP sync read back, or a row written before the column existed. It
 * is a truthful third value rather than an "unknown" hole — the mail did leave
 * the mailbox, we just have nothing saying which surface wrote it.
 */
export type SendOrigin = 'claude' | 'dashboard' | 'mailbox';

export interface JournalContact {
  /** Lowercased address, the CRM's join key and what the deep link carries. */
  id: string;
  email: string;
  /** The company, or the address when there is no company. */
  label: string;
  kind: Contact['kind'];
}

export interface JournalRow {
  /** Stable across renders: the stored message id, or the contact and rank. */
  id: string;
  /** The stamp as stored, e.g. '2026-09-07T08:15:00'. Never a Date. */
  date: string;
  /** Its 'YYYY-MM-DD' prefix — what the window and the shelves compare. */
  day: string;
  direction: JournalDirection;
  /** Null on anything that did not leave. See the header. */
  origin: SendOrigin | null;
  contact: JournalContact;
  subject: string;
  /** One line of preview. */
  snippet: string;
  /** Folded haystack for the search box: contact, address, subject, preview. */
  search: string;
}

/** The periods the page offers, and the one it opens on. */
export const JOURNAL_PERIODS: readonly number[] = [7, 14, 30, 90];
export const DEFAULT_PERIOD = 14;

export interface JournalFilter {
  direction: JournalDirection | 'all';
  origin: SendOrigin | 'all';
  /** Calendar days ending today, today included. See withinPeriod. */
  days: number;
  query: string;
}

export const DEFAULT_JOURNAL_FILTER: JournalFilter = {
  direction: 'all',
  origin: 'all',
  days: DEFAULT_PERIOD,
  query: '',
};

/**
 * The direction of a stored row, narrowed to the three the CRM writes.
 *
 * Anything unexpected reads as 'in', which is the same fallback the ingester
 * applies server-side (see src/routes/api-keys.ts): a row we cannot classify is
 * shown as something that arrived, never as something we sent — an invented
 * departure is the one error that would make this page lie about its subject.
 */
function directionOf(m: Message): JournalDirection {
  return m.direction === 'out' ? 'out' : m.direction === 'draft' ? 'draft' : 'in';
}

/** Who sent it, or null when nothing left. See the header. */
function originOf(m: Message, direction: JournalDirection): SendOrigin | null {
  if (direction !== 'out') return null;
  return m.origin === 'claude' || m.origin === 'dashboard' ? m.origin : 'mailbox';
}

/**
 * The preview line: the French translation when we hold one, else the stored
 * snippet. Same default as the thread, and for the same reason — a journal line
 * in a language the reader does not have is a line that has to be opened to be
 * read, which is exactly what a journal is supposed to spare.
 */
function previewOf(m: Message): string {
  return (m.snippet_fr || m.snippet || '').replace(/\s+/g, ' ').trim();
}

/**
 * Every message of every contact, newest first.
 *
 * 🚨 Rows we cannot place on a day are DROPPED, not sorted last. msg_date is
 * free-form TEXT filled by the ingester, and a row without a readable day can
 * be in no window, on no shelf and at no rank — it would sit at one end of the
 * list forever, in every period at once, and make the summary above it false.
 * That is the same reading `datedAscending` and the admin endpoint's `since`
 * cut already apply to this column. Nothing the CRM writes is affected: the
 * draft route stamps every draft, and a send stamps its own row.
 *
 * Ties are broken on the id so the order is a total one: two mails of the same
 * minute must not swap places between the server's render and the browser's.
 */
export function journalRows(contacts: Contact[]): JournalRow[] {
  const rows: JournalRow[] = [];
  for (const c of contacts) {
    const contact: JournalContact = {
      id: c.id,
      email: c.email,
      label: c.company || c.email || c.id,
      kind: c.kind,
    };
    // The draft is carried beside the thread rather than inside it (see
    // ContactBase), so both have to be walked or the unsent mail — the one
    // thing on this page nobody else will remind him about — never appears.
    const all: Message[] = c.draft ? [...c.messages, c.draft] : c.messages;
    for (let i = 0; i < all.length; i += 1) {
      const m = all[i];
      const day = isoDay(m.msg_date);
      if (!day || !m.msg_date) continue;
      const direction = directionOf(m);
      const subject = (m.subject ?? '').trim();
      const snippet = previewOf(m);
      rows.push({
        id: m.id || `${c.id}#${i}`,
        date: m.msg_date,
        day,
        direction,
        origin: originOf(m, direction),
        contact,
        subject,
        snippet,
        search: fold(`${contact.label} ${contact.email} ${subject} ${snippet}`),
      });
    }
  }
  return rows.sort((a, b) => (a.date === b.date ? cmp(a.id, b.id) : cmp(b.date, a.date)));
}

/** String order, spelt out so no call site reaches for localeCompare. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The rows of the last `days` calendar days, today included — so 7 is a week
 * and not eight days.
 *
 * No upper bound on purpose. A row can be dated slightly ahead of the page's
 * Zurich day (the send route stamps in UTC, and a mailbox's own Date header is
 * whatever the sending client said), and a journal that silently hid the mail
 * that just left would be worse than useless. Everything since the cutoff.
 *
 * An unreadable `todayIso` widens to everything rather than emptying the page:
 * the failure of a clock must not look like the absence of mail.
 */
export function withinPeriod(rows: JournalRow[], days: number, todayIso: string): JournalRow[] {
  const cutoff = shiftDay(todayIso, -(Math.max(1, days) - 1));
  if (!cutoff) return rows;
  return rows.filter((r) => r.day >= cutoff);
}

/**
 * The rows the controls currently select: the period, then the three narrowing
 * axes, joined by AND.
 *
 * The period is applied here as well as by the summary's own call, rather than
 * being left to the caller: a page that windowed one and not the other would
 * show a list and a sentence about two different fortnights.
 */
export function filterJournal(
  rows: JournalRow[],
  filter: JournalFilter,
  todayIso: string,
): JournalRow[] {
  let out = withinPeriod(rows, filter.days, todayIso);
  if (filter.direction !== 'all') out = out.filter((r) => r.direction === filter.direction);
  // Only ever narrows departures, by construction: every other row's origin is
  // null and matches nothing. Asking for "reçus" and "par Claude" at once is
  // therefore empty, which is the honest answer — the agent sends, it does not
  // receive — and the page says so in words rather than showing a wrong list.
  if (filter.origin !== 'all') out = out.filter((r) => r.origin === filter.origin);
  const term = fold(filter.query.trim());
  if (term) out = out.filter((r) => r.search.includes(term));
  return out;
}

export interface JournalSummary {
  sent: number;
  byClaude: number;
  byDashboard: number;
  /** Departures with no origin recorded: read back from the mailbox. */
  byMailbox: number;
  received: number;
  drafts: number;
}

/**
 * What the period holds, counted BEFORE the three narrowing axes.
 *
 * Deliberate, and the whole value of the line: the sentence describes the
 * fortnight, not the filter. Counted after them it would be a tautology —
 * "3 envoyés" while standing on Envoyés says nothing — and the one question
 * this page exists for ("how much of what left, left without me") would need
 * two clicks and a subtraction to answer.
 */
export function journalSummary(rows: JournalRow[]): JournalSummary {
  const s: JournalSummary = {
    sent: 0,
    byClaude: 0,
    byDashboard: 0,
    byMailbox: 0,
    received: 0,
    drafts: 0,
  };
  for (const r of rows) {
    if (r.direction === 'in') s.received += 1;
    else if (r.direction === 'draft') s.drafts += 1;
    else {
      s.sent += 1;
      if (r.origin === 'claude') s.byClaude += 1;
      else if (r.origin === 'dashboard') s.byDashboard += 1;
      else s.byMailbox += 1;
    }
  }
  return s;
}

export interface JournalDay {
  /** 'YYYY-MM-DD' — the React key, and what the shelves are ordered on. */
  day: string;
  /** « aujourd'hui », « hier », « lundi 7 septembre ». */
  label: string;
  rows: JournalRow[];
}

/**
 * The list, shelved by day. Assumes the antichronological order journalRows
 * gives, and preserves it: a run of one day ends where the next begins.
 */
export function groupByDay(rows: JournalRow[], todayIso: string): JournalDay[] {
  const out: JournalDay[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.day === r.day) last.rows.push(r);
    else out.push({ day: r.day, label: dayLabel(r.date, todayIso) ?? r.day, rows: [r] });
  }
  return out;
}

/**
 * Messages the contact list claims none of.
 *
 * `email_messages` is keyed by address and knows nothing of who holds a key;
 * `buildContacts` only emits a contact for a key holder, a prospect row or a
 * registered correspondent. So a letter written to an authority that was never
 * added to the registry has a stored row and no contact — and would be missing,
 * silently, from the page built to prove nothing is missing.
 *
 * One number, deliberately unscoped by date: it answers "is this list the whole
 * story", which is not a question about a fortnight. The page shows it only
 * when it is not zero, and says what to do about it.
 */
export function unattachedCount(messages: MessageRow[], contacts: Contact[]): number {
  const known = new Set(contacts.map((c) => c.id));
  let n = 0;
  for (const m of messages) {
    const email = typeof m.customer_email === 'string' ? m.customer_email.toLowerCase() : '';
    if (!email || !known.has(email)) n += 1;
  }
  return n;
}

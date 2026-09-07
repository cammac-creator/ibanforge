import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JOURNAL_FILTER,
  filterJournal,
  groupByDay,
  journalRows,
  journalSummary,
  unattachedCount,
  withinPeriod,
  type JournalFilter,
} from './journal';
import type { MessageRow } from './build-contacts';
import type { Contact, Message } from './types';

/** The page's day, decided once in Europe/Zurich, exactly as the page does. */
const TODAY = '2026-09-07';

function msg(over: Partial<Message>): Message {
  return {
    direction: 'in',
    msg_date: `${TODAY}T09:00:00`,
    subject: 'Objet',
    snippet: 'Un aperçu',
    counterparty: null,
    ...over,
  };
}

/** A client, a prospect or a correspondent, with a thread and maybe a draft. */
function contact(over: {
  id: string;
  kind: Contact['kind'];
  company?: string | null;
  messages?: Message[];
  draft?: Message | null;
}): Contact {
  const base = {
    id: over.id,
    email: over.id,
    company: over.company ?? null,
    country: null,
    website: null,
    messages: over.messages ?? [],
    draft: over.draft ?? null,
    unread: false,
    account: 'contact@alpha.example.net',
  };
  if (over.kind === 'prospect') {
    return {
      ...base,
      kind: 'prospect',
      sourcing: {
        prospectId: over.id,
        segment: null,
        whatTheyDo: null,
        fitReason: null,
        buyingSignal: null,
        signalSourceUrl: null,
        contactName: null,
        contactRole: null,
        emailSourceUrl: null,
        personalizationHook: null,
        confidence: null,
        status: 'a_mailer',
        source: null,
        createdAt: null,
        outcome: null,
        outcomeNote: null,
        wakeUpAt: null,
        outcomeAt: null,
      },
      readyMail: null,
    };
  }
  if (over.kind === 'institution') {
    return {
      ...base,
      kind: 'institution',
      institution: {
        org: over.company ?? 'Autorité Alpha',
        category: 'autorite',
        country: 'CH',
        role: null,
        website: null,
        dossier: null,
      },
    };
  }
  return {
    ...base,
    kind: 'client',
    apiKey: {
      keyPrefix: `ifk_${over.id}`,
      paid: false,
      creditsTotal: null,
      creditsRemaining: null,
      monthlyLimit: 200,
      usedAllTime: 0,
      lastActiveMonth: null,
      createdAt: null,
      issuedByUs: false,
      isNew: false,
    },
    usage: { series: [], months: [], days: [], endpoints: [] },
  };
}

/**
 * Two clients, a prospect and a correspondent, with mail in both directions,
 * three origins and one draft — the fixture every test below reads.
 */
const CONTACTS: Contact[] = [
  contact({
    id: 'acme@example.net',
    kind: 'client',
    company: 'Société Alpha',
    messages: [
      msg({ id: 'a1', direction: 'in', msg_date: `${TODAY}T08:00`, subject: 'Question quota' }),
      msg({
        id: 'a2',
        direction: 'out',
        msg_date: `${TODAY}T08:30`,
        subject: 'Réponse quota',
        origin: 'dashboard',
      }),
    ],
    draft: msg({ id: 'a3', direction: 'draft', msg_date: `${TODAY}T09:10`, subject: 'Suite' }),
  }),
  contact({
    id: 'beta@example.net',
    kind: 'client',
    company: 'Société Bêta',
    messages: [
      // Old enough to fall out of a fortnight but not out of a quarter.
      msg({ id: 'b1', direction: 'out', msg_date: '2026-08-10T11:00', origin: 'dashboard' }),
      // A copy read back from the mailbox: nothing said who wrote it.
      msg({ id: 'b2', direction: 'out', msg_date: '2026-09-02T15:00', subject: 'Relance' }),
    ],
  }),
  contact({
    id: 'gamma@example.net',
    kind: 'prospect',
    company: 'Société Gamma',
    messages: [
      msg({
        id: 'g1',
        direction: 'out',
        msg_date: '2026-09-05T07:45',
        subject: 'Présentation',
        origin: 'dashboard',
      }),
    ],
  }),
  contact({
    id: 'registry@alpha.example.net',
    kind: 'institution',
    company: 'Autorité Alpha',
    messages: [
      msg({
        id: 'r1',
        direction: 'out',
        msg_date: '2026-09-07T07:15',
        subject: 'Demande de réutilisation',
        snippet: 'Nous sollicitons une autorisation',
        origin: 'claude',
      }),
      msg({
        id: 'r2',
        direction: 'out',
        msg_date: '2026-09-06T18:20',
        subject: 'Complément',
        origin: 'claude',
      }),
      // A message whose stored stamp cannot be read as a day at all.
      msg({ id: 'r3', direction: 'in', msg_date: 'hier soir', subject: 'Accusé' }),
    ],
  }),
];

const ALL = journalRows(CONTACTS);
const filter = (over: Partial<JournalFilter>): JournalFilter => ({
  ...DEFAULT_JOURNAL_FILTER,
  ...over,
});

describe('journalRows', () => {
  it('flattens every thread, the drafts included, newest first', () => {
    expect(ALL.map((r) => r.id)).toEqual(['a3', 'a2', 'a1', 'r1', 'r2', 'g1', 'b2', 'b1']);
  });

  it('drops what it cannot place on a day rather than sorting it last', () => {
    // A row with no readable day belongs to no period and to no shelf; kept, it
    // would sit in every window at once and make the summary above it false.
    expect(ALL.some((r) => r.id === 'r3')).toBe(false);
  });

  it('carries the contact, so a line names who it is with', () => {
    const row = ALL.find((r) => r.id === 'r1')!;
    expect(row.contact.label).toBe('Autorité Alpha');
    expect(row.contact.kind).toBe('institution');
    expect(row.contact.id).toBe('registry@alpha.example.net');
  });

  it('gives an origin to departures only', () => {
    const byId = new Map(ALL.map((r) => [r.id, r]));
    expect(byId.get('r1')!.origin).toBe('claude');
    expect(byId.get('a2')!.origin).toBe('dashboard');
    // Sent, but nothing said by whom: read back from the mailbox.
    expect(byId.get('b2')!.origin).toBe('mailbox');
    // Neither of these left, so neither has a sender on our side.
    expect(byId.get('a1')!.origin).toBe(null);
    expect(byId.get('a3')!.origin).toBe(null);
  });
});

describe('withinPeriod', () => {
  it('counts calendar days ending today, so 7 is a week', () => {
    // 2026-09-01 is the seventh day back from the 7th, inclusive.
    const rows = journalRows([
      contact({
        id: 'edge@example.net',
        kind: 'client',
        messages: [
          msg({ id: 'in', direction: 'out', msg_date: '2026-09-01T23:59' }),
          msg({ id: 'out', direction: 'out', msg_date: '2026-08-31T00:01' }),
        ],
      }),
    ]);
    expect(withinPeriod(rows, 7, TODAY).map((r) => r.id)).toEqual(['in']);
  });

  it('keeps a row dated ahead of the page rather than hiding it', () => {
    // The send route stamps in UTC while the page's day is Zurich, and a
    // mailbox's own Date header is whatever the sending client claimed. Hiding
    // the mail that just left would be the worst failure this page can have.
    const rows = journalRows([
      contact({
        id: 'ahead@example.net',
        kind: 'client',
        messages: [msg({ id: 'ahead', direction: 'out', msg_date: '2026-09-08T02:00' })],
      }),
    ]);
    expect(withinPeriod(rows, 14, TODAY).map((r) => r.id)).toEqual(['ahead']);
  });

  it('widens to everything when the clock cannot be read', () => {
    expect(withinPeriod(ALL, 14, 'pas une date')).toHaveLength(ALL.length);
  });
});

describe('filterJournal', () => {
  it('opens on a fortnight, everything, in order', () => {
    // b1 is the only row older than the default period.
    expect(filterJournal(ALL, DEFAULT_JOURNAL_FILTER, TODAY).map((r) => r.id)).toEqual([
      'a3',
      'a2',
      'a1',
      'r1',
      'r2',
      'g1',
      'b2',
    ]);
  });

  it('widens to the quarter, which is what brings the oldest back', () => {
    expect(filterJournal(ALL, filter({ days: 90 }), TODAY).map((r) => r.id)).toContain('b1');
  });

  it('narrows on the direction', () => {
    expect(filterJournal(ALL, filter({ direction: 'in' }), TODAY).map((r) => r.id)).toEqual(['a1']);
    expect(filterJournal(ALL, filter({ direction: 'draft' }), TODAY).map((r) => r.id)).toEqual([
      'a3',
    ]);
    expect(filterJournal(ALL, filter({ direction: 'out' }), TODAY).map((r) => r.id)).toEqual([
      'a2',
      'r1',
      'r2',
      'g1',
      'b2',
    ]);
  });

  it('answers the question the page was built for: what left without a click', () => {
    expect(filterJournal(ALL, filter({ origin: 'claude' }), TODAY).map((r) => r.id)).toEqual([
      'r1',
      'r2',
    ]);
    expect(filterJournal(ALL, filter({ origin: 'dashboard' }), TODAY).map((r) => r.id)).toEqual([
      'a2',
      'g1',
    ]);
    expect(filterJournal(ALL, filter({ origin: 'mailbox' }), TODAY).map((r) => r.id)).toEqual([
      'b2',
    ]);
  });

  it('finds nothing rather than something wrong when the two axes disagree', () => {
    // The agent sends, it does not receive. An empty list is the truthful
    // answer, and the page says so in words.
    expect(filterJournal(ALL, filter({ direction: 'in', origin: 'claude' }), TODAY)).toEqual([]);
  });

  it('searches the contact, the subject and the preview, accents folded', () => {
    expect(filterJournal(ALL, filter({ query: 'autorite' }), TODAY).map((r) => r.id)).toEqual([
      'r1',
      'r2',
    ]);
    expect(filterJournal(ALL, filter({ query: 'QUOTA' }), TODAY).map((r) => r.id)).toEqual([
      'a2',
      'a1',
    ]);
    expect(filterJournal(ALL, filter({ query: 'sollicitons' }), TODAY).map((r) => r.id)).toEqual([
      'r1',
    ]);
  });

  it('joins the axes rather than replacing one with another', () => {
    // 'alpha' alone matches five rows across two contacts, in all three
    // directions; with Envoyés pressed it must be the intersection, not either.
    expect(filterJournal(ALL, filter({ query: 'alpha' }), TODAY).map((r) => r.id)).toEqual([
      'a3',
      'a2',
      'a1',
      'r1',
      'r2',
    ]);
    expect(
      filterJournal(ALL, filter({ direction: 'out', query: 'alpha' }), TODAY).map((r) => r.id),
    ).toEqual(['a2', 'r1', 'r2']);
  });
});

describe('journalSummary', () => {
  it('describes the period, not the filter', () => {
    const period = withinPeriod(ALL, 14, TODAY);
    expect(journalSummary(period)).toEqual({
      sent: 5,
      byClaude: 2,
      byDashboard: 2,
      byMailbox: 1,
      received: 1,
      drafts: 1,
    });
  });

  it('adds up: every departure carries exactly one origin', () => {
    const s = journalSummary(withinPeriod(ALL, 90, TODAY));
    expect(s.byClaude + s.byDashboard + s.byMailbox).toBe(s.sent);
  });
});

describe('groupByDay', () => {
  it('shelves the list by day, in the order the rows already have', () => {
    const days = groupByDay(filterJournal(ALL, DEFAULT_JOURNAL_FILTER, TODAY), TODAY);
    expect(days.map((d) => d.day)).toEqual([
      '2026-09-07',
      '2026-09-06',
      '2026-09-05',
      '2026-09-02',
    ]);
    expect(days[0].label).toBe('aujourd’hui');
    expect(days[1].label).toBe('hier');
    expect(days[2].label).toBe('samedi 5 septembre');
    expect(days[0].rows.map((r) => r.id)).toEqual(['a3', 'a2', 'a1', 'r1']);
  });

  it('has nothing to shelve when nothing matched', () => {
    expect(groupByDay([], TODAY)).toEqual([]);
  });
});

describe('unattachedCount', () => {
  const row = (email: string): MessageRow => ({
    customer_email: email,
    id: `x-${email}`,
    direction: 'out',
    msg_date: `${TODAY}T10:00`,
    subject: 'Lettre',
    snippet: '…',
    counterparty: null,
  });

  it('counts the mail no contact claims, which is what the page cannot show', () => {
    // A letter to an authority nobody added to the registry has a stored row
    // and no contact: invisible on the page built to prove nothing is missing.
    const messages = [row('ACME@example.net'), row('inconnu@example.net')];
    expect(unattachedCount(messages, CONTACTS)).toBe(1);
  });

  it('is zero when every address is known, whatever its case', () => {
    expect(unattachedCount([row('Registry@Alpha.Example.NET')], CONTACTS)).toBe(0);
  });
});

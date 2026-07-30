import { describe, expect, it } from 'vitest';
import { mailFilters, mailRows, searchRows, type RowsInput } from './mail-rows';
import type { Contact, Message, ProspectSourcing, Situation } from './types';

function message(direction: Message['direction'], subject: string, snippet: string, msg_date: string): Message {
  return { direction, msg_date, subject, snippet, counterparty: 'acme@example.com' };
}

function client(id: string, company: string, messages: Message[], isNew = false): Contact {
  return {
    kind: 'client',
    id,
    email: id,
    company,
    country: 'CH',
    website: null,
    messages,
    draft: null,
    unread: false,
    account: 'desk@example.com',
    apiKey: {
      keyPrefix: 'ifk_test',
      paid: false,
      creditsTotal: null,
      creditsRemaining: null,
      monthlyLimit: 200,
      usedAllTime: 4,
      lastActiveMonth: '2026-07',
      createdAt: '2026-01-01',
      isNew,
    },
    usage: { series: [], months: [], days: [], endpoints: [] },
  };
}

function sourcing(id: string, status: string): ProspectSourcing {
  return {
    prospectId: id,
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
    status,
    source: null,
    outcome: null,
    outcomeNote: null,
    wakeUpAt: null,
    outcomeAt: null,
  };
}

function prospect(id: string, company: string, messages: Message[], status = 'a_mailer'): Contact {
  return {
    kind: 'prospect',
    id,
    email: id,
    company,
    country: 'CH',
    website: null,
    messages,
    draft: null,
    unread: false,
    account: 'desk@example.com',
    sourcing: sourcing(id, status),
    readyMail: null,
  };
}

function situation(over: Partial<Situation>): Situation {
  // 'wait' rather than 'none': NextAction is
  // 'first_mail' | 'reply' | 'followup' | 'firm_offer' | 'wait', and there is no
  // 'none'. No cast here on purpose, so a future change to Situation breaks this
  // fixture at compile time instead of silently.
  return {
    ballInCourt: 'none',
    silenceDays: null,
    followupDue: false,
    firstContactAt: null,
    hasEverReplied: false,
    messageCount: 0,
    nextAction: 'wait',
    ...over,
  };
}

const alpha = client('alpha@example.com', 'Société Alpha', [
  message('out', 'Prise de contact', 'Bonjour, je vous écris au sujet de', '2026-07-01'),
  message('in', 'Prise de contact', 'Merci, une question sur le format', '2026-07-28'),
]);
const beta = client('beta@example.com', 'Société Beta', [
  message('out', 'Relance', 'Je reviens vers vous', '2026-06-01'),
]);

const input: RowsInput = {
  contacts: [alpha, beta],
  situations: {
    'alpha@example.com': situation({ ballInCourt: 'us', silenceDays: 2 }),
    'beta@example.com': situation({ followupDue: true, silenceDays: 40 }),
  },
  snoozed: {},
};

describe('mailFilters', () => {
  it('puts the one that demands an answer first', () => {
    expect(mailFilters(input)[0]?.key).toBe('reply');
  });

  it('counts what its own filter would show, so a count cannot lie', () => {
    for (const filter of mailFilters(input)) {
      expect(mailRows(input, filter.key)).toHaveLength(filter.count);
    }
  });
});

describe('mailRows', () => {
  it('projects three readable levels per row', () => {
    const [row] = mailRows(input, 'reply');
    expect(row?.who).toBe('Société Alpha');
    expect(row?.subject).toBe('Prise de contact');
    expect(row?.preview).toBe('Merci, une question sur le format');
    expect(row?.age).toBe('2 j');
  });

  it('labels the age from the situation, never from a clock', () => {
    // Three branches of user-visible French text. Untested, a wrong label would
    // reach the column and only be noticed by reading it there.
    const withDays = (silenceDays: number | null) => ({
      ...input,
      contacts: [alpha],
      situations: { 'alpha@example.com': situation({ ballInCourt: 'us', silenceDays }) },
    });
    expect(mailRows(withDays(0), 'reply')[0]?.age).toBe('aujourd’hui');
    expect(mailRows(withDays(1), 'reply')[0]?.age).toBe('1 j');
    expect(mailRows(withDays(null), 'reply')[0]?.age).toBe('');
  });

  it('sorts the reply filter by longest silence first', () => {
    // The only real contribution of the removed day rail, kept as a behaviour
    // of this filter rather than as a column of its own.
    const two = { ...input, situations: {
      'alpha@example.com': situation({ ballInCourt: 'us', silenceDays: 2 }),
      'beta@example.com': situation({ ballInCourt: 'us', silenceDays: 40 }),
    } };
    expect(mailRows(two, 'reply').map((r) => r.id)).toEqual(['beta@example.com', 'alpha@example.com']);
  });

  it('puts an unread thread above a longer silence', () => {
    // The regression this rule exists for, in its worst form: the fresh reply
    // has the SHORTEST silence of the two, so silence-first alone buries the one
    // row the filter is meant to raise. Contacts are handed in already in the
    // wrong order, so a comparator that ignores unread keeps them there.
    const fresh = { ...alpha, unread: true };
    const two = {
      ...input,
      contacts: [beta, fresh],
      situations: {
        'alpha@example.com': situation({ ballInCourt: 'us', silenceDays: 0 }),
        'beta@example.com': situation({ ballInCourt: 'us', silenceDays: 40 }),
      },
    };
    expect(mailRows(two, 'reply').map((r) => r.id)).toEqual(['alpha@example.com', 'beta@example.com']);
  });

  it('carries unread onto the row under every filter', () => {
    // Projected outside "À répondre" too, so the same thread reads the same way
    // wherever it is met. Both values asserted: a field hard-wired to true would
    // pass a one-sided test.
    const one = { ...input, contacts: [{ ...alpha, unread: true }] };
    expect(mailRows(one, 'all')[0]?.unread).toBe(true);
    expect(mailRows({ ...input, contacts: [alpha] }, 'all')[0]?.unread).toBe(false);
  });

  it('breaks ties on id so the server and the browser agree', () => {
    // Contacts handed in REVERSED against the expected answer. Array.sort is
    // stable, so an input already in the answer's order would let a comparator
    // that returns 0 on a tie pass this test while deciding nothing.
    const tied = {
      ...input,
      contacts: [beta, alpha],
      situations: {
        'alpha@example.com': situation({ ballInCourt: 'us', silenceDays: 5 }),
        'beta@example.com': situation({ ballInCourt: 'us', silenceDays: 5 }),
      },
    };
    expect(mailRows(tied, 'reply').map((r) => r.id)).toEqual(['alpha@example.com', 'beta@example.com']);
  });

  it('sorts every other filter by most recent first', () => {
    // alpha's last message is dated 2026-07-28, beta's 2026-06-01. Reversed on
    // input for the same reason as above: a comparator sorting oldest first must
    // fail here rather than hide behind sort stability. This is the order of
    // "Tous", so nothing else pins it.
    const both = { ...input, contacts: [beta, alpha] };
    expect(mailRows(both, 'all').map((r) => r.id)).toEqual(['alpha@example.com', 'beta@example.com']);
  });

  it('marks urgent by filter, not by contact', () => {
    // The very same contact is urgent under "À répondre" and not under "Tous".
    // Urgency is what the active filter means, which is what keeps the accent
    // colour meaning something.
    expect(mailRows(input, 'reply')[0]?.urgent).toBe(true);
    expect(mailRows(input, 'all').some((r) => r.urgent)).toBe(false);
  });

  it('falls back to the email when a contact has no company', () => {
    const nameless = { ...input, contacts: [{ ...alpha, company: null }] };
    expect(mailRows(nameless, 'all')[0]?.who).toBe('alpha@example.com');
  });

  it('says so in words when a thread has no subject yet', () => {
    const bare = { ...input, contacts: [{ ...beta, messages: [] }] };
    expect(mailRows(bare, 'all')[0]?.subject).toBe('Aucun échange');
  });
});

/**
 * Fixtures that discriminate, one per filter: beta is the only follow-up due,
 * gamma the only client with a fresh key, delta the only prospect and the only
 * row with no message at all. The counter/rows coherence loop above holds for
 * ANY predicate, so each filter below is pinned by the ids it returns, which a
 * predicate swapped for () => true or () => false cannot reproduce.
 */
const newClient = client('gamma@example.com', 'Société Gamma', [
  message('out', 'Bienvenue', 'Ta clé est prête', '2026-07-20'),
], true);
const cold = prospect('delta@example.com', 'Société Delta', []);
const wide: RowsInput = {
  contacts: [alpha, beta, newClient, cold],
  situations: {
    'alpha@example.com': situation({ ballInCourt: 'us', silenceDays: 2 }),
    'beta@example.com': situation({ followupDue: true, silenceDays: 40 }),
    'gamma@example.com': situation({}),
    'delta@example.com': situation({ nextAction: 'first_mail' }),
  },
  snoozed: {},
};

describe('filter membership', () => {
  it('followup keeps exactly the contacts whose follow-up is due', () => {
    expect(mailRows(wide, 'followup').map((r) => r.id)).toEqual(['beta@example.com']);
  });

  it('new keeps exactly the clients whose key is fresh', () => {
    expect(mailRows(wide, 'new').map((r) => r.id)).toEqual(['gamma@example.com']);
  });

  it('clients keeps the clients and leaves the prospect out', () => {
    expect(mailRows(wide, 'clients').map((r) => r.id)).toEqual([
      'alpha@example.com',
      'gamma@example.com',
      'beta@example.com',
    ]);
  });

  it('shows an archived prospect under Tous and under no other filter', () => {
    // The produced gesture: a row set aside on purpose stays reachable, and
    // only where everything is. messageCount 0 is what isArchived reads, and
    // the archived row is dateless, so it also must NOT be lifted by the
    // never-contacted rule: it sorts last, after the dated thread.
    const archived = prospect('omega@example.com', 'Société Omega', [], 'archive');
    const withArchived: RowsInput = {
      contacts: [archived, alpha],
      situations: {
        'alpha@example.com': situation({ ballInCourt: 'us', silenceDays: 2 }),
        'omega@example.com': situation({ nextAction: 'first_mail' }),
      },
      snoozed: {},
    };
    expect(mailRows(withArchived, 'all').map((r) => r.id)).toEqual([
      'alpha@example.com',
      'omega@example.com',
    ]);
    for (const key of ['reply', 'followup', 'new', 'clients'] as const) {
      expect(mailRows(withArchived, key).map((r) => r.id)).not.toContain('omega@example.com');
    }
  });
});

describe('never-contacted rows under Tous', () => {
  it('puts a prospect never written to first, ahead of the recency order', () => {
    // delta has no message, so recency alone would sink it dead last; the
    // comparison under test is the one that lifts it. The rest of the order
    // is recency as before: alpha 07-28, gamma 07-20, beta 06-01.
    expect(mailRows(wide, 'all').map((r) => r.id)).toEqual([
      'delta@example.com',
      'alpha@example.com',
      'gamma@example.com',
      'beta@example.com',
    ]);
  });

  it('keeps the lift out of the other filters and off mere datelessness', () => {
    // A client with no message is dateless too, and the deleted filter
    // excluded clients on purpose (a missing thread is a sync gap, not a cold
    // lead). If the lift leaked out of "Tous", or were written on dates
    // rather than on the never-contacted rule, this row would jump first
    // under Clients. It must stay where recency puts a row with no date:
    // last. Handed in first so sort stability cannot fake the answer.
    const bare = client('epsilon@example.com', 'Société Epsilon', []);
    const two: RowsInput = {
      ...wide,
      contacts: [bare, alpha, beta, newClient, cold],
      situations: {
        ...wide.situations,
        'epsilon@example.com': situation({ nextAction: 'first_mail' }),
      },
    };
    expect(mailRows(two, 'clients').map((r) => r.id)).toEqual([
      'alpha@example.com',
      'gamma@example.com',
      'beta@example.com',
      'epsilon@example.com',
    ]);
  });
});

describe('searchRows', () => {
  const rows = mailRows(input, 'all');

  it('keeps the rows whose company matches the query', () => {
    expect(searchRows(rows, 'beta').map((r) => r.id)).toEqual(['beta@example.com']);
  });

  it('matches on the address even when the row displays a company', () => {
    // The deleted list matched company AND email. An implementation reading
    // only `who` (which collapses to the company here) must fail this.
    expect(searchRows(rows, 'alpha@example').map((r) => r.id)).toEqual(['alpha@example.com']);
  });

  it('returns every row unchanged on a blank or whitespace query', () => {
    expect(searchRows(rows, '')).toEqual(rows);
    expect(searchRows(rows, '   ')).toEqual(rows);
  });

  it('ignores case, as the field it reproduces did', () => {
    // Accented capitals included: the original lowercased both sides and did
    // nothing else, so "SOCIÉTÉ" finds "Société" while "societe" finds nothing.
    expect(searchRows(rows, 'SOCIÉTÉ ALPHA').map((r) => r.id)).toEqual(['alpha@example.com']);
    expect(searchRows(rows, 'societe')).toEqual([]);
  });
});

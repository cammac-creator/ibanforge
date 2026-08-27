import { describe, expect, it } from 'vitest';
import {
  MAIL_FILTER_KEYS,
  mailFilters,
  mailRows,
  searchRows,
  selectedRows,
  type RowsInput,
} from './mail-rows';
import { POPULATION_KEYS } from './table-view';
import type { Contact, InstitutionInfo, Message, ProspectSourcing, Situation } from './types';

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
    createdAt: null,
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

/**
 * The population segment, which is NOT the prospecting queue.
 *
 * `prospect` (singular) is everyone never written to; `prospects` (plural) is
 * everyone of that kind. One letter apart and a strict subset, so the two are
 * pinned against each other by a fixture where they differ.
 */
describe('the Prospects population', () => {
  const written = prospect('written@alpha.example.net', 'Société Iota', [
    message('out', 'Prise de contact', 'Premier mail parti', '2026-07-05'),
  ]);
  const never = prospect('never@alpha.example.net', 'Société Kappa', []);
  const population: RowsInput = {
    contacts: [written, never, alpha],
    situations: {
      'written@alpha.example.net': situation({ ballInCourt: 'them', silenceDays: 3 }),
      'never@alpha.example.net': situation({ nextAction: 'first_mail' }),
      'alpha@example.com': situation({ ballInCourt: 'us', silenceDays: 2 }),
    },
    snoozed: {},
  };

  it('holds every prospect, written to or not, and no client', () => {
    expect(mailRows(population, 'prospects').map((r) => r.id).sort()).toEqual([
      'never@alpha.example.net',
      'written@alpha.example.net',
    ]);
  });

  it('is strictly wider than the À prospecter queue, which is the whole point', () => {
    // The regression this guards: wiring the segment to the queue would hide
    // every prospect already written to — most of them once a campaign has run.
    expect(mailRows(population, 'prospect').map((r) => r.id)).toEqual(['never@alpha.example.net']);
  });

  it('keeps a prospect never written to at the head of its own segment', () => {
    // It has no message, so recency alone would sink the segment's whole point
    // to the bottom of the segment's own list.
    expect(mailRows(population, 'prospects').map((r) => r.id)[0]).toBe('never@alpha.example.net');
  });

  it('counts what it shows, like every other filter', () => {
    for (const filter of mailFilters(population)) {
      expect(mailRows(population, filter.key)).toHaveLength(filter.count);
    }
  });
});

/**
 * A base where EVERY key holds somebody.
 *
 * `wide` is four contacts and it leaves four keys — Payants, Endormis,
 * Brouillons, Correspondances — empty on BOTH sides of the parity loop below,
 * where the assertion then reads `[] === []` and would survive a composed
 * reading that silently dropped every row of those keys. This fixture is what
 * makes each iteration of that loop compare something, and a test right after
 * it refuses to let a key fall back to empty unnoticed.
 *
 * Deliberately holds NO archived row. The parity between a filtered ordering
 * and the composed reading of the same keys is exact only while `bare` agrees
 * on both sides, and `bare` is what decides whether archived rows surface (see
 * pickBy): add an archived prospect here and the population×work identity below
 * starts failing for reasons that have nothing to do with what it pins.
 */
const buyer: Contact = {
  ...client('buyer@alpha.example.net', 'Société Lambda', [
    message('in', 'Question', 'Une question sur le batch', '2026-08-01'),
  ]),
  business: {
    status: 'paying' as const,
    source: 'direct',
    creditsTotal: 5000,
    creditsRemaining: 1200,
    packs: 2,
    firstCallAt: null,
    calls90d: 40,
  },
};
const sleeping: Contact = {
  ...client('quiet@alpha.example.net', 'Société Xi', [
    message('out', 'Des nouvelles', 'Ta clé n’a plus servi depuis un moment', '2026-05-02'),
  ]),
  business: {
    status: 'dormant' as const,
    source: 'direct',
    creditsTotal: 1000,
    creditsRemaining: 1000,
    packs: 0,
    firstCallAt: null,
    calls90d: 0,
  },
};
const drafted: Contact = {
  ...client('pending@alpha.example.net', 'Société Omicron', [
    message('out', 'Suivi', 'Je reviens vers vous la semaine prochaine', '2026-06-15'),
  ]),
  draft: message('draft', 'Suivi', 'Brouillon écrit et jamais parti', '2026-08-03'),
};
const desk = institution('desk@alpha.example.net', 'Autorité Rho', [
  message('out', 'Demande de permission', 'Nous souhaitons citer vos données', '2026-07-11'),
]);

const rich: RowsInput = {
  contacts: [alpha, beta, newClient, cold, buyer, sleeping, drafted, desk],
  situations: {
    'alpha@example.com': situation({ ballInCourt: 'us', silenceDays: 2 }),
    'beta@example.com': situation({ followupDue: true, silenceDays: 40 }),
    'gamma@example.com': situation({}),
    'delta@example.com': situation({ nextAction: 'first_mail' }),
    'buyer@alpha.example.net': situation({ ballInCourt: 'them', silenceDays: 1, messageCount: 1 }),
    'quiet@alpha.example.net': situation({ silenceDays: 90, messageCount: 1 }),
    'pending@alpha.example.net': situation({ silenceDays: 20, messageCount: 1 }),
    'desk@alpha.example.net': situation({ ballInCourt: 'them', silenceDays: 12, messageCount: 1 }),
  },
  snoozed: {},
};

/**
 * The toolbar's composed reading. Three axes narrow each other, where the list
 * this replaces could only ever ask one question at a time.
 */
describe('selectedRows', () => {
  it('has a fixture that leaves no key empty, so the parity loop compares something', () => {
    // The guard on the guard. Without it the loop below can go green while
    // asserting nothing at all: on a fixture nobody satisfies, both sides
    // return [] and every regression in the composed reading of that key slips
    // through. Fails the day a key is added and `rich` is not extended for it.
    const empty = MAIL_FILTER_KEYS.filter((key) => mailRows(rich, key).length === 0);
    expect(empty).toEqual([]);
  });

  it('is the single-key reading when the population is the whole base', () => {
    // THE invariant of the redesign: the tiles advertise absolute counts, and
    // those counts have to be the rows the composed table then shows. Asserted
    // over every key rather than a chosen few, so a key added later is covered
    // the day it is declared, and over two populations rather than one — the
    // narrow fixture keeps the original coverage, the rich one is what makes
    // Payants, Endormis, Brouillons and Correspondances actually compare rows.
    for (const base of [wide, rich]) {
      for (const key of MAIL_FILTER_KEYS) {
        expect(selectedRows(base, { population: 'all', work: key })).toEqual(mailRows(base, key));
      }
      expect(selectedRows(base, { population: 'all' })).toEqual(mailRows(base, 'all'));
    }
  });

  it('is the single-key reading for a population pressed alone', () => {
    // The other half of the bridge, unpinned until now: it holds today only
    // because both readings funnel through the same pickBy/order/project, and
    // nothing said so. Read from the toolbar's own list of segments, so a
    // fifth one is covered the day it is declared there.
    for (const key of POPULATION_KEYS) {
      expect(selectedRows(rich, { population: key })).toEqual(mailRows(rich, key));
    }
  });

  it('intersects a population with a queue without inventing an order of its own', () => {
    // What "the axes narrow each other" has to mean, said as an identity: the
    // composed rows are the queue's own rows kept to the members of the
    // population, IN THE QUEUE'S ORDER. Both halves matter — dropping rows and
    // re-sorting them are the two ways this could break — and the ordering half
    // holds because order() reads per-contact data plus the dominant key, with
    // byId as the last tiebreak, so sorting a subset is filtering the sorted
    // whole.
    for (const population of POPULATION_KEYS) {
      const inside = new Set(mailRows(rich, population).map((r) => r.id));
      for (const work of MAIL_FILTER_KEYS) {
        expect(selectedRows(rich, { population, work }).map((r) => r.id)).toEqual(
          mailRows(rich, work)
            .filter((r) => inside.has(r.id))
            .map((r) => r.id),
        );
      }
    }
  });

  it('intersects the population with the work queue', () => {
    // beta is the only follow-up due and it is a client; the segment must keep
    // it and the correspondents' segment must not.
    expect(selectedRows(withInstitutions, { population: 'clients', work: 'followup' }).map((r) => r.id))
      .toEqual(['beta@example.com']);
    expect(selectedRows(withInstitutions, { population: 'institution', work: 'followup' })).toEqual([]);
  });

  it('intersects all three axes at once', () => {
    const buyer = {
      ...client('buyer@alpha.example.net', 'Société Lambda', [
        message('in', 'Question', 'Une question sur le batch', '2026-08-01'),
      ]),
      business: {
        status: 'paying' as const,
        source: 'direct',
        creditsTotal: 5000,
        creditsRemaining: 1200,
        packs: 1,
        firstCallAt: null,
        calls90d: 40,
      },
    };
    const three: RowsInput = {
      contacts: [buyer, alpha],
      situations: {
        'buyer@alpha.example.net': situation({ ballInCourt: 'us', silenceDays: 1 }),
        'alpha@example.com': situation({ ballInCourt: 'us', silenceDays: 2 }),
      },
      snoozed: {},
    };
    // Both are clients waiting on an answer; only one of them ever bought.
    expect(selectedRows(three, { population: 'all', work: 'reply' }).map((r) => r.id)).toEqual([
      'alpha@example.com',
      'buyer@alpha.example.net',
    ]);
    expect(
      selectedRows(three, { population: 'clients', work: 'reply', refine: 'paying' }).map((r) => r.id),
    ).toEqual(['buyer@alpha.example.net']);
  });

  it('lets the pressed queue decide the order, not the segment it stands on', () => {
    // "Clients" sorts by heat; "À répondre" sorts unread first. Pressing the
    // tile while standing on the segment must keep the queue's ordering, or the
    // queue loses the one thing it is opened for. Handed in in the wrong order
    // so sort stability cannot fake the answer.
    const quiet = client('quiet@alpha.example.net', 'Société Mu', [
      message('in', 'Bonjour', 'Merci pour le retour', '2026-08-02'),
    ]);
    const shouting = {
      ...client('loud@alpha.example.net', 'Société Nu', [
        message('in', 'Urgent', 'Nous attendons', '2026-08-01'),
      ]),
      unread: true,
    };
    const two: RowsInput = {
      contacts: [quiet, shouting],
      situations: {
        'quiet@alpha.example.net': situation({ ballInCourt: 'us', silenceDays: 0 }),
        'loud@alpha.example.net': situation({ ballInCourt: 'us', silenceDays: 0 }),
      },
      snoozed: {},
    };
    expect(selectedRows(two, { population: 'clients', work: 'reply' }).map((r) => r.id)).toEqual([
      'loud@alpha.example.net',
      'quiet@alpha.example.net',
    ]);
    // …and the accent follows the queue too, not the segment.
    expect(selectedRows(two, { population: 'clients', work: 'reply' }).every((r) => r.urgent)).toBe(true);
    expect(selectedRows(two, { population: 'clients' }).some((r) => r.urgent)).toBe(false);
  });

  it('shows an archived contact only when nothing at all is being asked', () => {
    // The rule the single-key reading states as `key !== 'all'`. Composed, the
    // equivalent is "the whole base, no queue, no chip" — a segment alone is
    // already a question, and a row set aside on purpose must not answer it.
    const archived = prospect('omega@example.com', 'Société Omega', [], 'archive');
    const withArchived: RowsInput = {
      contacts: [archived, alpha],
      situations: {
        'alpha@example.com': situation({ ballInCourt: 'us', silenceDays: 2 }),
        'omega@example.com': situation({ nextAction: 'first_mail' }),
      },
      snoozed: {},
    };
    expect(selectedRows(withArchived, { population: 'all' }).map((r) => r.id)).toContain(
      'omega@example.com',
    );
    expect(selectedRows(withArchived, { population: 'prospects' }).map((r) => r.id)).not.toContain(
      'omega@example.com',
    );
    expect(selectedRows(withArchived, { population: 'all', refine: 'prospect' }).map((r) => r.id))
      .not.toContain('omega@example.com');
  });
});

describe('what the table reads off a row', () => {
  it('carries the kind, so the colour rail never re-opens the union', () => {
    expect(mailRows(wide, 'all').find((r) => r.id === 'delta@example.com')?.kind).toBe('prospect');
    expect(mailRows(wide, 'all').find((r) => r.id === 'alpha@example.com')?.kind).toBe('client');
  });

  it('carries the raw next action beside its French label', () => {
    // Both, because the Statut column needs a SHORT name and a tone, and
    // neither can be read back off a sentence. Its own situation rather than
    // the shared fixture's, whose nextAction is the helper's default.
    const waiting: RowsInput = {
      contacts: [alpha],
      situations: {
        'alpha@example.com': situation({ ballInCourt: 'us', silenceDays: 2, nextAction: 'reply' }),
      },
      snoozed: {},
    };
    const row = mailRows(waiting, 'reply')[0];
    expect(row?.nextAction).toBe('reply');
    expect(row?.next).toBe('Il attend ta réponse');
  });

  it('leaves the action null when the page built no situation', () => {
    const orphan: RowsInput = { contacts: [alpha], situations: {}, snoozed: {} };
    expect(mailRows(orphan, 'all')[0]?.nextAction).toBeNull();
    expect(mailRows(orphan, 'all')[0]?.next).toBeNull();
  });

  it('carries the conquest verdict, decided once per row', () => {
    // Wiring only. Each clause of the rule is pinned in isolation over in
    // outreach.test.ts; what this pins is that the row actually ASKS, and that
    // the answer is neither hardcoded nor defaulted — `alpha` fails the rule
    // (no dossier, and its key predates its mail) and reads false on the row.
    const won: Contact = {
      kind: 'client',
      id: 'gamma@example.com',
      email: 'gamma@example.com',
      company: 'Société Gamma',
      country: 'CH',
      website: null,
      messages: [message('out', 'Prise de contact', 'Bonjour', '2026-07-01')],
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
        // Minted after the outbound mail above: the causal proof.
        createdAt: '2026-07-20 09:00:00',
        isNew: false,
      },
      usage: { series: [], months: [], days: [], endpoints: [] },
      sourcing: sourcing('gamma@example.com', 'contacte'),
    };
    const rows = mailRows(
      { contacts: [alpha, won], situations: {}, snoozed: {} },
      'all',
    );
    expect(rows.find((r) => r.id === 'gamma@example.com')?.wonByOutreach).toBe(true);
    expect(rows.find((r) => r.id === 'alpha@example.com')?.wonByOutreach).toBe(false);
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

  it('ignores case AND folds accents — both sides, per the A6 ruling', () => {
    // The original matched lowercase only, so "societe" found nothing and the
    // operator had to type the accent. Folding is normalised on both sides:
    // a folded haystack against a raw accented query would silently un-match.
    expect(searchRows(rows, 'SOCIÉTÉ ALPHA').map((r) => r.id)).toEqual(['alpha@example.com']);
    // The haystack now includes thread content, so "societe" may legitimately
    // surface other rows whose messages mention the word; what the ruling
    // guarantees is that the accentless query finds the accented company.
    expect(searchRows(rows, 'societe').map((r) => r.id)).toContain('alpha@example.com');
  });
});

describe('business filters and shelves', () => {
  function withBiz(c: Contact, status: 'paying' | 'dormant' | 'active', packs: number): Contact {
    return {
      ...c,
      business: {
        status,
        source: 'direct',
        creditsTotal: packs * 5000,
        creditsRemaining: 2400,
        packs,
        firstCallAt: null,
        calls90d: 12,
      },
    };
  }

  it('Payants counts every pack owner, dormant included — never the used counter', () => {
    const buyerAwake = withBiz(client('a@alpha.example.net', 'Alpha', []), 'paying', 1);
    const buyerAsleep = withBiz(client('b@alpha.example.net', 'Beta', []), 'dormant', 2);
    const free = withBiz(client('c@alpha.example.net', 'Gamma', []), 'active', 0);
    const input: RowsInput = {
      contacts: [buyerAwake, buyerAsleep, free],
      situations: {},
      snoozed: {},
    };
    const paying = mailFilters(input).find((f) => f.key === 'paying');
    expect(paying?.count).toBe(2);
    const rows = mailRows(input, 'paying').map((r) => r.id);
    expect(rows).toContain('a@alpha.example.net');
    expect(rows).toContain('b@alpha.example.net');
    expect(rows).not.toContain('c@alpha.example.net');
    const dormant = mailRows(input, 'dormant').map((r) => r.id);
    expect(dormant).toEqual(['b@alpha.example.net']);
  });

  it('reply rows carry shelves in the sort order; other filters carry none', () => {
    const unreadNow = { ...client('u@alpha.example.net', 'U', [message('in', 'Hi', 'x', '2026-08-12 08:00')]), unread: true };
    const old = client('o@alpha.example.net', 'O', [message('in', 'Old', 'y', '2026-08-01 08:00')]);
    const fresh = client('f@alpha.example.net', 'F', [message('in', 'New', 'z', '2026-08-11 08:00')]);
    const situations: Record<string, Situation> = {
      'u@alpha.example.net': { ballInCourt: 'us', silenceDays: 0, firstContactAt: null, messageCount: 1, nextAction: 'reply', hasEverReplied: false, lastOutboundAt: null } as unknown as Situation,
      'o@alpha.example.net': { ballInCourt: 'us', silenceDays: 11, firstContactAt: null, messageCount: 1, nextAction: 'reply', hasEverReplied: false, lastOutboundAt: null } as unknown as Situation,
      'f@alpha.example.net': { ballInCourt: 'us', silenceDays: 1, firstContactAt: null, messageCount: 1, nextAction: 'reply', hasEverReplied: false, lastOutboundAt: null } as unknown as Situation,
    };
    const input: RowsInput = { contacts: [unreadNow, old, fresh], situations, snoozed: {} };
    const rows = mailRows(input, 'reply');
    expect(rows.map((r) => r.group)).toEqual(['urgent', 'urgent', 'later']);
    expect(mailRows(input, 'all').every((r) => r.group === null)).toBe(true);
  });
});

describe('the prospecting queue (À prospecter)', () => {
  it('ranks never-contacted prospects by confidence, and exposes it on the row', () => {
    const low = prospect('low@alpha.example.net', 'Basse', []);
    const high = prospect('high@alpha.example.net', 'Haute', []);
    if (low.kind === 'prospect') low.sourcing.confidence = 'low';
    if (high.kind === 'prospect') high.sourcing.confidence = 'high';
    const situations: Record<string, Situation> = {
      'low@alpha.example.net': situation({ nextAction: 'first_mail' }),
      'high@alpha.example.net': situation({ nextAction: 'first_mail' }),
    };
    const rows = mailRows({ contacts: [low, high], situations, snoozed: {} }, 'prospect');
    expect(rows.map((r) => r.id)).toEqual(['high@alpha.example.net', 'low@alpha.example.net']);
    expect(rows[0].confidence).toBe('high');
  });

  it('puts a returned sleeper first, ahead of the confidence order, and flags the row', () => {
    // The wake date is WHY the row is back today: "call me back in September"
    // arrived. It outranks the standing confidence sort, or the snooze gesture
    // would bury its own result under fresher high-confidence rows.
    const high = prospect('high@alpha.example.net', 'Haute', []);
    const woken = prospect('woken@alpha.example.net', 'Réveillée', []);
    if (high.kind === 'prospect') high.sourcing.confidence = 'high';
    if (woken.kind === 'prospect') {
      woken.sourcing.confidence = 'low';
      woken.sourcing.wakeUpAt = '2026-08-10';
    }
    const situations: Record<string, Situation> = {
      'high@alpha.example.net': situation({ nextAction: 'first_mail' }),
      'woken@alpha.example.net': situation({ nextAction: 'first_mail' }),
    };
    const rows = mailRows(
      {
        contacts: [high, woken],
        situations,
        snoozed: {},
        woke: { 'woken@alpha.example.net': true },
      },
      'prospect',
    );
    expect(rows.map((r) => r.id)).toEqual(['woken@alpha.example.net', 'high@alpha.example.net']);
    expect(rows[0].woke).toBe(true);
    expect(rows[1].woke).toBe(false);
  });
});

/**
 * The Correspondances filter.
 *
 * Institutions are invented, as everything in this file is: this repository is
 * public and no real authority, bank, scheme or supplier may be named here,
 * fixtures included.
 */
function institution(
  id: string,
  org: string,
  messages: Message[],
  over: Partial<InstitutionInfo> = {},
  unread = false,
): Contact {
  return {
    kind: 'institution',
    id,
    email: id,
    company: org,
    country: 'CH',
    website: null,
    messages,
    draft: null,
    unread,
    account: 'desk@example.com',
    institution: {
      org,
      category: 'autorite',
      country: 'CH',
      role: null,
      website: null,
      dossier: null,
      ...over,
    },
  };
}

const registry = institution('registry@alpha.example.net', 'Autorité Alpha', [
  message('out', 'Demande de permission', 'Nous souhaitons citer votre registre', '2026-07-02'),
  message('in', 'Re: Demande de permission', 'Votre demande est enregistrée', '2026-07-25'),
]);
const scheme = institution(
  'scheme@beta.example.net',
  'Réseau Beta',
  [message('out', 'Question réglementaire', 'Une question sur le format', '2026-07-10')],
  { category: 'reseau_paiement', dossier: 'Conditions de redistribution des données' },
  true,
);

const withInstitutions: RowsInput = {
  contacts: [alpha, beta, registry, scheme],
  situations: {
    ...input.situations,
    'registry@alpha.example.net': situation({ ballInCourt: 'us', silenceDays: 5 }),
    'scheme@beta.example.net': situation({ ballInCourt: 'them', silenceDays: 17 }),
  },
  snoozed: {},
};

describe('the Correspondances filter', () => {
  it('holds every institution and nothing else', () => {
    const rows = mailRows(withInstitutions, 'institution');
    expect(rows.map((r) => r.id).sort()).toEqual(['registry@alpha.example.net', 'scheme@beta.example.net']);
  });

  it('counts exactly what it shows, like every other filter', () => {
    for (const filter of mailFilters(withInstitutions)) {
      expect(mailRows(withInstitutions, filter.key)).toHaveLength(filter.count);
    }
  });

  // The two commercial queues. A correspondent in "Clients" would corrupt a
  // head count the owner reads; one in "À prospecter" would invite a cold pitch
  // to a supervisor, which is the more expensive of the two mistakes.
  it('keeps institutions out of the client and prospecting queues', () => {
    expect(mailRows(withInstitutions, 'clients').map((r) => r.id)).not.toContain('registry@alpha.example.net');
    expect(mailRows(withInstitutions, 'prospect').map((r) => r.id)).not.toContain('registry@alpha.example.net');
  });

  it('keeps them in Tous, where everything is', () => {
    expect(mailRows(withInstitutions, 'all').map((r) => r.id)).toContain('registry@alpha.example.net');
  });

  it('keeps a waiting institution in À répondre, which is the point of the whole feature', () => {
    // An authority that answered and is waiting on us is the most expensive
    // thing on this page to forget, and that filter asks about the thread
    // rather than about who is on the other end of it.
    expect(mailRows(withInstitutions, 'reply').map((r) => r.id)).toContain('registry@alpha.example.net');
  });

  it('carries a draft into the drafts queue like anybody else', () => {
    const drafting = {
      ...withInstitutions,
      contacts: [{ ...registry, draft: message('draft', 'Réponse', 'En cours', '2026-07-26') } as Contact],
    };
    expect(mailRows(drafting, 'drafts').map((r) => r.id)).toEqual(['registry@alpha.example.net']);
  });

  it('says the category in the row chip, in French', () => {
    const rows = mailRows(withInstitutions, 'institution');
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId['registry@alpha.example.net'].chip?.label).toBe('autorité');
    expect(byId['scheme@beta.example.net'].chip?.label).toBe('réseau de paiement');
  });

  it('shows a category nobody foresaw as itself rather than swallowing it', () => {
    // Underscores are a storage convention, not a word: the chip reads as prose.
    const odd = institution('desk@gamma.example.net', 'Institut Gamma', [], { category: 'banque_regionale' });
    const rows = mailRows({ contacts: [odd], situations: {}, snoozed: {} }, 'institution');
    expect(rows[0].chip?.label).toBe('banque regionale');
  });

  it('caps a very long category rather than pushing the name off the row', () => {
    const odd = institution('desk@gamma.example.net', 'Institut Gamma', [], {
      category: 'commission de surveillance des marchés',
    });
    const rows = mailRows({ contacts: [odd], situations: {}, snoozed: {} }, 'institution');
    expect(rows[0].chip?.label.length).toBeLessThanOrEqual(16);
    expect(rows[0].chip?.label.endsWith('…')).toBe(true);
  });

  // Unread first: "which of these answered" is the question this filter is
  // opened with. Heat is deliberately not consulted — not because it is zero
  // here (conversation facts score whatever the kind is) but because it measures
  // a commercial temperature, which says nothing about which authority to
  // answer first.
  it('puts an unread answer first, whatever the dates say', () => {
    const rows = mailRows(withInstitutions, 'institution');
    expect(rows.map((r) => r.id)).toEqual(['scheme@beta.example.net', 'registry@alpha.example.net']);
  });

  it('finds a correspondent by its file line, which is what the operator remembers', () => {
    const rows = searchRows(mailRows(withInstitutions, 'institution'), 'redistribution');
    expect(rows.map((r) => r.id)).toEqual(['scheme@beta.example.net']);
  });

  // Its own input rather than an addition to `withInstitutions`: that fixture is
  // asserted exactly, id by id, and by a loop comparing every filter's count to
  // its rows. A contact added there to prove something else would silently be
  // proving it against two broken assertions.
  const pending = institution('pending@delta.example.net', 'Registre Delta', [
    message('out', 'Demande de permission', 'Nous souhaitons citer votre registre', '2026-07-01'),
  ]);
  const waitingOnThem: RowsInput = {
    contacts: [pending],
    situations: {
      'pending@delta.example.net': situation({ ballInCourt: 'them', silenceDays: 24, followupDue: true }),
    },
    snoozed: {},
  };

  // Asserted rather than assumed. A letter to an authority that got no answer
  // is the single most forgettable thing in this CRM — nobody is chasing it —
  // and "Relances" is the only queue that would ever surface it. The filter
  // asks about the thread and not about the kind, which is what makes this
  // work; a kind test added there one day would break exactly here.
  it('puts an institution whose follow-up is due in Relances', () => {
    expect(mailRows(waitingOnThem, 'followup').map((r) => r.id)).toEqual(['pending@delta.example.net']);
  });

  // The money views. A correspondent has no key, so it carries no activation
  // join at all and both predicates decline it — but they decline it by reading
  // `business`, not by testing the kind, so this is pinned rather than trusted.
  it('keeps institutions out of the money queues', () => {
    expect(mailRows(waitingOnThem, 'paying')).toHaveLength(0);
    expect(mailRows(waitingOnThem, 'dormant')).toHaveLength(0);
  });
});

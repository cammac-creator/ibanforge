import { describe, expect, it } from 'vitest';
import { mailFilters, mailRows, searchRows, type RowsInput } from './mail-rows';
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

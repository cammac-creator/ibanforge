import { describe, expect, it } from 'vitest';
import { ballWithUs, dueToday, followupDue, neverContacted } from './buckets';
import { FOLLOWUP_DAYS, situationOf } from './situation';
import type { Contact, Message, ProspectSourcing, Situation } from './types';

/**
 * Every address and company below is invented; example.net is reserved for
 * documentation by RFC 2606. Local parts avoid the substrings INTERNAL_RE
 * matches, so the same fixtures stay usable if these ever meet buildContacts.
 */

const TODAY = new Date('2026-07-25T09:00:00Z');

/** An ISO stamp n days before TODAY, so silence durations are exact. */
const daysAgo = (n: number): string => new Date(TODAY.getTime() - n * 86_400_000).toISOString();

const msg = (direction: Message['direction'], msg_date: string | null): Message => ({
  direction,
  msg_date,
  subject: null,
  snippet: null,
  counterparty: null,
});

const sourcing = (status: string): ProspectSourcing => ({
  prospectId: 'p-1',
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
});

const prospect = (id: string, status = 'contacte', messages: Message[] = []): Contact => ({
  kind: 'prospect',
  id,
  email: id,
  company: 'Fictive Sàrl',
  country: 'CH',
  website: null,
  messages,
  draft: null,
  unread: false,
  account: 'crm@example.net',
  sourcing: sourcing(status),
  readyMail: null,
});

/**
 * messageCount defaults to 2 so the contact is NOT archived unless a test says
 * so: isArchived only fires on a thread with no datable message.
 */
const situation = (over: Partial<Situation> = {}): Situation => ({
  ballInCourt: 'none',
  silenceDays: null,
  followupDue: false,
  firstContactAt: null,
  hasEverReplied: false,
  messageCount: 2,
  nextAction: 'wait',
  ...over,
});

const ACTIVE = prospect('lena@example.net');
const ARCHIVED = prospect('otto@example.net', 'archive');

describe('ballWithUs', () => {
  it('claims a contact whose last message is inbound', () => {
    expect(ballWithUs(ACTIVE, situation({ ballInCourt: 'us' }))).toBe(true);
  });

  it('leaves a contact whose ball is not in our court', () => {
    // 'none' matters as much as 'them': an empty thread owes a first mail, not
    // a reply, and the rail's "ils attendent ta réponse" section would lie.
    expect(ballWithUs(ACTIVE, situation({ ballInCourt: 'them' }))).toBe(false);
    expect(ballWithUs(ACTIVE, situation({ ballInCourt: 'none' }))).toBe(false);
  });

  it('declines an archived contact even when the ball is with us', () => {
    // situationOf cannot currently produce this pair, since messageCount 0 also
    // means ballInCourt 'none'. That is the point: the guard is what keeps the
    // day's queue empty of archived rows if isArchived is ever loosened.
    const s = situation({ ballInCourt: 'us', messageCount: 0 });
    expect(ballWithUs(ARCHIVED, s)).toBe(false);
  });

  it('declines a contact whose id has no situation', () => {
    const situations: Record<string, Situation> = {};
    expect(ballWithUs(ACTIVE, situations[ACTIVE.id])).toBe(false);
  });
});

describe('followupDue', () => {
  it('claims a contact whose silence has run past the threshold', () => {
    expect(followupDue(ACTIVE, situation({ ballInCourt: 'them', followupDue: true }))).toBe(true);
  });

  it('leaves a contact whose silence has not', () => {
    expect(followupDue(ACTIVE, situation({ ballInCourt: 'them', followupDue: false }))).toBe(false);
  });

  it('declines an archived contact even when a followup is due', () => {
    const s = situation({ ballInCourt: 'them', followupDue: true, messageCount: 0 });
    expect(followupDue(ARCHIVED, s)).toBe(false);
  });

  it('declines a contact whose id has no situation', () => {
    const situations: Record<string, Situation> = {};
    expect(followupDue(ACTIVE, situations[ACTIVE.id])).toBe(false);
  });
});

describe('a contact whose id has no situation', () => {
  it('lands in no bucket at all, without throwing', () => {
    // The page builds one entry per contact id, so an absent one is a bug in
    // the caller. A predicate that declines the row beats one that throws in
    // the operator's face, but it must decline it rather than claim it.
    const situations: Record<string, Situation> = {};
    const s = situations[ACTIVE.id];
    expect(() => dueToday(ACTIVE, s)).not.toThrow();
    expect(ballWithUs(ACTIVE, s)).toBe(false);
    expect(followupDue(ACTIVE, s)).toBe(false);
    expect(dueToday(ACTIVE, s)).toBe(false);
  });
});

describe('dueToday', () => {
  const cases: Array<{ name: string; c: Contact; s: Situation | undefined; expected: boolean }> = [
    { name: 'ball with us', c: ACTIVE, s: situation({ ballInCourt: 'us' }), expected: true },
    {
      name: 'followup due',
      c: ACTIVE,
      s: situation({ ballInCourt: 'them', followupDue: true }),
      expected: true,
    },
    {
      name: 'waiting on them, not yet due',
      c: ACTIVE,
      s: situation({ ballInCourt: 'them' }),
      expected: false,
    },
    { name: 'empty thread', c: ACTIVE, s: situation({ ballInCourt: 'none' }), expected: false },
    {
      name: 'archived with the ball on our side',
      c: ARCHIVED,
      s: situation({ ballInCourt: 'us', messageCount: 0 }),
      expected: false,
    },
    {
      name: 'archived with a followup due',
      c: ARCHIVED,
      s: situation({ ballInCourt: 'them', followupDue: true, messageCount: 0 }),
      expected: false,
    },
    { name: 'no situation', c: ACTIVE, s: undefined, expected: false },
  ];

  for (const { name, c, s, expected } of cases) {
    it(`is the union of the two buckets: ${name}`, () => {
      expect(dueToday(c, s)).toBe(expected);
      expect(dueToday(c, s)).toBe(ballWithUs(c, s) || followupDue(c, s));
    });
  }
});

/**
 * The invariant the module exists for, pinned against situationOf rather than
 * against hand-written Situation objects. Nothing in buckets.ts enforces it: a
 * literal { ballInCourt: 'us', followupDue: true } would satisfy both
 * predicates at once. Disjointness is a property of situation.ts, which only
 * calls a followup due when the ball is in THEIR court, and the rail's two
 * section badges are read against the Aujourd'hui chip on that basis.
 */
describe('the two buckets are disjoint', () => {
  const threads: Array<{ name: string; messages: Message[] }> = [
    { name: 'empty thread', messages: [] },
    { name: 'they answered yesterday', messages: [msg('out', daysAgo(4)), msg('in', daysAgo(1))] },
    {
      // The row that kills the invariant if situation.ts drops its ballInCourt
      // term: the ball is with us AND the silence is long enough to look due.
      name: 'they answered long ago and we never replied',
      messages: [msg('out', daysAgo(40)), msg('in', daysAgo(FOLLOWUP_DAYS + 15))],
    },
    { name: 'we wrote recently', messages: [msg('out', daysAgo(FOLLOWUP_DAYS - 3))] },
    { name: 'we wrote and got nothing back', messages: [msg('out', daysAgo(FOLLOWUP_DAYS + 1))] },
    { name: 'only undatable messages', messages: [msg('out', 'last spring'), msg('in', null)] },
    { name: 'a draft and nothing else', messages: [msg('draft', daysAgo(1))] },
  ];

  const rows = threads.map(({ name, messages }, i) => ({
    name,
    c: prospect(`c${i}@example.net`, 'contacte', messages),
    s: situationOf(messages, TODAY),
  }));

  for (const { name, c, s } of rows) {
    it(`puts "${name}" in at most one bucket`, () => {
      expect(ballWithUs(c, s) && followupDue(c, s)).toBe(false);
    });
  }

  it('splits the day into two buckets that add up', () => {
    // What the operator actually reads: the rail's two section badges must sum
    // to the Aujourd'hui chip. That only holds because the buckets are disjoint.
    const ours = rows.filter(({ c, s }) => ballWithUs(c, s)).length;
    const due = rows.filter(({ c, s }) => followupDue(c, s)).length;
    const today = rows.filter(({ c, s }) => dueToday(c, s)).length;

    // Both sides non-zero, otherwise the identity would hold for free.
    expect(ours).toBe(2);
    expect(due).toBe(1);
    expect(today).toBe(ours + due);
  });
});

/**
 * The snooze. A contact put to sleep until a date must leave the day's queue,
 * which is the entire point of recording 'pas maintenant': without it the row
 * comes back every ten days to be dismissed by hand.
 */
describe('a contact asleep until a date', () => {
  const due = situation({ ballInCourt: 'them', followupDue: true, silenceDays: 30 });

  it('leaves the follow-up bucket', () => {
    expect(followupDue(ACTIVE, due, false)).toBe(true);
    expect(followupDue(ACTIVE, due, true)).toBe(false);
  });

  it('leaves the day entirely', () => {
    expect(dueToday(ACTIVE, due, true)).toBe(false);
  });

  it('comes straight back the moment they write', () => {
    // Writing overtakes the snooze: burying that message would hide the one
    // event proving the snooze wrong.
    const wrote = situation({ ballInCourt: 'us', silenceDays: 1 });
    expect(ballWithUs(ACTIVE, wrote)).toBe(true);
    expect(dueToday(ACTIVE, wrote, true)).toBe(true);
  });

  it('defaults to awake when no caller passes the flag', () => {
    // Every existing call site kept compiling when the parameter was added;
    // this pins that the default is the old behaviour rather than silence.
    expect(followupDue(ACTIVE, due)).toBe(true);
    expect(dueToday(ACTIVE, due)).toBe(true);
  });
});

describe('neverContacted', () => {
  it('claims a prospect no mail has ever gone out to', () => {
    // The whole point: this row is invisible in every other bucket. It is not
    // due today (nobody is waiting on anybody) and no follow-up is due (there
    // is nothing to follow up), so finding it meant scrolling the full list.
    expect(neverContacted(prospect('a'), situation({ nextAction: 'first_mail', messageCount: 0 }), false)).toBe(true);
  });

  it('drops the row the moment a first mail exists', () => {
    for (const next of ['reply', 'followup', 'firm_offer', 'wait'] as const) {
      expect(neverContacted(prospect('b'), situation({ nextAction: next }), false), next).toBe(false);
    }
  });

  it('respects the snooze, like every other bucket', () => {
    // Someone told us to come back in September. A cold first mail is exactly
    // the thing that must not reappear in the meantime.
    expect(neverContacted(prospect('c'), situation({ nextAction: 'first_mail', messageCount: 0 }), true)).toBe(false);
  });

  it('never claims a client', () => {
    // A client with no stored thread is a sync gap, not someone to cold-mail.
    const c: Contact = {
      ...prospect('d'),
      kind: 'client',
      apiKey: {
        keyPrefix: 'ifk_demo',
        paid: true,
        creditsTotal: null,
        creditsRemaining: null,
        monthlyLimit: 200,
        usedAllTime: 12,
        lastActiveMonth: '2026-07',
    createdAt: null,
    issuedByUs: false,
    isNew: false,
      },
      usage: { series: [], months: [], days: [], endpoints: [] },
    };
    expect(neverContacted(c, situation({ nextAction: 'first_mail', messageCount: 0 }), false)).toBe(false);
  });

  it('cannot overlap the day buckets', () => {
    // dueToday needs a message in the thread; never-contacted has none. The two
    // counts must stay addable, which is what makes the chips trustworthy.
    const s = situation({ nextAction: 'first_mail', messageCount: 0 });
    const c = prospect('e');
    expect(neverContacted(c, s, false) && dueToday(c, s, false)).toBe(false);
  });
});

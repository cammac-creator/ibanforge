import { describe, expect, it } from 'vitest';
import { byPriority, priorityOf, sendableStock } from './priority';
import type { Contact, Message, ProspectSourcing, Situation } from './types';

/** Same conventions as buckets.test.ts: invented addresses on example.net. */

const msg = (direction: Message['direction'], msg_date: string): Message => ({
  direction,
  msg_date,
  subject: null,
  snippet: null,
  counterparty: null,
});

const sourcing = (over: Partial<ProspectSourcing> = {}): ProspectSourcing => ({
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
  status: 'contacte',
  source: null,
  ...over,
});

const prospect = (id: string, over: Partial<ProspectSourcing> = {}, messages: Message[] = []): Contact => ({
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
  sourcing: sourcing(over),
  readyMail: null,
});

const client = (id: string, over: Partial<Contact & { kind: 'client' }> = {}): Contact => ({
  kind: 'client',
  id,
  email: id,
  company: 'Fictive AG',
  country: 'CH',
  website: null,
  messages: [],
  draft: null,
  unread: false,
  account: 'crm@example.net',
  apiKey: {
    keyPrefix: 'ibf_x',
    paid: false,
    creditsTotal: null,
    creditsRemaining: null,
    monthlyLimit: 1000,
    usedAllTime: 0,
    lastActiveMonth: null,
  },
  usage: { series: [], months: [], days: [], endpoints: [] },
  ...over,
});

const situation = (over: Partial<Situation> = {}): Situation => ({
  ballInCourt: 'them',
  silenceDays: 20,
  followupDue: true,
  firstContactAt: null,
  hasEverReplied: false,
  messageCount: 2,
  nextAction: 'followup',
  ...over,
});

describe('priorityOf', () => {
  it('puts a person waiting on an answer above everything', () => {
    const p = priorityOf(prospect('a@example.net'), situation({ ballInCourt: 'us' }));
    expect(p.key).toBe('answer');
    expect(p.rank).toBe(0);
  });

  it('answers a person even when the contact is asleep', () => {
    // Writing while snoozed overtakes the snooze. The opposite would bury the
    // one event that proves the snooze was wrong.
    const p = priorityOf(prospect('a@example.net'), situation({ ballInCourt: 'us' }), true);
    expect(p.key).toBe('answer');
  });

  it('ranks a snoozed contact last, below even an unqualified one', () => {
    const asleep = priorityOf(prospect('a@example.net', { confidence: 'high' }), situation(), true);
    const unknown = priorityOf(prospect('b@example.net'), situation());
    expect(asleep.key).toBe('snoozed');
    expect(asleep.rank).toBeGreaterThan(unknown.rank);
  });

  it('ranks a paying client above a warm prospect', () => {
    const paying = priorityOf(
      client('a@example.net', { apiKey: { keyPrefix: 'k', paid: true, creditsTotal: 5000, creditsRemaining: 10, monthlyLimit: null, usedAllTime: 40, lastActiveMonth: '2026-07' } }),
      situation(),
    );
    const warm = priorityOf(prospect('b@example.net'), situation({ hasEverReplied: true }));
    expect(paying.key).toBe('client');
    expect(warm.key).toBe('replied');
    expect(paying.rank).toBeLessThan(warm.rank);
  });

  it('does not call an unused free key a client', () => {
    // An address that signed up and never called is not a relationship, and
    // ranking it above a prospect who actually answered would be wrong.
    const idle = priorityOf(client('a@example.net'), situation());
    expect(idle.key).toBe('unknown');
  });

  it('counts a free key that is genuinely used as a client', () => {
    const used = priorityOf(
      client('a@example.net', { apiKey: { keyPrefix: 'k', paid: false, creditsTotal: null, creditsRemaining: null, monthlyLimit: 1000, usedAllTime: 231, lastActiveMonth: '2026-07' } }),
      situation(),
    );
    expect(used.key).toBe('client');
  });

  it('orders the three confidences, and falls back when there is none', () => {
    const rank = (c: string | null) =>
      priorityOf(prospect('a@example.net', { confidence: c }), situation()).rank;
    expect(rank('high')).toBeLessThan(rank('medium'));
    expect(rank('medium')).toBeLessThan(rank('low'));
    expect(rank(null)).toBeGreaterThan(rank('low'));
    // A value nobody planned for must not silently outrank a known one.
    expect(rank('tres-haute')).toBe(rank(null));
  });

  it('reads the confidence of a converted prospect whose key is idle', () => {
    // `sourcing` is optional on the client branch, carried when the address
    // came from the prospect list. An idle key does not reach the client rung,
    // so this row falls through to its confidence rather than to 'unknown':
    // signing up and never calling does not erase what sourcing knew.
    const idleConverted = client('a@example.net', { sourcing: sourcing({ confidence: 'high' }) });
    expect(priorityOf(idleConverted, situation()).key).toBe('high');
  });

  it('still ranks a converted prospect as a client once the key is used', () => {
    const active = client('a@example.net', {
      sourcing: sourcing({ confidence: 'low' }),
      apiKey: { keyPrefix: 'k', paid: false, creditsTotal: null, creditsRemaining: null, monthlyLimit: 1000, usedAllTime: 900, lastActiveMonth: '2026-07' },
    });
    expect(priorityOf(active, situation()).key).toBe('client');
  });

  it('does not throw on a client with no sourcing at all', () => {
    expect(() => priorityOf(client('a@example.net'), situation())).not.toThrow();
    expect(priorityOf(client('a@example.net'), situation()).key).toBe('unknown');
  });

  it('gives every rung a reason to show on the row', () => {
    const keys = ['answer', 'client', 'replied', 'high', 'medium', 'low', 'unknown', 'snoozed'];
    const reasons = new Set<string>();
    for (const c of ['high', 'medium', 'low', null])
      reasons.add(priorityOf(prospect('a@example.net', { confidence: c }), situation()).reason);
    reasons.add(priorityOf(prospect('a@example.net'), situation({ ballInCourt: 'us' })).reason);
    reasons.add(priorityOf(prospect('a@example.net'), situation({ hasEverReplied: true })).reason);
    reasons.add(priorityOf(prospect('a@example.net'), situation(), true).reason);
    reasons.add(priorityOf(client('a@example.net', { apiKey: { keyPrefix: 'k', paid: true, creditsTotal: 1000, creditsRemaining: 1, monthlyLimit: null, usedAllTime: 1, lastActiveMonth: null } }), situation()).reason);
    expect(reasons.size).toBe(keys.length);
    for (const r of reasons) {
      expect(r).not.toContain('—'); // no em dash in operator-facing copy
      expect(r.length).toBeGreaterThan(0);
    }
  });

  it('survives a missing situation', () => {
    expect(priorityOf(prospect('a@example.net'), undefined).key).toBe('unknown');
  });
});

describe('byPriority', () => {
  const row = (id: string, rankKey: Partial<ProspectSourcing>, silenceDays: number, over: Partial<Situation> = {}) => {
    const c = prospect(id, rankKey);
    const s = situation({ silenceDays, ...over });
    return { c, s, p: priorityOf(c, s) };
  };

  it('sorts by rung before silence', () => {
    // The old order was silence alone. This is the case it got wrong: a high
    // confidence thread silent 12 days must come before a low one silent 30.
    const high = row('a@example.net', { confidence: 'high' }, 12);
    const low = row('b@example.net', { confidence: 'low' }, 30);
    expect([low, high].sort(byPriority)[0]).toBe(high);
  });

  it('sorts by longest silence inside a rung', () => {
    const older = row('a@example.net', { confidence: 'high' }, 30);
    const newer = row('b@example.net', { confidence: 'high' }, 12);
    expect([newer, older].sort(byPriority)[0]).toBe(older);
  });

  it('breaks a full tie on the id, so the order is the same on both renders', () => {
    const first = row('anna@example.net', { confidence: 'high' }, 20);
    const second = row('zoe@example.net', { confidence: 'high' }, 20);
    expect([second, first].sort(byPriority)[0]).toBe(first);
    expect([first, second].sort(byPriority)[0]).toBe(first);
  });
});

describe('sendableStock', () => {
  it('counts only prospects with an address, not set aside, never written to', () => {
    const stock = sendableStock([
      prospect('fresh@example.net', { confidence: 'high' }),
      prospect('written@example.net', { confidence: 'high' }, [msg('out', '2026-07-01T10:00')]),
      prospect('shelved@example.net', { confidence: 'high', status: 'archive' }),
      { ...prospect('noaddress@example.net', { confidence: 'high' }), email: '' },
      client('customer@example.net'),
    ]);
    expect(stock.total).toBe(1);
    expect(stock.byConfidence.high).toBe(1);
  });

  it('breaks the stock down so an empty useful reserve cannot hide behind a total', () => {
    // The real shape on 27/07/2026: a total that looks like a reserve, and
    // nothing worth writing to inside it.
    const stock = sendableStock([
      prospect('a@example.net', { confidence: 'low' }),
      prospect('b@example.net', { confidence: 'low' }),
      prospect('c@example.net', { confidence: 'medium' }),
    ]);
    expect(stock.total).toBe(3);
    expect(stock.byConfidence.high).toBe(0);
    expect(stock.byConfidence.low).toBe(2);
  });

  it('files an unknown confidence under unknown rather than dropping it', () => {
    const stock = sendableStock([prospect('a@example.net', { confidence: null })]);
    expect(stock.total).toBe(1);
    expect(stock.byConfidence.unknown).toBe(1);
  });

  it('returns zeroes on an empty list', () => {
    expect(sendableStock([]).total).toBe(0);
  });
});

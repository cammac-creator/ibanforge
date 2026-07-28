import { describe, expect, it } from 'vitest';
import { isSnoozed, localDay, snoozedMap } from './snooze';
import type { Contact, ProspectSourcing } from './types';

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
  outcome: null,
  outcomeNote: null,
  wakeUpAt: null,
  outcomeAt: null,
  ...over,
});

const prospect = (id: string, wakeUpAt: string | null): Contact => ({
  kind: 'prospect',
  id,
  email: id,
  company: 'Fictive Sàrl',
  country: 'CH',
  website: null,
  messages: [],
  draft: null,
  unread: false,
  account: 'crm@example.net',
  sourcing: sourcing({ wakeUpAt, outcome: wakeUpAt ? 'pas_maintenant' : null }),
  readyMail: null,
});

describe('isSnoozed', () => {
  it('is false when no date is set', () => {
    expect(isSnoozed(null, '2026-07-28')).toBe(false);
    expect(isSnoozed(undefined, '2026-07-28')).toBe(false);
    expect(isSnoozed('', '2026-07-28')).toBe(false);
  });

  it('is true strictly before the wake-up day', () => {
    expect(isSnoozed('2026-09-15', '2026-07-28')).toBe(true);
  });

  it('wakes ON the day, not the day after', () => {
    // "rappeler le 15" means the 15th is the day you call, not the day you
    // notice you were meant to.
    expect(isSnoozed('2026-09-15', '2026-09-15')).toBe(false);
  });

  it('stays awake after the day has passed', () => {
    expect(isSnoozed('2026-09-15', '2026-09-16')).toBe(false);
    expect(isSnoozed('2026-09-15', '2027-01-02')).toBe(false);
  });

  it('orders across month and year boundaries', () => {
    // The whole reason the comparison is on the string: YYYY-MM-DD sorts
    // chronologically, so no Date and therefore no timezone is involved.
    expect(isSnoozed('2027-01-01', '2026-12-31')).toBe(true);
    expect(isSnoozed('2026-08-01', '2026-07-31')).toBe(true);
    expect(isSnoozed('2026-07-31', '2026-08-01')).toBe(false);
  });
});

describe('localDay', () => {
  it('reads the local calendar day, zero padded', () => {
    // Built from the local getters, not from toISOString: in Zurich on the 1st
    // at 00:30, toISOString still says the previous day, and a contact due to
    // wake would stay asleep for two more hours.
    const d = new Date(2026, 8, 5, 0, 30);
    expect(localDay(d)).toBe('2026-09-05');
  });

  it('pads a single digit month and day', () => {
    expect(localDay(new Date(2026, 0, 9, 12, 0))).toBe('2026-01-09');
  });
});

describe('snoozedMap', () => {
  it('answers for every contact, keyed by id', () => {
    const now = new Date(2026, 6, 28, 10, 0);
    const map = snoozedMap([prospect('a@example.net', '2026-09-15'), prospect('b@example.net', null)], now);
    expect(map['a@example.net']).toBe(true);
    expect(map['b@example.net']).toBe(false);
  });

  it('handles a client with no sourcing at all', () => {
    const client: Contact = {
      kind: 'client',
      id: 'c@example.net',
      email: 'c@example.net',
      company: null,
      country: null,
      website: null,
      messages: [],
      draft: null,
      unread: false,
      account: 'crm@example.net',
      apiKey: {
        keyPrefix: 'k',
        paid: false,
        creditsTotal: null,
        creditsRemaining: null,
        monthlyLimit: 1000,
        usedAllTime: 0,
        lastActiveMonth: null,
      },
      usage: { series: [], months: [], days: [], endpoints: [] },
    };
    expect(snoozedMap([client], new Date(2026, 6, 28))['c@example.net']).toBe(false);
  });
});

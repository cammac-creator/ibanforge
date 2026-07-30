import { describe, expect, it } from 'vitest';
import type { BuildInput, KeyRow, MessageRow, ProspectRow } from './build-contacts';
import { ballWithUs as isBallWithUs, followupDue as isFollowupDue } from './buckets';
import { crmSnapshot } from './snapshot';

// example.net rather than example.com: INTERNAL_RE deliberately swallows
// example.com. Local parts avoid "test-", "-test", "smoke" and "audit", which
// the same regex matches anywhere in an address.

const NOW = new Date('2026-07-30T09:00:00Z');

const keyRow = (email: string, over: Partial<KeyRow> = {}): KeyRow => ({
  key_prefix: `ifk_${email.split('@')[0]}`,
  email,
  monthly_limit: 200,
  active: 1,
  created_at: '2026-01-05 10:00:00',
  used: 0,
  used_prev: 0,
  used_all_time: 0,
  last_active_month: '2026-07',
  credits_total: null,
  credits_remaining: null,
  paid: 0,
  series: [],
  ...over,
});

const prospectRow = (id: string, email: string, over: Partial<ProspectRow> = {}): ProspectRow => ({
  id,
  company: `Société ${id}`,
  segment: 'editeurs',
  website: null,
  country: 'CH',
  what_they_do: null,
  fit_reason: null,
  buying_signal: null,
  signal_source_url: null,
  contact_name: null,
  contact_role: null,
  contact_email: email,
  email_source_url: null,
  personalization_hook: null,
  confidence: 'high',
  status: 'a_mailer',
  mail_subject_en: null,
  mail_body_en: null,
  mail_subject_fr: null,
  mail_body_fr: null,
  recommended_lang: 'en',
  source: null,
  ...over,
});

const msgRow = (email: string, over: Partial<MessageRow> = {}): MessageRow => ({
  customer_email: email,
  direction: 'out',
  msg_date: '2026-07-01T10:00',
  subject: 'Sujet',
  snippet: 'Texte',
  counterparty: null,
  ...over,
});

/**
 * One base wide enough to exercise every figure the two pages share: a paying
 * client waiting on our answer, a free client whose last mail has gone stale, a
 * fresh prospect, an archived one, one asleep until a date, and a mail sent
 * today to an address the contact list does not carry.
 */
const input: BuildInput = {
  keys: [
    keyRow('paid@example.net', { credits_total: 5000, paid: 1, used_all_time: 400 }),
    keyRow('free@example.net', { used_all_time: 12 }),
  ],
  prospects: [
    prospectRow('p1', 'fresh@example.net'),
    prospectRow('p2', 'gone@example.net', { status: 'archive' }),
    prospectRow('p3', 'later@example.net', {
      status: 'contacte',
      outcome: 'pas_maintenant',
      wake_up_at: '2026-12-01',
    }),
  ],
  messages: [
    // They wrote last: the ball is with us.
    msgRow('paid@example.net', { direction: 'out', msg_date: '2026-07-20T10:00' }),
    msgRow('paid@example.net', { direction: 'in', msg_date: '2026-07-28T10:00' }),
    // Our mail, twenty days of silence: a follow-up has come due.
    msgRow('free@example.net', { direction: 'out', msg_date: '2026-07-10T10:00' }),
    // Same shape, but this one asked to be left until December.
    msgRow('later@example.net', { direction: 'out', msg_date: '2026-07-10T10:00' }),
    // Sent today, to an address buildContacts drops as internal. It still
    // counts against the day, which is what the cadence figure is for.
    msgRow('ops@ibanforge.com', { direction: 'out', msg_date: '2026-07-30T07:30' }),
    // A draft is not a send, whatever day it carries.
    msgRow('fresh@example.net', { direction: 'draft', msg_date: '2026-07-30T08:00' }),
  ],
  activityByKey: {},
  reads: {},
  months: ['2026-06', '2026-07'],
};

describe('crmSnapshot', () => {
  it('counts the live set, archived rows excluded', () => {
    const snap = crmSnapshot(input, NOW);
    // Five contacts are built, four are live: the archived prospect has no
    // correspondence, so nothing outranks its status.
    expect(snap.contacts).toHaveLength(5);
    expect(snap.active.map((c) => c.id).sort()).toEqual([
      'free@example.net',
      'fresh@example.net',
      'later@example.net',
      'paid@example.net',
    ]);
    expect(snap.clients).toBe(2);
    expect(snap.prospects).toBe(2);
  });

  it('reads the day buckets off the very predicates the list reads', () => {
    const snap = crmSnapshot(input, NOW);
    expect(snap.ballWithUs).toBe(1);
    expect(snap.followupDue).toBe(1);
    // Not merely equal by luck: the figures are what those predicates answer on
    // the same contacts, which is the whole reason they live in one module.
    expect(snap.ballWithUs).toBe(
      snap.contacts.filter((c) => isBallWithUs(c, snap.situations[c.id])).length,
    );
    expect(snap.followupDue).toBe(
      snap.contacts.filter((c) => isFollowupDue(c, snap.situations[c.id], snap.snoozed[c.id]))
        .length,
    );
  });

  it('leaves a contact asleep out of the follow-ups and says how many', () => {
    const snap = crmSnapshot(input, NOW);
    expect(snap.snoozed['later@example.net']).toBe(true);
    expect(snap.asleep).toBe(1);
    // Its mail is as old as the one that did come due, so only the snooze can
    // be what keeps it out of the count.
    expect(snap.situations['later@example.net'].followupDue).toBe(true);
    expect(snap.followupDue).toBe(1);
  });

  it('counts the day over the raw messages, drafts excluded', () => {
    const snap = crmSnapshot(input, NOW);
    expect(snap.sentToday).toBe(1);
    expect(snap.todayUtc).toBe('2026-07-30');
  });

  it('prices the live client set and counts the free keys that call', () => {
    const snap = crmSnapshot(input, NOW);
    expect(snap.revenueUsd).toBe(20);
    expect(snap.freeActive).toBe(1);
  });

  it('gives an unpriced credit bundle no value rather than a wrong one', () => {
    const snap = crmSnapshot(
      { ...input, keys: [keyRow('paid@example.net', { credits_total: 777, paid: 1 })] },
      NOW,
    );
    expect(snap.revenueUsd).toBe(0);
  });

  /**
   * The point of the module. Both pages call this, so the only way they can
   * quote different figures for the same thing is for one call to answer
   * differently from another on the same payload and the same instant.
   */
  it('answers the same thing twice on one payload and one instant', () => {
    const a = crmSnapshot(input, NOW);
    const b = crmSnapshot(input, NOW);
    const figures = (s: typeof a) => ({
      active: s.active.length,
      ballWithUs: s.ballWithUs,
      followupDue: s.followupDue,
      asleep: s.asleep,
      clients: s.clients,
      prospects: s.prospects,
      sentToday: s.sentToday,
      revenueUsd: s.revenueUsd,
      freeActive: s.freeActive,
      todayUtc: s.todayUtc,
    });
    expect(figures(a)).toEqual(figures(b));
  });

  it('holds nothing when the payloads are empty', () => {
    const snap = crmSnapshot(
      { keys: [], prospects: [], messages: [], activityByKey: {}, reads: {}, months: [] },
      NOW,
    );
    expect(snap.active).toEqual([]);
    expect(snap.ballWithUs).toBe(0);
    expect(snap.followupDue).toBe(0);
    expect(snap.sentToday).toBe(0);
    expect(snap.revenueUsd).toBe(0);
  });
});

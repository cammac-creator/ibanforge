import { describe, expect, it } from 'vitest';
import {
  buildDossiers,
  denseDays,
  sortDossiers,
  type ClientProfileRow,
  type DossierInput,
} from './client-dossiers';
import type { KeyRow, MessageRow, ProspectRow } from './build-contacts';

// example.net rather than example.com: INTERNAL_RE swallows the latter, and a
// fixture that never reaches the output tests nothing.
const NOW = new Date('2026-07-30T09:00:00Z');

const keyRow = (email: string, over: Partial<KeyRow> = {}): KeyRow => ({
  key_prefix: `ifk_${email.split('@')[0]}`,
  email,
  monthly_limit: 200,
  active: 1,
  created_at: '2026-07-01 10:00:00',
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

const profile = (over: Partial<ClientProfileRow> = {}): ClientProfileRow => ({
  key_prefix: 'ifk_x',
  first_seen: '2026-07-20 09:00:00',
  last_seen: '2026-07-29 15:00:00',
  total: 0,
  ok: 0,
  paywall: 0,
  bad_input: 0,
  auth_or_quota: 0,
  server_error: 0,
  avg_ms: 0,
  p95_ms: 0,
  last_success_at: null,
  last_refusal_at: null,
  endpoints: [],
  countries: [],
  user_agents: [],
  client_kinds: [],
  distinct_ips: 0,
  hours: Array(24).fill(0),
  days: [],
  reject_reasons: [],
  ...over,
});

const base: DossierInput = {
  keys: [],
  prospects: [],
  messages: [],
  profiles: {},
  monthsByKey: {},
  quotaWarnedByKey: {},
  now: NOW,
};

const msg = (email: string, over: Partial<MessageRow> = {}): MessageRow => ({
  id: `m-${Math.abs(email.length)}-${over.msg_date ?? ''}`,
  customer_email: email,
  direction: 'out',
  msg_date: '2026-07-21T12:08',
  subject: 'Hello',
  snippet: null,
  counterparty: 'claude-alain@ibanforge.com',
  ...over,
} as MessageRow);

const prospectRow = (email: string, over: Partial<ProspectRow> = {}): ProspectRow => ({
  id: `p-${email}`,
  company: 'Société Alpha',
  segment: null,
  website: 'https://alpha.example.net',
  country: 'CH',
  what_they_do: 'invoicing suite',
  fit_reason: null,
  buying_signal: null,
  signal_source_url: null,
  contact_name: null,
  contact_role: null,
  contact_email: email,
  email_source_url: null,
  personalization_hook: null,
  confidence: null,
  status: 'a_mailer',
  mail_subject_en: null,
  mail_body_en: null,
  mail_subject_fr: null,
  mail_body_fr: null,
  recommended_lang: null,
  source: null,
  ...over,
});

describe('buildDossiers', () => {
  it('gathers every key of one address into a single dossier', () => {
    const out = buildDossiers({
      ...base,
      keys: [
        keyRow('two@example.net', { key_prefix: 'ifk_a', used_all_time: 30 }),
        keyRow('two@example.net', { key_prefix: 'ifk_b', used_all_time: 12 }),
      ],
      profiles: {
        ifk_a: profile({ key_prefix: 'ifk_a', total: 30, ok: 30 }),
        ifk_b: profile({ key_prefix: 'ifk_b', total: 12, ok: 10, paywall: 2 }),
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].keys).toHaveLength(2);
    expect(out[0].requests).toBe(42);
    expect(out[0].paywall).toBe(2);
  });

  it('never shows our own accounts', () => {
    const out = buildDossiers({ ...base, keys: [keyRow('someone@ibanforge.com', { used_all_time: 99 })] });
    expect(out).toHaveLength(0);
  });

  it('takes company, website and country from the prospect record when there is one', () => {
    const out = buildDossiers({
      ...base,
      keys: [keyRow('d@alpha.example.net')],
      prospects: [prospectRow('d@alpha.example.net')],
    });
    expect(out[0].company).toBe('Société Alpha');
    expect(out[0].website).toBe('https://alpha.example.net');
    expect(out[0].country).toBe('CH');
  });

  it('merges the countries checked across a customer’s keys, busiest first', () => {
    const out = buildDossiers({
      ...base,
      keys: [keyRow('c@example.net', { key_prefix: 'ifk_a' }), keyRow('c@example.net', { key_prefix: 'ifk_b' })],
      profiles: {
        ifk_a: profile({ countries: [{ code: 'DE', count: 5 }, { code: 'FR', count: 4 }] }),
        ifk_b: profile({ countries: [{ code: 'FR', count: 9 }] }),
      },
    });
    expect(out[0].countries).toEqual([
      { code: 'FR', count: 13 },
      { code: 'DE', count: 5 },
    ]);
  });

  it('summarises the mail thread and points at the exchange', () => {
    const out = buildDossiers({
      ...base,
      keys: [keyRow('m@example.net')],
      messages: [
        msg('m@example.net', { direction: 'out', msg_date: '2026-07-21T12:08', subject: 'Quick question' }),
        msg('m@example.net', { direction: 'in', msg_date: '2026-07-23T08:00', subject: 'Re: Quick question' }),
        msg('m@example.net', { direction: 'draft', msg_date: '2026-07-29T10:00', subject: 'I raised your limit' }),
      ],
    });
    const d = out[0];
    expect(d.mails.sent).toBe(1);
    expect(d.mails.received).toBe(1);
    // A draft is not correspondence, but it is the thing waiting to be done.
    expect(d.mails.hasDraft).toBe(true);
    expect(d.mails.lastSubject).toBe('Re: Quick question');
    expect(d.mails.lastAt).toBe('2026-07-23T08:00');
  });

  it('counts the days since the last call, which is what freshness means', () => {
    const out = buildDossiers({
      ...base,
      keys: [keyRow('f@example.net', { key_prefix: 'ifk_f' })],
      profiles: { ifk_f: profile({ key_prefix: 'ifk_f', total: 3, last_seen: '2026-07-27 09:00:00' }) },
    });
    expect(out[0].daysSinceLastCall).toBe(3);
  });
});

describe('the verdict, which is the point of the page', () => {
  const verdictOf = (input: Partial<DossierInput>, over: Partial<ClientProfileRow>, key: Partial<KeyRow> = {}) =>
    buildDossiers({
      ...base,
      ...input,
      keys: [keyRow('v@example.net', { key_prefix: 'ifk_v', ...key })],
      profiles: { ifk_v: profile({ key_prefix: 'ifk_v', ...over }) },
    })[0].verdict;

  it('calls a customer blocked when the last thing we did was turn them away', () => {
    // The real shape, invented figures: a customer runs through its whole
    // monthly allowance, takes a string of 402s, then goes silent.
    expect(
      verdictOf({}, {
        total: 204, ok: 200, paywall: 4, last_seen: '2026-07-25 14:30:00',
        last_success_at: '2026-07-25 14:00:00', last_refusal_at: '2026-07-25 14:30:00',
      }, { used: 200, monthly_limit: 200 }),
    ).toBe('blocked');
  });

  it('keeps saying blocked after we raise the quota, because the customer does not know we did', () => {
    // The quota now has room, so "exhausted" is false — but they walked away at
    // a wall and nothing since has told them otherwise. This is the whole point.
    expect(
      verdictOf({}, {
        total: 204, ok: 200, paywall: 4, last_seen: '2026-07-25 14:30:00',
        last_success_at: '2026-07-25 14:00:00', last_refusal_at: '2026-07-25 14:30:00',
      }, { used: 200, monthly_limit: 5000 }),
    ).toBe('blocked');
  });

  it('stops saying blocked once they have called successfully since', () => {
    expect(
      verdictOf({}, {
        total: 204, ok: 200, paywall: 4, last_seen: '2026-07-29 15:00:00',
        last_refusal_at: '2026-07-25 14:30:00', last_success_at: '2026-07-29 15:00:00',
      }, { used: 200, monthly_limit: 5000 }),
    ).not.toBe('blocked');
  });

  it('flags a customer whose calls keep being rejected', () => {
    expect(verdictOf({}, { total: 40, ok: 10, bad_input: 30, last_seen: '2026-07-29 15:00:00', last_success_at: '2026-07-29 15:00:00' })).toBe('struggling');
  });

  it('calls a customer dormant once they have been quiet for a fortnight', () => {
    expect(verdictOf({}, { total: 120, ok: 120, last_seen: '2026-07-10 09:00:00', last_success_at: '2026-07-10 09:00:00' })).toBe('dormant');
  });

  it('says silent when a key exists but has never been used', () => {
    expect(verdictOf({}, { total: 0, last_seen: null, first_seen: null })).toBe('silent');
  });

  it('spots a customer ramping up', () => {
    const days = [
      { day: '2026-07-18', count: 2 },
      { day: '2026-07-19', count: 2 },
      { day: '2026-07-27', count: 40 },
      { day: '2026-07-29', count: 60 },
    ];
    expect(verdictOf({}, { total: 104, ok: 104, days, last_seen: '2026-07-29 15:00:00', last_success_at: '2026-07-29 15:00:00' })).toBe('rising');
  });

  it('otherwise just says active', () => {
    const days = [
      { day: '2026-07-20', count: 10 },
      { day: '2026-07-27', count: 10 },
    ];
    expect(verdictOf({}, { total: 20, ok: 20, days, last_seen: '2026-07-29 15:00:00', last_success_at: '2026-07-29 15:00:00' })).toBe('active');
  });

  it('ranks blocked above dormant, because the reason for the silence is the story', () => {
    expect(
      verdictOf({}, {
        total: 204, ok: 200, paywall: 4, last_seen: '2026-07-10 09:00:00',
        last_success_at: '2026-07-10 08:00:00', last_refusal_at: '2026-07-10 09:00:00',
      }, { used: 200, monthly_limit: 200 }),
    ).toBe('blocked');
  });
});

describe('sortDossiers', () => {
  const mk = (email: string, requests: number, lastSeen: string | null) =>
    buildDossiers({
      ...base,
      keys: [keyRow(email, { key_prefix: `ifk_${email[0]}` })],
      profiles: { [`ifk_${email[0]}`]: profile({ total: requests, last_seen: lastSeen }) },
    })[0];

  const a = mk('a@example.net', 5, '2026-07-29 10:00:00');
  const b = mk('b@example.net', 500, '2026-07-10 10:00:00');
  const c = mk('c@example.net', 50, null);

  it('sorts by request volume, busiest first', () => {
    expect(sortDossiers([a, b, c], 'requests').map((d) => d.email)).toEqual([
      'b@example.net',
      'c@example.net',
      'a@example.net',
    ]);
  });

  it('sorts by freshness, most recent first, and puts the never-seen last', () => {
    expect(sortDossiers([b, c, a], 'freshness').map((d) => d.email)).toEqual([
      'a@example.net',
      'b@example.net',
      'c@example.net',
    ]);
  });

  it('does not mutate the array it was given', () => {
    const list = [a, b, c];
    sortDossiers(list, 'requests');
    expect(list.map((d) => d.email)).toEqual(['a@example.net', 'b@example.net', 'c@example.net']);
  });
});

describe('denseDays', () => {
  it('fills the gaps, so three busy days do not draw as three fat bars', () => {
    const out = denseDays([{ day: '2026-07-28', count: 5 }, { day: '2026-07-30', count: 9 }], NOW, 5);
    expect(out.map((d) => d.day)).toEqual(['2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30']);
    expect(out.map((d) => d.count)).toEqual([0, 0, 5, 0, 9]);
  });

  it('ignores days older than the span rather than stretching to reach them', () => {
    const out = denseDays([{ day: '2026-01-01', count: 99 }, { day: '2026-07-30', count: 1 }], NOW, 3);
    expect(out).toHaveLength(3);
    expect(out.reduce((s, d) => s + d.count, 0)).toBe(1);
  });

  it('returns a flat span for a customer who never called', () => {
    const out = denseDays([], NOW, 4);
    expect(out).toHaveLength(4);
    expect(out.every((d) => d.count === 0)).toBe(true);
  });
});

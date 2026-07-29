import { describe, expect, it } from 'vitest';
import {
  buildContacts,
  INTERNAL_RE,
  type BuildInput,
  type KeyRow,
  type MessageRow,
  type ProspectRow,
} from './build-contacts';
import type { Contact } from './types';

// example.net is reserved for documentation (RFC 2606) like example.com, but
// INTERNAL_RE deliberately swallows example.com, so any fixture that must reach
// the output uses example.net. Local parts avoid "test-", "-test", "smoke" and
// "audit", which the same regex matches anywhere in an address.

const base: BuildInput = {
  keys: [],
  prospects: [],
  messages: [],
  activityByKey: {},
  reads: {},
  months: ['2026-06', '2026-07'],
};

const keyRow = (email: string, over: Partial<KeyRow> = {}): KeyRow => ({
  key_prefix: `ifk_${email.split('@')[0]}`,
  email,
  monthly_limit: 200,
  active: 1,
  created_at: '2026-06-01 10:00:00',
  used: 0,
  used_prev: 0,
  used_all_time: 5,
  last_active_month: '2026-07',
  credits_total: null,
  credits_remaining: null,
  paid: 0,
  series: [1, 2],
  ...over,
});

const prospectRow = (id: string, email: string | null, over: Partial<ProspectRow> = {}): ProspectRow => ({
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
  mail_subject_en: 'Hello',
  mail_body_en: 'Body',
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
  subject: null,
  snippet: null,
  counterparty: null,
  ...over,
});

/** Narrow to a client contact, failing loudly rather than silently skipping. */
function asClient(contact: Contact) {
  if (contact.kind !== 'client') throw new Error(`expected a client contact, got ${contact.kind}`);
  return contact;
}

describe('INTERNAL_RE', () => {
  it('matches internal and documentation addresses, not a real prospect domain', () => {
    expect(INTERNAL_RE.test('someone@ibanforge.com')).toBe(true);
    expect(INTERNAL_RE.test('someone@example.com')).toBe(true);
    expect(INTERNAL_RE.test('SOMEONE@IBANFORGE.COM')).toBe(true);
    expect(INTERNAL_RE.test('alpha@example.net')).toBe(false);
  });
});

describe('buildContacts', () => {
  it('produces one client contact per meaningful key', () => {
    const out = buildContacts({ ...base, keys: [keyRow('alpha@example.net')] });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('client');
    expect(out[0].id).toBe('alpha@example.net');
  });

  it('carries the key, the usage series and the per-key activity onto the client', () => {
    const out = buildContacts({
      ...base,
      keys: [keyRow('alpha@example.net', { credits_total: 1000, credits_remaining: 400 })],
      activityByKey: {
        ifk_alpha: { endpoints: [{ path: '/v1/iban', count: 7 }], days: [{ day: '2026-07-01', count: 7 }] },
      },
    });
    const client = asClient(out[0]);
    expect(client.apiKey).toEqual({
      keyPrefix: 'ifk_alpha',
      paid: true,
      creditsTotal: 1000,
      creditsRemaining: 400,
      monthlyLimit: 200,
      usedAllTime: 5,
      lastActiveMonth: '2026-07',
      // Carried through from the key row so the UI can date a signup, alongside
      // the decision itself, taken once server-side against one clock.
      createdAt: '2026-06-01 10:00:00',
      isNew: false,
    });
    expect(client.usage.series).toEqual([1, 2]);
    expect(client.usage.months).toEqual(['2026-06', '2026-07']);
    expect(client.usage.days).toEqual([{ day: '2026-07-01', count: 7 }]);
    expect(client.usage.endpoints).toEqual([{ path: '/v1/iban', count: 7 }]);
  });

  it('drops internal and test accounts', () => {
    const out = buildContacts({
      ...base,
      keys: [keyRow('someone@ibanforge.com'), keyRow('test-buyer@example.net'), keyRow('doc@example.com')],
    });
    expect(out).toHaveLength(0);
  });

  it('drops a key with no usage, no payment and no mail', () => {
    const out = buildContacts({ ...base, keys: [keyRow('quiet@example.net', { used_all_time: 0 })] });
    expect(out).toHaveLength(0);
  });

  it('keeps a key with no usage that was paid for', () => {
    const out = buildContacts({
      ...base,
      keys: [keyRow('quiet@example.net', { used_all_time: 0, credits_total: 1000, credits_remaining: 1000 })],
    });
    expect(out).toHaveLength(1);
  });

  it('keeps a key with no usage that we have a thread with', () => {
    const out = buildContacts({
      ...base,
      keys: [keyRow('quiet@example.net', { used_all_time: 0 })],
      messages: [msgRow('quiet@example.net')],
    });
    expect(out).toHaveLength(1);
    expect(out[0].messages).toHaveLength(1);
  });

  it('keeps a key with no usage that only has a draft waiting', () => {
    const out = buildContacts({
      ...base,
      keys: [keyRow('quiet@example.net', { used_all_time: 0 })],
      messages: [msgRow('quiet@example.net', { direction: 'draft', subject: 'brouillon' })],
    });
    expect(out).toHaveLength(1);
    expect(out[0].messages).toHaveLength(0);
    expect(out[0].draft?.subject).toBe('brouillon');
  });

  it('produces a prospect contact for a prospect with no key', () => {
    const out = buildContacts({ ...base, prospects: [prospectRow('p1', 'lead@example.net')] });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('prospect');
    expect(out[0].company).toBe('Société p1');
  });

  it('merges a prospect who became a client into a single client contact', () => {
    const out = buildContacts({
      ...base,
      keys: [keyRow('both@example.net')],
      prospects: [prospectRow('p2', 'both@example.net')],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('client');
    expect(asClient(out[0]).sourcing?.prospectId).toBe('p2');
    expect(out[0].company).toBe('Société p2');
  });

  it('leaves sourcing off a client who never was a prospect and falls back to enrichment', () => {
    // .example is reserved like example.net, so the derived name is invented too.
    const out = buildContacts({ ...base, keys: [keyRow('billing@acme-pay.example')] });
    expect(asClient(out[0]).sourcing).toBeUndefined();
    expect(out[0].company).toBe('Acme Pay');
    expect(out[0].website).toBe('https://acme-pay.example');
  });

  it('keeps a prospect with no contact email', () => {
    const out = buildContacts({ ...base, prospects: [prospectRow('p3', null, { status: 'a_enrichir' })] });
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe('');
    expect(out[0].id).toBe('prospect:p3');
  });

  it('gives two prospects with no contact email distinct ids', () => {
    const out = buildContacts({
      ...base,
      prospects: [prospectRow('p3a', null), prospectRow('p3b', null)],
    });
    expect(out.map((c) => c.id)).toEqual(['prospect:p3a', 'prospect:p3b']);
  });

  it('excludes rejected prospects', () => {
    const out = buildContacts({ ...base, prospects: [prospectRow('p4', 'no@example.net', { status: 'rejete' })] });
    expect(out).toHaveLength(0);
  });

  it('attaches messages by lowercased email and separates the draft', () => {
    const out = buildContacts({
      ...base,
      prospects: [prospectRow('p5', 'Lead@Example.net')],
      messages: [
        msgRow('lead@example.net', { direction: 'out', msg_date: '2026-07-01T10:00', subject: 'a' }),
        msgRow('lead@example.net', { direction: 'draft', msg_date: '2026-07-20T10:00', subject: 'd' }),
      ],
    });
    expect(out[0].messages).toHaveLength(1);
    expect(out[0].messages[0].subject).toBe('a');
    expect(out[0].draft?.subject).toBe('d');
  });

  it('matches a mixed-case key email with its thread and its read marker', () => {
    const input: BuildInput = {
      ...base,
      keys: [keyRow('Mixed@Example.net')],
      messages: [msgRow('MIXED@EXAMPLE.NET', { direction: 'in', msg_date: '2026-07-01T10:00' })],
      reads: { 'mixed@example.net': '2026-07-01 09:00:00' },
    };
    const out = buildContacts(input);
    expect(out[0].id).toBe('mixed@example.net');
    expect(out[0].email).toBe('Mixed@Example.net');
    expect(out[0].messages).toHaveLength(1);
    expect(out[0].unread).toBe(true);

    const read = buildContacts({ ...input, reads: { 'mixed@example.net': '2026-07-02 00:00:00' } });
    expect(read[0].unread).toBe(false);
  });

  it('sorts messages by date ascending', () => {
    const out = buildContacts({
      ...base,
      prospects: [prospectRow('p6', 'lead6@example.net')],
      messages: [
        msgRow('lead6@example.net', { direction: 'in', msg_date: '2026-07-05T10:00', subject: 'second' }),
        msgRow('lead6@example.net', { direction: 'out', msg_date: '2026-07-01T10:00', subject: 'first' }),
      ],
    });
    expect(out[0].messages.map((m) => m.subject)).toEqual(['first', 'second']);
  });

  it('sorts on the instant, not on the raw date string', () => {
    // The two rows use the two formats the ingester actually produces. A raw
    // string sort puts the space form first (' ' < 'T') and inverts the thread.
    const out = buildContacts({
      ...base,
      prospects: [prospectRow('p7', 'lead7@example.net')],
      messages: [
        msgRow('lead7@example.net', { direction: 'out', msg_date: '2026-07-01 23:00:00', subject: 'second' }),
        msgRow('lead7@example.net', { direction: 'in', msg_date: '2026-07-01T09:00', subject: 'first' }),
      ],
    });
    expect(out[0].messages.map((m) => m.subject)).toEqual(['first', 'second']);
  });

  it('drops messages whose date cannot be read', () => {
    const out = buildContacts({
      ...base,
      prospects: [prospectRow('p8', 'lead8@example.net')],
      messages: [
        msgRow('lead8@example.net', { msg_date: null, subject: 'undated' }),
        msgRow('lead8@example.net', { msg_date: 'hier matin', subject: 'unparsable' }),
        msgRow('lead8@example.net', { msg_date: '2026-07-01T10:00', subject: 'real' }),
      ],
    });
    expect(out[0].messages.map((m) => m.subject)).toEqual(['real']);
  });

  it('still counts an undatable message when deciding a key is meaningful', () => {
    const out = buildContacts({
      ...base,
      keys: [keyRow('quiet@example.net', { used_all_time: 0 })],
      messages: [msgRow('quiet@example.net', { msg_date: null })],
    });
    expect(out).toHaveLength(1);
    expect(out[0].messages).toHaveLength(0);
  });

  it('keeps the most recent datable draft', () => {
    const out = buildContacts({
      ...base,
      prospects: [prospectRow('p9', 'lead9@example.net')],
      messages: [
        msgRow('lead9@example.net', { direction: 'draft', msg_date: '2026-07-20T10:00', subject: 'latest' }),
        msgRow('lead9@example.net', { direction: 'draft', msg_date: '2026-07-05T10:00', subject: 'older' }),
      ],
    });
    expect(out[0].draft?.subject).toBe('latest');
  });

  it('falls back to the last draft in input order when none can be dated', () => {
    const out = buildContacts({
      ...base,
      prospects: [prospectRow('p10', 'lead10@example.net')],
      messages: [
        msgRow('lead10@example.net', { direction: 'draft', msg_date: null, subject: 'first' }),
        msgRow('lead10@example.net', { direction: 'draft', msg_date: 'hier', subject: 'last' }),
      ],
    });
    expect(out[0].draft?.subject).toBe('last');
  });

  it('does not leak one address thread onto another', () => {
    const out = buildContacts({
      ...base,
      prospects: [prospectRow('p11', 'lead11@example.net'), prospectRow('p12', 'lead12@example.net')],
      messages: [msgRow('lead11@example.net', { subject: 'only for eleven' })],
    });
    expect(out[0].messages.map((m) => m.subject)).toEqual(['only for eleven']);
    expect(out[1].messages).toHaveLength(0);
  });

  it('sends from the warm mailbox once a client thread exists, from the cold one otherwise', () => {
    const cold = buildContacts({ ...base, keys: [keyRow('alpha@example.net')] });
    expect(cold[0].account).toBe('claude-alain@ibanforge.com');

    const warm = buildContacts({
      ...base,
      keys: [keyRow('alpha@example.net')],
      messages: [msgRow('alpha@example.net')],
    });
    expect(warm[0].account).toBe('cammac@bluewin.ch');
  });

  it('exposes the ready-made mail of a prospect and nothing when there is no body', () => {
    const withMail = buildContacts({ ...base, prospects: [prospectRow('p13', 'lead13@example.net')] });
    expect(withMail[0].kind === 'prospect' ? withMail[0].readyMail : null).toEqual({
      subjectEn: 'Hello',
      bodyEn: 'Body',
      subjectFr: null,
      bodyFr: null,
      recommendedLang: 'en',
    });

    const without = buildContacts({
      ...base,
      prospects: [prospectRow('p14', 'lead14@example.net', { mail_body_en: null, mail_body_fr: null })],
    });
    expect(without[0].kind === 'prospect' ? without[0].readyMail : undefined).toBeNull();
  });

  // --- Pilots: a large free quota is an evaluation, not a customer. -----------

  it('drops a pilot key, so a pilot who is nothing else appears nowhere', () => {
    const out = buildContacts({
      ...base,
      keys: [keyRow('pilot@example.net', { monthly_limit: 5000, used_all_time: 900 })],
    });
    expect(out).toHaveLength(0);
  });

  it('keeps a key on a pilot-sized quota once it has been paid for', () => {
    const out = buildContacts({
      ...base,
      keys: [
        keyRow('pilot@example.net', { monthly_limit: 5000, credits_total: 1000, credits_remaining: 1000 }),
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('client');
  });

  it('keeps a free key just under the pilot quota', () => {
    const out = buildContacts({
      ...base,
      keys: [keyRow('nearly@example.net', { monthly_limit: 4999 })],
    });
    expect(out).toHaveLength(1);
  });

  it('still lists a pilot who is also a prospect, on the prospect side', () => {
    // The pilot is skipped before it can claim the address, which is how the two
    // old pages behaved: hidden among the clients, visible among the prospects.
    const out = buildContacts({
      ...base,
      keys: [keyRow('pilot@example.net', { monthly_limit: 5000, used_all_time: 900 })],
      prospects: [prospectRow('p18', 'pilot@example.net')],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('prospect');
    expect(out[0].id).toBe('pilot@example.net');
  });

  it('lets an ordinary key represent an address that also holds a pilot key', () => {
    // Pilots leave the candidate set before the ranking. Rank first and the
    // pilot wins on usage, then gets dropped, taking a visible person with it.
    const out = buildContacts({
      ...base,
      keys: [
        keyRow('mixed-quota@example.net', { key_prefix: 'ifk_pilot', monthly_limit: 5000, used_all_time: 100 }),
        keyRow('mixed-quota@example.net', { key_prefix: 'ifk_free', monthly_limit: 200, used_all_time: 10 }),
      ],
    });
    expect(out).toHaveLength(1);
    expect(asClient(out[0]).apiKey.keyPrefix).toBe('ifk_free');
    expect(asClient(out[0]).apiKey.usedAllTime).toBe(10);
  });

  it('emits nothing for an address whose every key is a pilot', () => {
    const out = buildContacts({
      ...base,
      keys: [
        keyRow('allpilot@example.net', { key_prefix: 'ifk_one', monthly_limit: 5000, used_all_time: 100 }),
        keyRow('allpilot@example.net', { key_prefix: 'ifk_two', monthly_limit: 9000, used_all_time: 900 }),
      ],
    });
    expect(out).toHaveLength(0);
  });

  // --- One contact per address, and who represents it. ------------------------

  it('emits one client contact per address, not one per key', () => {
    const out = buildContacts({
      ...base,
      keys: [
        keyRow('multi@example.net', { key_prefix: 'ifk_one' }),
        keyRow('multi@example.net', { key_prefix: 'ifk_two' }),
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('multi@example.net');
  });

  it('lets a paid key represent the address even when an unpaid one is more used', () => {
    const out = buildContacts({
      ...base,
      keys: [
        keyRow('multi@example.net', { key_prefix: 'ifk_free', used_all_time: 100 }),
        keyRow('multi@example.net', { key_prefix: 'ifk_paid', used_all_time: 0, credits_total: 1000, credits_remaining: 900 }),
      ],
    });
    expect(out).toHaveLength(1);
    expect(asClient(out[0]).apiKey.keyPrefix).toBe('ifk_paid');
    expect(asClient(out[0]).apiKey.paid).toBe(true);
  });

  it('lets the most used key represent the address when neither is paid', () => {
    // The busy key sorts AFTER the quiet one, so only the usage level can pick
    // it: drop that level and the prefix tiebreak returns the other key.
    const out = buildContacts({
      ...base,
      keys: [
        keyRow('multi@example.net', { key_prefix: 'ifk_aquiet', used_all_time: 3 }),
        keyRow('multi@example.net', { key_prefix: 'ifk_zbusy', used_all_time: 300 }),
      ],
    });
    expect(asClient(out[0]).apiKey.keyPrefix).toBe('ifk_zbusy');
    expect(asClient(out[0]).apiKey.usedAllTime).toBe(300);
  });

  it('falls back to the smaller key prefix when payment and usage tie', () => {
    const out = buildContacts({
      ...base,
      keys: [
        keyRow('multi@example.net', { key_prefix: 'ifk_zeta' }),
        keyRow('multi@example.net', { key_prefix: 'ifk_alpha' }),
      ],
    });
    expect(asClient(out[0]).apiKey.keyPrefix).toBe('ifk_alpha');
  });

  it('picks the same representative whichever order the payload arrives in', () => {
    const a = keyRow('multi@example.net', { key_prefix: 'ifk_zeta', series: [9] });
    const b = keyRow('multi@example.net', { key_prefix: 'ifk_alpha', series: [1] });
    expect(buildContacts({ ...base, keys: [a, b] })).toEqual(buildContacts({ ...base, keys: [b, a] }));
  });

  it('carries the representative key and its own usage, not a sibling key', () => {
    const out = buildContacts({
      ...base,
      keys: [
        keyRow('multi@example.net', { key_prefix: 'ifk_aquiet', used_all_time: 3, series: [1, 1] }),
        keyRow('multi@example.net', { key_prefix: 'ifk_zbusy', used_all_time: 300, series: [7, 7] }),
      ],
      activityByKey: {
        ifk_aquiet: { endpoints: [{ path: '/quiet', count: 3 }], days: [{ day: '2026-07-01', count: 3 }] },
        ifk_zbusy: { endpoints: [{ path: '/busy', count: 300 }], days: [{ day: '2026-07-01', count: 300 }] },
      },
    });
    const client = asClient(out[0]);
    expect(client.apiKey.keyPrefix).toBe('ifk_zbusy');
    expect(client.usage.series).toEqual([7, 7]);
    expect(client.usage.endpoints).toEqual([{ path: '/busy', count: 300 }]);
    expect(client.usage.days).toEqual([{ day: '2026-07-01', count: 300 }]);
  });

  it('emits one contact for two prospects sharing an address, keeping the first', () => {
    const out = buildContacts({
      ...base,
      prospects: [prospectRow('pa', 'twin@example.net'), prospectRow('pb', 'twin@example.net')],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind === 'prospect' ? out[0].sourcing.prospectId : null).toBe('pa');
  });

  it('suppresses every prospect on a converted address and keeps the first sourcing', () => {
    const out = buildContacts({
      ...base,
      keys: [keyRow('twin@example.net')],
      prospects: [prospectRow('pa', 'twin@example.net'), prospectRow('pb', 'twin@example.net')],
    });
    expect(out).toHaveLength(1);
    expect(asClient(out[0]).sourcing?.prospectId).toBe('pa');
  });

  it('shows the same company before and after an address converts', () => {
    // One rule for both lookups: the first prospect row represents the address,
    // so converting must not silently rename the contact.
    const prospects = [
      prospectRow('pa', 'twin@example.net', { company: 'Première SA' }),
      prospectRow('pb', 'twin@example.net', { company: 'Seconde SA' }),
    ];
    const before = buildContacts({ ...base, prospects });
    const after = buildContacts({ ...base, keys: [keyRow('twin@example.net')], prospects });
    expect(before[0].company).toBe('Première SA');
    expect(after[0].company).toBe('Première SA');
    expect(after[0].kind).toBe('client');
  });

  it('never lets a rejected row give its identity to a client', () => {
    const out = buildContacts({
      ...base,
      keys: [keyRow('twin@example.net')],
      prospects: [prospectRow('pa', 'twin@example.net', { status: 'rejete', company: 'Rejetée SA' })],
    });
    expect(out).toHaveLength(1);
    const client = asClient(out[0]);
    expect(client.sourcing).toBeUndefined();
    expect(client.company).toBe('Example'); // enrichment, not the killed row
  });

  it('shows the same company before and after conversion when the first row is rejected', () => {
    // The rejected row must be invisible to both lookups, or the live row names
    // the address before conversion and the dead one names it after.
    const prospects = [
      prospectRow('pa', 'twin@example.net', { status: 'rejete', company: 'Rejetée SA' }),
      prospectRow('pb', 'twin@example.net', { company: 'Vivante SA' }),
    ];
    const before = buildContacts({ ...base, prospects });
    const after = buildContacts({ ...base, keys: [keyRow('twin@example.net')], prospects });
    expect(before[0].company).toBe('Vivante SA');
    expect(after[0].company).toBe('Vivante SA');
    expect(asClient(after[0]).sourcing?.prospectId).toBe('pb');
  });

  it('lets a later prospect represent the address when the first one is rejected', () => {
    // The rejected row leaves before it can claim the address, so the surviving
    // row is still emitted. Dropping someone here would be a real regression.
    const out = buildContacts({
      ...base,
      prospects: [
        prospectRow('pa', 'twin@example.net', { status: 'rejete' }),
        prospectRow('pb', 'twin@example.net'),
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind === 'prospect' ? out[0].sourcing.prospectId : null).toBe('pb');
  });

  it('keeps an address where only one of its keys ever did anything', () => {
    // The meaningful rule now runs on the representative alone, so the ranking
    // must never elect the idle key over the one that makes the address visible.
    const out = buildContacts({
      ...base,
      keys: [
        keyRow('multi@example.net', { key_prefix: 'ifk_aidle', used_all_time: 0 }),
        keyRow('multi@example.net', { key_prefix: 'ifk_zused', used_all_time: 4 }),
      ],
    });
    expect(out).toHaveLength(1);
    expect(asClient(out[0]).apiKey.keyPrefix).toBe('ifk_zused');
  });

  it('still lists a prospect whose address holds a dormant key', () => {
    // Third leg of the "an unemitted key leaves its address unclaimed" rule,
    // alongside the internal and pilot cases. The key is real but did nothing,
    // so it produces no client, and the prospect must survive that.
    const out = buildContacts({
      ...base,
      keys: [keyRow('dormant@example.net', { used_all_time: 0 })],
      prospects: [prospectRow('p19', 'dormant@example.net')],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('prospect');
    expect(out[0].id).toBe('dormant@example.net');
  });

  it('still lists a prospect whose address holds a key we never surfaced', () => {
    // The key is filtered out as internal, so nothing claims the address and the
    // prospect must not disappear silently.
    const out = buildContacts({
      ...base,
      keys: [keyRow('ghost@example.com')],
      prospects: [prospectRow('p15', 'ghost@example.com')],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('prospect');
  });

  it('copies the whole sourcing block onto a prospect contact', () => {
    const out = buildContacts({
      ...base,
      prospects: [
        prospectRow('p16', 'lead16@example.net', {
          segment: 'banques',
          what_they_do: 'Paiements',
          fit_reason: 'Valide des IBAN',
          buying_signal: 'Recrute',
          signal_source_url: 'https://example.net/jobs',
          contact_name: 'Prénom Nom',
          contact_role: 'CTO',
          email_source_url: 'https://example.net/contact',
          personalization_hook: 'Leur page API',
          confidence: 'medium',
          status: 'contacte',
          source: 'annuaire',
        }),
      ],
    });
    expect(out[0].kind === 'prospect' ? out[0].sourcing : null).toEqual({
      prospectId: 'p16',
      segment: 'banques',
      whatTheyDo: 'Paiements',
      fitReason: 'Valide des IBAN',
      buyingSignal: 'Recrute',
      signalSourceUrl: 'https://example.net/jobs',
      contactName: 'Prénom Nom',
      contactRole: 'CTO',
      emailSourceUrl: 'https://example.net/contact',
      personalizationHook: 'Leur page API',
      confidence: 'medium',
      status: 'contacte',
      source: 'annuaire',
      outcome: null,
      outcomeNote: null,
      wakeUpAt: null,
      outcomeAt: null,
    });
  });

  it('carries the outcome across, and refuses one it does not recognise', () => {
    const carried = buildContacts({
      ...base,
      prospects: [
        prospectRow('p17', 'lead17@example.net', {
          outcome: 'pas_maintenant',
          outcome_note: 'Budget gelé, revoir à la rentrée.',
          wake_up_at: '2026-09-15',
          outcome_at: '2026-07-28T08:00:00.000Z',
        }),
      ],
    });
    const s = carried[0].kind === 'prospect' ? carried[0].sourcing : null;
    expect(s?.outcome).toBe('pas_maintenant');
    expect(s?.wakeUpAt).toBe('2026-09-15');
    expect(s?.outcomeNote).toBe('Budget gelé, revoir à la rentrée.');

    // The column is free TEXT. A value the UI has no badge for must read as
    // "nothing recorded" rather than reaching the interface and drawing blank.
    const bogus = buildContacts({
      ...base,
      prospects: [prospectRow('p18', 'lead18@example.net', { outcome: 'peut-etre' })],
    });
    expect(bogus[0].kind === 'prospect' ? bogus[0].sourcing.outcome : 'x').toBeNull();
  });

  it('reads an API that does not return the outcome columns yet', () => {
    // Vercel and Railway deploy independently: between the two pushes the page
    // runs against a backend whose SELECT has no outcome columns at all.
    const out = buildContacts({
      ...base,
      prospects: [prospectRow('p19', 'lead19@example.net', {})],
    });
    const s = out[0].kind === 'prospect' ? out[0].sourcing : null;
    expect(s?.outcome).toBeNull();
    expect(s?.wakeUpAt).toBeNull();
    expect(s?.outcomeAt).toBeNull();
  });

  it('gives each message-less contact its own messages array', () => {
    // One shared empty array would let a renderer that sorts or pushes in place
    // corrupt every silent contact at once.
    const out = buildContacts({
      ...base,
      prospects: [prospectRow('p20', 'quiet20@example.net'), prospectRow('p21', null)],
    });
    expect(out[0].messages).not.toBe(out[1].messages);
    out[0].messages.push(msgRow('quiet20@example.net'));
    expect(out[1].messages).toHaveLength(0);
  });

  it('does not mutate the input messages', () => {
    const messages = [
      msgRow('lead17@example.net', { msg_date: '2026-07-05T10:00', subject: 'second' }),
      msgRow('lead17@example.net', { msg_date: '2026-07-01T10:00', subject: 'first' }),
    ];
    buildContacts({ ...base, prospects: [prospectRow('p17', 'lead17@example.net')], messages });
    expect(messages.map((m) => m.subject)).toEqual(['second', 'first']);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildContacts,
  INTERNAL_RE,
  isInternalAccount,
  SEEDED_PILOT_RE,
  type BuildInput,
  type InstitutionalContactRow,
  type KeyRow,
  type MessageRow,
  type ProspectRow,
} from './build-contacts';
import { warmAccount } from './sending-account';
import type { Contact } from './types';

// Same reason as sending-account.test.ts: the warm mailbox is configured, not
// committed. Supply a value so the account assertions have something to check.
const savedWarm = process.env.CRM_WARM_ACCOUNT;
beforeAll(() => {
  process.env.CRM_WARM_ACCOUNT = 'warm@personal.invalid';
});
afterAll(() => {
  if (savedWarm === undefined) delete process.env.CRM_WARM_ACCOUNT;
  else process.env.CRM_WARM_ACCOUNT = savedWarm;
});

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

describe('SEEDED_PILOT_RE', () => {
  // The dashboard listed a dozen of these under "Pilotes silencieux, à
  // relancer" for 111 days. They are keys we minted ourselves at launch, one
  // per company we wanted to approach, and nobody ever called them. Presented
  // as leads going cold they read as a backlog of missed opportunities; they
  // are neither leads nor missed.
  it('matches the outreach keys we minted at launch', () => {
    expect(SEEDED_PILOT_RE.test('acme-pilot@acme.example.net')).toBe(true);
    expect(SEEDED_PILOT_RE.test('ACME-PILOT@ACME.EXAMPLE.NET')).toBe(true);
  });

  // The hyphen carries the whole rule, so these three are the ones that decide
  // whether it is narrow enough to be safe.
  it('leaves ordinary addresses alone', () => {
    expect(SEEDED_PILOT_RE.test('copilot@alpha.example.net')).toBe(false);
    expect(SEEDED_PILOT_RE.test('contact@pilot-school.example.net')).toBe(false);
    expect(SEEDED_PILOT_RE.test('alpha@example.net')).toBe(false);
  });

  // A company we seeded that later signs up for real does so with a normal
  // address, so this filter must not be what hides them.
  it('does not swallow a real signup from a seeded company', () => {
    expect(SEEDED_PILOT_RE.test('ops@acme.example.net')).toBe(false);
  });
});

describe('INTERNAL_RE', () => {
  it('matches internal and documentation addresses, not a real prospect domain', () => {
    expect(INTERNAL_RE.test('someone@ibanforge.com')).toBe(true);
    expect(INTERNAL_RE.test('someone@example.com')).toBe(true);
    expect(INTERNAL_RE.test('SOMEONE@IBANFORGE.COM')).toBe(true);
    expect(INTERNAL_RE.test('alpha@example.net')).toBe(false);
  });

  it('swallows the probe keys this session mints and revokes', () => {
    // These landed in the "Nouveaux clients" list on 29/07/2026, next to
    // genuine signups. A list of good news polluted by our own test keys is
    // worth about as much as no list.
    expect(INTERNAL_RE.test('edge-probe@ibanforge.internal')).toBe(true);
    expect(INTERNAL_RE.test('nextsteps-probe@ibanforge.internal')).toBe(true);
  });

  it("swallows the founder's own accounts, which are configured, not committed", () => {
    // These are personal addresses and this repository is public, so they live
    // in CRM_INTERNAL_EMAILS rather than in INTERNAL_RE. The regex alone must
    // NOT match them; isInternalAccount, which reads the variable, must.
    const previous = process.env.CRM_INTERNAL_EMAILS;
    process.env.CRM_INTERNAL_EMAILS = 'owner@personal.invalid, tagged+';
    try {
      expect(INTERNAL_RE.test('owner@personal.invalid')).toBe(false);
      expect(isInternalAccount('owner@personal.invalid')).toBe(true);
      expect(isInternalAccount('tagged+audit@mail.invalid')).toBe(true);
      expect(isInternalAccount('a-real-customer@acme.example.net')).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.CRM_INTERNAL_EMAILS;
      else process.env.CRM_INTERNAL_EMAILS = previous;
    }
  });

  it('leaves a genuine customer alone', () => {
    // The shapes real key holders actually arrive in, not the addresses
    // themselves: a customer list does not belong in a public repository, and
    // the filter has no idea who anyone is. It reads the local part and the
    // domain, so exercising the shapes is what tests it. Each of these has a
    // trait that has caused a false positive somewhere: a role-style local part
    // ('admin', 'developer'), a dotted one, a hyphenated domain, a short novel
    // TLD, and a plain free-mail address.
    for (const real of [
      'bankdesk@nordvik.no',
      'mgwenabab@gmail.com',
      'petr.novak@ledgerworks.eu',
      'developer@meridian-systems.com',
      'admin@verity.ai',
      'treasury@northwind-pay.io',
    ]) {
      expect(INTERNAL_RE.test(real), real).toBe(false);
    }
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
    // Asserted against the constant: the value is a personal mailbox read
    // from CRM_WARM_ACCOUNT, and must not be written into this repository.
    expect(warm[0].account).toBe(warmAccount());
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

  it('still lists an all-pilot address we are already in a thread with', () => {
    // The real shape: a customer signed up unprompted, burned its whole quota,
    // and we answered by mail. No prospect row, so the prospect side could not
    // catch it either, and the hottest lead around was invisible in the CRM.
    const out = buildContacts({
      ...base,
      keys: [keyRow('inthread@example.net', { monthly_limit: 5000, used_all_time: 200 })],
      messages: [msgRow('inthread@example.net', { direction: 'out', msg_date: '2026-07-05T09:00' })],
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('inthread@example.net');
    expect(out[0].kind).toBe('client');
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
      createdAt: null,
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

/**
 * The institutional correspondents: the third emission loop.
 *
 * Every fixture here is invented. `alpha.example.net` is the reserved
 * documentation domain this file already uses, and no real authority, bank,
 * scheme or supplier is named anywhere: the register is filled at runtime,
 * through the API, and this repository is public.
 */
const instRow = (email: string, over: Partial<InstitutionalContactRow> = {}): InstitutionalContactRow => ({
  email,
  org: 'Autorité Alpha',
  category: 'autorite',
  country: 'CH',
  role: null,
  website: null,
  dossier: null,
  ...over,
});

/** Narrow to an institution, failing loudly rather than silently skipping. */
function asInstitution(contact: Contact) {
  if (contact.kind !== 'institution') throw new Error(`expected an institution, got ${contact.kind}`);
  return contact;
}

describe('buildContacts, institutional correspondents', () => {
  it('emits one contact per registered address, with the organisation as its name', () => {
    const out = buildContacts({
      ...base,
      institutions: [instRow('registry@alpha.example.net', { role: 'Service des registres' })],
    });
    const inst = asInstitution(out[0]);
    expect(out).toHaveLength(1);
    expect(inst.id).toBe('registry@alpha.example.net');
    expect(inst.company).toBe('Autorité Alpha');
    expect(inst.institution.category).toBe('autorite');
    expect(inst.institution.role).toBe('Service des registres');
    // The company mailbox, never the warm personal one: a written request to an
    // institution is written by IBANforge, and this account is never empty.
    expect(inst.account).toBe('claude-alain@ibanforge.com');
  });

  it('carries the thread that arrived on that address, and its unread state', () => {
    const out = buildContacts({
      ...base,
      institutions: [instRow('registry@alpha.example.net')],
      messages: [
        msgRow('registry@alpha.example.net', { direction: 'out', msg_date: '2026-07-01T10:00', subject: 'Demande' }),
        msgRow('registry@alpha.example.net', { direction: 'in', msg_date: '2026-07-20T10:00', subject: 'Réponse' }),
      ],
    });
    const inst = asInstitution(out[0]);
    expect(inst.messages.map((m) => m.subject)).toEqual(['Demande', 'Réponse']);
    expect(inst.unread).toBe(true);
  });

  it('lowercases the address, which is the join key the mail sync files against', () => {
    const out = buildContacts({ ...base, institutions: [instRow('Registry@Alpha.Example.NET')] });
    expect(out[0].id).toBe('registry@alpha.example.net');
  });

  // The three exclusion rules, one test each. Together they say: a commercial
  // identity always wins the address, and the register can never split one
  // contact in two.
  it('leaves an address that already emitted as a client alone', () => {
    const out = buildContacts({
      ...base,
      keys: [keyRow('ops@alpha.example.net')],
      institutions: [instRow('ops@alpha.example.net', { org: 'Fournisseur Alpha', category: 'fournisseur' })],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('client');
  });

  it('leaves an address that already emitted as a prospect alone', () => {
    const out = buildContacts({
      ...base,
      prospects: [prospectRow('p1', 'lead@alpha.example.net')],
      institutions: [instRow('lead@alpha.example.net')],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('prospect');
  });

  it('emits one contact when the register lists the same address twice', () => {
    const out = buildContacts({
      ...base,
      institutions: [instRow('registry@alpha.example.net'), instRow('registry@alpha.example.net', { org: 'Doublon' })],
    });
    expect(out).toHaveLength(1);
    expect(out[0].company).toBe('Autorité Alpha');
  });

  it('drops a row with no address, which has no thread and nothing to write to', () => {
    const out = buildContacts({ ...base, institutions: [instRow('  ')] });
    expect(out).toHaveLength(0);
  });

  /**
   * The rule this one pins is an omission, so nothing else would catch it
   * breaking. INTERNAL_RE matches "audit" ANYWHERE in an address, which is a
   * sane net over machine-minted keys and a trap over a desk the operator
   * registered by hand: a supervisory address is exactly what this feature
   * exists for, and applying the filter would make it vanish without a word.
   */
  it('does not apply the internal-address filter to a hand-registered correspondent', () => {
    expect(isInternalAccount('audit@alpha.example.net')).toBe(true);
    const out = buildContacts({ ...base, institutions: [instRow('audit@alpha.example.net')] });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('institution');
  });

  it('never attaches a business block, whatever the activation payload says', () => {
    const out = buildContacts({
      ...base,
      institutions: [instRow('registry@alpha.example.net')],
      activation: [
        {
          email: 'registry@alpha.example.net',
          status: 'paying',
          source: 'direct',
          credits_total: 1000,
          credits_remaining: 900,
          packs: 1,
          first_call_at: null,
          calls_90d: 0,
        },
      ],
    });
    expect(out[0].business).toBeUndefined();
  });

  // The deploy story: Vercel and Railway ship independently, so this page runs
  // for a while against an API that answers 404 on the new endpoint.
  it('is the CRM it was when the register is absent', () => {
    const out = buildContacts({ ...base, keys: [keyRow('ops@alpha.example.net')] });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('client');
  });
});

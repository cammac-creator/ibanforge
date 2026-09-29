import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { adminOutreachTest } from './admin-outreach-test.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import {
  asksToStop,
  ownWords,
  quotableLines,
  summarizeOutreachTest,
  type OutreachTestSummary,
} from '../lib/outreach-test.js';

vi.hoisted(() => {
  process.env.RADAR_INTERNAL_EMAILS = '';
  process.env.CRM_INTERNAL_EMAILS = '';
});

afterAll(() => closeAll());
afterEach(() => vi.unstubAllEnvs());

const app = new Hono();
app.route('/', adminOutreachTest);
const headers = { 'X-Admin-Secret': 'secret-admin-fictif' };

// Invented subjects and addresses only: the campaign text stays out of this
// public repository, and example.com is internal to the filters (it would read
// as a silent zero).
const EN = 'a note about your key';
const FR = 'une note sur votre clé';
const ANA = 'ana@alpha.example.net';
const BEN = 'ben@alpha.example.net';
const CARL = 'carl@alpha.example.net';
const DORA = 'dora@alpha.example.net';

function db() {
  return getStatsDB();
}

function mail(
  id: string,
  email: string,
  direction: 'out' | 'in' | 'draft',
  msgDate: string,
  subject: string,
  body: string | null = null,
) {
  db()
    .prepare(
      `INSERT INTO email_messages (id, customer_email, direction, msg_date, subject, snippet, body, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      email,
      direction,
      msgDate,
      subject,
      body?.slice(0, 300) ?? null,
      body,
      direction === 'in' ? null : 'claude',
    );
}

function key(prefix: string, email: string, createdAt: string) {
  db()
    .prepare('INSERT INTO api_keys (key_hash, key_prefix, email, created_at) VALUES (?, ?, ?, ?)')
    .run(`hash_${prefix}`, prefix, email, createdAt);
}

function purchase(
  ref: string,
  prefix: string,
  kind: 'pack' | 'subscription',
  outcome: string,
  bundle: string | null,
  createdAt: string,
  issuedByUs = 0,
  payer: string | null = null,
) {
  db()
    .prepare(
      `INSERT INTO key_purchases (payment_ref, rail, kind, outcome, lineage_hash, key_hash, key_prefix, bundle,
         created_at, issued_by_us, payer_email)
       VALUES (?, 'card', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ref,
      kind,
      outcome,
      `hash_${prefix}`,
      `hash_${prefix}`,
      prefix,
      bundle,
      createdAt,
      issuedByUs,
      payer,
    );
}

function call(prefix: string, createdAt: string, status = 200) {
  db()
    .prepare(
      `INSERT INTO request_log (method, path, status, response_ms, created_at, key_prefix)
       VALUES ('POST', '/v1/iban/validate', ?, 2, ?, ?)`,
    )
    .run(status, createdAt, prefix);
}

async function read(
  query: string,
): Promise<{ status: number; body: OutreachTestSummary & { error?: string } }> {
  const res = await app.request(`/v1/admin/outreach-test?${query}`, { headers });
  expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  return {
    status: res.status,
    body: (await res.json()) as OutreachTestSummary & { error?: string },
  };
}

const WINDOW = `since=2031-03-03&until=2031-05-30&subject=${encodeURIComponent(EN)}&subject=${encodeURIComponent(FR)}`;

beforeEach(() => {
  vi.stubEnv('ADMIN_SECRET', 'secret-admin-fictif');
  for (const t of ['email_messages', 'api_keys', 'key_purchases', 'request_log']) {
    db().exec(`DELETE FROM ${t}`);
  }
});

describe('GET /v1/admin/outreach-test — access', () => {
  it('refuses a caller without the secret, or with a wrong one, and never lets it be cached', async () => {
    const refused: Array<Record<string, string>> = [
      {},
      { 'X-Admin-Secret': 'incorrect' },
      { Authorization: 'Bearer secret-admin-fictif' },
    ];
    for (const h of refused) {
      const res = await app.request(`/v1/admin/outreach-test?${WINDOW}`, { headers: h });
      expect(res.status).toBe(401);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    }
  });

  it('refuses a malformed window or a missing subject', async () => {
    expect((await read(`since=03.03.2031&subject=${EN}`)).body.error).toBe('invalid_since');
    expect((await read(`since=2031-03-03&until=2031-03-01&subject=${EN}`)).body.error).toBe(
      'invalid_until',
    );
    expect((await read('since=2031-03-03')).body.error).toBe('invalid_subject');
    expect((await read(`since=2031-03-03&subject=${'x'.repeat(201)}`)).status).toBe(400);
  });
});

describe('GET /v1/admin/outreach-test — the four figures', () => {
  beforeEach(() => {
    key('ifk_ana1', ANA, '2031-01-10 08:00:00');
    key('ifk_ben1', BEN, '2031-02-01 08:00:00');
    key('ifk_carl', CARL, '2030-12-01 08:00:00');
    key('ifk_buyr', 'buyer@beta.example.net', '2031-03-20 10:00:00');

    // Sent: one per recipient, the second subject folded differently, a twin
    // row of the first (the mailbox sync), and four rows that are not sends.
    mail('o1', ANA, 'out', '2031-03-03T09:17:22', EN);
    mail('o1-twin', ANA, 'out', '2031-03-03T09:17', EN);
    mail('o2', BEN, 'out', '2031-03-04T10:21:40', 'Une  Note sur votre CLÉ');
    mail('o3', CARL, 'out', '2031-03-05T13:02:10', EN);
    mail('x-reply', BEN, 'out', '2031-03-06T08:00:00', `Re: ${FR}`);
    mail('x-before', DORA, 'out', '2031-03-01T09:00:00', EN);
    mail('x-internal', 'acme@example.com', 'out', '2031-03-03T11:11:00', EN);
    mail('x-draft', DORA, 'draft', '2031-03-06T09:47', EN);

    // Replies.
    mail(
      'i-early',
      ANA,
      'in',
      '2031-03-02T08:00:00',
      'Question',
      'Please unsubscribe me from everything.',
    );
    mail('i1', ANA, 'in', '2031-03-03T15:00:00', `Re: ${EN}`, 'Please unsubscribe me.\n\nAna');
    mail(
      'i2',
      BEN,
      'in',
      '2031-03-04T18:00:00',
      `Re: ${FR}`,
      'Interesting. What about volume pricing?\n\nOn Tue, 4 Mar 2031, the founder wrote:\n> To stop receiving messages like this one, reply "unsubscribe".',
    );
    mail(
      'i2-auto',
      BEN,
      'in',
      '2031-03-04T10:30:00',
      'Automatic reply: out of office',
      'I am away.',
    );
    mail('i3-auto', CARL, 'in', '2031-03-05T13:10:00', 'Abwesenheitsnotiz', 'Nicht im Büro.');
    mail('i-stranger', DORA, 'in', '2031-03-07T09:00:00', 'unsubscribe', 'unsubscribe');

    // Subscriptions.
    purchase(
      'stripe:attached',
      'ifk_ana1',
      'subscription',
      'attached',
      'pro',
      '2031-03-08 12:00:00',
    );
    purchase(
      'stripe:new',
      'ifk_buyr',
      'subscription',
      'minted',
      'pro',
      '2031-03-20 10:00:00',
      0,
      'buyer@beta.example.net',
    );
    purchase(
      'stripe:oem',
      'ifk_carl',
      'subscription',
      'minted_fallback',
      'oem',
      '2031-04-02 09:00:00',
    );
    purchase('stripe:earlier', 'ifk_carl', 'subscription', 'minted', 'pro', '2031-02-10 09:00:00');
    purchase(
      'stripe:before-first-send',
      'ifk_ben1',
      'subscription',
      'attached',
      'pro',
      '2031-03-03 06:00:00',
    );
    purchase('stripe:ours', 'ifk_ben1', 'subscription', 'minted', 'pro', '2031-03-09 09:00:00', 1);
    purchase('stripe:pack', 'ifk_ben1', 'pack', 'credited', null, '2031-03-10 09:00:00');

    // Calls: Ana within thirty days, Ben only refused inside and served after,
    // Carl before his message only.
    call('ifk_ana1', '2031-03-05 09:00:00');
    call('ifk_ben1', '2031-03-10 09:00:00', 429);
    call('ifk_ben1', '2031-04-20 09:00:00');
    call('ifk_carl', '2031-03-01 09:00:00');
  });

  it('counts what left by its exact subject, once per message, never an answer or an internal address', async () => {
    const { status, body } = await read(WINDOW);
    expect(status).toBe(200);
    expect(body.sent).toEqual({
      messages: 3,
      recipients: 3,
      first_at: '2031-03-03T09:17:00.000Z',
      last_at: '2031-03-05T13:02:10.000Z',
      by_day: { '2031-03-03': 1, '2031-03-04': 1, '2031-03-05': 1 },
    });
    expect(body.window.subjects).toBe(2);
  });

  it('reads replies after each send, a stop request in the reply’s own words only, automatic replies apart', async () => {
    const { body } = await read(WINDOW);
    expect(body.replies).toEqual({
      recipients: 2,
      messages: 2,
      optout_recipients: 1,
      other_recipients: 1,
      automatic_only_recipients: 1,
    });
  });

  it('counts a subscription on an existing key, not one before the first send, ours, or a pack', async () => {
    const { body } = await read(WINDOW);
    expect(body.subscriptions).toMatchObject({
      total: 3,
      pro: 2,
      other_plans: 1,
      on_existing_key: 1,
      on_new_key: 2,
      among_recipients: 2,
    });
    expect(body.subscriptions.keys.map((k) => k.key_prefix).sort()).toEqual([
      'ifk_ana1',
      'ifk_buyr',
      'ifk_carl',
    ]);
    expect(body.window.subscriptions_from).toBe('2031-03-03T09:17:00.000Z');
  });

  it('counts recipients who called successfully within thirty days of their message', async () => {
    const { body } = await read(WINDOW);
    expect(body.called_within_30d).toEqual({
      recipients_with_key: 3,
      recipients: 1,
      window_complete: true,
    });
  });

  it('says the window is incomplete while thirty days have not elapsed', () => {
    const early = summarizeOutreachTest({
      since: '2031-03-03',
      until: null,
      subjects: [EN, FR],
      now: new Date('2031-03-12T12:00:00Z'),
    });
    expect(early.called_within_30d.window_complete).toBe(false);
    expect(early.subscriptions.total).toBe(1);
  });

  it('names what it cannot measure instead of answering zero, and never returns an address', async () => {
    const { body } = await read(WINDOW);
    expect(Object.keys(body.not_measured).sort()).toEqual(['bounced', 'delivered']);
    expect(body).not.toHaveProperty('bounced');
    expect(JSON.stringify(body)).not.toContain('@');
  });
});

describe('a stop request is read in the reply, not in the quoted original', () => {
  it('cuts the quote at the usual separators', () => {
    expect(ownWords('Sure.\n\nLe 3 mars 2031, quelqu’un a écrit :\n> répondez « retrait »')).toBe(
      'Sure.\n',
    );
    expect(ownWords('Ja.\nAm 3. März 2031 schrieb jemand:\n> abmelden')).toBe('Ja.');
    expect(ownWords('ok\n-----Original Message-----\nunsubscribe')).toBe('ok');
  });

  it('drops the lines of our own message when a reply arrives without quote marks', () => {
    const ours =
      'Hello,\n\nA short offer about your key.\n\nTo stop receiving messages like this one, reply "unsubscribe".';
    const reply =
      'Thanks, I will think about it.\nHello,\nA short offer about your key.\nTo stop receiving messages like this one, reply "unsubscribe".';
    expect(asksToStop('Re: x', reply)).toBe(true);
    expect(asksToStop('Re: x', reply, quotableLines(ours))).toBe(false);
    expect(asksToStop('Re: x', `unsubscribe please\n${reply}`, quotableLines(ours))).toBe(true);
  });

  it('recognises the three offered words and a plain subject', () => {
    expect(asksToStop('Re: x', 'retrait')).toBe(true);
    expect(asksToStop('Re: x', 'Bitte abmelden.')).toBe(true);
    expect(asksToStop('unsubscribe', '')).toBe(true);
    expect(asksToStop('Re: x', 'Thanks, subscribed!')).toBe(false);
  });
});

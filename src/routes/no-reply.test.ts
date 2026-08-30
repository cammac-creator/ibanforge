import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { apiKeys } from './api-keys.js';
import { getStatsDB } from '../lib/db.js';

/**
 * « Rien à répondre » — the marker that lets a thank-you, a read receipt or a
 * ticket robot leave the day's queues without being filed as a commercial
 * refusal.
 *
 * What these tests actually guard, beyond "the route works":
 *  - the direction gate (only an inbound can be marked),
 *  - that a re-sync does NOT wipe a hand-placed mark — the failure that would
 *    be invisible until the operator noticed his marks evaporating nightly,
 *  - and that the sender rule matches WHOLE addresses, so it can never grow
 *    into the fragment matching that once mislabelled entire customer domains.
 */
function makeApp(): Hono {
  const app = new Hono();
  app.route('/', apiKeys);
  return app;
}

const SECRET = 'correct-horse-battery-staple';
const RUN = Date.now();
const admin = { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET };

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.ADMIN_SECRET = SECRET;
});
afterEach(() => {
  process.env = { ...originalEnv };
  // The suite shares one stats database, serially. The sender table is global
  // state: a row left behind here would stamp another file's ingested messages.
  const db = getStatsDB();
  db.prepare("DELETE FROM no_reply_senders WHERE address LIKE '%alpha.example.net'").run();
  db.prepare('DELETE FROM email_messages WHERE id LIKE ?').run(`nr-${RUN}-%`);
});

interface IngestRow {
  id: string;
  customer_email: string;
  direction: string;
  msg_date?: string;
  subject?: string;
}

async function ingest(rows: IngestRow[]): Promise<number> {
  const res = await makeApp().request('/v1/admin/email-messages', {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({ messages: rows }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { upserted: number }).upserted;
}

async function noReply(id: string, value: boolean): Promise<{ status: number; updated?: number }> {
  const res = await makeApp().request('/v1/admin/email-messages/no-reply', {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({ id, value }),
  });
  const json = (await res.json()) as { updated?: number };
  return { status: res.status, updated: json.updated };
}

async function sender(address: string, value: boolean): Promise<number> {
  const res = await makeApp().request('/v1/admin/no-reply-senders', {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({ address, value }),
  });
  return res.status;
}

function stored(id: string): number | undefined {
  const row = getStatsDB().prepare('SELECT no_reply_needed FROM email_messages WHERE id = ?').get(id) as
    | { no_reply_needed: number }
    | undefined;
  return row?.no_reply_needed;
}

describe('POST /v1/admin/email-messages/no-reply — admin auth', () => {
  it('rejects without the secret', async () => {
    const res = await makeApp().request('/v1/admin/email-messages/no-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'whatever', value: true }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong secret of the same length', async () => {
    const res = await makeApp().request('/v1/admin/email-messages/no-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': 'wrong-horse-battery-staple-BAD' },
      body: JSON.stringify({ id: 'whatever', value: true }),
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /v1/admin/email-messages/no-reply — the direction gate', () => {
  it('marks an inbound, and only an inbound', async () => {
    const inbound = `nr-${RUN}-in`;
    const outbound = `nr-${RUN}-out`;
    const draft = `nr-${RUN}-draft`;
    await ingest([
      { id: inbound, customer_email: 'acme@example.com', direction: 'in', msg_date: '2026-08-01T10:00:00Z' },
      { id: outbound, customer_email: 'acme@example.com', direction: 'out', msg_date: '2026-08-01T11:00:00Z' },
      { id: draft, customer_email: 'acme@example.com', direction: 'draft', msg_date: '2026-08-01T12:00:00Z' },
    ]);

    expect(await noReply(inbound, true)).toEqual({ status: 200, updated: 1 });
    // Our own mail never put the ball in our court, so there is nothing to
    // absolve; the WHERE refuses it exactly as /delete refuses a non-draft.
    expect(await noReply(outbound, true)).toEqual({ status: 200, updated: 0 });
    expect(await noReply(draft, true)).toEqual({ status: 200, updated: 0 });

    expect(stored(inbound)).toBe(1);
    expect(stored(outbound)).toBe(0);
    expect(stored(draft)).toBe(0);
  });

  it('answers 200 with updated:0 for an id nobody knows', async () => {
    expect(await noReply(`nr-${RUN}-ghost`, true)).toEqual({ status: 200, updated: 0 });
  });

  it('is reversible, and replaying either way lands on the same state', async () => {
    const id = `nr-${RUN}-toggle`;
    await ingest([{ id, customer_email: 'acme@example.com', direction: 'in', msg_date: '2026-08-02T09:00:00Z' }]);

    await noReply(id, true);
    await noReply(id, true);
    // Asserted on the stored state rather than on `updated`: SQLite counts a
    // row it rewrote with an identical value, so a replay legitimately reports
    // updated:1 again. updated:0 means "no such markable message", nothing else.
    expect(stored(id)).toBe(1);

    await noReply(id, false);
    await noReply(id, false);
    expect(stored(id)).toBe(0);
  });

  it('refuses a non-boolean value instead of quietly unmarking', async () => {
    const id = `nr-${RUN}-strict`;
    await ingest([{ id, customer_email: 'acme@example.com', direction: 'in', msg_date: '2026-08-02T10:00:00Z' }]);
    await noReply(id, true);

    const res = await makeApp().request('/v1/admin/email-messages/no-reply', {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ id, value: 'false' }),
    });
    expect(res.status).toBe(400);
    expect(stored(id)).toBe(1);
  });
});

describe('GET /v1/admin/email-messages — the marker travels to the CRM', () => {
  it('serves no_reply_needed with the message', async () => {
    const id = `nr-${RUN}-served`;
    await ingest([{ id, customer_email: 'acme@example.com', direction: 'in', msg_date: '2026-08-03T08:00:00Z' }]);
    await noReply(id, true);

    const res = await makeApp().request('/v1/admin/email-messages', { headers: admin });
    expect(res.status).toBe(200);
    const { messages } = (await res.json()) as { messages: Array<{ id: string; no_reply_needed: number }> };
    expect(messages.find((m) => m.id === id)?.no_reply_needed).toBe(1);
  });
});

describe('no-reply senders — the standing rule', () => {
  it('needs the admin secret, both to read and to write', async () => {
    expect((await makeApp().request('/v1/admin/no-reply-senders')).status).toBe(401);
    const res = await makeApp().request('/v1/admin/no-reply-senders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: `bot@alpha.example.net`, value: true }),
    });
    expect(res.status).toBe(401);
  });

  it('refuses anything that is not a whole address', async () => {
    // A fragment here would swallow every address containing it — the mistake
    // INTERNAL_EMAIL_RE already paid for, with silence as its symptom.
    expect(await sender('alpha.example.net', true)).toBe(400);
    expect(await sender('', true)).toBe(400);
  });

  it('stores lowercased and lists back', async () => {
    expect(await sender(`  Ticket-BOT@Alpha.Example.NET `, true)).toBe(200);
    const res = await makeApp().request('/v1/admin/no-reply-senders', { headers: admin });
    const { senders } = (await res.json()) as { senders: Array<{ address: string }> };
    expect(senders.some((s) => s.address === 'ticket-bot@alpha.example.net')).toBe(true);
  });

  it('stamps the future inbound of a listed sender, whatever the case', async () => {
    await sender(`ticket-bot@alpha.example.net`, true);
    const marked = `nr-${RUN}-rule-in`;
    const other = `nr-${RUN}-rule-other`;
    await ingest([
      // Same mailbox, shouted: the comparison is on the whole address, folded.
      { id: marked, customer_email: 'Ticket-Bot@Alpha.Example.net', direction: 'in', msg_date: '2026-08-04T08:00:00Z' },
      // A neighbour in the same domain must stay untouched — the exact case a
      // fragment rule would get wrong.
      { id: other, customer_email: 'ops@alpha.example.net', direction: 'in', msg_date: '2026-08-04T09:00:00Z' },
    ]);
    expect(stored(marked)).toBe(1);
    expect(stored(other)).toBe(0);
  });

  it('never stamps our own outbound or a draft', async () => {
    await sender(`ticket-bot@alpha.example.net`, true);
    const out = `nr-${RUN}-rule-out`;
    const draft = `nr-${RUN}-rule-draft`;
    await ingest([
      { id: out, customer_email: 'ticket-bot@alpha.example.net', direction: 'out', msg_date: '2026-08-04T10:00:00Z' },
      { id: draft, customer_email: 'ticket-bot@alpha.example.net', direction: 'draft', msg_date: '2026-08-04T11:00:00Z' },
    ]);
    expect(stored(out)).toBe(0);
    expect(stored(draft)).toBe(0);
  });

  it('stops stamping once the address is removed, and leaves past marks alone', async () => {
    await sender(`ticket-bot@alpha.example.net`, true);
    const before = `nr-${RUN}-rule-before`;
    await ingest([
      { id: before, customer_email: 'ticket-bot@alpha.example.net', direction: 'in', msg_date: '2026-08-05T08:00:00Z' },
    ]);
    expect(stored(before)).toBe(1);

    expect(await sender(`ticket-bot@alpha.example.net`, false)).toBe(200);
    const after = `nr-${RUN}-rule-after`;
    await ingest([
      { id: after, customer_email: 'ticket-bot@alpha.example.net', direction: 'in', msg_date: '2026-08-05T09:00:00Z' },
    ]);
    expect(stored(after)).toBe(0);
    // The old judgement was true about the message it was made on; withdrawing
    // the standing rule is not a reason to rewrite it.
    expect(stored(before)).toBe(1);
  });
});

describe('re-ingestion — the mark survives the nightly sync', () => {
  it('keeps a hand-placed mark when the same message is synced again', async () => {
    const id = `nr-${RUN}-resync`;
    const row: IngestRow = {
      id,
      customer_email: 'acme@example.com',
      direction: 'in',
      msg_date: '2026-08-06T08:00:00Z',
      subject: 'Merci !',
    };
    await ingest([row]);
    await noReply(id, true);

    // Ids are stable md5s and the whole mailbox is re-ingested nightly. If the
    // upsert assigned this column, every mark would evaporate by morning.
    await ingest([{ ...row, subject: 'Merci ! (re)' }]);
    expect(stored(id)).toBe(1);
  });

  it('does not let an ingester set the mark by asking', async () => {
    const id = `nr-${RUN}-forged`;
    await makeApp().request('/v1/admin/email-messages', {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({
        messages: [
          {
            id,
            customer_email: 'acme@example.com',
            direction: 'in',
            msg_date: '2026-08-07T08:00:00Z',
            no_reply_needed: 1,
          },
        ],
      }),
    });
    expect(stored(id)).toBe(0);
  });
});

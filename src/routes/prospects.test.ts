import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { apiKeys } from './api-keys.js';
import { Hono } from 'hono';

function makeApp() {
  const app = new Hono();
  app.route('/', apiKeys);
  return app;
}

const SECRET = 'correct-horse-battery-staple';
const RUN_ID = Date.now();
const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.ADMIN_SECRET = SECRET;
});
afterEach(() => {
  process.env = { ...originalEnv };
});

describe('/v1/admin/prospects — admin auth', () => {
  it('GET rejects without secret', async () => {
    const res = await makeApp().request('/v1/admin/prospects');
    expect(res.status).toBe(401);
  });

  it('POST rejects without secret', async () => {
    const res = await makeApp().request('/v1/admin/prospects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prospects: [] }),
    });
    expect(res.status).toBe(401);
  });

  it('GET returns an array with correct secret', async () => {
    const res = await makeApp().request('/v1/admin/prospects', {
      headers: { 'X-Admin-Secret': SECRET },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { prospects: unknown[] };
    expect(Array.isArray(json.prospects)).toBe(true);
  });
});

describe('/v1/admin/prospects — upsert + read back', () => {
  it('rejects a non-array body', async () => {
    const res = await makeApp().request('/v1/admin/prospects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({ prospects: 'nope' }),
    });
    expect(res.status).toBe(400);
  });

  it('upserts idempotently by id and is then listed', async () => {
    const app = makeApp();
    const id = 'p_test_fixed_0001';
    const payload = {
      prospects: [
        {
          id,
          company: 'Vitest Test Co',
          segment: 'editeurs',
          website: 'https://example.com',
          contact_email: 'sales@example.com',
          status: 'a_mailer',
          mail_subject_en: 'Hello',
          mail_body_en: 'Body',
          source: 'vitest',
        },
      ],
    };
    const up1 = await app.request('/v1/admin/prospects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify(payload),
    });
    expect(up1.status).toBe(200);
    expect(((await up1.json()) as { upserted: number }).upserted).toBe(1);

    // Second upsert with same id must not create a duplicate.
    const up2 = await app.request('/v1/admin/prospects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify(payload),
    });
    expect(up2.status).toBe(200);

    const list = await app.request('/v1/admin/prospects', { headers: { 'X-Admin-Secret': SECRET } });
    const json = (await list.json()) as { prospects: Array<{ id: string }> };
    const matches = json.prospects.filter((p) => p.id === id);
    expect(matches.length).toBe(1);
  });

  it('updates a prospect status', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/prospects/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({ id: 'p_test_fixed_0001', status: 'archive' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(1);
  });

  it('rejects an invalid status', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/prospects/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({ id: 'p_test_fixed_0001', status: 'bogus' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('email-messages upsert → prospect status auto-flip', () => {
  const pid = 'p_test_contact_flip';
  const email = `flip-${RUN_ID}@prospect-test.example`;

  async function seedProspect(app: Hono, status: string) {
    const res = await app.request('/v1/admin/prospects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({
        prospects: [{ id: pid, company: 'FlipTest AG', contact_email: email, status }],
      }),
    });
    expect(res.status).toBe(200);
  }

  async function readStatus(app: Hono): Promise<string> {
    const list = await app.request('/v1/admin/prospects', { headers: { 'X-Admin-Secret': SECRET } });
    const json = (await list.json()) as { prospects: Array<{ id: string; status: string }> };
    return json.prospects.find((p) => p.id === pid)!.status;
  }

  it('an outgoing message to the prospect email flips a_mailer → contacte', async () => {
    const app = makeApp();
    await seedProspect(app, 'a_mailer');
    const res = await app.request('/v1/admin/email-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({
        messages: [{ id: `m-out-${RUN_ID}`, customer_email: email.toUpperCase(), direction: 'out', subject: 'Hello', msg_date: '2026-07-02T08:00' }],
      }),
    });
    expect(res.status).toBe(200);
    expect(await readStatus(app)).toBe('contacte');
  });

  it('an incoming message alone does NOT flip the preparation status', async () => {
    const app = makeApp();
    await seedProspect(app, 'a_mailer');
    await app.request('/v1/admin/email-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({
        messages: [{ id: `m-in-${RUN_ID}`, customer_email: email, direction: 'in', subject: 'Re: Hello', msg_date: '2026-07-02T09:00' }],
      }),
    });
    expect(await readStatus(app)).toBe('a_mailer');
  });

  it('does not touch terminal statuses (rejete stays rejete)', async () => {
    const app = makeApp();
    await seedProspect(app, 'rejete');
    await app.request('/v1/admin/email-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({
        messages: [{ id: `m-out2-${RUN_ID}`, customer_email: email, direction: 'out', subject: 'Hello again', msg_date: '2026-07-02T10:00' }],
      }),
    });
    expect(await readStatus(app)).toBe('rejete');
  });

  it('a CRM draft does NOT flip the preparation status (a draft is not correspondence)', async () => {
    const app = makeApp();
    await seedProspect(app, 'a_mailer');
    const res = await app.request('/v1/admin/email-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({
        messages: [{ id: `m-draft-${RUN_ID}`, customer_email: email, direction: 'draft', subject: 'Brouillon', msg_date: '2026-07-02T11:00', body: 'draft body' }],
      }),
    });
    expect(res.status).toBe(200);
    expect(await readStatus(app)).toBe('a_mailer');
  });
});

describe('email-messages delete — drafts only', () => {
  it('deletes a draft, refuses to delete sent history', async () => {
    const app = makeApp();
    const mail = `draft-del-${RUN_ID}@example.com`;
    await app.request('/v1/admin/email-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({
        messages: [
          { id: `del-draft-${RUN_ID}`, customer_email: mail, direction: 'draft', subject: 'Brouillon', msg_date: '2026-07-02T12:00' },
          { id: `del-out-${RUN_ID}`, customer_email: mail, direction: 'out', subject: 'Envoyé', msg_date: '2026-07-02T12:01' },
        ],
      }),
    });

    const delDraft = await app.request('/v1/admin/email-messages/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({ id: `del-draft-${RUN_ID}` }),
    });
    expect(delDraft.status).toBe(200);
    expect(((await delDraft.json()) as { deleted: number }).deleted).toBe(1);

    const delOut = await app.request('/v1/admin/email-messages/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': SECRET },
      body: JSON.stringify({ id: `del-out-${RUN_ID}` }),
    });
    expect(((await delOut.json()) as { deleted: number }).deleted).toBe(0);
  });

  it('rejects without the admin secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/email-messages/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'whatever' }),
    });
    expect(res.status).toBe(401);
  });
});

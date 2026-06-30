import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { apiKeys } from './api-keys.js';
import { Hono } from 'hono';

function makeApp() {
  const app = new Hono();
  app.route('/', apiKeys);
  return app;
}

const SECRET = 'correct-horse-battery-staple';
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

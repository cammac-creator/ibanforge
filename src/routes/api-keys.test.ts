import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { apiKeys } from './api-keys.js';
import { getStatsDB } from '../lib/db.js';
import { Hono } from 'hono';

function makeApp() {
  const app = new Hono();
  app.route('/', apiKeys);
  return app;
}

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.ADMIN_SECRET = 'correct-horse-battery-staple';
  // Allow @example.com / disposable domains in test suite so we don't have to
  // invent unique real-looking emails for every test case.
  process.env.IBANFORGE_ADMIN_TEST_KEYS = 'true';
});
afterEach(() => {
  process.env = { ...originalEnv };
});

describe('/v1/admin/keys — admin auth (timing-safe)', () => {
  it('rejects requests without X-Admin-Secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects requests with wrong secret of same length', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'wrong-horse-battery-staple-BAD', // padded to 30 chars
      },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects requests with wrong secret of different length', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'short',
      },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects when ADMIN_SECRET env is not set (defence in depth)', async () => {
    delete process.env.ADMIN_SECRET;
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'anything',
      },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('accepts correct secret and issues a key', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'correct-horse-battery-staple',
      },
      body: JSON.stringify({ email: `admin-test-${Date.now()}@example.com` }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { api_key: string };
    expect(json.api_key).toMatch(/^ifk_/);
  });
});

describe('/v1/admin/keys GET — listing', () => {
  it('unauthorized without secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys');
    expect(res.status).toBe(401);
  });

  it('authorized with correct secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      headers: { 'X-Admin-Secret': 'correct-horse-battery-staple' },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { keys: unknown[] };
    expect(Array.isArray(json.keys)).toBe(true);
  });
});

describe('/v1/keys/generate — acquisition source (best-effort)', () => {
  it('stores a well-formed source and ignores a malformed one', async () => {
    process.env.IBANFORGE_ADMIN_TEST_KEYS = 'true';
    const app = makeApp();
    const { getStatsDB } = await import('../lib/db.js');

    const okEmail = `src-ok-${Date.now()}@example.com`;
    const ok = await app.request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: okEmail, source: 'NPM-Readme' }),
    });
    expect(ok.status).toBe(201);
    const row = getStatsDB()
      .prepare('SELECT source FROM api_keys WHERE email = ?')
      .get(okEmail) as { source: string | null };
    expect(row.source).toBe('npm-readme');

    // Malformed source (spaces, too long, injection-ish) must not block the
    // key and must land as NULL — attribution is best-effort by contract.
    const badEmail = `src-bad-${Date.now()}@example.com`;
    const bad = await app.request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: badEmail, source: 'not a valid source!! ' + 'x'.repeat(60) }),
    });
    expect(bad.status).toBe(201);
    const rowBad = getStatsDB()
      .prepare('SELECT source FROM api_keys WHERE email = ?')
      .get(badEmail) as { source: string | null };
    expect(rowBad.source).toBeNull();
  });
});

describe('/v1/admin/activation — per-email activation view', () => {
  it('rejects without the admin secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/activation');
    expect(res.status).toBe(401);
  });

  it('returns the four blocks with a clamped period', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/activation?days=45', {
      headers: { 'X-Admin-Secret': 'correct-horse-battery-staple' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      clients: unknown[];
      funnel: { period_days: number };
      sources: unknown[];
      cohorts: unknown[];
    };
    expect(Array.isArray(body.clients)).toBe(true);
    expect(Array.isArray(body.sources)).toBe(true);
    expect(body.cohorts).toHaveLength(8);
    // Only 30 and 90 are served; anything else falls back to 30.
    expect(body.funnel.period_days).toBe(30);
  });
});

describe('POST /v1/admin/events — manual annotations', () => {
  it('rejects without the admin secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'nope' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects an empty label, records a real one', async () => {
    const app = makeApp();
    const headers = { 'Content-Type': 'application/json', 'X-Admin-Secret': 'correct-horse-battery-staple' };
    const bad = await app.request('/v1/admin/events', { method: 'POST', headers, body: JSON.stringify({ label: '  ' }) });
    expect(bad.status).toBe(400);
    const ok = await app.request('/v1/admin/events', {
      method: 'POST',
      headers,
      body: JSON.stringify({ label: 'admin-events-route-fixture' }),
    });
    expect(ok.status).toBe(201);
    const { getEvents } = await import('../lib/events.js');
    expect(getEvents(1).some((e) => e.label === 'admin-events-route-fixture' && e.kind === 'manual')).toBe(true);
    const { getStatsDB } = await import('../lib/db.js');
    getStatsDB().prepare(`DELETE FROM events WHERE label = 'admin-events-route-fixture'`).run();
  });
});

describe('/v1/admin/weekly-facts + /v1/admin/digest — Monday digest plumbing', () => {
  const headers = { 'Content-Type': 'application/json', 'X-Admin-Secret': 'correct-horse-battery-staple' };

  it('facts endpoint requires the secret and serves the WoW block', async () => {
    const app = makeApp();
    expect((await app.request('/v1/admin/weekly-facts')).status).toBe(401);
    const res = await app.request('/v1/admin/weekly-facts', { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { week: string; requests: { current: number; previous: number } };
    expect(body.week).toMatch(/^\d{4}-W\d{2}$/);
    expect(typeof body.requests.current).toBe('number');
  });

  it('digest POST upserts by week (re-running the cron never duplicates)', async () => {
    const app = makeApp();
    const week = '1999-W01'; // far outside any real listing window
    const post = (body_fr: string) =>
      app.request('/v1/admin/digest', { method: 'POST', headers, body: JSON.stringify({ week, body_fr }) });
    expect((await post('premier jet')).status).toBe(201);
    expect((await post('version corrigée')).status).toBe(201);
    const { getStatsDB } = await import('../lib/db.js');
    const rows = getStatsDB().prepare('SELECT body_fr FROM weekly_digest WHERE week = ?').all(week) as Array<{ body_fr: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].body_fr).toBe('version corrigée');
    getStatsDB().prepare('DELETE FROM weekly_digest WHERE week = ?').run(week);
  });

  it('digest POST rejects a malformed week or empty body', async () => {
    const app = makeApp();
    const bad = await app.request('/v1/admin/digest', {
      method: 'POST',
      headers,
      body: JSON.stringify({ week: 'lundi', body_fr: 'x' }),
    });
    expect(bad.status).toBe(400);
    const empty = await app.request('/v1/admin/digest', {
      method: 'POST',
      headers,
      body: JSON.stringify({ week: '2026-W01', body_fr: '  ' }),
    });
    expect(empty.status).toBe(400);
  });

  it('digest GET lists rows newest week first', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/digest?limit=3', { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { digests: Array<{ week: string }> };
    expect(Array.isArray(body.digests)).toBe(true);
  });
});

describe('/v1/admin/thread-summary — cached French thread summaries', () => {
  const headers = { 'Content-Type': 'application/json', 'X-Admin-Secret': 'correct-horse-battery-staple' };

  it('misses on unknown email, upserts, hits on matching key, misses on a changed key', async () => {
    const app = makeApp();
    const email = 'summary-probe@alpha.example.net';
    const miss = await app.request(`/v1/admin/thread-summary?email=${encodeURIComponent(email)}&key=k1`, { headers });
    expect(miss.status).toBe(200);
    expect(((await miss.json()) as { summary: unknown }).summary).toBeNull();

    const post = await app.request('/v1/admin/thread-summary', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, thread_key: 'k1', summary_fr: 'Il attend le pricing entreprise.' }),
    });
    expect(post.status).toBe(201);

    const hit = await app.request(`/v1/admin/thread-summary?email=${encodeURIComponent(email)}&key=k1`, { headers });
    const hitBody = (await hit.json()) as { summary: { summary_fr: string } | null };
    expect(hitBody.summary?.summary_fr).toContain('pricing');

    // A new message moves the key: the stale summary must not be served.
    const stale = await app.request(`/v1/admin/thread-summary?email=${encodeURIComponent(email)}&key=k2`, { headers });
    expect(((await stale.json()) as { summary: unknown }).summary).toBeNull();

    const { getStatsDB } = await import('../lib/db.js');
    getStatsDB().prepare('DELETE FROM thread_summaries WHERE email = ?').run(email);
  });

  it('rejects an empty summary or missing key', async () => {
    const app = makeApp();
    const bad = await app.request('/v1/admin/thread-summary', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'x@alpha.example.net', thread_key: '', summary_fr: '  ' }),
    });
    expect(bad.status).toBe(400);
  });
});

describe('/v1/admin/contact-notes — the operator working memory', () => {
  const headers = { 'Content-Type': 'application/json', 'X-Admin-Secret': 'correct-horse-battery-staple' };
  const EMAIL = 'notes-probe@alpha.example.net';

  it('adds, lists (newest first) and deletes a note', async () => {
    const app = makeApp();
    const a = await app.request('/v1/admin/contact-notes', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: EMAIL, note: 'migre depuis iban.com, décision en septembre' }),
    });
    expect(a.status).toBe(201);
    const b = await app.request('/v1/admin/contact-notes', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: EMAIL, note: 'veut le VoP' }),
    });
    expect(b.status).toBe(201);

    const list = await app.request(`/v1/admin/contact-notes?email=${encodeURIComponent(EMAIL)}`, { headers });
    const notes = ((await list.json()) as { notes: Array<{ id: number; note: string }> }).notes;
    expect(notes.length).toBe(2);
    expect(notes[0].note).toContain('VoP');

    const del = await app.request(`/v1/admin/contact-notes?id=${notes[0].id}`, { method: 'DELETE', headers });
    expect(del.status).toBe(200);
    const after = await app.request(`/v1/admin/contact-notes?email=${encodeURIComponent(EMAIL)}`, { headers });
    expect(((await after.json()) as { notes: unknown[] }).notes.length).toBe(1);

    const { getStatsDB } = await import('../lib/db.js');
    getStatsDB().prepare('DELETE FROM contact_notes WHERE email = ?').run(EMAIL);
  });

  it('rejects an empty note', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/contact-notes', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: EMAIL, note: '   ' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('/v1/admin/keys — a prepaid customer is not a dormant one', () => {
  const admin = { 'X-Admin-Secret': 'correct-horse-battery-staple' };
  const P = 'ifk_testcred';

  function seed(creditsTotal: number, creditsRemaining: number, calls: number): void {
    const db = getStatsDB();
    db.prepare('DELETE FROM api_keys WHERE key_prefix = ?').run(P);
    db.prepare('DELETE FROM request_log WHERE key_prefix = ?').run(P);
    db.prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, monthly_limit, credits_remaining, credits_total)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    ).run(`hash-${P}`, P, 'acme@example.com', creditsRemaining, creditsTotal);
    const insert = db.prepare(
      "INSERT INTO request_log (method, path, status, key_prefix, created_at) VALUES ('POST', '/v1/iban/batch', 200, ?, datetime('now'))",
    );
    for (let i = 0; i < calls; i++) insert.run(P);
  }

  function clean(): void {
    const db = getStatsDB();
    db.prepare('DELETE FROM api_keys WHERE key_prefix = ?').run(P);
    db.prepare('DELETE FROM request_log WHERE key_prefix = ?').run(P);
  }

  async function readKey(): Promise<Record<string, unknown>> {
    const res = await makeApp().request('/v1/admin/keys', { headers: admin });
    const body = (await res.json()) as { keys: Array<Record<string, unknown>> };
    return body.keys.find((k) => k.key_prefix === P)!;
  }

  it('counts credits spent as usage, not as silence', async () => {
    // The defect this pins: a credit key writes no api_usage row, because the
    // middleware takes the decrementCredits branch instead. Reading only that
    // ledger showed a customer who had just spent 3,373 units as one who had
    // never called, on the very screen used to decide who to contact.
    seed(5000, 1627, 12);
    const key = await readKey();
    expect(key.used_all_time).toBe(3373);
    expect(key.credits_used).toBe(3373);
    clean();
  });

  it('draws the sparkline from the call log when the quota ledger is silent', async () => {
    seed(5000, 1627, 12);
    const key = await readKey();
    expect(key.series_unit).toBe('calls');
    expect((key.series as number[]).at(-1)).toBe(12);
    // A month must be named, otherwise the CRM reads the customer as never seen.
    expect(key.last_active_month).toBe(new Date().toISOString().slice(0, 7));
    clean();
  });

  it('never reports negative usage when a refund overshoots', async () => {
    // refundCredit clamps at credits_total, but a row edited by hand or an old
    // migration could still hold remaining > total. Reporting -50 units used
    // would be worse than reporting zero.
    seed(1000, 1050, 0);
    const key = await readKey();
    expect(key.credits_used).toBe(0);
    expect(key.used_all_time).toBe(0);
    clean();
  });
});

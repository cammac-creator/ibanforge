import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { apiKeys } from './api-keys.js';
import { recordOrphan, getOrphans, setOrphanGist } from '../lib/orphan-mail.js';

/**
 * The French gist of an orphan mail (03/09/2026): stored once through the
 * admin route, read back with the queue, never overwritten.
 */
const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.ADMIN_SECRET = 'correct-horse-battery-staple';
});
afterEach(() => {
  process.env = { ...originalEnv };
});

function makeApp() {
  const app = new Hono();
  app.route('/', apiKeys);
  return app;
}

describe('POST /v1/admin/orphan-mail/gist', () => {
  it('stores the gist on the row and the queue carries it back', async () => {
    const id = `orphan-gist-${Date.now()}`;
    recordOrphan({
      id,
      sender: 'someone@alpha.example.net',
      subject: 'Your service is listed',
      snippet: 'Hi, your submission has been approved and is now live in the directory.',
      msg_date: '2026-09-01 10:00',
      kind: 'first_contact',
    });
    const app = makeApp();
    const res = await app.request('/v1/admin/orphan-mail/gist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'correct-horse-battery-staple',
      },
      body: JSON.stringify({
        id,
        gist_fr: 'Un annuaire annonce que le service est listé — rien à faire.',
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id, written: true });

    const row = getOrphans(true, 100000).find((o) => o.id === id);
    expect(row?.gist_fr).toBe('Un annuaire annonce que le service est listé, rien à faire.');

    // A second write is a no-op that still answers 200: the first reading wins.
    const again = await app.request('/v1/admin/orphan-mail/gist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'correct-horse-battery-staple',
      },
      body: JSON.stringify({ id, gist_fr: 'Autre lecture.' }),
    });
    expect(await again.json()).toEqual({ id, written: false });
    expect(getOrphans(true, 100000).find((o) => o.id === id)?.gist_fr).toContain('rien à faire');
  });

  it('refuses without the secret, an unknown id, and an empty gist', async () => {
    const app = makeApp();
    const noAuth = await app.request('/v1/admin/orphan-mail/gist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'x', gist_fr: 'y' }),
    });
    expect(noAuth.status).toBe(401);
    const unknown = await app.request('/v1/admin/orphan-mail/gist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'correct-horse-battery-staple',
      },
      body: JSON.stringify({ id: 'never-recorded', gist_fr: 'y' }),
    });
    expect(unknown.status).toBe(404);
    const empty = await app.request('/v1/admin/orphan-mail/gist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'correct-horse-battery-staple',
      },
      body: JSON.stringify({ id: 'x', gist_fr: '   ' }),
    });
    expect(empty.status).toBe(400);
    expect(setOrphanGist('never-recorded', 'y')).toBe(false);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { apiKeys } from './api-keys.js';
import {
  recordOrphan,
  getOrphans,
  setOrphanGist,
  setOrphanTranslation,
} from '../lib/orphan-mail.js';

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

describe('the full text and its translation', () => {
  it('ingests the body, keeps it across a run without one, and stores the translation once', async () => {
    const id = `orphan-body-${Date.now()}`;
    const app = makeApp();
    const headers = {
      'Content-Type': 'application/json',
      'X-Admin-Secret': 'correct-horse-battery-staple',
    };
    const ingest = await app.request('/v1/admin/orphan-mail', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: [
          {
            id,
            sender: 'writer@alpha.example.net',
            subject: 'Hello',
            snippet: 'Hi there, a longer message follows.',
            msg_date: '2026-09-02 09:00',
            kind: 'first_contact',
            body: 'Hi there, a longer message follows.\n\nSecond paragraph with the actual ask.',
          },
        ],
      }),
    });
    expect(ingest.status).toBe(201);
    let row = getOrphans(true, 100000).find((o) => o.id === id);
    expect(row?.body).toContain('Second paragraph');
    expect(row?.body_fr).toBeNull();

    // The next sync run sends the same row without a body: the held one stays.
    recordOrphan({
      id,
      sender: 'writer@alpha.example.net',
      msg_date: '2026-09-02 09:00',
      kind: 'first_contact',
    });
    row = getOrphans(true, 100000).find((o) => o.id === id);
    expect(row?.body).toContain('Second paragraph');

    const tr = await app.request('/v1/admin/orphan-mail/translation', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id,
        body_fr:
          'Bonjour, un message plus long suit.\n\nDeuxième paragraphe avec la vraie demande.',
      }),
    });
    expect(await tr.json()).toEqual({ id, written: true });
    expect(getOrphans(true, 100000).find((o) => o.id === id)?.body_fr).toContain(
      'Deuxième paragraphe',
    );
    expect(setOrphanTranslation(id, 'autre')).toBe(false);
    const unknown = await app.request('/v1/admin/orphan-mail/translation', {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: 'never', body_fr: 'x' }),
    });
    expect(unknown.status).toBe(404);
  });
});

describe('a translation made by the sync itself', () => {
  it('lands on a new row, never overwrites a held one, and the list can be asked in full', async () => {
    const stamp = Date.now();
    const headers = {
      'Content-Type': 'application/json',
      'X-Admin-Secret': 'correct-horse-battery-staple',
    };
    const app = makeApp();
    const held = `orphan-held-${stamp}`;
    recordOrphan({
      id: held,
      sender: 'a@alpha.example.net',
      msg_date: '2026-09-02 09:00',
      kind: 'first_contact',
      body: 'Hello',
    });
    expect(setOrphanTranslation(held, 'Première traduction.')).toBe(true);
    recordOrphan({
      id: held,
      sender: 'a@alpha.example.net',
      msg_date: '2026-09-02 09:00',
      kind: 'first_contact',
      body_fr: 'Une autre.',
    });
    expect(getOrphans(true, 100000).find((o) => o.id === held)?.body_fr).toBe(
      'Première traduction.',
    );

    const fresh = `orphan-fresh-${stamp}`;
    const ingest = await app.request('/v1/admin/orphan-mail', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: [
          {
            id: fresh,
            sender: 'b@alpha.example.net',
            msg_date: '2026-09-02 09:01',
            kind: 'first_contact',
            body: 'Hello',
            body_fr: 'Bonjour',
          },
        ],
      }),
    });
    expect(ingest.status).toBe(201);
    const list = await app.request('/v1/admin/orphan-mail?all=1&limit=5000', { headers });
    const rows = ((await list.json()) as { orphans: Array<{ id: string; body_fr: string | null }> })
      .orphans;
    expect(rows.find((o) => o.id === fresh)?.body_fr).toBe('Bonjour');
  });
});

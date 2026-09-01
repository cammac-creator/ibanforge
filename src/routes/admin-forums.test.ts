import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { adminForums } from './admin-forums.js';

function makeApp() {
  const app = new Hono();
  app.route('/', adminForums);
  return app;
}

const SECRET = 'correct-horse-battery-staple';
const RUN_ID = Date.now();
const H = { 'X-Admin-Secret': SECRET, 'Content-Type': 'application/json' };
const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.ADMIN_SECRET = SECRET;
});
afterEach(() => {
  process.env = { ...originalEnv };
});

describe('/v1/admin/forum-* — auth', () => {
  it('tout est fermé sans secret', async () => {
    const app = makeApp();
    expect((await app.request('/v1/admin/forum-threads')).status).toBe(401);
    expect((await app.request('/v1/admin/forum-marketplaces')).status).toBe(401);
    expect((await app.request('/v1/admin/forum-scan', { method: 'POST' })).status).toBe(401);
    expect(
      (await app.request('/v1/admin/forum-threads/1', { method: 'PATCH', body: '{}' })).status,
    ).toBe(401);
  });
});

describe('forum-threads — cycle de vie', () => {
  const url = `https://example.com/thread-${RUN_ID}`;

  it('POST crée, GET liste avec compteurs, PATCH borne les champs', async () => {
    const app = makeApp();
    const created = await app.request('/v1/admin/forum-threads', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ url, title: 'Test thread', source: 'github', status: 'planned', planned_for: '2026-08-25' }),
    });
    expect(created.status).toBe(200);
    const { thread } = (await created.json()) as { thread: { id: number; status: string; planned_for: string } };
    expect(thread.status).toBe('planned');
    expect(thread.planned_for).toBe('2026-08-25');

    const list = await app.request('/v1/admin/forum-threads?status=planned', { headers: H });
    expect(list.status).toBe(200);
    const data = (await list.json()) as { threads: Array<{ url: string }>; counts: Record<string, number>; scan: unknown };
    expect(data.threads.some((t) => t.url === url)).toBe(true);
    expect(data.counts.planned).toBeGreaterThanOrEqual(1);
    expect(data.scan).toBeDefined();

    const patched = await app.request(`/v1/admin/forum-threads/${thread.id}`, {
      method: 'PATCH',
      headers: H,
      body: JSON.stringify({ status: 'posted', posted_url: 'https://example.com/answer', draft: 'final text' }),
    });
    expect(patched.status).toBe(200);
    const after = (await patched.json()) as { thread: { status: string; posted_url: string; draft: string } };
    expect(after.thread.status).toBe('posted');
    expect(after.thread.posted_url).toBe('https://example.com/answer');
  });

  it('POST re-upsert ne régresse pas les champs déjà remplis (COALESCE)', async () => {
    const app = makeApp();
    const again = await app.request('/v1/admin/forum-threads', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ url, title: 'Test thread (rescan)', source: 'github', status: 'posted' }),
    });
    expect(again.status).toBe(200);
    const { thread } = (await again.json()) as { thread: { posted_url: string | null; draft: string | null } };
    expect(thread.posted_url).toBe('https://example.com/answer');
    expect(thread.draft).toBe('final text');
  });

  it('valide les entrées : url non-https, statut inconnu, PATCH sans champ', async () => {
    const app = makeApp();
    const bad = await app.request('/v1/admin/forum-threads', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ url: 'http://insecure', title: 'x' }),
    });
    expect(bad.status).toBe(400);
    const noField = await app.request('/v1/admin/forum-threads/999999', {
      method: 'PATCH',
      headers: H,
      body: JSON.stringify({ status: 'not-a-status' }),
    });
    expect(noField.status).toBe(400);
    const notFound = await app.request('/v1/admin/forum-threads/999999999', {
      method: 'PATCH',
      headers: H,
      body: JSON.stringify({ notes: 'x' }),
    });
    expect(notFound.status).toBe(404);
  });
});

describe('forum-marketplaces', () => {
  it('GET liste les définitions upsertées depuis le code', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/forum-marketplaces', { headers: H });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { marketplaces: Array<{ slug: string; auto: number }> };
    const slugs = data.marketplaces.map((m) => m.slug);
    expect(slugs).toContain('cdp-bazaar');
    expect(slugs).toContain('cline-marketplace');
    // glama graduated from a manual row to a probed one on 18/08/2026;
    // postman is the surface that still has no reliable probe.
    expect(data.marketplaces.find((m) => m.slug === 'glama')?.auto).toBe(1);
    expect(data.marketplaces.find((m) => m.slug === 'postman')?.auto).toBe(0);
  });

  it('PATCH accepte notes et statut, refuse un statut invalide', async () => {
    const app = makeApp();
    const ok = await app.request('/v1/admin/forum-marketplaces/glama', {
      method: 'PATCH',
      headers: H,
      body: JSON.stringify({ notes: `test ${RUN_ID}` }),
    });
    expect(ok.status).toBe(200);
    const bad = await app.request('/v1/admin/forum-marketplaces/glama', {
      method: 'PATCH',
      headers: H,
      body: JSON.stringify({ status: 'nonsense' }),
    });
    expect(bad.status).toBe(400);
  });
});

describe('forum-threads — les deux paramètres optionnels (TABS-16, TABS-18)', () => {
  const url = `https://example.com/lean-${RUN_ID}`;

  it('sert la table des limites par plateforme, plutôt que de la laisser recopier', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/forum-threads', { headers: H });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { platform_limits?: Record<string, { max: number | null; comfy: number }> };
    // Le composeur compte contre CETTE table, plus contre une copie locale.
    expect(body.platform_limits?.stackoverflow).toEqual({ max: 30_000, comfy: 2_500 });
    expect(body.platform_limits?.hn?.max).toBeNull();
  });

  it('fields=list retire les textes longs, et rien d’autre', async () => {
    const app = makeApp();
    await app.request('/v1/admin/forum-threads', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        url,
        title: 'Comment valider un IBAN belge',
        source: 'manual',
        draft: 'Un brouillon assez long pour peser dans le sondage.',
        summary_fr: 'Résumé.',
        excerpt: 'Extrait.',
      }),
    });
    const full = (await (await app.request('/v1/admin/forum-threads', { headers: H })).json()) as {
      threads: Array<Record<string, unknown>>;
    };
    const mineFull = full.threads.find((t) => t.url === url);
    expect(mineFull?.draft).toBe('Un brouillon assez long pour peser dans le sondage.');

    const lean = (await (await app.request('/v1/admin/forum-threads?fields=list', { headers: H })).json()) as {
      threads: Array<Record<string, unknown>>;
    };
    const mineLean = lean.threads.find((t) => t.url === url);
    expect(mineLean).toBeDefined();
    for (const heavy of ['draft', 'draft_fr', 'summary_fr', 'notes', 'excerpt', 'score_detail']) {
      expect(heavy in mineLean!).toBe(false);
    }
    // Tout ce que la liste dessine est toujours là.
    expect(mineLean!.title).toBe('Comment valider un IBAN belge');
    expect(mineLean!.status).toBeDefined();
    expect(mineLean!.first_seen).toBeDefined();
  });
})

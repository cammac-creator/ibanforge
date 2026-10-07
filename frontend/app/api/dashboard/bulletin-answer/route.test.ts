import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * La route des boutons Oui / Plus tard / Non du bulletin (étape A2). Session
 * simulée par le pot de cookies, comme la page ; `fetch` simulé ; secret factice.
 */
const jar = vi.hoisted(() => ({ token: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.token ? { name, value: jar.token } : undefined),
  }),
  headers: async () => new Headers(),
}));

beforeEach(() => {
  jar.token = undefined;
  vi.stubEnv('API_URL', 'http://backend.invalid');
  vi.stubEnv('ADMIN_SECRET', 'secret-factice');
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function withSession() {
  const { getSessionCookieConfig } = await import('@/lib/auth');
  jar.token = getSessionCookieConfig().value;
}

function form(fields: Record<string, string>, origin?: string): NextRequest {
  const body = new URLSearchParams(fields).toString();
  return new NextRequest('http://site.test/api/dashboard/bulletin-answer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(origin ? { Origin: origin } : {}),
    },
    body,
  });
}

describe('POST /api/dashboard/bulletin-answer', () => {
  it('refuse sans session, sans atteindre l’API', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { POST } = await import('./route');
    const res = await POST(form({ key: 'session:1', answer: 'oui', locale: 'fr' }));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('transmet la réponse avec le secret, puis revient au bulletin par un 303', async () => {
    await withSession();
    const fetch = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const { POST } = await import('./route');
    const res = await POST(
      form({ key: 'regle:bic-introuvable:IT', answer: 'plus_tard', locale: 'fr' }, 'http://site.test'),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      'http://site.test/fr/dashboard/bulletin?reponse=ok#decisions',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://backend.invalid/v1/admin/bulletin/answers');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'X-Admin-Secret': 'secret-factice' });
    expect(JSON.parse(String(init.body))).toEqual({
      key: 'regle:bic-introuvable:IT',
      answer: 'plus_tard',
    });
  });

  it('dit l’échec quand l’API refuse (une API d’avant l’étape A2 répond 404)', async () => {
    await withSession();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    const { POST } = await import('./route');
    const res = await POST(form({ key: 'session:3', answer: 'non', locale: 'de' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      'http://site.test/de/dashboard/bulletin?reponse=echec#decisions',
    );
  });

  it('refuse une clé ou une réponse hors forme sans appeler l’API', async () => {
    await withSession();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { POST } = await import('./route');
    const cases: Array<Record<string, string>> = [
      { key: 'session:1;drop', answer: 'oui' },
      { key: 'https://alpha.example.net', answer: 'oui' },
      { key: 'session:1', answer: 'peut-etre' },
      { answer: 'oui' },
    ];
    for (const fields of cases) {
      const res = await POST(form({ ...fields, locale: 'fr' }));
      expect(res.status, JSON.stringify(fields)).toBe(303);
      expect(res.headers.get('location')).toContain('reponse=echec');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuse une autre origine, et ne renvoie jamais ailleurs que sur le site', async () => {
    await withSession();
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const { POST } = await import('./route');
    const foreign = await POST(
      form({ key: 'session:1', answer: 'oui', locale: 'fr' }, 'https://alpha.example.net'),
    );
    expect(foreign.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    // Une langue inconnue retombe sur la langue par défaut, à la racine du site.
    const res = await POST(form({ key: 'session:1', answer: 'oui', locale: '//alpha.example.net' }));
    expect(res.headers.get('location')).toBe(
      'http://site.test/dashboard/bulletin?reponse=ok#decisions',
    );
  });
});

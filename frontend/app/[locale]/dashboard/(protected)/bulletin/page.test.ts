import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * La page du bulletin ne lit JAMAIS la route d'administration sans session (leçon
 * D1 de la relecture du 25.09.2026, la même que la page Portes). Next rend le
 * gabarit et la page en parallèle : la redirection du gabarit arrive trop tard
 * pour empêcher la lecture, qui porte le secret d'administration et fait calculer
 * tout le bulletin à l'API.
 *
 * Même patron que `portes/page.test.ts` : un pot de cookies simulé, et un `fetch`
 * qui échoue bruyamment s'il est appelé. La vraie règle de session (`@/lib/auth`)
 * est utilisée telle quelle.
 */
const jar = vi.hoisted(() => ({ token: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.token ? { name, value: jar.token } : undefined),
  }),
  headers: async () => new Headers(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => 'fr',
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

const props = (week?: string) => ({
  searchParams: Promise.resolve(week === undefined ? {} : { week }),
});

async function withSession() {
  const { getSessionCookieConfig } = await import('@/lib/auth');
  jar.token = getSessionCookieConfig().value;
}

describe('la page Bulletin', () => {
  it('redirige vers la connexion sans jamais appeler la route quand la session manque', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('une page sans session ne doit pas atteindre le réseau');
    });
    vi.stubGlobal('fetch', fetch);
    const { default: BulletinPage } = await import('./page');
    await expect(BulletinPage(props())).rejects.toThrow('redirect:/dashboard/login');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuse aussi un cookie contrefait', async () => {
    jar.token = 'eyJpYXQiOjF9.pas-la-bonne-signature';
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { default: BulletinPage } = await import('./page');
    await expect(BulletinPage(props('2026-W39'))).rejects.toThrow('redirect:/dashboard/login');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lit la route une fois, côté serveur et avec le secret, quand la session est valide', async () => {
    await withSession();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ version: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const { default: BulletinPage } = await import('./page');
    await BulletinPage(props());
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://backend.invalid/v1/admin/bulletin');
    expect(init.headers).toEqual({ 'X-Admin-Secret': 'secret-factice' });
  });

  it('transmet une semaine ISO demandée, et rien d’autre', async () => {
    await withSession();
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const { default: BulletinPage } = await import('./page');
    await BulletinPage(props('2026-W39'));
    await BulletinPage(props('2026-W39&admin=1'));
    await BulletinPage(props('<script>'));
    const urls = fetch.mock.calls.map((c) => String((c as unknown as [string])[0]));
    expect(urls).toEqual([
      'http://backend.invalid/v1/admin/bulletin?week=2026-W39',
      'http://backend.invalid/v1/admin/bulletin',
      'http://backend.invalid/v1/admin/bulletin',
    ]);
  });
});

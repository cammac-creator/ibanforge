import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * La page du tableau des portes ne lit JAMAIS la route d'administration sans
 * session (relecture du 25.09.2026, D1). Next rend le gabarit et la page en
 * parallèle : la redirection du gabarit arrive trop tard pour empêcher la
 * lecture, qui porte le secret d'administration et fait calculer tout le
 * tableau à l'API.
 *
 * `lib/dashboard/session-guard.test.ts` vérifie la FORME (la garde commune
 * `requireDashboardSession()` ouvre la page) ; ce test-ci vérifie l'EFFET sur
 * cette page : sans session, la route n'est jamais lue. Même patron que
 * `app/api/private-routes-auth.test.ts` : un pot de cookies simulé, et un
 * `fetch` qui échoue bruyamment s'il est appelé. La vraie règle de session
 * (`@/lib/auth`) est utilisée telle quelle.
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

describe('la page Portes', () => {
  it('redirige vers la connexion sans jamais appeler la route quand la session manque', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('une page sans session ne doit pas atteindre le réseau');
    });
    vi.stubGlobal('fetch', fetch);
    const { default: DoorsPage } = await import('./page');
    await expect(DoorsPage()).rejects.toThrow('redirect:/dashboard/login');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuse aussi un cookie contrefait', async () => {
    jar.token = 'eyJpYXQiOjF9.pas-la-bonne-signature';
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { default: DoorsPage } = await import('./page');
    await expect(DoorsPage()).rejects.toThrow('redirect:/dashboard/login');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lit la route une fois, avec le secret, quand la session est valide', async () => {
    const { getSessionCookieConfig } = await import('@/lib/auth');
    jar.token = getSessionCookieConfig().value;
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ observed_at_zurich: '07.10 à 12:00' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetch);
    const { default: DoorsPage } = await import('./page');
    await DoorsPage();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://backend.invalid/v1/admin/doors?weeks=10');
    expect(init.headers).toEqual({ 'X-Admin-Secret': 'secret-factice' });
  });
});

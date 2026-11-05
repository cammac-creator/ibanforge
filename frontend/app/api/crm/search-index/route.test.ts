import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ isAuthenticated: auth }));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.resetModules();
  auth.mockResolvedValue(true);
  vi.stubEnv('API_URL', 'https://api.example.net');
  vi.stubEnv('ADMIN_SECRET', 'secret-fictif');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function get() {
  return (await import('./route')).GET();
}

describe('Recherche des contacts : panne distincte d’un résultat vide', () => {
  it('refuse la lecture sans session avant tout appel amont', async () => {
    auth.mockResolvedValue(false);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect((await get()).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rend une vraie liste vide quand les deux sources sont lisibles', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      json(url.endsWith('/keys') ? { keys: [] } : { prospects: [] }),
    );
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rows: [], partial: false });
  });
  it('ne transforme pas deux erreurs HTTP en absence de contacts', async () => {
    vi.stubGlobal('fetch', async () => json({}, 503));
    expect((await get()).status).toBe(502);
  });
  it('ne transforme pas deux erreurs réseau en absence de contacts', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('réseau');
    });
    expect((await get()).status).toBe(502);
  });
  it.each(['keys', 'prospects'])(
    'signale une lecture partielle quand %s échoue',
    async (source) => {
      vi.stubGlobal('fetch', async (url: string) => {
        if (url.endsWith(`/${source}`)) throw new Error('réseau');
        return json(
          url.endsWith('/keys')
            ? { keys: [{ email: 'contact@alpha.example.net' }] }
            : {
                prospects: [
                  { contact_email: 'contact@alpha.example.net', company: 'Société Alpha' },
                ],
              },
        );
      });
      const response = await get();
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.partial).toBe(true);
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0].email).toBe('contact@alpha.example.net');
    },
  );
  it('garde un seul résultat lorsque le même client est aussi un prospect', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      json(
        url.endsWith('/keys')
          ? { keys: [{ email: 'CONTACT@alpha.example.net' }] }
          : {
              prospects: [{ contact_email: 'contact@alpha.example.net', company: 'Société Alpha' }],
            },
      ),
    );
    expect(await (await get()).json()).toEqual({
      rows: [{ email: 'contact@alpha.example.net', label: 'Société Alpha', kind: 'client' }],
      partial: false,
    });
  });
});

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
  vi.useRealTimers();
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


describe('Recherche : lecture et contrat indépendants pour chaque source', () => {
  it.each(['json', 'contrat'])('conserve les clés quand le corps prospects est invalide (%s)', async mode => {
    vi.stubGlobal('fetch', async (url: string) => url.endsWith('/keys')
      ? json({ keys: [{ email: 'contact@alpha.example.net' }] })
      : mode === 'json' ? new Response('{illisible') : json({ prospects: 'invalide' }));
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rows: [{ email: 'contact@alpha.example.net', label: 'alpha.example.net', kind: 'client' }], partial: true });
  });
  it('ne présente pas deux contrats absents comme une liste vide', async () => {
    vi.stubGlobal('fetch', async () => json({}));
    expect((await get()).status).toBe(502);
  });
});


describe('Recherche : bornes et confidentialité de la lecture', () => {
  it.each(['keys', 'prospects'])('conserve l’autre source quand %s contient une ligne mal formée', async source => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith(`/${source}`)) return json({ [source]: [null] });
      return url.endsWith('/keys') ? json({ keys: [{ email: 'contact@alpha.example.net' }] }) : json({ prospects: [{ contact_email: 'contact@beta.example.net', company: 'Société Beta' }] });
    });
    const response = await get(); const body = await response.json();
    expect(response.status).toBe(200); expect(body.partial).toBe(true); expect(body.rows).toHaveLength(1);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('accepte les champs facultatifs absents ou nuls sans inventer de contact', async () => {
    vi.stubGlobal('fetch', async (url: string) => url.endsWith('/keys') ? json({ keys: [{}, { email: null }] }) : json({ prospects: [{ contact_email: null, company: null }, { contact_email: 'contact@beta.example.net', company: null }] }));
    expect(await (await get()).json()).toEqual({ rows: [{ email: 'contact@beta.example.net', label: 'beta.example.net', kind: 'prospect' }], partial: false });
  });
  it('borne aussi un corps qui reste suspendu et conserve la source déjà lue', async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
      expect(options.cache).toBe('no-store');
      if (url.endsWith('/prospects')) return json({ prospects: [{ contact_email: 'contact@beta.example.net' }] });
      signal = options.signal as AbortSignal;
      return { ok: true, json: () => new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('Délai fictif')), { once: true })) };
    });
    const { GET } = await import('./route'); let settled = false;
    const result = GET().then(response => { settled = true; return response; });
    await vi.advanceTimersByTimeAsync(7999); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1); const response = await result;
    expect(signal?.aborted).toBe(true); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ partial: true, rows: [{ email: 'contact@beta.example.net' }] });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('refuse une connexion non configurée sans consulter une source', async () => {
    vi.stubEnv('ADMIN_SECRET', ''); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const response = await get(); expect(response.status).toBe(503); expect(fetch).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});

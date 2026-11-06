import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers(); vi.resetModules();
  vi.stubEnv('ADMIN_SECRET', 'fiction');
  vi.stubEnv('API_URL', 'https://api.example.net');
});
afterEach(() => {
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
});
const jeu = {
  keys: [{ key_prefix: 'fiction', email: 'client@example.net' }],
  prospects: [], messages: [], by_key: {}, reads: {}, months: [], clients: [], contacts: [],
};

describe('synthèse CRM bornée de la vue d’ensemble', () => {
  it.each([true, false])('préserve les sept lectures et le choix des corps de messages : %s', async (court) => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json(jeu));
    vi.stubGlobal('fetch', fetcher);
    const { fetchOverviewCrm } = await import('./overview-crm');
    expect((await fetchOverviewCrm(court))?.keys).toEqual(jeu.keys);
    expect(fetcher).toHaveBeenCalledTimes(7);
    expect(fetcher.mock.calls.some(([url]) => url.endsWith(court ? '/email-messages?fields=summary' : '/email-messages'))).toBe(true);
    const signaux = fetcher.mock.calls.map(([, init]) => init.signal);
    expect(new Set(signaux).size).toBe(1);
    expect(signaux[0].aborted).toBe(false);
  });

  it.each(['en-têtes', 'corps'])('une seule source bloquée sur %s rend la synthèse indisponible, même si les clés ont répondu', async (phase) => {
    const fetcher = vi.fn((url, init) => {
      if (!url.includes('/email-messages')) return Promise.resolve(Response.json(jeu));
      const attente = () => new Promise<never>((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('Interruption', 'AbortError')), { once: true });
      });
      return phase === 'en-têtes' ? attente() : Promise.resolve({ ok: true, json: attente });
    });
    vi.stubGlobal('fetch', fetcher);
    const { fetchOverviewCrm } = await import('./overview-crm');
    let fini = false;
    const resultat = fetchOverviewCrm(true).then((r) => { fini = true; return r; });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fini).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await resultat).toBeNull();
    expect(fetcher.mock.calls.every(([, init]) => init.signal.aborted)).toBe(true);
  });

  it('ne lance aucune lecture si le secret manque', async () => {
    vi.stubEnv('ADMIN_SECRET', '');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const { fetchOverviewCrm } = await import('./overview-crm');
    expect(await fetchOverviewCrm(false)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('les autres appelants CRM peuvent toujours lire sans signal fourni', async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json(jeu));
    vi.stubGlobal('fetch', fetcher);
    const { fetchCrmData } = await import('@/lib/crm/build-contacts');
    expect((await fetchCrmData())?.keys).toEqual(jeu.keys);
    expect(fetcher.mock.calls.every(([, init]) => !('signal' in init))).toBe(true);
  });
});

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
  it('partage les clients déjà lus et ne relance que les six autres sources', async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json(jeu)); vi.stubGlobal('fetch', fetcher);
    const { fetchOverviewCrm } = await import('./overview-crm');
    const clients = [{ email: 'client@example.net', status: 'active' as const, source: 'direct', credits_total: 0,
      credits_remaining: 0, packs: 0, first_call_at: null, calls_90d: 3 }];
    const result = await fetchOverviewCrm(true, Promise.resolve({ ok: true, status: 200, data: clients }));
    expect(result?.activation).toBe(clients); expect(result?.keys).toEqual(jeu.keys);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(fetcher.mock.calls.some(([url]) => url.includes('/activation'))).toBe(false);
  });

  it.each(['refus', 'rejet', 'vide'] as const)('une activation %s garde les autres données CRM lisibles', async mode => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json(jeu)); vi.stubGlobal('fetch', fetcher);
    const { fetchOverviewCrm } = await import('./overview-crm');
    const promise = mode === 'rejet' ? Promise.reject(new Error('Échec fictif')) : Promise.resolve({ ok: mode === 'vide', status: mode === 'vide' ? 200 : 503, data: mode === 'vide' ? [] : null });
    const result = await fetchOverviewCrm(false, promise);
    expect(result?.keys).toEqual(jeu.keys);
    if (mode === 'vide') expect(result?.activation).toEqual([]); else expect(result).not.toHaveProperty('activation');
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it('borne une activation qui ne finit jamais et ne laisse aucun minuteur', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json(jeu)));
    const { fetchOverviewCrm } = await import('./overview-crm');
    let done = false;
    const result = fetchOverviewCrm(false, new Promise(() => {})).then(r => { done = true; return r; });
    await vi.advanceTimersByTimeAsync(14_999); expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(await result).toBeNull();
  });

  it('l’interruption du CRM ne consomme ni n’annule la lecture partagée des autres sections', async () => {
    vi.stubGlobal('fetch', vi.fn((url, init) => url.includes('/email-messages')
      ? new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('Interruption fictive')), { once: true }))
      : Promise.resolve(Response.json(jeu))));
    const { fetchOverviewCrm } = await import('./overview-crm');
    let finish!: (value: { ok: boolean; status: number; data: [] }) => void;
    const shared = new Promise<{ ok: boolean; status: number; data: [] }>(resolve => { finish = resolve; });
    const result = fetchOverviewCrm(false, shared);
    await vi.advanceTimersByTimeAsync(15_000); expect(await result).toBeNull();
    const answer = { ok: true, status: 200, data: [] as [] }; finish(answer);
    expect(await shared).toBe(answer);
  });

  it('une synthèse impossible ou non configurée ne reste pas retenue par l’activation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(null, { status: 503 })));
    const { fetchOverviewCrm } = await import('./overview-crm');
    expect(await fetchOverviewCrm(false, new Promise(() => {}))).toBeNull();
    vi.resetModules(); vi.stubEnv('ADMIN_SECRET', '');
    const { fetchOverviewCrm: withoutSecret } = await import('./overview-crm');
    expect(await withoutSecret(false, new Promise(() => {}))).toBeNull();
  });

});

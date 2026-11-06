import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchJSON } from '@/components/dashboard/overview/fetching';
import { STRIPE_READ_TIMEOUT_MS } from './read-deadline';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function enAttente(signal: AbortSignal) {
  return new Promise<never>((_, reject) => {
    const interrompre = () => reject(new DOMException('Lecture interrompue', 'AbortError'));
    if (signal.aborted) interrompre();
    else signal.addEventListener('abort', interrompre, { once: true });
  });
}

describe('lectures bornées du tableau de bord', () => {
  it('garde le cache privé et les en-têtes, puis libère le minuteur après lecture', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"version":1}'));
    vi.stubGlobal('fetch', fetcher);
    expect(await fetchJSON('https://api.example.net/private', { 'X-Admin-Secret': 'fiction' }, 6000))
      .toEqual({ ok: true, status: 200, data: { version: 1 } });
    expect(fetcher).toHaveBeenCalledWith('https://api.example.net/private', {
      cache: 'no-store', headers: { 'X-Admin-Secret': 'fiction' }, signal: expect.any(AbortSignal),
    });
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
  });

  it.each(['en-têtes', 'corps'])('interrompt aussi une attente du %s, sans fabriquer de zéros', async (phase) => {
    let signal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn((_url, init) => {
      signal = init.signal;
      return phase === 'en-têtes' ? enAttente(signal)
        : Promise.resolve({ ok: true, status: 200, json: () => enAttente(signal) });
    }));
    let fini = false;
    const resultat = fetchJSON('https://api.example.net/private', {}).then((r) => { fini = true; return r; });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fini).toBe(false);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await resultat).toEqual({ ok: false, status: 0, data: null });
    expect(signal.aborted).toBe(true);
  });

  it('conserve la garde courte de six secondes pour la synthèse essentielle', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, init) => enAttente(init.signal)));
    let fini = false;
    const resultat = fetchJSON('https://api.example.net/private', {}, 6000).then((r) => { fini = true; return r; });
    await vi.advanceTimersByTimeAsync(5999);
    expect(fini).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await resultat).toEqual({ ok: false, status: 0, data: null });
  });

  it('laisse finir Stripe après le délai des autres sources, puis borne une lecture bloquée', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, init) => enAttente(init.signal)));
    let fini = false;
    const resultat = fetchJSON('https://api.example.net/private', {}, STRIPE_READ_TIMEOUT_MS)
      .then((r) => { fini = true; return r; });
    await vi.advanceTimersByTimeAsync(74_999);
    expect(fini).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await resultat).toEqual({ ok: false, status: 0, data: null });
  });

  it.each([0, -1, NaN, Infinity, 0.5, 300_001])('un délai invalide %s garde une borne de quinze secondes', async (delai) => {
    vi.stubGlobal('fetch', vi.fn((_url, init) => enAttente(init.signal)));
    const resultat = fetchJSON('https://api.example.net/private', {}, delai);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await resultat).toEqual({ ok: false, status: 0, data: null });
  });

  it.each([401, 403, 503])('préserve le refus HTTP %s', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    expect(await fetchJSON('https://api.example.net/private', {})).toEqual({ ok: false, status, data: null });
  });

  it.each(['json', 'réseau'])('libère le minuteur même sur un échec %s', async (cause) => {
    vi.stubGlobal('fetch', cause === 'json' ? vi.fn().mockResolvedValue(new Response('invalide'))
      : vi.fn().mockRejectedValue(new Error('réseau')));
    expect(await fetchJSON('https://api.example.net/private', {})).toEqual({ ok: false, status: 0, data: null });
  });
});

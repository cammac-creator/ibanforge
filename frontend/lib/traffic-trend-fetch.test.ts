import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('API_URL', 'http://api.example.test');
  vi.stubEnv('STATS_TOKEN', 'jeton-fictif');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const load = async () => (await import('./traffic-trend')).fetchTrafficTrend;

describe('lecture du trafic', () => {
  it('ne tente pas de lecture sans configuration', async () => {
    vi.stubEnv('STATS_TOKEN', '');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(await (await load())()).toEqual({ ok: false, reason: 'no-token', status: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('lit une période vide valide sans cache', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ period_days: 7, days: [] }));
    vi.stubGlobal('fetch', fetcher);
    expect(await (await load())(7)).toEqual({ ok: true, days: [] });
    expect(fetcher).toHaveBeenCalledWith('http://api.example.test/stats/traffic-trend?period=7', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
  });
  it.each([{ days: [] }, { period_days: 30, days: [] }, { period_days: 7, days: [{ date: '2026-08-30' }] }])('refuse le contrat incomplet ou une période différente : %j', async (raw) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(raw)));
    expect(await (await load())(7)).toEqual({ ok: false, reason: 'malformed', status: 200 });
  });
  it('refuse un corps non JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('illisible')));
    expect(await (await load())()).toEqual({ ok: false, reason: 'malformed', status: 200 });
  });
  it('distingue le refus HTTP du réseau indisponible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    const read = await load();
    expect(await read()).toEqual({ ok: false, reason: 'http', status: 503 });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('réseau fictif')));
    expect(await read()).toEqual({ ok: false, reason: 'unreachable', status: 0 });
  });
  it.each(['en-têtes', 'corps'])('annule les %s au bout de huit secondes et libère le minuteur', async (stage) => {
    vi.useFakeTimers();
    const read = await load();
    const block = (signal: AbortSignal) => new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('délai fictif'))));
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => stage === 'corps'
      ? Promise.resolve({ ok: true, status: 200, json: () => block(options.signal as AbortSignal) })
      : block(options.signal as AbortSignal)));
    let settled = false;
    const result = read().then((r) => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(7999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ ok: false, reason: 'timeout', status: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
});

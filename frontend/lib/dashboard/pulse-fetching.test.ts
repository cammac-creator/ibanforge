import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJSON } from '@/components/dashboard/overview/fetching';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('lecture bornée des indicateurs essentiels', () => {
  it('transmet le délai et les en-têtes uniquement à la lecture serveur', async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    const fetcher = vi.fn().mockResolvedValue(new Response('{"version":1}'));
    vi.stubGlobal('fetch', fetcher);
    expect(
      await fetchJSON('https://api.example.net/private', { 'X-Admin-Secret': 'fiction' }, 6000),
    ).toEqual({ ok: true, status: 200, data: { version: 1 } });
    expect(timeout).toHaveBeenCalledWith(6000);
    expect(fetcher).toHaveBeenCalledWith('https://api.example.net/private', {
      cache: 'no-store',
      headers: { 'X-Admin-Secret': 'fiction' },
      signal,
    });
  });
  it('une interruption garde une lecture indisponible, jamais un objet de compteurs nuls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('Délai dépassé', 'TimeoutError')),
    );
    expect(await fetchJSON('https://api.example.net/private', {}, 6000)).toEqual({
      ok: false,
      status: 0,
      data: null,
    });
  });
  it('préserve les refus HTTP et les lectures qui n’ont pas de délai explicite', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
    expect(await fetchJSON('https://api.example.net/private', {})).toEqual({
      ok: false,
      status: 403,
      data: null,
    });
    expect(timeout).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createHealthProbe } from './status-health';

/*
 * /status is rendered on each visit. Its health line must report a round trip
 * that was really measured and an outage that really happened: Next's data
 * cache, in a request render, serves a stale entry as is and refreshes it in
 * the background, so a cached fetch would show a near-zero latency and keep
 * saying "operational" while the API is down.
 */

const URL = 'https://api.example.test/health';

/** A fake clock and a fetcher that takes `latency` ms on that clock. */
function harness(reply: () => Promise<Response> | Response, latency = 40) {
  let clock = 1_000_000;
  const now = () => clock;
  const advance = (ms: number) => {
    clock += ms;
  };
  const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => {
    clock += latency;
    return reply();
  });
  return { now, advance, fetcher };
}

const ok = () => new Response(JSON.stringify({ status: 'ok', version: '9.9.9' }), { status: 200 });

describe('health probe of /status', () => {
  it('reports the measured round trip, outside the data cache, with a deadline', async () => {
    const h = harness(ok, 42);
    const read = createHealthProbe(URL, { fetcher: h.fetcher, now: h.now });

    const reading = await read();

    expect(reading).toEqual({ healthy: true, latencyMs: 42, version: '9.9.9' });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    const init = h.fetcher.mock.calls[0][1];
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('asks the API at most once every five minutes', async () => {
    const h = harness(ok);
    const read = createHealthProbe(URL, { fetcher: h.fetcher, now: h.now });

    await read();
    h.advance(299_000);
    await read();
    expect(h.fetcher).toHaveBeenCalledTimes(1);

    h.advance(1_000);
    await read();
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  });

  it('shares one request between visits that arrive together', async () => {
    const h = harness(ok);
    const read = createHealthProbe(URL, { fetcher: h.fetcher, now: h.now });

    const [a, b] = await Promise.all([read(), read()]);

    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('shows an outage after a healthy reading once that reading is five minutes old', async () => {
    let up = true;
    const h = harness(() => (up ? ok() : Promise.reject(new TypeError('fetch failed'))));
    const read = createHealthProbe(URL, { fetcher: h.fetcher, now: h.now });

    expect((await read()).healthy).toBe(true);
    up = false;
    h.advance(300_000);

    expect(await read()).toEqual({ healthy: false, latencyMs: null, version: null });
  });

  it('says disrupted, with the measured time, when the API answers an error', async () => {
    const h = harness(() => new Response('unavailable', { status: 503 }), 120);
    const read = createHealthProbe(URL, { fetcher: h.fetcher, now: h.now });

    expect(await read()).toEqual({ healthy: false, latencyMs: 120, version: null });
  });

  it('gives up at the deadline instead of holding the visitor', async () => {
    const h = harness(ok);
    const hanging = vi.fn(
      (...[, init]: [string, RequestInit]) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const read = createHealthProbe(URL, { fetcher: hanging, now: h.now, timeoutMs: 20 });

    expect(await read()).toEqual({ healthy: false, latencyMs: null, version: null });
  });
});

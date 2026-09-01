import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET } from './route';

// The relay exists so the browser never needs CORS on api.ibanforge.com:
// it forwards ?after and the JSON body verbatim, and never caches — a stale
// feed would replay couriers the viewer has already seen.

afterEach(() => vi.unstubAllGlobals());

function stubUpstream(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return calls;
}

describe('GET /api/ops', () => {
  it('forwards the after cursor to /v1/ops/recent and returns the body verbatim', async () => {
    const calls = stubUpstream({ ops: [{ id: 7, t: 'x', type: 'iban_validate', country: 'DE', success: true }] });
    const res = await GET(new Request('http://site.test/api/ops?after=42'));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/v1\/ops\/recent\?after=42$/);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ops: [{ id: 7, t: 'x', type: 'iban_validate', country: 'DE', success: true }] });
  });

  it('drops a malformed cursor instead of forwarding it', async () => {
    const calls = stubUpstream({ ops: [] });
    await GET(new Request('http://site.test/api/ops?after=DROP%20TABLE'));
    expect(calls[0].url).toMatch(/\/v1\/ops\/recent$/);
  });

  it('answers 502 with an empty feed when the API is unreachable', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('down'); });
    const res = await GET(new Request('http://site.test/api/ops'));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ops: [] });
  });
});

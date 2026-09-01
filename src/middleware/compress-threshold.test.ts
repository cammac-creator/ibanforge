/**
 * `compress()` must stop gzipping four bytes (PERF-02, audit 2026-09-01).
 *
 * Hono's compress middleware carries a 1024-byte threshold, but it only applies
 * it when a `Content-Length` is already on the response as the middleware
 * unwinds — and `@hono/node-server` sets that header AFTER the whole chain. It
 * therefore read null on every response and compressed everything: `GET /ping`
 * answered `content-encoding: gzip` for a 4-byte body, measured at 1 825 req/s
 * against 5 815 without it, the cost being the per-response CompressionStream
 * rather than the compression itself.
 *
 * The fix is one middleware registered directly under `compress()` in
 * `buildApp()`: it buffers the body and sets the real Content-Length, so the
 * threshold finally has something to read. This file drives the whole app
 * rather than the middleware in isolation, because the bug lived entirely in
 * the ORDER of the chain — a unit test of the middleware alone would have
 * passed while the app kept gzipping `pong`.
 *
 * It lives in `middleware/` and not beside `app.ts` because it tests a
 * middleware; the route it uses is incidental.
 */
import { gunzipSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { buildApp } from '../app.js';

const GZIP = { 'Accept-Encoding': 'gzip' } as const;

describe('compression threshold', () => {
  it('does not gzip a 4-byte response', async () => {
    const app = buildApp();
    const res = await app.request('/ping', { headers: GZIP });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding'), '4 bytes went through a CompressionStream').toBeNull();
    // The real size is now published, which is what made the threshold readable.
    expect(res.headers.get('content-length')).toBe('4');
    expect(await res.text()).toBe('pong');
  });

  it('still gzips a large response', async () => {
    const app = buildApp();
    const res = await app.request('/openapi.json', { headers: GZIP });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding'), 'the big documents must stay compressed').toBe('gzip');
  });

  it('leaves the body and its content-type intact', async () => {
    // `c.res = new Response(...)` rebuilds the response, and Hono's own setter
    // merges the previous headers over the new one after deleting its
    // content-type. A silent loss there would change what every client parses.
    const app = buildApp();
    const res = await app.request('/health', { headers: GZIP });
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('x-content-type-options'), 'a security header was dropped in the rebuild').toBe('nosniff');
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBeTruthy();
  });

  it('serves the same bytes compressed as uncompressed', async () => {
    // `app.request()` hands back the raw body — no HTTP client decodes it — so
    // the gzip is undone here. The point is that buffering the body under
    // compress() did not truncate or re-encode anything on the way through.
    const plain = await (await buildApp().request('/openapi.json')).text();
    const res = await buildApp().request('/openapi.json', { headers: GZIP });
    expect(res.headers.get('content-encoding')).toBe('gzip');
    const unzipped = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
    expect(unzipped).toBe(plain);
  });
});

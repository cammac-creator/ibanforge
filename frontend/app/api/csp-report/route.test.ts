import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

/**
 * WEB-06 (audit 10/11/2026): the size of a report is checked BEFORE the body
 * is read. The route used to `await req.text()` first and compare afterwards,
 * so a body of several hundred megabytes was already in the container's memory
 * when it was refused.
 *
 * The budget per address lives at module level, so every case writes its own
 * address (documentation range, RFC 5737).
 */

const LIMIT = 32_768;

const report = JSON.stringify({
  'csp-report': {
    'document-uri': 'https://ibanforge.com/fr/playground',
    'effective-directive': 'connect-src',
    'blocked-uri': 'https://alpha.example.net',
  },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/csp-report, bounded body', () => {
  it('refuses a declared Content-Length over the limit without reading the body', async () => {
    const text = vi.fn(async () => 'x');
    const json = vi.fn(async () => ({}));
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const getReader = vi.fn();
    const req = {
      headers: new Headers({
        'content-type': 'application/csp-report',
        'content-length': String(10 * 1024 * 1024),
        'x-real-ip': '192.0.2.10',
      }),
      body: { getReader },
      text,
      json,
      arrayBuffer,
    } as unknown as Request;

    const res = await POST(req);

    expect(res.status).toBe(413);
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(getReader).not.toHaveBeenCalled();
  });

  it('stops reading a body without a length as soon as it passes the limit, and still logs a normal report', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Ten megabytes in 16 KiB chunks, pulled on demand: the count of chunks
    // pulled is what the route actually held in memory.
    const CHUNK = 16 * 1024;
    const TOTAL_CHUNKS = 640;
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= TOTAL_CHUNKS) {
          controller.close();
          return;
        }
        pulled += 1;
        controller.enqueue(new Uint8Array(CHUNK).fill(0x61));
      },
      cancel() {
        cancelled = true;
      },
    });
    const big = new Request('http://localhost/api/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report', 'x-real-ip': '192.0.2.11' },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    const refused = await POST(big);

    expect(refused.status).toBe(413);
    expect(cancelled).toBe(true);
    // The limit is two chunks; the stream may have one chunk queued ahead.
    expect(pulled * CHUNK).toBeLessThanOrEqual(LIMIT + 2 * CHUNK);

    // An ordinary report, under the limit, is still read and logged.
    const ok = await POST(
      new Request('http://localhost/api/csp-report', {
        method: 'POST',
        headers: { 'content-type': 'application/csp-report', 'x-real-ip': '192.0.2.12' },
        body: report,
      }),
    );
    expect(ok.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toBe('[csp-report]');
    expect(String(warn.mock.calls[0]?.[1])).toContain('"directive":"connect-src"');
  });
});

/**
 * The 402 has to FIT through a Node client, or it is not a 402 at all.
 *
 * Node caps a response header block at `http.maxHeaderSize` (16 384 bytes by
 * default) and undici throws UND_ERR_HEADERS_OVERFLOW instead of handing the
 * response to `fetch()`. On 2026-09-01 the MCP audit measured the
 * `PAYMENT-REQUIRED` header at 18 600 bytes on POST /v1/iban/validate and
 * 19 509 on POST /v1/iban/batch: the published `ibanforge-mcp` package answered
 * `fetch failed` on its headline tool, our own TypeScript SDK raised
 * `IBANforgeError: Network error` instead of `PaymentRequiredError`, and the
 * documented `wrapFetchWithPayment` recipe could not work. Python and curl read
 * the same response without blinking, which is why nothing caught it.
 *
 * These tests run the REAL application against a stand-in facilitator, so the
 * header under assertion is the one the x402 SDK actually emits — a
 * hand-assembled response would only prove the assembly. One assertion here
 * (< 8 192 bytes) is what would have caught MCP-01 the day the Bazaar
 * extension grew.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildApp } from '../app.js';
import { resetX402Paywall } from './x402.js';
import { MAX_PAYMENT_REQUIRED_BYTES, projectAnnouncementForHeader } from './enrich-402.js';
import { closeAll } from '../lib/db.js';

// Our own bucket in the process-wide in-memory rate limiter. TEST-NET-2.
const IP = '198.51.100.77';
const H = { 'x-real-ip': IP };
const WALLET = '0x00000000000000000000000000000000000000B2';

let facilitator: Server;
let facilitatorUrl: string;
const originalEnv = { ...process.env };

beforeAll(async () => {
  facilitator = createServer((req, res) => {
    if (req.url === '/supported') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }],
          extensions: [],
          signers: {},
        }),
      );
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((resolve) => facilitator.listen(0, '127.0.0.1', resolve));
  facilitatorUrl = `http://127.0.0.1:${(facilitator.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => facilitator.close(() => resolve()));
  process.env = originalEnv;
  closeAll();
});

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.X402_ENABLED = 'true';
  process.env.WALLET_ADDRESS = WALLET;
  process.env.FACILITATOR_URL = facilitatorUrl;
  // A stray CDP key would build a Coinbase client and bypass the stand-in.
  delete process.env.CDP_API_KEY_ID;
  delete process.env.CDP_API_KEY_SECRET;
  delete process.env.IBANFORGE_FREE_MODE;
  resetX402Paywall();
});

/** The five paid routes, probed the way an agent probes them: no payment. */
const PAID_ROUTES: Array<[string, string, string | undefined]> = [
  ['POST', '/v1/iban/validate', '{}'],
  ['POST', '/v1/iban/batch', '{}'],
  ['POST', '/v1/iban/compliance', '{}'],
  ['GET', '/v1/bic/DEUTDEFF', undefined],
  ['GET', '/v1/ch/clearing/100', undefined],
];

interface Announcement {
  x402Version?: number;
  accepts?: Array<{ amount?: string; payTo?: string; network?: string; scheme?: string }>;
  extensions?: { bazaar?: Record<string, unknown> };
}

function decodeHeader(value: string): Announcement {
  return JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as Announcement;
}

async function probe(method: string, path: string, body?: string): Promise<Response> {
  return buildApp().request(`https://api.ibanforge.com${path}`, {
    method,
    headers: body ? { ...H, 'Content-Type': 'application/json' } : H,
    body,
  });
}

describe('the PAYMENT-REQUIRED header fits through a default Node client', () => {
  for (const [method, path, body] of PAID_ROUTES) {
    it(`${method} ${path} answers 402 with a header under ${MAX_PAYMENT_REQUIRED_BYTES} bytes`, async () => {
      const res = await probe(method, path, body);
      expect(res.status).toBe(402);

      const header = res.headers.get('payment-required');
      expect(header, 'a paid route must quote its price in the header').toBeTruthy();
      expect(
        Buffer.byteLength(header as string, 'utf8'),
        'over 16 KB of headers and undici throws UND_ERR_HEADERS_OVERFLOW before fetch() ever sees the 402',
      ).toBeLessThan(MAX_PAYMENT_REQUIRED_BYTES);
    });

    it(`${method} ${path} says the same price in the header as in the body`, async () => {
      const res = await probe(method, path, body);
      const decoded = decodeHeader(res.headers.get('payment-required') as string);
      const parsed = (await res.json()) as Announcement;

      // The terms are the part that must survive the trim byte for byte: a
      // shorter header that quotes a different price is worse than no header.
      expect(decoded.x402Version).toBe(parsed.x402Version);
      expect(decoded.accepts?.[0]?.amount).toBe(parsed.accepts?.[0]?.amount);
      expect(decoded.accepts?.[0]?.payTo).toBe(parsed.accepts?.[0]?.payTo);
      expect(decoded.accepts?.[0]?.network).toBe(parsed.accepts?.[0]?.network);
      expect(decoded.accepts).toEqual(parsed.accepts);
    });
  }

  it('keeps the discovery block whole in the body, where indexers read it', async () => {
    const res = await probe('POST', '/v1/iban/validate', '{}');
    const parsed = (await res.json()) as Announcement;

    // The header may drop `outputSchema`; the body never does. This is the
    // half CDP Bazaar and agentic.market ingest.
    expect(parsed.extensions?.bazaar).toBeTruthy();
    expect(parsed.extensions?.bazaar?.outputSchema).toBeTruthy();
    expect(parsed.extensions?.bazaar?.info).toBeTruthy();
  });

  it('leaves `info` byte-identical in the header, so a paid retry is not refused', async () => {
    const res = await probe('POST', '/v1/iban/validate', '{}');
    const decoded = decodeHeader(res.headers.get('payment-required') as string);
    const parsed = (await res.json()) as Announcement;

    // @x402/core validates a client's echoed extension info as a SUBSET of what
    // the server advertises on the retry. A client echoing a trimmed `info`
    // would be refused with `extension_echo_mismatch`, so the header either
    // carries the whole `info` or no extensions at all.
    if (decoded.extensions?.bazaar) {
      expect(decoded.extensions.bazaar.info).toEqual(parsed.extensions?.bazaar?.info);
    }
  });
});

describe('projectAnnouncementForHeader', () => {
  const terms = {
    x402Version: 2,
    error: 'Payment required',
    resource: { url: 'https://api.ibanforge.com/v1/iban/validate' },
    accepts: [{ scheme: 'exact', network: 'eip155:8453', amount: '5000' }],
  };

  it('returns the announcement untouched when it already fits', () => {
    const small = { ...terms, extensions: { bazaar: { info: { input: {} } } } };
    expect(projectAnnouncementForHeader(small)).toBe(small);
  });

  it('drops the bulk beside `info` first, and keeps `info` verbatim', () => {
    const info = { input: { type: 'http', method: 'POST' }, output: { type: 'json' } };
    const fat = {
      ...terms,
      extensions: {
        bazaar: { discoverable: true, info, outputSchema: { pad: 'x'.repeat(20_000) } },
      },
    };
    const projected = projectAnnouncementForHeader(fat) as {
      extensions: { bazaar: Record<string, unknown> };
      accepts: unknown;
    };

    expect(projected.extensions.bazaar.outputSchema).toBeUndefined();
    expect(projected.extensions.bazaar.info).toEqual(info);
    expect(projected.extensions.bazaar.discoverable).toBe(true);
    expect(projected.accepts, 'the terms are never trimmed').toEqual(terms.accepts);
    // The source object is left alone: the 402 body is built from it.
    expect(fat.extensions.bazaar.outputSchema).toBeTruthy();
  });

  it('drops extensions outright rather than emit a half-trimmed `info`', () => {
    const fat = {
      ...terms,
      extensions: { bazaar: { info: { input: {}, output: { example: 'x'.repeat(20_000) } } } },
    };
    const projected = projectAnnouncementForHeader(fat) as Record<string, unknown>;

    expect(projected.extensions).toBeUndefined();
    expect(projected.accepts).toEqual(terms.accepts);
    expect(projected.x402Version).toBe(2);
  });
});

/**
 * The assembly test — what `buildApp()` was extracted for.
 *
 * Until 20/08/2026 `src/index.ts` exported nothing and started a listening
 * server on import, so NO test could reach the order in which the middlewares
 * are mounted. That order is the business model: stripe before the api-key
 * middleware, the api-key middleware before x402, and `creditsBuy` AFTER x402
 * so a $5 credit pack cannot be minted without a settlement. Audit A1 spelled
 * out the cost: swapping two lines would have minted free 25,000-credit keys
 * and left all 1,052 tests green.
 *
 * Everything here therefore runs against the REAL application object, not a
 * hand-assembled mini-app that would only prove the mini-app is right.
 *
 * The facilitator is a local stand-in HTTP server that counts its calls. That
 * counter is the second subject of this file: the paywall used to be rebuilt on
 * every request, and each rebuild fired a `GET /supported` at Coinbase — one
 * outbound call per anonymous request, and a detached promise that killed the
 * process whenever that call failed (audit A2 §C1.1/C1.3).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildApp } from './app.js';
import { resetX402Paywall } from './middleware/x402.js';
import { generateCreditKey } from './lib/api-keys.js';
import { getStatsDB, closeAll } from './lib/db.js';

// Our own bucket in the in-memory rate limiter (100 req/min per IP, shared
// process-wide by the whole suite). TEST-NET-2, never routable.
const IP = '198.51.100.42';
const H = { 'x-real-ip': IP };
const WALLET = '0x00000000000000000000000000000000000000A1';
const VALID_IBAN = 'CH9300762011623852957';

// ─── The stand-in facilitator ────────────────────────────────────────────────

let facilitator: Server;
let facilitatorUrl: string;
let supportedCalls = 0;
/** Flip to make the stand-in refuse, WITHOUT changing its address. */
let facilitatorHealthy = true;

/** A port that was open just long enough to be certain nothing else took it. */
let deadFacilitatorUrl: string;

function supportedPayload(): string {
  return JSON.stringify({
    kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }],
    extensions: [],
    signers: {},
  });
}

const originalEnv = { ...process.env };

beforeAll(async () => {
  facilitator = createServer((req, res) => {
    if (req.url === '/supported') {
      supportedCalls += 1;
      if (!facilitatorHealthy) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end('{"error":"facilitator down"}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(supportedPayload());
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((resolve) => facilitator.listen(0, '127.0.0.1', resolve));
  facilitatorUrl = `http://127.0.0.1:${(facilitator.address() as AddressInfo).port}`;

  const doomed = createServer(() => {});
  await new Promise<void>((resolve) => doomed.listen(0, '127.0.0.1', resolve));
  deadFacilitatorUrl = `http://127.0.0.1:${(doomed.address() as AddressInfo).port}`;
  await new Promise<void>((resolve) => doomed.close(() => resolve()));
});

afterAll(async () => {
  await new Promise<void>((resolve) => facilitator.close(() => resolve()));
  process.env = originalEnv;
  closeAll();
});

/** Paid mode, pointed at the local facilitator. Applied per test, never global. */
function paidMode(url = facilitatorUrl): void {
  process.env.NODE_ENV = 'test';
  process.env.X402_ENABLED = 'true';
  process.env.WALLET_ADDRESS = WALLET;
  process.env.FACILITATOR_URL = url;
  // A stray CDP key would build a Coinbase client and quietly bypass the local
  // facilitator, so every assertion below would be measuring nothing.
  delete process.env.CDP_API_KEY_ID;
  delete process.env.CDP_API_KEY_SECRET;
  delete process.env.IBANFORGE_FREE_MODE;
  resetX402Paywall();
}

beforeEach(() => {
  process.env = { ...originalEnv };
  paidMode();
  supportedCalls = 0;
  facilitatorHealthy = true;
});

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = { ...H, ...(init.headers as Record<string, string> | undefined) };
  return buildApp().request(`https://api.ibanforge.com${path}`, { ...init, headers });
}

function keyCount(): number {
  return (getStatsDB().prepare('SELECT COUNT(*) AS n FROM api_keys').get() as { n: number }).n;
}

// ─── 1. The paywall is built once, not once per request ──────────────────────

describe('the facilitator handshake happens once, not on every request', () => {
  it('serves two paid requests with a single GET /supported', async () => {
    const app = buildApp();
    const first = await app.request(`https://api.ibanforge.com/v1/bic/COBADEFFXXX`, { headers: H });
    const second = await app.request(`https://api.ibanforge.com/v1/bic/COBADEFFXXX`, { headers: H });

    expect(first.status).toBe(402);
    expect(second.status).toBe(402);
    // Before 20/08/2026 this was 2 — one outbound call to Coinbase per
    // anonymous probe, on a rail designed to be initialised once at boot.
    expect(supportedCalls, 'one handshake for the whole process').toBe(1);
  });

  it('never calls the facilitator for a free route, even after the handshake', async () => {
    const app = buildApp();
    // Warm the singleton first: measuring a delta on a cold paywall would pass
    // for a design that has merely not initialised yet.
    await app.request('https://api.ibanforge.com/v1/bic/COBADEFFXXX', { headers: H });
    expect(supportedCalls).toBe(1);

    supportedCalls = 0;
    const free = await app.request(
      `https://api.ibanforge.com/v1/iban/format?iban=${VALID_IBAN}`,
      { headers: H },
    );

    expect(free.status).toBe(200);
    expect(supportedCalls, 'a free route must never reach the payment rail').toBe(0);
  });

  it('serves POST /v1/address/check for free, with the paywall armed and nobody paying', async () => {
    // The FREE claim on that route is published — in the OpenAPI contract
    // (security: []), in /llms.txt under free_forever, and on three docs pages.
    // Its own route test mounts the handler on a bare Hono with no middleware,
    // and the integration probes ran in IBANFORGE_FREE_MODE, where a PAID route
    // is free too. Neither can see a paywall. This one can: paidMode() is armed
    // by beforeEach, the path sits under `app.use('/v1/*', createX402Middleware())`,
    // and no payment header is sent.
    const app = buildApp();
    await app.request('https://api.ibanforge.com/v1/bic/COBADEFFXXX', { headers: H });
    supportedCalls = 0;

    const res = await app.request('https://api.ibanforge.com/v1/address/check', {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheme: 'sps', address: { twn_nm: 'Zurich', ctry: 'CH' } }),
    });

    expect(res.status, 'a published free route must not answer 402').toBe(200);
    expect((await res.json()) as { conforms: boolean }).toMatchObject({ conforms: true });
    expect(supportedCalls, 'a free route must never reach the payment rail').toBe(0);
  });

  it('does not call the facilitator when an API key already authenticates', async () => {
    const key = generateCreditKey(null, 50);
    const res = await req('/v1/iban/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.api_key}` },
      body: JSON.stringify({ iban: VALID_IBAN }),
    });

    expect(res.status).toBe(200);
    expect(supportedCalls).toBe(0);
  });
});

// ─── 2. The order that decides who pays ──────────────────────────────────────

describe('POST /v1/credits/buy/:bundle is gated by x402', () => {
  it('answers 402 and mints NOTHING when nobody paid', async () => {
    const before = keyCount();
    const res = await req('/v1/credits/buy/1k', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(res.status).toBe(402);
    // The assertion the whole extraction exists for: mounting `creditsBuy`
    // before the x402 middleware would answer 201 with a live 1,000-credit key.
    expect(keyCount() - before, 'no key may be minted without a settlement').toBe(0);
    const body = (await res.json()) as { api_key?: string };
    expect(body.api_key).toBeUndefined();
  });

  it('still answers 402 to a valid API key — an allowance never buys an allowance', async () => {
    // Security audit 2026-07-25, finding 1: a free key (200 req/month) bought
    // $80 bundles, and each minted key could start over.
    const key = generateCreditKey(null, 50);
    const before = keyCount();
    const res = await req('/v1/credits/buy/25k', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.api_key}` },
      body: '{}',
    });

    expect(res.status).toBe(402);
    expect(keyCount() - before).toBe(0);
  });

  it('lets a valid API key through on a CONSUMPTION route', async () => {
    const key = generateCreditKey(null, 50);
    const res = await req('/v1/iban/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.api_key}` },
      body: JSON.stringify({ iban: VALID_IBAN }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-credits-remaining')).toBe('49');
  });

  it('leaves the Stripe retrieval endpoint reachable without a Bearer token', async () => {
    // It is mounted BEFORE the api-key and x402 middlewares on purpose: the
    // buyer paid by card and has only a session id. A 402 here would mean a
    // customer who paid cannot collect the key.
    const res = await req('/v1/stripe/key/cs_test_notarealsession');
    expect(res.status).not.toBe(402);
    expect([400, 404]).toContain(res.status);
  });
});

// ─── 3. The public 402, which indexers read ──────────────────────────────────

describe('the 402 an indexer reads', () => {
  it('quotes the credit pack in x402 v2, in the body and in the header alike', async () => {
    const res = await req('/v1/credits/buy/1k', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(402);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as {
      x402Version: number;
      error: string;
      resource: { url: string; mimeType: string; serviceName: string; tags: string[]; iconUrl: string };
      accepts: Array<Record<string, unknown>>;
      extensions?: { bazaar?: Record<string, unknown> };
    };

    expect(body.x402Version).toBe(2);
    expect(body.error).toBe('payment_required');
    expect(body.accepts).toHaveLength(1);
    expect(body.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'eip155:8453',
      // $5.00 in USDC's 6 decimals. A change here is a price change.
      amount: '5000000',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      payTo: WALLET,
      maxTimeoutSeconds: 60,
      extra: { name: 'USD Coin', version: '2' },
    });
    expect(body.resource.url).toBe('https://api.ibanforge.com/v1/credits/buy/1k');
    expect(body.resource.serviceName).toBe('IBANforge');
    expect(body.extensions?.bazaar).toBeDefined();

    // The same requirements travel base64 in the header, and the two must not
    // disagree: llms.txt tells agents either one is authoritative.
    const header = res.headers.get('payment-required');
    expect(header, 'PAYMENT-REQUIRED header').toBeTruthy();
    const decoded = JSON.parse(Buffer.from(header!, 'base64').toString('utf8')) as {
      accepts: Array<Record<string, unknown>>;
      resource: { url: string };
    };
    expect(decoded.accepts).toEqual(body.accepts);
    expect(decoded.resource.url).toBe(body.resource.url);
  });

  it('announces the URL actually requested on a parameterised route, never the template', async () => {
    const res = await req('/v1/bic/COBADEFFXXX');
    expect(res.status).toBe(402);
    const body = (await res.json()) as { resource: { url: string }; accepts: Array<{ amount: string }> };
    expect(body.resource.url).toBe('https://api.ibanforge.com/v1/bic/COBADEFFXXX');
    expect(body.resource.url).not.toContain(':code');
    expect(body.accepts[0].amount).toBe('3000');
  });

  it('quotes a bare GET probe on a POST route instead of answering 405 (piste A)', async () => {
    const res = await req('/v1/iban/validate');
    expect(res.status).toBe(402);
    const body = (await res.json()) as { accepts: Array<{ amount: string }> };
    // The synthetic entry announces the REAL price of the POST route.
    expect(body.accepts[0].amount).toBe('5000');
  });

  // ─── The OpenAPI-template probe, on the two parameterised GET routes ────────
  //
  // A directory that probes before it lists (Aegis & co) substitutes nothing
  // into `/v1/bic/{code}` and calls the template literally. Answering 400 there
  // reads as "this resource is broken" on 2 of our 5 paid routes; answering 402
  // reads as "payable resource, alive". The second is what we serve.
  //
  // 🚨 The ONLY thing that produces it is the mount ORDER in app.ts: the x402
  // middleware (line ~562) runs BEFORE the format guards (lines ~574-575), so
  // an anonymous probe is quoted and never reaches the guard. Move the guards
  // one line up and every one of those probes becomes a 400 again.
  //
  // That regression is invisible to `identifier-guard.test.ts`: it composes a
  // bare `new Hono()` with the guards and the routes and NO x402 middleware, so
  // it asserts 400 by construction and stays green either way. Its header
  // comment still claims that composition is "identique à src/index.ts", which
  // has not been true since piste A (18/08) — see the note there. This is the
  // only place the production contract is checked against the real app.
  const TEMPLATE_PROBES = [
    ['/v1/bic/%7Bcode%7D', '3000'],
    ['/v1/bic/{code}', '3000'],
    ['/v1/ch/clearing/%7Biid%7D', '3000'],
    ['/v1/ch/clearing/{iid}', '3000'],
  ] as const;

  it.each(TEMPLATE_PROBES)(
    'quotes %s instead of calling it a malformed request (piste A)',
    async (path, amount) => {
      const res = await req(path);

      expect(res.status, `${path} must be payable, not broken`).toBe(402);
      const body = (await res.json()) as {
        error: string;
        accepts: Array<{ scheme: string; network: string; amount: string; payTo: string }>;
      };

      // Status alone is not the contract: a 402 with no requirements is a dead
      // end a directory can neither pay nor rank. The requirements are the point.
      expect(body.accepts, `${path} must carry payment requirements`).toHaveLength(1);
      expect(body.accepts[0]).toMatchObject({
        scheme: 'exact',
        network: 'eip155:8453',
        amount,
        payTo: WALLET,
      });
      expect(body.error).toBe('payment_required');
    },
  );

  it('still answers 400 to an authenticated caller — a quote is for probes, not for typos', async () => {
    // The other half of the contract, and the reason the guards were kept
    // rather than deleted: a caller who is PAST the paywall sent a real
    // request, and the useful answer is what is wrong with it, not a bill they
    // have already settled.
    const key = generateCreditKey(null, 50);
    const auth = { Authorization: `Bearer ${key.api_key}` };

    const placeholder = await req('/v1/bic/%7Bcode%7D', { headers: auth });
    expect(placeholder.status).toBe(400);
    expect((await placeholder.json()) as { error: string }).toMatchObject({
      error: 'placeholder_literal',
    });

    const badBic = await req('/v1/bic/!!!', { headers: auth });
    expect(badBic.status).toBe(400);
    expect((await badBic.json()) as { error: string }).toMatchObject({
      error: 'invalid_bic_format',
    });

    const badIid = await req('/v1/ch/clearing/abc', { headers: auth });
    expect(badIid.status).toBe(400);
    expect((await badIid.json()) as { error: string }).toMatchObject({
      error: 'invalid_iid_format',
    });
  });
});

// ─── 4. The switches that must keep working ──────────────────────────────────

describe('IBANFORGE_FREE_MODE', () => {
  it('serves the paid routes free and never touches the facilitator', async () => {
    process.env.X402_ENABLED = 'false';
    process.env.IBANFORGE_FREE_MODE = 'true';
    resetX402Paywall();

    const res = await req('/v1/bic/COBADEFFXXX');
    expect(res.status).toBe(200);
    expect(supportedCalls).toBe(0);
  });
});

// ─── 5. A facilitator outage must not spread ─────────────────────────────────

describe('when the facilitator is unreachable (audit A2 §C1.1)', () => {
  it('keeps serving free routes, with no unhandled rejection', async () => {
    paidMode(deadFacilitatorUrl);

    const rejections: unknown[] = [];
    const capture = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', capture);
    try {
      const res = await req(`/v1/iban/format?iban=${VALID_IBAN}`);
      expect(res.status).toBe(200);
      // Let any promise the SDK might have detached settle before we judge.
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      process.off('unhandledRejection', capture);
    }

    expect(rejections, 'a CDP outage must not reach a route that never needed CDP').toEqual([]);
    expect(supportedCalls).toBe(0);
  });

  it('fails CLOSED on a selling route in production — 503, and nothing minted', async () => {
    paidMode(deadFacilitatorUrl);
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://ibanforge.com';

    const before = keyCount();
    const res = await req('/v1/credits/buy/1k', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(res.status).toBe(503);
    expect(keyCount() - before, 'an outage is never a free credit pack').toBe(0);
  });

  it('retries the handshake on the next request instead of latching the failure', async () => {
    // Same address and same configuration throughout — only the facilitator's
    // health changes. Memoising a rejection here would keep the paywall broken
    // until the next deploy, long after CDP came back.
    facilitatorHealthy = false;
    const app = buildApp();
    await app.request('https://api.ibanforge.com/v1/bic/COBADEFFXXX', { headers: H });
    expect(supportedCalls, 'the failed handshake was attempted').toBe(1);

    facilitatorHealthy = true;
    const res = await app.request('https://api.ibanforge.com/v1/bic/COBADEFFXXX', { headers: H });
    expect(res.status).toBe(402);
    expect(supportedCalls, 'a second handshake was attempted and succeeded').toBe(2);

    // …and once it succeeded, the latch holds again.
    const third = await app.request('https://api.ibanforge.com/v1/bic/COBADEFFXXX', { headers: H });
    expect(third.status).toBe(402);
    expect(supportedCalls).toBe(2);
  });
});

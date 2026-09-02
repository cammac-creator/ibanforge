/**
 * POST /internal/playground — server-side relay for the landing-page demo.
 *
 * The demo used to carry PLAYGROUND_API_KEY inline in the HTML served by GET /
 * (landing.ts interpolated it into `var _pk='…'`). Anyone could lift it with one
 * curl and replay it on the paid surface — but the part that actually hurt is
 * that /v1/keys/revoke and /v1/keys/rotate authenticate with the key ITSELF, so
 * any reader could kill the public demo outright. It would then stay dead until
 * someone noticed and re-provisioned the key by hand.
 *
 * The credential now never leaves the server: the browser posts {type, value}
 * and we replay the call against our own app with the key attached. Same
 * trade-off the Vercel front already made in app/api/playground/route.ts
 * ("server-side only, never exposed to client").
 *
 * Security audit 2026-07-25, finding 4.
 */
import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { extractClientIp, hashIp } from '../lib/stats.js';

interface Target {
  path: string;
  method: 'GET' | 'POST';
  body?: string;
}

/** Whitelist — also what stops the relay from being pointed back at itself. */
const TARGETS: Record<string, (value: string) => Target> = {
  iban: (v) => ({ path: '/v1/iban/validate', method: 'POST', body: JSON.stringify({ iban: v }) }),
  compliance: (v) => ({
    path: '/v1/iban/compliance',
    method: 'POST',
    body: JSON.stringify({ iban: v }),
  }),
  bic: (v) => ({ path: `/v1/bic/${encodeURIComponent(v)}`, method: 'GET' }),
};

// The relay carries a server-side credential, so it needs its own ceiling:
// without one it is just the paid API served free and anonymous to anyone who
// scripts it. High enough that a human clicking through the demo never sees it.
const HOURLY_LIMIT = 30;
const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, { count: number; resetAt: number }>();

setInterval(
  () => {
    const now = Date.now();
    for (const [k, v] of hits) {
      if (now >= v.resetAt) hits.delete(k);
    }
  },
  10 * 60 * 1000,
).unref();

/**
 * Takes the app itself so the relay can re-dispatch through the full middleware
 * chain (api-key → x402 → handler) instead of duplicating handler logic, which
 * for /v1/iban/compliance would mean copying the whole risk-scoring path.
 * Passed as a parameter rather than imported to keep index.ts → routes acyclic.
 */
export function createPlaygroundRelay(app: {
  fetch: (req: Request) => Response | Promise<Response>;
}): Hono<HonoEnv> {
  const playground = new Hono<HonoEnv>();

  playground.post('/internal/playground', async (c) => {
    let payload: { type?: unknown; value?: unknown };
    try {
      payload = await c.req.json<{ type?: unknown; value?: unknown }>();
    } catch {
      return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON.' }, 400);
    }

    const type = typeof payload.type === 'string' ? payload.type : '';
    const value = typeof payload.value === 'string' ? payload.value.trim() : '';
    const build = TARGETS[type];
    if (!build || !value || value.length > 64) {
      return c.json(
        {
          error: 'invalid_request',
          message:
            'Expected {"type":"iban"|"compliance"|"bic","value":"..."} with value of 64 chars or fewer.',
        },
        400,
      );
    }

    const bucket =
      hashIp(
        extractClientIp({
          'x-forwarded-for': c.req.header('x-forwarded-for') ?? null,
          'x-real-ip': c.req.header('x-real-ip') ?? null,
        }),
      ) ?? 'unknown';
    const now = Date.now();
    let win = hits.get(bucket);
    if (!win || now >= win.resetAt) {
      win = { count: 0, resetAt: now + WINDOW_MS };
      hits.set(bucket, win);
    }
    win.count += 1;
    if (win.count > HOURLY_LIMIT) {
      return c.json(
        {
          error: 'playground_rate_limited',
          message:
            `The public demo is capped at ${HOURLY_LIMIT} calls per hour. ` +
            'Generate a free API key (POST /v1/keys/generate, 200 req/month) to keep going.',
        },
        429,
      );
    }

    const key = process.env.PLAYGROUND_API_KEY;
    if (!key) {
      return c.json(
        { error: 'playground_unavailable', message: 'The demo is not configured on this server.' },
        503,
      );
    }

    const target = build(value);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'User-Agent': 'ibanforge-playground',
    };
    // Preserve the visitor's address so the downstream rate limiter and the
    // telemetry attribute the call to them, not to the container.
    const xff = c.req.header('x-forwarded-for');
    if (xff) headers['X-Forwarded-For'] = xff;

    const origin = new URL(c.req.url).origin;
    const upstream = await app.fetch(
      new Request(`${origin}${target.path}`, { method: target.method, headers, body: target.body }),
    );

    // Pass the payload through untouched (the demo renders it verbatim) but
    // drop upstream headers: X-Quota-* would leak the shared key's balance.
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  return playground;
}

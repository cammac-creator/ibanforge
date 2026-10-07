import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { isAdminAuthorized } from './api-keys.js';
import { getBulletin, readMissingBics, resolveBulletinWeek } from '../lib/bulletin.js';
import {
  FEED_BODY_MAX_BYTES,
  feedWeekAt,
  isFeedSource,
  validateFeedPayload,
  writeFeed,
} from '../lib/bulletin-feed.js';
import { addSessionProposal, isAnswer, recordAnswer } from '../lib/bulletin-decisions.js';

/**
 * The Monday bulletin (Claude-Alain's approval of 28.09.2026, steps A1 and A2).
 *
 * `GET /v1/admin/bulletin?week=AAAA-Wss`: one Swiss week, the last complete one by
 * default. Read-only: every block reads what already runs (`src/lib/bulletin.ts`
 * names each source), and a block that cannot be read says `unread` instead of
 * showing zeros.
 *
 * AGGREGATES only: no address, no key, no hash. Never cached: an intermediary that
 * kept the body would show a frozen week to someone who believes they read today's
 * state. The header is set before the secret is checked, so the 401 carries it too.
 *
 * Step A2 adds three writers, each behind its own door:
 *
 *  - `POST /internal/bulletin/:source`: the two Monday veilles deposit their summary
 *    (`bulletin-feed.ts`), with `BULLETIN_FEED_TOKEN`;
 *  - `POST /v1/admin/bulletin/proposals`: the main session adds a proposal;
 *  - `POST /v1/admin/bulletin/answers`: Oui / Plus tard / Non, from the dashboard
 *    page through the site's own route, which keeps the admin secret server side.
 */
export const adminBulletin = new Hono();

adminBulletin.get('/v1/admin/bulletin', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return c.json(await getBulletin({ week: c.req.query('week') ?? null }));
});

// ─── The veilles' deposit ────────────────────────────────────────────────────

/**
 * ⚠️ BULLETIN_FEED_TOKEN, never HEARTBEAT_TOKEN and never ADMIN_SECRET.
 *
 * The token sits in the GitHub Actions secrets of a PUBLIC repository. Its own name
 * gives it the right blast radius: if it leaks, the attacker can write three lines
 * and a score into a private page, and nothing else; it neither silences a dead
 * man's switch (the heartbeat token) nor opens the dashboard (the admin secret).
 * Unset, the door refuses everything: it never opens by default.
 */
function isFeedAuthorized(provided: string | undefined): boolean {
  const expected = process.env.BULLETIN_FEED_TOKEN;
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * 🚨 The answer is `{ ok: true }` and nothing more, and a refusal names a short
 * code, never what was received: the workflows that call this run in a public
 * repository, and the lines they deposit can carry real figures.
 */
adminBulletin.post('/internal/bulletin/:source', async (c) => {
  c.header('Cache-Control', 'no-store');
  // The refusal is silent on which of the two (token or source) is wrong.
  if (!isFeedAuthorized(c.req.header('x-bulletin-token'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const source = c.req.param('source');
  if (!isFeedSource(source)) return c.json({ error: 'unknown_source' }, 404);
  const declared = Number(c.req.header('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > FEED_BODY_MAX_BYTES) {
    return c.json({ error: 'payload_too_large' }, 413);
  }
  const text = await c.req.text();
  if (Buffer.byteLength(text, 'utf8') > FEED_BODY_MAX_BYTES) {
    return c.json({ error: 'payload_too_large' }, 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const valid = validateFeedPayload(source, body);
  if (!valid.ok) return c.json({ error: valid.error }, 400);
  writeFeed(source, feedWeekAt(Date.now()).label, valid.payload);
  return c.json({ ok: true });
});

// ─── Proposals and answers ──────────────────────────────────────────────────

async function jsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

/**
 * A proposal of the main session: `{ title, detail?, origin? }`, plain text, shown
 * from the bulletin of the last complete week until it is answered.
 */
adminBulletin.post('/v1/admin/bulletin/proposals', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const body = await jsonBody(c);
  const week = resolveBulletinWeek(null, Date.now()).week;
  const result = addSessionProposal(body, week);
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json(result, 201);
});

/**
 * An answer to a proposal SHOWN by this Monday's bulletin: `{ key, answer }`, where
 * the answer is `oui`, `plus_tard` or `non`. A key the bulletin does not show answers
 * 404: one does not answer a proposal one cannot see.
 */
adminBulletin.post('/v1/admin/bulletin/answers', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const body = await jsonBody(c);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const { key, answer } = body as Record<string, unknown>;
  if (typeof key !== 'string' || key.length > 80 || !isAnswer(answer)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const now = Date.now();
  const { week } = resolveBulletinWeek(null, now);
  let bics: ReturnType<typeof readMissingBics> | null = null;
  try {
    bics = readMissingBics(week);
  } catch {
    // Unreadable, the rule on missing BIC codes is simply not applied, as on the page.
  }
  const result = recordAnswer(key, answer, week, bics, now);
  if (!result.ok) return c.json({ error: result.error }, 404);
  return c.json(result);
});

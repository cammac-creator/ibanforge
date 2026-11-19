import { Hono } from 'hono';
import { authorizeAdmin } from '../lib/admin-auth.js';
import { extractClientIp } from '../lib/stats.js';
import { parseWebEvent, recordWebEvent, webEventsSummary } from '../lib/web-events.js';
import {
  PAGE_VIEW_EVENT,
  pageViewsSummary,
  parsePageView,
  recordPageView,
  shouldSkipView,
} from '../lib/page-views.js';

/**
 * POST /v1/web/events — one line per landing-page action (src/lib/web-events).
 * GET  /v1/admin/web-events?days=30 — the counts, admin only.
 *
 * The browser posts with `sendBeacon` and a text/plain body, which needs no
 * CORS preflight and survives the navigation the click causes; the body is
 * parsed as JSON whatever its declared type. The answer is always 204 for a
 * well-formed event and 400 otherwise: there is nothing to tell a browser.
 *
 * The same endpoint carries the visit counter (src/lib/page-views.ts): a body named
 * `view:page` is counted by page TEMPLATE and day, and is never written to `web_events`
 * (which keeps a time and a referring host). A browser that sends `DNT: 1` or `Sec-GPC: 1`,
 * and a script or crawler that names itself, is answered 204 and not counted.
 *
 * A page can only send so much: sixty events per ten minutes and address,
 * counted in memory, which is the rhythm of a human clicking around and
 * far below anything a loop could do to the table.
 */
export const webEvents = new Hono();

export const WEB_EVENTS_PER_WINDOW = 60;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_BODY = 1024;
const recent = new Map<string, number[]>();

export function resetWebEventLimiter() {
  recent.clear();
}

function allowed(ip: string): boolean {
  const now = Date.now();
  const stamps = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (stamps.length >= WEB_EVENTS_PER_WINDOW) {
    recent.set(ip, stamps);
    return false;
  }
  stamps.push(now);
  recent.set(ip, stamps);
  // the map must not grow with every address ever seen
  if (recent.size > 5000) {
    for (const [k, v] of recent) if (v.every((t) => now - t >= WINDOW_MS)) recent.delete(k);
  }
  return true;
}

webEvents.post('/v1/web/events', async (c) => {
  const text = await c.req.text();
  if (text.length > MAX_BODY) return c.body(null, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const isView =
    !!raw && typeof raw === 'object' && (raw as Record<string, unknown>).name === PAGE_VIEW_EVENT;
  const view = isView ? parsePageView(raw) : null;
  const event = isView ? null : parseWebEvent(raw);
  if (!view && !event) return c.json({ error: 'invalid_event' }, 400);
  const ip =
    extractClientIp({
      'x-forwarded-for': c.req.header('x-forwarded-for'),
      'x-real-ip': c.req.header('x-real-ip'),
    }) ?? 'unknown';
  if (!allowed(ip)) return c.body(null, 429);
  if (view) {
    const skip = shouldSkipView({
      dnt: c.req.header('dnt'),
      secGpc: c.req.header('sec-gpc'),
      userAgent: c.req.header('user-agent'),
    });
    if (!skip) recordPageView(view);
    return c.body(null, 204);
  }
  recordWebEvent(event!);
  return c.body(null, 204);
});

webEvents.get('/v1/admin/web-events', (c) => {
  if (!authorizeAdmin(c)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const raw = Number.parseInt(c.req.query('days') ?? '30', 10);
  const days = Number.isFinite(raw) ? Math.max(1, Math.min(365, raw)) : 30;
  // Read apart, never joined: the visit counter shares no table with the click log.
  return c.json({ ...webEventsSummary(days), page_views: pageViewsSummary(days) });
});

/**
 * Admin API for the CRM "Forums" tab: scored community threads worth
 * answering, and marketplace presence. Same X-Admin-Secret contract as the
 * other /v1/admin routes; the Vercel dashboard proxies to here.
 *
 * POST /v1/admin/forum-scan is fire-and-forget on purpose: a full scan takes
 * up to a minute (GitHub search is throttled to stay under the
 * unauthenticated ceiling), which outlives comfortable proxy timeouts. The
 * client polls the list endpoint, which carries scanning/last_report state.
 */
import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { getStatsDB } from '../lib/db.js';
import { ensureMarketplaceRows, lastScanInfo, runScan } from '../lib/forum-radar-server.js';

const adminForums = new Hono();

function isAdminAuthorized(provided: string | undefined): boolean {
  const expected = process.env.ADMIN_SECRET;
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

const THREAD_STATUSES = new Set(['new', 'to_answer', 'drafted', 'planned', 'posted', 'dismissed']);
const THREAD_SOURCES = new Set(['stackoverflow', 'money_se', 'github', 'hn', 'reddit', 'manual']);

adminForums.get('/v1/admin/forum-threads', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = getStatsDB();
  const status = c.req.query('status');
  const limit = Math.max(1, Math.min(500, parseInt(c.req.query('limit') ?? '200', 10)));

  const where = status && THREAD_STATUSES.has(status) ? 'WHERE status = ?' : '';
  const params = where ? [status, limit] : [limit];
  const rows = db
    .prepare(
      `SELECT * FROM forum_threads ${where}
       ORDER BY needs_attention DESC,
                CASE status WHEN 'new' THEN 0 WHEN 'to_answer' THEN 1 WHEN 'drafted' THEN 2
                            WHEN 'planned' THEN 3 WHEN 'posted' THEN 4 ELSE 5 END,
                score DESC, first_seen DESC
       LIMIT ?`,
    )
    .all(...params);

  const counts = db
    .prepare(`SELECT status, COUNT(*) AS n FROM forum_threads GROUP BY status`)
    .all() as Array<{ status: string; n: number }>;

  return c.json({
    threads: rows,
    counts: Object.fromEntries(counts.map((r) => [r.status, r.n])),
    scan: lastScanInfo(),
  });
});

adminForums.post('/v1/admin/forum-threads', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!/^https:\/\//.test(url) || !title) {
    return c.json({ error: 'invalid_input', message: 'url (https) et title requis' }, 400);
  }
  const source = typeof body.source === 'string' && THREAD_SOURCES.has(body.source) ? body.source : 'manual';
  const status = typeof body.status === 'string' && THREAD_STATUSES.has(body.status) ? body.status : 'to_answer';
  const s = (k: string, max = 10_000): string | null => {
    const v = body[k];
    return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
  };
  const db = getStatsDB();
  db.prepare(
    `INSERT INTO forum_threads
       (url, source, title, excerpt, lang, score, score_detail, activity, thread_created_at,
        status, planned_for, draft, draft_fr, summary_fr, posted_url, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET
       title = excluded.title,
       status = excluded.status,
       planned_for = COALESCE(excluded.planned_for, forum_threads.planned_for),
       draft = COALESCE(excluded.draft, forum_threads.draft),
       draft_fr = COALESCE(excluded.draft_fr, forum_threads.draft_fr),
       summary_fr = COALESCE(excluded.summary_fr, forum_threads.summary_fr),
       posted_url = COALESCE(excluded.posted_url, forum_threads.posted_url),
       notes = COALESCE(excluded.notes, forum_threads.notes),
       updated_at = datetime('now')`,
  ).run(
    url,
    source,
    title.slice(0, 300),
    s('excerpt', 500),
    typeof body.lang === 'string' && ['en', 'de', 'fr'].includes(body.lang) ? body.lang : 'en',
    Number.isFinite(Number(body.score)) ? Math.max(0, Math.min(100, Number(body.score))) : 50,
    s('score_detail', 300),
    s('activity', 200),
    s('thread_created_at', 10),
    status,
    s('planned_for', 10),
    s('draft'),
    s('draft_fr'),
    s('summary_fr', 2000),
    s('posted_url', 500),
    s('notes', 2000),
  );
  const row = db.prepare('SELECT * FROM forum_threads WHERE url = ?').get(url);
  return c.json({ thread: row });
});

adminForums.patch('/v1/admin/forum-threads/:id', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  const takeStr = (k: string, max: number): void => {
    if (typeof body[k] === 'string') {
      sets.push(`${k} = ?`);
      vals.push((body[k] as string).slice(0, max));
    }
  };
  if (typeof body.status === 'string' && THREAD_STATUSES.has(body.status)) {
    sets.push('status = ?');
    vals.push(body.status);
    // The daily-guardrail clock starts at the FIRST transition to posted.
    if (body.status === 'posted') sets.push(`posted_at = COALESCE(posted_at, datetime('now'))`);
  }
  if (typeof body.lang === 'string' && ['en', 'de', 'fr'].includes(body.lang)) {
    sets.push('lang = ?');
    vals.push(body.lang);
  }
  if (body.needs_attention === 0 || body.needs_attention === 1) {
    sets.push('needs_attention = ?');
    vals.push(body.needs_attention);
  }
  takeStr('draft', 10_000);
  takeStr('draft_fr', 10_000);
  takeStr('summary_fr', 2000);
  takeStr('planned_for', 10);
  takeStr('posted_url', 500);
  takeStr('notes', 2000);
  if (!sets.length) return c.json({ error: 'no_supported_field' }, 400);

  sets.push(`updated_at = datetime('now')`);
  const res = getStatsDB()
    .prepare(`UPDATE forum_threads SET ${sets.join(', ')} WHERE id = ?`)
    .run(...vals, id);
  if (res.changes === 0) return c.json({ error: 'not_found' }, 404);
  const row = getStatsDB().prepare('SELECT * FROM forum_threads WHERE id = ?').get(id);
  return c.json({ thread: row });
});

adminForums.get('/v1/admin/forum-marketplaces', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  ensureMarketplaceRows();
  const db = getStatsDB();
  const rows = db
    .prepare(
      `SELECT * FROM marketplace_checks
       ORDER BY CASE status WHEN 'absent' THEN 0 WHEN 'pending' THEN 1 WHEN 'unknown' THEN 2
                            WHEN 'listed' THEN 3 WHEN 'manual' THEN 4 ELSE 5 END, name`,
    )
    .all();
  const events = db
    .prepare(`SELECT * FROM marketplace_events ORDER BY created_at DESC, id DESC LIMIT 10`)
    .all();
  return c.json({ marketplaces: rows, events, scan: lastScanInfo() });
});

adminForums.patch('/v1/admin/forum-marketplaces/:slug', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const slug = c.req.param('slug');
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof body.notes === 'string') {
    sets.push('notes = ?');
    vals.push(body.notes.slice(0, 2000));
  }
  // Manual rows carry an operator-set status; automated rows are the radar's.
  if (typeof body.status === 'string' && ['listed', 'absent', 'pending', 'dead', 'manual'].includes(body.status)) {
    sets.push('status = ?');
    vals.push(body.status);
  }
  if (!sets.length) return c.json({ error: 'no_supported_field' }, 400);
  sets.push(`updated_at = datetime('now')`);
  const res = getStatsDB()
    .prepare(`UPDATE marketplace_checks SET ${sets.join(', ')} WHERE slug = ?`)
    .run(...vals, slug);
  if (res.changes === 0) return c.json({ error: 'not_found' }, 404);
  const row = getStatsDB().prepare('SELECT * FROM marketplace_checks WHERE slug = ?').get(slug);
  return c.json({ marketplace: row });
});

adminForums.post('/v1/admin/forum-scan', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let what: 'threads' | 'marketplaces' | 'all' = 'all';
  try {
    const body = await c.req.json<{ what?: string }>();
    if (body.what === 'threads' || body.what === 'marketplaces') what = body.what;
  } catch {
    // empty body = full scan
  }
  const info = lastScanInfo();
  if (info.scanning) return c.json({ started: false, reason: 'scan déjà en cours' }, 409);
  // Fire and forget; errors land in the persisted report, never in the response.
  void runScan(what, true).catch((err) =>
    console.error('[forum-radar] manual scan failed:', err instanceof Error ? err.message : err),
  );
  return c.json({ started: true, what });
});

export { adminForums };

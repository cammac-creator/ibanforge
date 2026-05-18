import { Hono } from 'hono';
import { getStatsDB } from '../lib/db.js';

const adminScanners = new Hono();

function checkAuth(authHeader: string | undefined): boolean {
  const token = process.env.STATS_TOKEN;
  if (!token) return false;
  return authHeader === `Bearer ${token}`;
}

interface ScannerRow {
  ip_hash: string | null;
  user_agent: string | null;
  client_kind: string | null;
  total: number;
  s2xx: number;
  s4xx: number;
  s402: number;
  s400: number;
  distinct_paths: number;
  first_seen: string;
  last_seen: string;
}

interface DrillRow {
  method: string;
  path: string;
  status: number;
  count: number;
}

adminScanners.get('/admin/scanners', (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Admin endpoints require Bearer STATS_TOKEN.' }, 403);
  }

  const days = Math.max(1, Math.min(30, parseInt(c.req.query('days') ?? '7', 10)));
  const limit = Math.max(1, Math.min(200, parseInt(c.req.query('limit') ?? '50', 10)));
  const focusIpHash = c.req.query('ip_hash');

  const db = getStatsDB();

  if (focusIpHash) {
    const breakdown = db
      .prepare(
        `SELECT method, path, status, COUNT(*) as count
         FROM request_log
         WHERE created_at >= datetime('now', ?)
           AND ip_hash = ?
         GROUP BY method, path, status
         ORDER BY count DESC
         LIMIT 30`,
      )
      .all(`-${days} days`, focusIpHash) as DrillRow[];

    const summary = db
      .prepare(
        `SELECT user_agent, client_kind, COUNT(*) as total,
                MIN(created_at) as first_seen, MAX(created_at) as last_seen
         FROM request_log
         WHERE created_at >= datetime('now', ?)
           AND ip_hash = ?
         GROUP BY user_agent, client_kind
         ORDER BY total DESC`,
      )
      .all(`-${days} days`, focusIpHash);

    return c.json({
      period_days: days,
      ip_hash: focusIpHash,
      user_agents: summary,
      paths: breakdown,
    });
  }

  const rows = db
    .prepare(
      `SELECT
         ip_hash,
         user_agent,
         client_kind,
         COUNT(*) as total,
         SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as s2xx,
         SUM(CASE WHEN status >= 400 AND status < 500 THEN 1 ELSE 0 END) as s4xx,
         SUM(CASE WHEN status = 402 THEN 1 ELSE 0 END) as s402,
         SUM(CASE WHEN status = 400 THEN 1 ELSE 0 END) as s400,
         COUNT(DISTINCT path) as distinct_paths,
         MIN(created_at) as first_seen,
         MAX(created_at) as last_seen
       FROM request_log
       WHERE created_at >= datetime('now', ?)
         AND ip_hash IS NOT NULL
       GROUP BY ip_hash, user_agent
       ORDER BY total DESC
       LIMIT ?`,
    )
    .all(`-${days} days`, limit) as ScannerRow[];

  const totalLogged = (db.prepare(
    `SELECT COUNT(*) as c FROM request_log WHERE created_at >= datetime('now', ?) AND ip_hash IS NOT NULL`,
  ).get(`-${days} days`) as { c: number }).c;

  const totalAnonymous = (db.prepare(
    `SELECT COUNT(*) as c FROM request_log WHERE created_at >= datetime('now', ?) AND ip_hash IS NULL`,
  ).get(`-${days} days`) as { c: number }).c;

  return c.json({
    period_days: days,
    total_requests_with_ip: totalLogged,
    total_requests_without_ip: totalAnonymous,
    note:
      totalAnonymous > 0 && totalLogged === 0
        ? 'No IP-logged requests yet — the new ip_hash column was added recently. Data will accumulate over the next 24-72h.'
        : undefined,
    sources: rows.map((r) => ({
      ip_hash: r.ip_hash,
      user_agent: r.user_agent,
      client_kind: r.client_kind,
      total: r.total,
      s2xx: r.s2xx,
      s4xx: r.s4xx,
      s402: r.s402,
      s400: r.s400,
      distinct_paths: r.distinct_paths,
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      drill_down: `?ip_hash=${r.ip_hash}&days=${days}`,
    })),
    docs:
      'Pass Bearer STATS_TOKEN. Aggregates request_log by (ip_hash, user_agent) over the last N days (1-30, default 7). Add ?ip_hash=... to drill into paths/methods for one source. IPs are salted-SHA256 truncated; never reversible.',
  });
});

export { adminScanners };

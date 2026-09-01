import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { getStatsDB } from '../lib/db.js';
import { registerInternalEmailFn } from '../lib/internal-accounts.js';

/**
 * GET /v1/ops/recent — the live-traffic feed of the village page (/live).
 *
 * Serves the last operations as exactly four public fields: id, timestamp,
 * type, country, success. The operations table also carries error_detail
 * (first characters of a failed input) and key_prefix — neither may ever
 * appear here, which is why the SELECT names its columns instead of `*`.
 *
 * Our own demonstrations stay off the road (owner's decision, 01/09/2026):
 * an operation made by an internal key — the site playground, the /live
 * village itself, the probes — is not a customer walking the pipeline, and
 * the village must never show the traffic it generates. The same
 * is_internal_email() the funnel uses decides; keyless x402 calls stay.
 *
 * Same exposure level as the public /stats page (aggregates of the same
 * table), free on purpose: every poll is one indexed LIMIT-50 read on a WAL
 * database — cheaper than a cache layer whose staleness would hide fresh
 * rows from the ?after cursor.
 */

const WINDOW = 50;

interface OpRow {
  id: number;
  t: string;
  type: string;
  country: string | null;
  success: 0 | 1;
}

const opsRecent = new Hono<HonoEnv>();

opsRecent.get('/v1/ops/recent', (c) => {
  const afterRaw = Number(c.req.query('after') ?? 0);
  const after = Number.isFinite(afterRaw) && afterRaw > 0 ? Math.floor(afterRaw) : 0;
  const db = getStatsDB();
  registerInternalEmailFn(db);
  const rows = db
    .prepare(
      `SELECT id, created_at AS t, operation_type AS type, country_code AS country, success
       FROM operations
       WHERE id > ?
         AND (key_prefix IS NULL
              OR key_prefix NOT IN (SELECT key_prefix FROM api_keys WHERE is_internal_email(email)))
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(after, WINDOW) as OpRow[];
  return c.json({
    ops: rows.map((r) => ({ ...r, success: r.success === 1 })),
  });
});

export { opsRecent };

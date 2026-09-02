import { Hono } from 'hono';
import { getStatsDB } from '../lib/db.js';
import { hashIp, extractClientIp } from '../lib/stats.js';
import { isAdminAuthorized } from './api-keys.js';

const feedback = new Hono();

interface FeedbackBody {
  tx_hash?: string;
  endpoint?: string;
  error_type?:
    | 'wrong_validation'
    | 'stale_bic'
    | 'missing_data'
    | 'incorrect_classification'
    | 'latency'
    | 'other';
  expected?: unknown;
  got?: unknown;
  notes?: string;
  contact?: string;
  agent?: string;
}

const VALID_ERROR_TYPES = new Set([
  'wrong_validation',
  'stale_bic',
  'missing_data',
  'incorrect_classification',
  'latency',
  'other',
]);

function ensureFeedbackTable() {
  const db = getStatsDB();
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      tx_hash TEXT,
      endpoint TEXT,
      error_type TEXT,
      expected TEXT,
      got TEXT,
      notes TEXT,
      contact TEXT,
      agent TEXT,
      ip_hash TEXT,
      status TEXT NOT NULL DEFAULT 'open'
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
    CREATE INDEX IF NOT EXISTS idx_feedback_endpoint ON feedback(endpoint);
    CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
  `);

  // Migration: this table used to store the raw client IP, while the privacy
  // policy has always promised "only a salted hash, never the raw address".
  // Hash what exists, then drop the raw column so the promise is structural.
  const cols = db.prepare(`PRAGMA table_info(feedback)`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === 'ip')) {
    if (!cols.some((c) => c.name === 'ip_hash')) {
      db.exec(`ALTER TABLE feedback ADD COLUMN ip_hash TEXT`);
    }
    const rows = db.prepare(`SELECT id, ip FROM feedback WHERE ip IS NOT NULL`).all() as Array<{
      id: number;
      ip: string;
    }>;
    const set = db.prepare(`UPDATE feedback SET ip_hash = ? WHERE id = ?`);
    db.transaction(() => {
      for (const r of rows) set.run(hashIp(r.ip), r.id);
      db.exec(`ALTER TABLE feedback DROP COLUMN ip`);
    })();
  }
}

// 🚨 This DDL runs as an import side effect, which is what made a corrupt
// `stats.sqlite` fatal: the throw happened while `src/app.ts` was still being
// loaded, so `serve()` never ran, no listener existed and `/health` could not
// even answer 503. Railway then stopped restarting after 3 attempts and nothing
// outside the dead process noticed (audit 2026-09-01, finding PERF-03).
//
// Swallowing it here is not hiding the failure: `getStatsDB()` records the
// cause in `getStatsDbState()`, `/health` turns it into a diagnosed 503 and
// `index.ts` raises an OPS alert at boot. On a healthy database nothing changes.
try {
  ensureFeedbackTable();
} catch (err) {
  console.error(
    '[feedback] table init failed — stats database unusable:',
    err instanceof Error ? err.message : err,
  );
}

/**
 * Shared insert behind POST /v1/feedback and the MCP send_feedback tool.
 * The MCP path has no HTTP context in the tool callback, so ipHash is null
 * there — the column is nullable for exactly that reason.
 */
/**
 * Field caps for a feedback row. POST /v1/feedback is unauthenticated and had
 * no length bound (unlike email-messages, which clips): a caller could store
 * arbitrarily large strings, ~100/min, and grow stats.sqlite unchecked. The
 * MCP tool already caps via its zod schema; this is defence in depth on BOTH
 * write paths.
 */
function clip(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  return s.length > max ? s.slice(0, max) : s;
}

export function recordFeedbackRow(p: {
  tx_hash?: string | null;
  endpoint?: string | null;
  error_type: string;
  expected?: unknown;
  got?: unknown;
  notes?: string | null;
  contact?: string | null;
  agent?: string | null;
  ipHash: string | null;
}): number {
  const info = getStatsDB()
    .prepare(
      `INSERT INTO feedback (tx_hash, endpoint, error_type, expected, got, notes, contact, agent, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      clip(p.tx_hash, 120),
      clip(p.endpoint, 200),
      p.error_type,
      p.expected !== undefined ? clip(JSON.stringify(p.expected), 2000) : null,
      p.got !== undefined ? clip(JSON.stringify(p.got), 2000) : null,
      clip(p.notes, 4000),
      clip(p.contact, 255),
      clip(p.agent, 120),
      p.ipHash,
    );
  return Number(info.lastInsertRowid);
}

/**
 * How many feedback rows this source inserted in the last `hours`. Powers the
 * per-source insert quota on the unauthenticated POST route, so a single
 * source cannot flood the table faster than the global 100/min would allow
 * over a sustained window.
 */
export function countRecentFeedback(ipHash: string, hours: number): number {
  return (
    getStatsDB()
      .prepare(
        "SELECT COUNT(*) AS n FROM feedback WHERE ip_hash = ? AND created_at >= datetime('now', ?)",
      )
      .get(ipHash, `-${hours} hours`) as { n: number }
  ).n;
}

/** Max feedback rows one source may insert per hour (flood cap). */
export const FEEDBACK_INSERTS_PER_SOURCE_HOUR = 20;

/** Error types a report may carry — shared with the MCP tool's schema. */
export const FEEDBACK_ERROR_TYPES = [
  'wrong_validation',
  'stale_bic',
  'missing_data',
  'incorrect_classification',
  'latency',
  'other',
] as const;

/**
 * POST /v1/feedback — free, no auth, no payment
 *
 * Lets agents and humans report incorrect data, missing entries, latency
 * spikes or other issues. Powers automatic refund decisions for x402
 * transactions when the report is verified.
 *
 * Body example:
 * {
 *   "tx_hash": "0xabc...",       // x402 transaction hash (optional)
 *   "endpoint": "/v1/bic/UBSWCHZH80A",
 *   "error_type": "stale_bic",
 *   "expected": "UBS Switzerland AG",
 *   "got": "UBS AG (legacy)",
 *   "notes": "Bank merged 2023-06-01",
 *   "contact": "agent@example.com",
 *   "agent": "claude-3.5-sonnet"
 * }
 */
feedback.post('/v1/feedback', async (c) => {
  let body: FeedbackBody;
  try {
    body = (await c.req.json()) as FeedbackBody;
  } catch {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON.' }, 400);
  }

  if (!body || typeof body !== 'object') {
    return c.json({ error: 'invalid_request', message: 'Body must be a JSON object.' }, 400);
  }

  const errorType = body.error_type ?? 'other';
  if (!VALID_ERROR_TYPES.has(errorType)) {
    return c.json(
      {
        error: 'invalid_error_type',
        message: `error_type must be one of: ${Array.from(VALID_ERROR_TYPES).join(', ')}`,
      },
      400,
    );
  }

  if (!body.endpoint && !body.notes && !body.tx_hash) {
    return c.json(
      {
        error: 'insufficient_detail',
        message: 'Provide at least one of: endpoint, tx_hash, or notes.',
      },
      400,
    );
  }

  // Spoof-resistant (trusted last hop), same rule as the rest of the app —
  // the previous first-XFF-segment read was caller-controlled, which also
  // undermined the per-source quota below.
  const ip =
    extractClientIp({
      'x-forwarded-for': c.req.header('x-forwarded-for') ?? null,
      'x-real-ip': c.req.header('x-real-ip') ?? null,
    }) ?? 'unknown';
  const ipHash = hashIp(ip);

  // Per-source insert quota: bound how fast one source can grow the table.
  if (ipHash && countRecentFeedback(ipHash, 1) >= FEEDBACK_INSERTS_PER_SOURCE_HOUR) {
    return c.json(
      {
        error: 'feedback_rate_limited',
        message: `At most ${FEEDBACK_INSERTS_PER_SOURCE_HOUR} feedback reports per hour. Try again later.`,
      },
      429,
    );
  }

  const rowId = recordFeedbackRow({
    tx_hash: body.tx_hash ?? null,
    endpoint: body.endpoint ?? null,
    error_type: errorType,
    expected: body.expected,
    got: body.got,
    notes: body.notes ?? null,
    contact: body.contact ?? null,
    agent: body.agent ?? null,
    ipHash,
  });

  return c.json(
    {
      ok: true,
      id: rowId,
      message:
        'Feedback received. We review reports daily; if a refund is owed for tx_hash, you will receive it on-chain within 72h.',
      status: 'open',
      next_steps: {
        check_status: `GET /v1/feedback/${rowId}`,
        documentation: 'https://ibanforge.com/docs#feedback',
      },
    },
    201,
  );
});

/**
 * GET /v1/feedback/:id — free, public read of feedback status
 * Returns minimal info; full notes are private.
 */
feedback.get('/v1/feedback/:id', (c) => {
  const id = c.req.param('id');
  if (!/^\d+$/.test(id)) {
    return c.json({ error: 'invalid_id', message: 'Feedback id must be numeric.' }, 400);
  }

  const db = getStatsDB();
  const row = db
    .prepare('SELECT id, created_at, endpoint, error_type, status FROM feedback WHERE id = ?')
    .get(Number(id)) as
    | {
        id: number;
        created_at: string;
        endpoint: string | null;
        error_type: string;
        status: string;
      }
    | undefined;

  if (!row) {
    return c.json({ error: 'not_found', message: `Feedback ${id} not found.` }, 404);
  }

  return c.json(row);
});

/**
 * GET /v1/admin/feedback — the reader this loop never had.
 *
 * send_feedback has been free (even past the cap) since 21/08/2026, on the
 * promise printed in the MCP instructions: "a human reads every report". But
 * the only read paths were the public status probe above and the raw table —
 * no endpoint listed reports, so nothing could surface them to the human the
 * promise names. An input channel without a reader is indistinguishable from
 * no channel: the reports accumulated invisibly, exactly like api_keys.source
 * did (see the 30/08 attribution finding). This closes the loop.
 *
 * Full rows here, unlike the minimal public probe: this side is authenticated
 * and the notes/expected/got fields are the whole point of reading a report.
 */
feedback.get('/v1/admin/feedback', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const statusFilter = c.req.query('status');
  const rawLimit = Number(c.req.query('limit') ?? '50');
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, Math.floor(rawLimit))) : 50;
  const db = getStatsDB();
  const rows = statusFilter
    ? db
        .prepare(
          `SELECT id, created_at, tx_hash, endpoint, error_type, expected, got, notes, contact, agent, status
           FROM feedback WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(statusFilter, limit)
    : db
        .prepare(
          `SELECT id, created_at, tx_hash, endpoint, error_type, expected, got, notes, contact, agent, status
           FROM feedback ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(limit);
  const open = (
    db.prepare(`SELECT COUNT(*) AS n FROM feedback WHERE status = 'open'`).get() as { n: number }
  ).n;
  return c.json({ open, reports: rows });
});

/**
 * POST /v1/admin/feedback/status — mark one report handled (or reopen it).
 *
 * Without a "done" gesture the reader above recreates the mailbox failure the
 * CRM just fixed: a list that only ever grows stops being read. Two states
 * only, 'open' and 'done' — a triage taxonomy can come the day the volume
 * asks for one.
 */
feedback.post('/v1/admin/feedback/status', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { id?: unknown; status?: unknown };
  try {
    body = await c.req.json<{ id?: unknown; status?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const id = typeof body.id === 'number' && Number.isInteger(body.id) ? body.id : null;
  const status = body.status === 'open' || body.status === 'done' ? body.status : null;
  if (id === null || status === null) {
    return c.json(
      { error: 'invalid_body', message: "id must be an integer and status 'open' or 'done'" },
      400,
    );
  }
  const info = getStatsDB().prepare('UPDATE feedback SET status = ? WHERE id = ?').run(status, id);
  return c.json({ updated: info.changes });
});

export { feedback };

import { Hono } from 'hono';
import { getStatsDB } from '../lib/db.js';

const feedback = new Hono();

interface FeedbackBody {
  tx_hash?: string;
  endpoint?: string;
  error_type?: 'wrong_validation' | 'stale_bic' | 'missing_data' | 'incorrect_classification' | 'latency' | 'other';
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
      ip TEXT,
      status TEXT NOT NULL DEFAULT 'open'
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
    CREATE INDEX IF NOT EXISTS idx_feedback_endpoint ON feedback(endpoint);
    CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
  `);
}

ensureFeedbackTable();

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

  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    'unknown';

  const db = getStatsDB();
  const stmt = db.prepare(
    `INSERT INTO feedback (tx_hash, endpoint, error_type, expected, got, notes, contact, agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const info = stmt.run(
    body.tx_hash ?? null,
    body.endpoint ?? null,
    errorType,
    body.expected !== undefined ? JSON.stringify(body.expected) : null,
    body.got !== undefined ? JSON.stringify(body.got) : null,
    body.notes ?? null,
    body.contact ?? null,
    body.agent ?? null,
    ip,
  );

  return c.json(
    {
      ok: true,
      id: info.lastInsertRowid,
      message:
        'Feedback received. We review reports daily; if a refund is owed for tx_hash, you will receive it on-chain within 72h.',
      status: 'open',
      next_steps: {
        check_status: `GET /v1/feedback/${info.lastInsertRowid}`,
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
    | { id: number; created_at: string; endpoint: string | null; error_type: string; status: string }
    | undefined;

  if (!row) {
    return c.json({ error: 'not_found', message: `Feedback ${id} not found.` }, 404);
  }

  return c.json(row);
});

export { feedback };

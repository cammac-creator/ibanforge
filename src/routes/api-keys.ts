import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { generateApiKey, validateApiKey, getUsage, revokeApiKey, rotateApiKey } from '../lib/api-keys.js';
import { getStatsDB } from '../lib/db.js';
import { notifyPurchaseTelegram } from '../lib/notify.js';
import { sendApiKeyEmail, isEmailConfigured } from '../lib/email.js';

// Bundle credits — prepaid pools sized for the 3 typical agent stacks.
// Pricing keeps a fair per-call rate (cheaper than retail x402) so agents
// have a reason to buy in bulk vs paying per call.
//
//   Bundle 1k:   5 USDC   = 0.005  USDC/call (same as retail validate_iban)
//   Bundle 5k:  20 USDC   = 0.004  USDC/call (-20%)
//   Bundle 25k: 80 USDC   = 0.0032 USDC/call (-36%)
//
// Pricing is enforced by the x402 middleware on /v1/credits/buy/:bundle.
// If the agent paid → x402 lets the request through → handler creates
// a fresh credit key with `credits` credits and returns it.
const BUNDLES: Record<string, { credits: number; price_usdc: number }> = {
  '1k': { credits: 1000, price_usdc: 5 },
  '5k': { credits: 5000, price_usdc: 20 },
  '25k': { credits: 25000, price_usdc: 80 },
};

const apiKeys = new Hono();

/**
 * Constant-time admin auth. Returns true only if ADMIN_SECRET is set AND
 * the provided header matches exactly. Length-normalized before timing-safe
 * compare so comparison cost does not leak the secret's length.
 */
function isAdminAuthorized(provided: string | undefined): boolean {
  const expected = process.env.ADMIN_SECRET;
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  // Pad provided to the same length (compare a dummy if mismatched) to make
  // the decision branch-free from attacker's POV.
  if (expectedBuf.length !== providedBuf.length) {
    // Still do a dummy compare to equalize timing.
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

// Domains we refuse for free-tier signups to keep the stats funnel honest.
// They get re-allowed when IBANFORGE_ADMIN_TEST_KEYS=true (CI/automation only).
const BLOCKED_EMAIL_DOMAINS = /@(example|test|invalid|localhost|mailinator|tempmail|guerrillamail|10minutemail|throwaway|dispostable|trashmail|fakeinbox|getnada|maildrop|sharklasers|yopmail)\.(com|org|net|io|me|fr|ch|de)$/i;

apiKeys.post('/v1/keys/generate', async (c) => {
  let body: { email?: unknown };
  try {
    body = await c.req.json<{ email?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }

  const email = body.email;
  if (!email || typeof email !== 'string' || !email.includes('@') || email.length > 255) {
    return c.json({ error: 'invalid_email', message: 'A valid email address is required' }, 400);
  }

  // Stricter shape check: local-part@domain.tld (avoids "test@" or "foo@bar")
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return c.json({ error: 'invalid_email', message: 'Email must be a valid address (e.g. you@company.com)' }, 400);
  }

  // Block disposable / fictional domains unless explicitly allowed (CI tests).
  if (process.env.IBANFORGE_ADMIN_TEST_KEYS !== 'true' && BLOCKED_EMAIL_DOMAINS.test(email)) {
    return c.json({
      error: 'disposable_email',
      message: 'Free tier requires a real email address. example.com, mailinator and other disposable domains are blocked.',
    }, 400);
  }

  const result = generateApiKey(email.trim().toLowerCase());

  if (!result) {
    return c.json({
      error: 'rate_limited',
      message: 'Only one API key can be generated per email per day. Try again tomorrow.',
    }, 429);
  }

  return c.json({
    api_key: result.api_key,
    key_prefix: result.key_prefix,
    email: email.trim().toLowerCase(),
    monthly_limit: 200,
    message: 'Save this key — it will not be shown again.',
  }, 201);
});

/**
 * Bundle credits endpoint — agents (or humans) pay once via x402, get a key
 * with N prepaid calls. The endpoint is gated by the x402 middleware in
 * src/middleware/x402.ts at the configured price for each bundle. When the
 * payment clears, the handler runs and we mint a fresh credit-based key.
 *
 * GET /v1/credits/bundles  — public, lists the 3 bundles + prices
 * POST /v1/credits/buy/:bundle  — gated 5/20/80 USDC, returns the key on success
 * GET /v1/credits/balance  — auth-gated by the API key middleware
 */
apiKeys.get('/v1/credits/bundles', (c) => {
  return c.json({
    bundles: Object.entries(BUNDLES).map(([slug, b]) => ({
      slug,
      credits: b.credits,
      price_usdc: b.price_usdc,
      price_per_call_usdc: Math.round((b.price_usdc / b.credits) * 1_000_000) / 1_000_000,
      buy_endpoint: `POST /v1/credits/buy/${slug}`,
    })),
    payment_method: 'x402 USDC on Base mainnet',
    documentation: 'https://ibanforge.com/agents#credits',
  });
});

// NOTE: POST /v1/credits/buy/:bundle lives in src/routes/credits-buy.ts
// because it must be mounted AFTER the x402 middleware to be payment-gated.
// `apiKeys` here is mounted before x402 (free routes only).

apiKeys.get('/v1/credits/balance', (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ifk_')) {
    return c.json({ error: 'missing_key', message: 'Provide your API key via Authorization: Bearer ifk_xxx' }, 401);
  }
  const key = authHeader.slice(7);
  const v = validateApiKey(key);
  if (!v.valid) {
    return c.json({ error: 'invalid_key', message: 'API key not found or inactive' }, 401);
  }
  if (typeof v.creditsRemaining !== 'number') {
    return c.json({
      type: 'subscription',
      key_prefix: key.slice(0, 12),
      message: 'This is a monthly subscription key, not a credit bundle. Use GET /v1/keys/usage for monthly stats.',
    });
  }
  return c.json({
    type: 'credit_bundle',
    key_prefix: key.slice(0, 12),
    credits_remaining: v.creditsRemaining,
    credits_total: v.creditsTotal ?? 0,
    credits_used: (v.creditsTotal ?? 0) - v.creditsRemaining,
    topup_endpoints: Object.keys(BUNDLES).map((s) => `POST /v1/credits/buy/${s}`),
  });
});

apiKeys.get('/v1/keys/usage', (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ifk_')) {
    return c.json({ error: 'missing_key', message: 'Provide your API key via Authorization: Bearer ifk_xxx' }, 401);
  }

  const key = authHeader.slice(7);
  const { valid, keyHash, monthlyLimit } = validateApiKey(key);

  if (!valid) {
    return c.json({ error: 'invalid_key', message: 'API key not found or inactive' }, 401);
  }

  const usage = getUsage(keyHash, monthlyLimit);
  return c.json({ ...usage, key_prefix: key.slice(0, 12) });
});

/**
 * Self-service revocation. Auth is the key itself (Authorization: Bearer ifk_*)
 * — if you hold the key, you may kill it. Lets a holder disable a leaked key
 * immediately without contacting support.
 */
apiKeys.post('/v1/keys/revoke', (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ifk_')) {
    return c.json({ error: 'missing_key', message: 'Provide the key to revoke via Authorization: Bearer ifk_xxx' }, 401);
  }
  const key = authHeader.slice(7);
  const revoked = revokeApiKey(key);
  if (!revoked) {
    return c.json({ error: 'invalid_key', message: 'Key not found or already revoked.' }, 404);
  }
  return c.json({ revoked: true, key_prefix: key.slice(0, 12), message: 'Key permanently deactivated. Rotate to get a fresh one.' });
});

/**
 * Self-service rotation. Auth is the (still valid) key itself. Mints a fresh key
 * inheriting the same plan + remaining credits and revokes the old one atomically.
 */
apiKeys.post('/v1/keys/rotate', (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ifk_')) {
    return c.json({ error: 'missing_key', message: 'Provide the key to rotate via Authorization: Bearer ifk_xxx' }, 401);
  }
  const key = authHeader.slice(7);
  const rotated = rotateApiKey(key);
  if (!rotated) {
    return c.json({ error: 'invalid_key', message: 'Key not found or inactive.' }, 404);
  }
  return c.json({
    api_key: rotated.api_key,
    key_prefix: rotated.key_prefix,
    monthly_limit: rotated.monthly_limit ?? 200,
    credits_remaining: rotated.credits_remaining,
    message: 'New key issued and the old one revoked. Save this — it will not be shown again.',
  }, 201);
});

apiKeys.post('/v1/admin/keys', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  let body: { email?: unknown; monthly_limit?: unknown };
  try {
    body = await c.req.json<{ email?: unknown; monthly_limit?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const email = body.email;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return c.json({ error: 'invalid_email' }, 400);
  }

  const monthlyLimit = typeof body.monthly_limit === 'number' ? body.monthly_limit : undefined;
  const result = generateApiKey(email.trim().toLowerCase(), monthlyLimit);
  if (!result) {
    return c.json({ error: 'rate_limited' }, 429);
  }

  return c.json({
    api_key: result.api_key,
    key_prefix: result.key_prefix,
    email: email.trim().toLowerCase(),
    monthly_limit: monthlyLimit ?? 200,
  }, 201);
});

apiKeys.post('/v1/admin/keys/import', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  let body: { api_key?: unknown; email?: unknown; monthly_limit?: unknown };
  try {
    body = await c.req.json<{ api_key?: unknown; email?: unknown; monthly_limit?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const apiKey = body.api_key;
  const email = body.email;
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('ifk_')) {
    return c.json({ error: 'invalid_key', message: 'api_key must start with ifk_' }, 400);
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return c.json({ error: 'invalid_email' }, 400);
  }

  const { createHash } = await import('node:crypto');
  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  const keyPrefix = apiKey.slice(0, 12);
  const monthlyLimit = typeof body.monthly_limit === 'number' ? body.monthly_limit : null;

  const db = getStatsDB();
  const existing = db.prepare('SELECT id FROM api_keys WHERE key_hash = ?').get(keyHash);
  if (existing) {
    return c.json({ error: 'key_exists', key_prefix: keyPrefix }, 409);
  }

  db.prepare(
    'INSERT INTO api_keys (key_hash, key_prefix, email, monthly_limit) VALUES (?, ?, ?, ?)',
  ).run(keyHash, keyPrefix, email.trim().toLowerCase(), monthlyLimit);

  return c.json({ imported: true, key_prefix: keyPrefix, email: email.trim().toLowerCase(), monthly_limit: monthlyLimit ?? 200 }, 201);
});

apiKeys.get('/v1/admin/keys', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const db = getStatsDB();
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  // Previous calendar month (UTC, year-boundary safe) for the usage trend.
  const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);
  // Rich per-customer payload for the CRM tab. credits_total/credits_remaining
  // and `paid` are what actually separate a paying customer (Stripe/x402 credit
  // pack) from a free key — the previous SELECT exposed neither, so the two were
  // indistinguishable. used_all_time / last_active_month / used_prev power the
  // activation, recency and trend indicators. All read-only.
  const rows = db.prepare(
    `SELECT k.key_hash, k.key_prefix, k.email, k.monthly_limit, k.active, k.created_at,
            k.credits_total, k.credits_remaining,
            CASE WHEN k.stripe_session_id IS NOT NULL THEN 1 ELSE 0 END AS paid,
            COALESCE(u.count, 0) AS used,
            COALESCE(p.count, 0) AS used_prev,
            COALESCE(t.total, 0) AS used_all_time,
            lam.last_active_month AS last_active_month,
            COALESCE(es.mail_count, 0) AS mail_count,
            COALESCE(es.received, 0) AS mail_received,
            es.last_date AS mail_last_date,
            es.last_subject AS mail_last_subject
     FROM api_keys k
     LEFT JOIN api_usage u ON u.key_hash = k.key_hash AND u.month = ?
     LEFT JOIN api_usage p ON p.key_hash = k.key_hash AND p.month = ?
     LEFT JOIN (SELECT key_hash, SUM(count) AS total FROM api_usage GROUP BY key_hash) t
            ON t.key_hash = k.key_hash
     LEFT JOIN (SELECT key_hash, MAX(month) AS last_active_month FROM api_usage GROUP BY key_hash) lam
            ON lam.key_hash = k.key_hash
     LEFT JOIN email_summaries es ON es.email = k.email
     ORDER BY k.created_at DESC`
  ).all(month, prevMonth) as Array<Record<string, unknown> & { key_hash: string }>;

  // Per-customer monthly usage series (last 6 months) → CRM sparkline.
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    months.push(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7),
    );
  }
  const usage = db
    .prepare('SELECT key_hash, month, count FROM api_usage WHERE month >= ?')
    .all(months[0]) as Array<{ key_hash: string; month: string; count: number }>;
  const byHash = new Map<string, Map<string, number>>();
  for (const u of usage) {
    let m = byHash.get(u.key_hash);
    if (!m) {
      m = new Map();
      byHash.set(u.key_hash, m);
    }
    m.set(u.month, u.count);
  }
  const keys = rows.map((r) => {
    const m = byHash.get(r.key_hash);
    const series = months.map((mo) => m?.get(mo) ?? 0);
    const out: Record<string, unknown> = { ...r, series };
    delete out.key_hash; // internal join key, never exposed
    return out;
  });
  return c.json({ month, prev_month: prevMonth, months, keys });
});

interface EmailSummaryInput {
  email?: unknown;
  mail_count?: unknown;
  received?: unknown;
  sent?: unknown;
  last_date?: unknown;
  last_subject?: unknown;
  last_snippet?: unknown;
}

/**
 * Ingest per-customer email-exchange summaries synced from the tabornio mail DB
 * (separate VPS). Body: { summaries: [{ email, mail_count, received, sent,
 * last_date, last_subject, last_snippet }] }. Upserts by email; the CRM reads
 * them back via the LEFT JOIN in GET /v1/admin/keys.
 */
apiKeys.post('/v1/admin/email-summary', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { summaries?: unknown };
  try {
    body = await c.req.json<{ summaries?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }
  if (!Array.isArray(body.summaries)) {
    return c.json({ error: 'invalid_body', message: 'Expected { summaries: [...] }' }, 400);
  }

  const db = getStatsDB();
  const upsert = db.prepare(
    `INSERT INTO email_summaries (email, mail_count, received, sent, last_date, last_subject, last_snippet, updated_at)
     VALUES (@email, @mail_count, @received, @sent, @last_date, @last_subject, @last_snippet, datetime('now'))
     ON CONFLICT(email) DO UPDATE SET
       mail_count = excluded.mail_count, received = excluded.received, sent = excluded.sent,
       last_date = excluded.last_date, last_subject = excluded.last_subject,
       last_snippet = excluded.last_snippet, updated_at = datetime('now')`,
  );
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length ? v.slice(0, 500) : null);
  const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

  const tx = db.transaction((rows: EmailSummaryInput[]) => {
    let n = 0;
    for (const r of rows) {
      if (!r || typeof r.email !== 'string' || !r.email.includes('@')) continue;
      upsert.run({
        email: r.email.trim().toLowerCase(),
        mail_count: num(r.mail_count),
        received: num(r.received),
        sent: num(r.sent),
        last_date: str(r.last_date),
        last_subject: str(r.last_subject),
        last_snippet: str(r.last_snippet),
      });
      n++;
    }
    return n;
  });
  const upserted = tx(body.summaries as EmailSummaryInput[]);
  return c.json({ upserted });
});

interface EmailMessageInput {
  id?: unknown;
  customer_email?: unknown;
  direction?: unknown;
  msg_date?: unknown;
  subject?: unknown;
  snippet?: unknown;
  counterparty?: unknown;
}

/**
 * Ingest full per-customer email messages (one row per message) synced from the
 * tabornio mail DB + Sent folders. Upserts by stable id. Powers the CRM
 * conversation cockpit (GET /v1/admin/email-messages).
 */
apiKeys.post('/v1/admin/email-messages', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { messages?: unknown };
  try {
    body = await c.req.json<{ messages?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }
  if (!Array.isArray(body.messages)) {
    return c.json({ error: 'invalid_body', message: 'Expected { messages: [...] }' }, 400);
  }

  const db = getStatsDB();
  const clip = (v: unknown, n: number): string | null => (typeof v === 'string' && v.length ? v.slice(0, n) : null);
  const upsert = db.prepare(
    `INSERT INTO email_messages (id, customer_email, direction, msg_date, subject, snippet, counterparty)
     VALUES (@id, @customer_email, @direction, @msg_date, @subject, @snippet, @counterparty)
     ON CONFLICT(id) DO UPDATE SET
       customer_email = excluded.customer_email, direction = excluded.direction,
       msg_date = excluded.msg_date, subject = excluded.subject,
       snippet = excluded.snippet, counterparty = excluded.counterparty`,
  );
  const tx = db.transaction((rows: EmailMessageInput[]) => {
    let n = 0;
    for (const r of rows) {
      if (!r || typeof r.id !== 'string' || typeof r.customer_email !== 'string' || !r.customer_email.includes('@')) continue;
      upsert.run({
        id: r.id.slice(0, 200),
        customer_email: r.customer_email.trim().toLowerCase(),
        direction: r.direction === 'out' ? 'out' : 'in',
        msg_date: clip(r.msg_date, 40),
        subject: clip(r.subject, 500),
        snippet: clip(r.snippet, 300),
        counterparty: clip(r.counterparty, 255),
      });
      n++;
    }
    return n;
  });
  const upserted = tx(body.messages as EmailMessageInput[]);
  return c.json({ upserted });
});

apiKeys.get('/v1/admin/email-messages', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = getStatsDB();
  const rows = db
    .prepare(
      `SELECT customer_email, direction, msg_date, subject, snippet, counterparty
       FROM email_messages ORDER BY msg_date ASC`,
    )
    .all();
  return c.json({ messages: rows });
});

/**
 * Read-only delivery check for a Stripe purchase. NON-CONSUMING: it only SELECTs
 * (never nulls raw_key_one_time_view), so calling it does not affect the
 * customer's success-page retrieval. `raw_key_still_available: true` means the
 * buyer never opened the success page → they may be stuck without their key.
 * Pass ?reveal=1 to also return the raw key (admin only) for a manual backfill.
 */
apiKeys.get('/v1/admin/stripe/delivery/:session_id', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const sessionId = c.req.param('session_id');
  const reveal = c.req.query('reveal') === '1';
  const db = getStatsDB();
  const row = db
    .prepare(
      'SELECT key_prefix, email, credits_total, credits_remaining, raw_key_one_time_view FROM api_keys WHERE stripe_session_id = ?',
    )
    .get(sessionId) as
    | {
        key_prefix: string;
        email: string;
        credits_total: number | null;
        credits_remaining: number | null;
        raw_key_one_time_view: string | null;
      }
    | undefined;
  if (!row) {
    return c.json({ found: false, session_id: sessionId });
  }
  const stillAvailable = row.raw_key_one_time_view !== null;
  return c.json({
    found: true,
    key_prefix: row.key_prefix,
    email: row.email,
    credits_total: row.credits_total,
    credits_remaining: row.credits_remaining,
    delivered_via_success_page: !stillAvailable,
    raw_key_still_available: stillAvailable,
    ...(reveal && stillAvailable ? { raw_key: row.raw_key_one_time_view } : {}),
  });
});

/**
 * Fire a test Telegram purchase alert — verifies the deployed notify wiring
 * (token/chat env + Telegram reachability) without needing a real Stripe event.
 */
apiKeys.post('/v1/admin/test-notify', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const sent = await notifyPurchaseTelegram({
    amountUsd: 0,
    bundle: 'TEST',
    credits: 0,
    email: 'test@ibanforge.com',
    keyPrefix: 'ifk_test0000',
  });
  return c.json({ sent });
});

/**
 * Send a test API-key email (verifies the deployed SMTP wiring once SMTP_* is
 * set on the server). Pass ?to=you@example.com. No-ops + reports if unconfigured.
 */
apiKeys.post('/v1/admin/test-email', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const to = c.req.query('to');
  if (!to || !to.includes('@')) {
    return c.json({ error: 'missing_to', message: 'pass ?to=email@example.com' }, 400);
  }
  const sent = await sendApiKeyEmail({ to, rawKey: 'ifk_test_0000000000000000', credits: 0, bundle: 'TEST' });
  return c.json({ sent, configured: isEmailConfigured() });
});

export { apiKeys };

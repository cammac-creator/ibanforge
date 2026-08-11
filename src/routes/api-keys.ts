import { Hono } from 'hono';
import { timingSafeEqual, createHash } from 'node:crypto';
import { generateApiKey, validateApiKey, getUsage, revokeApiKey, rotateApiKey } from '../lib/api-keys.js';
import { getStatsDB } from '../lib/db.js';
import { getClientProfiles, getBotProfiles } from '../lib/stats.js';
import { getActivation } from '../lib/activation.js';
import { notifyPurchaseTelegram } from '../lib/notify.js';
import { sendApiKeyEmail, isEmailConfigured } from '../lib/email.js';

// Bundle credits — prepaid pools sized for the 3 typical agent stacks.
// Pricing keeps a fair per-call rate (cheaper than retail x402) so agents
// have a reason to buy in bulk vs paying per call.
//
//   Bundle 1k:   5 USDC   = 0.005  USDC/credit (same as retail validate_iban)
//   Bundle 5k:  20 USDC   = 0.004  USDC/credit (-20%)
//   Bundle 25k: 80 USDC   = 0.0032 USDC/credit (-36%)
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
  let body: { email?: unknown; source?: unknown };
  try {
    body = await c.req.json<{ email?: unknown; source?: unknown }>();
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

  // Acquisition channel, carried by our own outbound links (?src=npm, the n8n
  // node, directory listings…). Best-effort by design: an absent or malformed
  // value silently becomes NULL — attribution must never block a key.
  const source =
    typeof body.source === 'string' && /^[a-z0-9_-]{1,40}$/i.test(body.source.trim())
      ? body.source.trim().toLowerCase()
      : undefined;

  const result = generateApiKey(email.trim().toLowerCase(), undefined, source);

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
    terms_url: 'https://ibanforge.com/legal/terms',
  }, 201);
});

/**
 * Bundle credits endpoint — agents (or humans) pay once via x402, get a key
 * with N prepaid credits. The endpoint is gated by the x402 middleware in
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
  snippet_fr?: unknown;
  lang?: unknown;
  body?: unknown;
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
    `INSERT INTO email_messages (id, customer_email, direction, msg_date, subject, snippet, snippet_fr, lang, body, counterparty)
     VALUES (@id, @customer_email, @direction, @msg_date, @subject, @snippet, @snippet_fr, @lang, @body, @counterparty)
     ON CONFLICT(id) DO UPDATE SET
       customer_email = excluded.customer_email, direction = excluded.direction,
       msg_date = excluded.msg_date, subject = excluded.subject,
       snippet = excluded.snippet,
       -- Preserve an existing FR translation / detected language when a later
       -- re-sync of the same message carries none (translations are set out-of-band
       -- by translate-messages.py; a raw re-sync must not wipe them).
       snippet_fr = COALESCE(excluded.snippet_fr, snippet_fr),
       lang = COALESCE(excluded.lang, lang),
       body = excluded.body, counterparty = excluded.counterparty`,
  );
  // An outgoing message to a prospect's contact_email means it HAS been
  // contacted — flip the stale preparation status so the API reflects reality
  // (the UI already derives contacted/replied from the thread, but scripts and
  // GET /v1/admin/prospects read the raw status). Message ids are stable
  // (md5 of email|dir|date|subject), so re-syncs retroactively backfill this.
  const markContacted = db.prepare(
    `UPDATE prospects SET status = 'contacte', updated_at = datetime('now')
     WHERE lower(contact_email) = ? AND status IN ('a_mailer', 'a_enrichir')`,
  );
  const tx = db.transaction((rows: EmailMessageInput[]) => {
    let n = 0;
    for (const r of rows) {
      if (!r || typeof r.id !== 'string' || typeof r.customer_email !== 'string' || !r.customer_email.includes('@')) continue;
      const email = r.customer_email.trim().toLowerCase();
      // 'draft' = a CRM-native draft awaiting review in the dashboard. It lives
      // in the same table so the thread UI can show it in place, but it must
      // never count as real correspondence (no prospect status flip below).
      const direction = r.direction === 'out' ? 'out' : r.direction === 'draft' ? 'draft' : 'in';
      upsert.run({
        id: r.id.slice(0, 200),
        customer_email: email,
        direction,
        msg_date: clip(r.msg_date, 40),
        subject: clip(r.subject, 500),
        snippet: clip(r.snippet, 300),
        snippet_fr: clip(r.snippet_fr, 8000),
        lang: clip(r.lang, 8),
        body: clip(r.body, 8000),
        counterparty: clip(r.counterparty, 255),
      });
      if (direction === 'out') markContacted.run(email);
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
      `SELECT id, customer_email, direction, msg_date, subject, snippet, snippet_fr, lang, body, counterparty
       FROM email_messages ORDER BY msg_date ASC`,
    )
    .all();
  return c.json({ messages: rows });
});

/**
 * Delete a CRM draft — and ONLY a draft. Sent/received history is immutable
 * through this endpoint by design: the WHERE clause refuses anything whose
 * direction isn't 'draft'. Used by the dashboard when a draft is sent (the
 * instant recordSent 'out' row replaces it) or discarded.
 */
apiKeys.post('/v1/admin/email-messages/delete', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { id?: unknown };
  try {
    body = await c.req.json<{ id?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }
  if (typeof body.id !== 'string' || !body.id) {
    return c.json({ error: 'invalid_body', message: 'Expected { id: "…" }' }, 400);
  }
  const db = getStatsDB();
  const res = db.prepare(`DELETE FROM email_messages WHERE id = ? AND direction = 'draft'`).run(body.id);
  return c.json({ deleted: res.changes });
});

/**
 * Per-customer API activity for the CRM: which endpoints each key calls + the
 * per-day activity over the last 30 days. Keyed by key_prefix. Populated
 * forward-only since request_log.key_prefix was added (historical rows NULL).
 */
apiKeys.get('/v1/admin/client-activity', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = getStatsDB();
  const endpoints = db
    .prepare(
      `SELECT key_prefix, path, COUNT(*) AS count
       FROM request_log
       WHERE key_prefix IS NOT NULL AND status < 400
       GROUP BY key_prefix, path
       ORDER BY key_prefix, count DESC`,
    )
    .all() as Array<{ key_prefix: string; path: string; count: number }>;
  const days = db
    .prepare(
      `SELECT key_prefix, date(created_at) AS day, COUNT(*) AS count
       FROM request_log
       WHERE key_prefix IS NOT NULL AND created_at >= date('now', '-30 days')
       GROUP BY key_prefix, day
       ORDER BY key_prefix, day`,
    )
    .all() as Array<{ key_prefix: string; day: string; count: number }>;

  type Activity = { endpoints: Array<{ path: string; count: number }>; days: Array<{ day: string; count: number }> };
  const byKey: Record<string, Activity> = {};
  const ensure = (k: string): Activity => (byKey[k] ??= { endpoints: [], days: [] });
  for (const e of endpoints) ensure(e.key_prefix).endpoints.push({ path: e.path, count: e.count });
  for (const d of days) ensure(d.key_prefix).days.push({ day: d.day, count: d.count });
  return c.json({ by_key: byKey });
});

/**
 * Everything the Clients tab needs about each customer's API use, in one call:
 * volume and verdict mix, endpoints, countries checked, latency they actually
 * experience, the shape of their day, their stack, and how many machines call.
 *
 * Separate from /v1/admin/client-activity, which stays as-is: that one feeds the
 * sparkline on the Contacts page and is fetched on every render of it.
 */
apiKeys.get('/v1/admin/client-profiles', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const daysParam = parseInt(c.req.query('days') ?? '90', 10);
  const days = Number.isNaN(daysParam) ? 90 : Math.max(1, Math.min(365, daysParam));
  const db = getStatsDB();
  // Monthly consumption per key, so the panel can show the trend rather than
  // only the current month. api_usage is keyed by hash; the CRM knows prefixes.
  const usage = db
    .prepare(
      `SELECT k.key_prefix, u.month, u.count
       FROM api_usage u JOIN api_keys k ON k.key_hash = u.key_hash
       ORDER BY k.key_prefix, u.month`,
    )
    .all() as Array<{ key_prefix: string; month: string; count: number }>;
  const monthsByKey: Record<string, Array<{ month: string; count: number }>> = {};
  for (const r of usage) (monthsByKey[r.key_prefix] ??= []).push({ month: r.month, count: r.count });
  // Which keys we have already warned about their quota, so the panel does not
  // suggest sending a notice twice.
  const warned = db
    .prepare(
      `SELECT k.key_prefix, q.month FROM quota_notices q JOIN api_keys k ON k.key_hash = q.key_hash`,
    )
    .all() as Array<{ key_prefix: string; month: string }>;
  const warnedByKey: Record<string, string[]> = {};
  for (const r of warned) (warnedByKey[r.key_prefix] ??= []).push(r.month);

  return c.json({
    period_days: days,
    profiles: getClientProfiles(days),
    months_by_key: monthsByKey,
    quota_warned_by_key: warnedByKey,
  });
});

/**
 * The activation picture the dashboard's Clients view reads: everything
 * aggregated per EMAIL (a buyer's pack lives on a separate key whose monthly
 * counter stays at zero — any per-key reading shows a paying customer as
 * unused). Two periods only: the dashboard's own selector offers 30 and 90.
 */
apiKeys.get('/v1/admin/activation', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const daysParam = parseInt(c.req.query('days') ?? '30', 10);
  const days = daysParam === 90 ? 90 : 30;
  return c.json(getActivation(days));
});

/**
 * The other half of the audience: everyone who calls without a key. Crawlers,
 * MCP registries, x402 probes, agent directories and the odd human with curl.
 * Keyed by user agent, which is what survives an IP_HASH_SECRET rotation.
 */
apiKeys.get('/v1/admin/bot-profiles', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const daysParam = parseInt(c.req.query('days') ?? '90', 10);
  const days = Number.isNaN(daysParam) ? 90 : Math.max(1, Math.min(365, daysParam));
  const minParam = parseInt(c.req.query('min') ?? '5', 10);
  const min = Number.isNaN(minParam) ? 5 : Math.max(1, Math.min(1000, minParam));
  return c.json({ period_days: days, min_requests: min, bots: getBotProfiles(days, min) });
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

// ---------------------------------------------------------------------------
// Prospects — outbound list of NOT-yet-customers for the CRM "Prospects" tab.
// Identified by the prospecting campaign; each row carries a pre-written,
// personalized cold email (EN+FR) for review-before-send. Admin-only.
// ---------------------------------------------------------------------------

interface ProspectInput {
  id?: unknown;
  company?: unknown;
  segment?: unknown;
  website?: unknown;
  country?: unknown;
  what_they_do?: unknown;
  fit_reason?: unknown;
  buying_signal?: unknown;
  signal_source_url?: unknown;
  contact_name?: unknown;
  contact_role?: unknown;
  contact_email?: unknown;
  email_source_url?: unknown;
  personalization_hook?: unknown;
  confidence?: unknown;
  status?: unknown;
  mail_subject_en?: unknown;
  mail_body_en?: unknown;
  mail_subject_fr?: unknown;
  mail_body_fr?: unknown;
  recommended_lang?: unknown;
  source?: unknown;
}

/** Stable id from website domain + company, so re-running the campaign upserts. */
function prospectId(r: ProspectInput): string {
  const site = typeof r.website === 'string' ? r.website : '';
  const company = typeof r.company === 'string' ? r.company : '';
  const basis = `${site}|${company}`.toLowerCase().trim();
  return 'p_' + createHash('md5').update(basis).digest('hex').slice(0, 16);
}

/**
 * Em dashes are the most recognisable AI-writing tell, so outreach mail prose
 * is scrubbed on every seed: campaign agents can never reintroduce them into
 * a sendable mail. Context-aware: signature lines get a middot, clause
 * starters a period, everything else a comma. Internal notes are untouched.
 */
function stripEmDashes(text: string | null): string | null {
  if (!text || !text.includes('—')) return text;
  const cleaned = text
    .split('\n')
    .map((line) => {
      if (/ibanforge\.com/i.test(line) || line.trimStart().startsWith('Claude-Alain Martin')) {
        return line.replace(/\s*—\s*/g, ' · ');
      }
      return line
        .replace(/\s*—\s*\(/g, ' (')
        .replace(
          /\s*—\s*(that's|it's|this |these |here's|that is|it is|we |you )/gi,
          (_m, w: string) => `. ${w.charAt(0).toUpperCase()}${w.slice(1)}`,
        )
        .replace(/\s*—\s*/g, ', ');
    })
    .join('\n');
  return cleaned
    .replace(/,\s*,/g, ', ')
    .replace(/[ \t]+,/g, ', ')
    .replace(/,\s*([.;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

apiKeys.get('/v1/admin/prospects', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = getStatsDB();
  const rows = db
    .prepare(
      `SELECT id, company, segment, website, country, what_they_do, fit_reason,
              buying_signal, signal_source_url, contact_name, contact_role,
              contact_email, email_source_url, personalization_hook, confidence,
              status, mail_subject_en, mail_body_en, mail_subject_fr, mail_body_fr,
              recommended_lang, source, outcome, outcome_note, wake_up_at, outcome_at,
              created_at, updated_at
       FROM prospects
       ORDER BY
         CASE status WHEN 'a_mailer' THEN 0 WHEN 'a_enrichir' THEN 1 WHEN 'archive' THEN 2 ELSE 3 END,
         company COLLATE NOCASE`,
    )
    .all();
  return c.json({ prospects: rows });
});

/**
 * Upsert a batch of prospects (idempotent by id, derived from website+company
 * when not provided). Body: { prospects: [...] }. Seeds the list from the
 * prospecting campaign; preserves created_at on conflict, refreshes updated_at.
 */
apiKeys.post('/v1/admin/prospects', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { prospects?: unknown };
  try {
    body = await c.req.json<{ prospects?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }
  if (!Array.isArray(body.prospects)) {
    return c.json({ error: 'invalid_body', message: 'Expected { prospects: [...] }' }, 400);
  }

  const db = getStatsDB();
  const clip = (v: unknown, n: number): string | null => (typeof v === 'string' && v.length ? v.slice(0, n) : null);
  const upsert = db.prepare(
    `INSERT INTO prospects (id, company, segment, website, country, what_they_do, fit_reason,
        buying_signal, signal_source_url, contact_name, contact_role, contact_email,
        email_source_url, personalization_hook, confidence, status,
        mail_subject_en, mail_body_en, mail_subject_fr, mail_body_fr, recommended_lang, source, updated_at)
     VALUES (@id, @company, @segment, @website, @country, @what_they_do, @fit_reason,
        @buying_signal, @signal_source_url, @contact_name, @contact_role, @contact_email,
        @email_source_url, @personalization_hook, @confidence, @status,
        @mail_subject_en, @mail_body_en, @mail_subject_fr, @mail_body_fr, @recommended_lang, @source, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
        company = excluded.company, segment = excluded.segment, website = excluded.website,
        country = excluded.country, what_they_do = excluded.what_they_do, fit_reason = excluded.fit_reason,
        buying_signal = excluded.buying_signal, signal_source_url = excluded.signal_source_url,
        contact_name = excluded.contact_name, contact_role = excluded.contact_role,
        contact_email = excluded.contact_email, email_source_url = excluded.email_source_url,
        personalization_hook = excluded.personalization_hook, confidence = excluded.confidence,
        status = excluded.status, mail_subject_en = excluded.mail_subject_en, mail_body_en = excluded.mail_body_en,
        mail_subject_fr = excluded.mail_subject_fr, mail_body_fr = excluded.mail_body_fr,
        recommended_lang = excluded.recommended_lang, source = excluded.source, updated_at = datetime('now')`,
  );
  const tx = db.transaction((rows: ProspectInput[]) => {
    let n = 0;
    for (const r of rows) {
      if (!r || typeof r.company !== 'string' || !r.company.trim()) continue;
      upsert.run({
        id: clip(r.id, 200) || prospectId(r),
        company: r.company.slice(0, 200),
        segment: clip(r.segment, 40),
        website: clip(r.website, 300),
        country: clip(r.country, 80),
        what_they_do: clip(r.what_they_do, 1000),
        fit_reason: clip(r.fit_reason, 1000),
        buying_signal: clip(r.buying_signal, 1000),
        signal_source_url: clip(r.signal_source_url, 500),
        contact_name: clip(r.contact_name, 120),
        contact_role: clip(r.contact_role, 120),
        contact_email: clip(r.contact_email, 200),
        email_source_url: clip(r.email_source_url, 500),
        personalization_hook: clip(r.personalization_hook, 1000),
        confidence: clip(r.confidence, 20),
        status: clip(r.status, 20) || 'a_enrichir',
        mail_subject_en: stripEmDashes(clip(r.mail_subject_en, 300)),
        mail_body_en: stripEmDashes(clip(r.mail_body_en, 6000)),
        mail_subject_fr: stripEmDashes(clip(r.mail_subject_fr, 300)),
        mail_body_fr: stripEmDashes(clip(r.mail_body_fr, 6000)),
        recommended_lang: clip(r.recommended_lang, 8),
        source: clip(r.source, 80),
      });
      n++;
    }
    return n;
  });
  const upserted = tx(body.prospects as ProspectInput[]);
  return c.json({ upserted });
});

/**
 * Update one prospect from the UI: its sourcing status, its outcome, or both.
 *
 * Two independent axes, and the endpoint keeps them independent. `status` says
 * where the sourcing got to (address found, mail ready, contacted, set aside,
 * rejected). `outcome` says where the RELATIONSHIP got to, which no value of
 * `status` can express. Sending one never disturbs the other.
 *
 * Body: { id, status? , outcome?, outcomeNote?, wakeUpAt? }. At least one of
 * status or outcome must be present. `outcome: null` clears the outcome, which
 * is how a judgement recorded by mistake is taken back.
 */
apiKeys.post('/v1/admin/prospects/update', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { id?: unknown; status?: unknown; outcome?: unknown; outcomeNote?: unknown; wakeUpAt?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (typeof body.id !== 'string') {
    return c.json({ error: 'invalid_body', message: 'Expected { id, status? , outcome? }' }, 400);
  }

  const hasStatus = body.status !== undefined;
  const hasOutcome = body.outcome !== undefined;
  if (!hasStatus && !hasOutcome) {
    return c.json({ error: 'invalid_body', message: 'Expected at least one of status, outcome' }, 400);
  }

  const sets: string[] = [];
  const args: Array<string | null> = [];

  if (hasStatus) {
    const allowed = ['a_mailer', 'a_enrichir', 'archive', 'rejete'];
    if (typeof body.status !== 'string' || !allowed.includes(body.status)) {
      return c.json({ error: 'invalid_status', message: `status must be one of ${allowed.join(', ')}` }, 400);
    }
    sets.push('status = ?');
    args.push(body.status);
  }

  if (hasOutcome) {
    const allowed = ['en_discussion', 'pas_maintenant', 'pas_interesse', 'mauvaise_personne'];
    if (body.outcome !== null && (typeof body.outcome !== 'string' || !allowed.includes(body.outcome))) {
      return c.json({ error: 'invalid_outcome', message: `outcome must be null or one of ${allowed.join(', ')}` }, 400);
    }
    const outcome = body.outcome as string | null;

    // A wake-up date only means something for "not now". Accepting one on any
    // other outcome would let a contact judged dead quietly resurface.
    let wakeUpAt: string | null = null;
    if (outcome === 'pas_maintenant') {
      if (typeof body.wakeUpAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.wakeUpAt)) {
        return c.json({ error: 'invalid_wake_up_at', message: 'pas_maintenant requires wakeUpAt as YYYY-MM-DD' }, 400);
      }
      wakeUpAt = body.wakeUpAt;
    }

    const note = typeof body.outcomeNote === 'string' && body.outcomeNote.trim()
      ? body.outcomeNote.trim().slice(0, 500)
      : null;

    sets.push('outcome = ?', 'outcome_note = ?', 'wake_up_at = ?', 'outcome_at = ?');
    // Clearing the outcome clears everything that hangs off it, so no orphan
    // wake-up date survives to wake a contact nobody is waiting on any more.
    args.push(outcome, outcome === null ? null : note, wakeUpAt, outcome === null ? null : new Date().toISOString());
  }

  const db = getStatsDB();
  const r = db
    .prepare(`UPDATE prospects SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...args, body.id);
  return c.json({ updated: r.changes });
});

// ---------------------------------------------------------------------------
// Thread read-state — inbox-style unread markers per counterpart email.
// A thread is unread when it has an inbound message newer than last_read_at.
// ---------------------------------------------------------------------------

apiKeys.get('/v1/admin/thread-reads', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = getStatsDB();
  const rows = db.prepare('SELECT email, last_read_at FROM thread_reads').all() as Array<{
    email: string;
    last_read_at: string | null;
  }>;
  const reads: Record<string, string> = {};
  for (const r of rows) if (r.last_read_at) reads[r.email] = r.last_read_at;
  return c.json({ reads });
});

apiKeys.post('/v1/admin/thread-read', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { email?: unknown };
  try {
    body = await c.req.json<{ email?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (typeof body.email !== 'string' || !body.email.includes('@')) {
    return c.json({ error: 'invalid_body', message: 'Expected { email }' }, 400);
  }
  const db = getStatsDB();
  db.prepare(
    `INSERT INTO thread_reads (email, last_read_at) VALUES (?, datetime('now'))
     ON CONFLICT(email) DO UPDATE SET last_read_at = datetime('now')`,
  ).run(body.email.trim().toLowerCase());
  return c.json({ ok: true });
});

export { apiKeys };

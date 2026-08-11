import type DatabaseType from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { resetStatements } from './bic-lookup.js';
import { resetStatsStatements } from './stats.js';
import { closeComplianceDB } from './compliance-db.js';
import { resetChClearingStatements } from './ch-clearing.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Lazy-load better-sqlite3 so the module can be imported even when the native
// addon is not compiled (e.g. during Glama MCP inspection).
// ---------------------------------------------------------------------------

type DatabaseConstructor = typeof DatabaseType;
let _Database: DatabaseConstructor | null = null;

function loadDatabaseSync(): DatabaseConstructor {
  if (!_Database) {
    _Database = require('better-sqlite3') as DatabaseConstructor;
  }
  return _Database;
}

// ---------------------------------------------------------------------------
// BIC database (read-only) — contains bic_entries table
// ---------------------------------------------------------------------------

const BIC_DB_PATH = process.env.BIC_DB_PATH ?? resolve(__dirname, '../../data/bic.sqlite');

let bicDB: DatabaseType.Database | null = null;

export function getBicDB(): DatabaseType.Database {
  if (!bicDB) {
    const Db = loadDatabaseSync();
    bicDB = new Db(BIC_DB_PATH, { readonly: true });
  }
  return bicDB;
}

// ---------------------------------------------------------------------------
// Stats database (read-write) — operations log + daily aggregates
// ---------------------------------------------------------------------------

const STATS_DB_PATH = process.env.STATS_DB_PATH ?? resolve(__dirname, '../../data/stats.sqlite');

let statsDB: DatabaseType.Database | null = null;

export function getStatsDB(): DatabaseType.Database {
  if (!statsDB) {
    const Db = loadDatabaseSync();
    statsDB = new Db(STATS_DB_PATH);
    // Concurrent reads + better write throughput. WAL is critical because
    // multiple request handlers write to stats.sqlite simultaneously
    // (recordOperation, recordRequest, increment quota).
    statsDB.pragma('journal_mode = WAL');
    statsDB.pragma('synchronous = NORMAL');
    statsDB.pragma('busy_timeout = 5000');
    statsDB.exec(`
      CREATE TABLE IF NOT EXISTS operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_type TEXT NOT NULL,
        country_code TEXT,
        success INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        hour INTEGER,
        day_of_week INTEGER,
        error_detail TEXT,
        reject_reason TEXT
      );
      CREATE TABLE IF NOT EXISTS daily_stats (
        date TEXT NOT NULL,
        operation_type TEXT NOT NULL,
        total INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        revenue_usdc REAL DEFAULT 0,
        PRIMARY KEY (date, operation_type)
      );
      CREATE TABLE IF NOT EXISTS hourly_stats (
        date TEXT NOT NULL,
        hour INTEGER NOT NULL,
        day_of_week INTEGER NOT NULL,
        operation_type TEXT NOT NULL,
        total INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        PRIMARY KEY (date, hour, operation_type)
      );
      CREATE TABLE IF NOT EXISTS request_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status INTEGER NOT NULL,
        response_ms INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        hour INTEGER,
        day_of_week INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_request_log_date ON request_log(created_at);
      CREATE INDEX IF NOT EXISTS idx_request_log_path ON request_log(path);
      CREATE INDEX IF NOT EXISTS idx_operations_type ON operations(operation_type);
      CREATE INDEX IF NOT EXISTS idx_operations_created ON operations(created_at);
      CREATE INDEX IF NOT EXISTS idx_operations_country ON operations(country_code);
      CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);
      CREATE INDEX IF NOT EXISTS idx_hourly_stats_date ON hourly_stats(date);
      CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_hash TEXT UNIQUE NOT NULL,
        key_prefix TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        active INTEGER DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
      CREATE INDEX IF NOT EXISTS idx_api_keys_email ON api_keys(email);
      CREATE TABLE IF NOT EXISTS api_usage (
        key_hash TEXT NOT NULL,
        month TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        PRIMARY KEY (key_hash, month)
      );
      -- Hot path: most usage queries scope by month then look up by key_hash.
      -- The PRIMARY KEY (key_hash, month) already covers (key_hash, month) lookups.
      -- This index covers the "list keys used this month" admin query.
      CREATE INDEX IF NOT EXISTS idx_api_usage_month ON api_usage(month);
      -- Same idea for api_keys: protect the daily quota check that filters by
      -- created_at >= now-1day for rate-limiting key creation per email.
      CREATE INDEX IF NOT EXISTS idx_api_keys_email_created ON api_keys(email, created_at);
      CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(active);
      -- Email exchange summaries per customer, synced from the tabornio mail DB
      -- (which lives on a separate VPS, unreachable from this service). Populated
      -- by POST /v1/admin/email-summary and LEFT JOINed into the CRM by email.
      CREATE TABLE IF NOT EXISTS email_summaries (
        email TEXT PRIMARY KEY,
        mail_count INTEGER DEFAULT 0,
        received INTEGER DEFAULT 0,
        sent INTEGER DEFAULT 0,
        last_date TEXT,
        last_subject TEXT,
        last_snippet TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      -- Full per-customer email thread (one row per message), synced from the
      -- tabornio mail DB + Sent folders. Powers the CRM conversation cockpit.
      -- direction: 'in' = customer -> founder, 'out' = founder -> customer.
      CREATE TABLE IF NOT EXISTS email_messages (
        id TEXT PRIMARY KEY,
        customer_email TEXT NOT NULL,
        direction TEXT NOT NULL,
        msg_date TEXT,
        subject TEXT,
        snippet TEXT,
        counterparty TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_email_messages_customer ON email_messages(customer_email, msg_date);
      -- Outbound prospect list (people who are NOT yet customers). Populated by
      -- the prospecting campaign via POST /v1/admin/prospects. Each row carries a
      -- pre-written, personalized cold email (EN+FR) so the CRM can show it for
      -- review before sending. status: 'a_mailer' (verified email + mail ready) |
      -- 'a_enrichir' (no safe email yet) | 'contacte' (an outbound reached the
      -- address; written by the email-messages ingester, never by the UI) |
      -- 'archive' (set aside) | 'rejete'.
      -- 'contacte' was long absent from this list while being the most common
      -- value in the table, which is how it also came to be missing from the
      -- badge map in the CRM. Keep the two in step.
      -- A prospect that gets emailed lands in email_messages by contact_email, so
      -- the CRM derives "contacted / replied" exactly like it does for customers.
      CREATE TABLE IF NOT EXISTS prospects (
        id TEXT PRIMARY KEY,
        company TEXT NOT NULL,
        segment TEXT,
        website TEXT,
        country TEXT,
        what_they_do TEXT,
        fit_reason TEXT,
        buying_signal TEXT,
        signal_source_url TEXT,
        contact_name TEXT,
        contact_role TEXT,
        contact_email TEXT,
        email_source_url TEXT,
        personalization_hook TEXT,
        confidence TEXT,
        status TEXT DEFAULT 'a_enrichir',
        mail_subject_en TEXT,
        mail_body_en TEXT,
        mail_subject_fr TEXT,
        mail_body_fr TEXT,
        recommended_lang TEXT,
        source TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_prospects_segment ON prospects(segment);
      CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
      CREATE INDEX IF NOT EXISTS idx_prospects_email ON prospects(contact_email);
      -- Per-thread read marker (by counterpart email), like an inbox. A thread is
      -- "unread" when it has an inbound message newer than last_read_at. Set when
      -- Claude-Alain opens the client/prospect in the CRM.
      CREATE TABLE IF NOT EXISTS thread_reads (
        email TEXT PRIMARY KEY,
        last_read_at TEXT
      );
      -- Timeline annotations for the dashboard charts: deploys recorded at
      -- boot, plus manual notes (secret rotation, campaign, press mention).
      -- Correlating a traffic move with "what happened that day" used to
      -- require an archaeology session; these are the dig markers.
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT DEFAULT (datetime('now')),
        kind TEXT NOT NULL CHECK (kind IN ('deploy','manual')),
        label TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_date ON events(created_at);
      -- One row per ISO week: the Monday-morning auto-written digest the
      -- dashboard shows and Telegram delivers. Upserted by week so the cron
      -- can be re-run without duplicating.
      CREATE TABLE IF NOT EXISTS weekly_digest (
        week TEXT PRIMARY KEY,
        created_at TEXT DEFAULT (datetime('now')),
        body_fr TEXT NOT NULL,
        facts_json TEXT NOT NULL
      );
    `);
    // Migrate existing databases that may be missing the new columns
    const existingCols = (statsDB.prepare("PRAGMA table_info(operations)").all() as Array<{ name: string }>).map(r => r.name);
    if (!existingCols.includes('hour')) statsDB.exec('ALTER TABLE operations ADD COLUMN hour INTEGER');
    if (!existingCols.includes('day_of_week')) statsDB.exec('ALTER TABLE operations ADD COLUMN day_of_week INTEGER');
    if (!existingCols.includes('error_detail')) statsDB.exec('ALTER TABLE operations ADD COLUMN error_detail TEXT');
    // Why a column of its own, next to error_detail: error_detail holds a
    // truncated slice of the SUBMITTED value, reject_reason holds only a
    // category from the RejectReason union. Keeping them apart is what lets us
    // count "what agents get rejected for" without retaining what they sent (DPA).
    if (!existingCols.includes('reject_reason')) statsDB.exec('ALTER TABLE operations ADD COLUMN reject_reason TEXT');
    statsDB.exec('CREATE INDEX IF NOT EXISTS idx_operations_reject ON operations(reject_reason)');
    // Which customer asked. request_log already carried key_prefix but holds no
    // country, and operations held the country but not who asked, so "which
    // countries does this customer check" was unanswerable — the question the
    // Clients tab exists for. Forward-only: rows written before 2026-07-30 are
    // attributed by scripts/backfill-operation-keys.ts where a single request
    // can be matched, and stay NULL where it cannot.
    if (!existingCols.includes('key_prefix')) statsDB.exec('ALTER TABLE operations ADD COLUMN key_prefix TEXT');
    statsDB.exec('CREATE INDEX IF NOT EXISTS idx_operations_key ON operations(key_prefix)');
    const keyCols = (statsDB.prepare("PRAGMA table_info(api_keys)").all() as Array<{ name: string }>).map(r => r.name);
    if (!keyCols.includes('monthly_limit')) statsDB.exec('ALTER TABLE api_keys ADD COLUMN monthly_limit INTEGER');
    // Acquisition channel ("src" query param carried by our outbound links:
    // npm README, n8n node, directory listings…). Forward-only and best-effort:
    // NULL means "unattributed", never a guess. Added 2026-08-06 so that new
    // discovery doors can be measured from their first day.
    if (!keyCols.includes('source')) statsDB.exec('ALTER TABLE api_keys ADD COLUMN source TEXT');
    // Credits-based keys (Bundle credits product). When credits_remaining is
    // NULL the key follows the existing monthly subscription model. When it
    // is an integer >= 0 the key consumes from the prepaid bundle (and the
    // monthly_limit is ignored). Decremented atomically per call.
    if (!keyCols.includes('credits_remaining')) statsDB.exec('ALTER TABLE api_keys ADD COLUMN credits_remaining INTEGER');
    if (!keyCols.includes('credits_total')) statsDB.exec('ALTER TABLE api_keys ADD COLUMN credits_total INTEGER');
    // Stripe Checkout session id — links an api_key to the Stripe payment that
    // minted it. Used for idempotency (we never mint twice for the same session)
    // and to retrieve the raw key once via /v1/stripe/key/:session_id.
    if (!keyCols.includes('stripe_session_id')) {
      statsDB.exec('ALTER TABLE api_keys ADD COLUMN stripe_session_id TEXT');
      statsDB.exec('CREATE INDEX IF NOT EXISTS idx_api_keys_stripe_session ON api_keys(stripe_session_id)');
    }
    // Raw API key stored in plaintext for ONE-TIME retrieval after Stripe payment.
    // Nulled out by consumeOneTimeKey() as soon as the buyer fetches it from the
    // success page. Never read by the auth middleware (that uses key_hash).
    if (!keyCols.includes('raw_key_one_time_view')) {
      statsDB.exec('ALTER TABLE api_keys ADD COLUMN raw_key_one_time_view TEXT');
    }
    // Stripe subscription id — set on Editor/OEM subscription keys so
    // customer.subscription.deleted can deactivate the key when the
    // subscription ends (churn must not leave a live key behind).
    if (!keyCols.includes('stripe_subscription_id')) {
      statsDB.exec('ALTER TABLE api_keys ADD COLUMN stripe_subscription_id TEXT');
      statsDB.exec('CREATE INDEX IF NOT EXISTS idx_api_keys_stripe_subscription ON api_keys(stripe_subscription_id)');
    }
    // When a key was deactivated — drives the DPA clause 4.7 commitment:
    // telemetry attributable to a terminated customer is deleted by default
    // 30 days after termination. Keys already inactive before this column
    // existed get "now" as their deactivation date, which starts their
    // 30-day deletion countdown from this deploy (conservative default).
    if (!keyCols.includes('deactivated_at')) {
      statsDB.exec('ALTER TABLE api_keys ADD COLUMN deactivated_at TEXT');
      statsDB.exec("UPDATE api_keys SET deactivated_at = datetime('now') WHERE active = 0 AND deactivated_at IS NULL");
    }
    // Idempotency log for Stripe webhooks — Stripe retries up to 3 days.
    // Insert AFTER successful key mint; presence of stripe_event_id here means
    // "we've already minted for this event, don't do it again".
    statsDB.exec(`
      CREATE TABLE IF NOT EXISTS processed_webhooks (
        stripe_event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        processed_at TEXT DEFAULT (datetime('now'))
      );
    `);
    // One row per (key, month) once the holder has been warned they are near
    // the monthly ceiling. The PRIMARY KEY is the idempotency guarantee: a
    // client burning 190 calls in 12 minutes must get one mail, not 40 — and a
    // 4xx refund that pushes usage back under the threshold must not re-arm it
    // within the same month.
    statsDB.exec(`
      CREATE TABLE IF NOT EXISTS quota_notices (
        key_hash TEXT NOT NULL,
        month    TEXT NOT NULL,
        sent_at  TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (key_hash, month)
      );
    `);
    // Track request provenance: distinguish MCP HTTP / MCP stdio / REST direct / bot / web
    const reqCols = (statsDB.prepare("PRAGMA table_info(request_log)").all() as Array<{ name: string }>).map(r => r.name);
    if (!reqCols.includes('client_kind')) {
      statsDB.exec('ALTER TABLE request_log ADD COLUMN client_kind TEXT');
      statsDB.exec('CREATE INDEX IF NOT EXISTS idx_request_log_client_kind ON request_log(client_kind)');
    }
    // Scanner identification: HMAC-truncated IP hash (clustering, not reversible)
    // and full User-Agent. Used by /admin/scanners to expose top sources of
    // automated traffic. ip_hash uses a server-side secret so dump leaks cannot
    // be rainbow-tabled back to an address.
    if (!reqCols.includes('ip_hash')) {
      statsDB.exec('ALTER TABLE request_log ADD COLUMN ip_hash TEXT');
      statsDB.exec('CREATE INDEX IF NOT EXISTS idx_request_log_ip_hash ON request_log(ip_hash)');
    }
    if (!reqCols.includes('user_agent')) {
      statsDB.exec('ALTER TABLE request_log ADD COLUMN user_agent TEXT');
    }
    // Per-customer attribution: which API key made each request → unlocks the
    // CRM "tools used + activity dates per client" view. Populated forward-only
    // from apiKeyMiddleware (historical rows stay NULL).
    if (!reqCols.includes('key_prefix')) {
      statsDB.exec('ALTER TABLE request_log ADD COLUMN key_prefix TEXT');
      statsDB.exec('CREATE INDEX IF NOT EXISTS idx_request_log_key_prefix ON request_log(key_prefix)');
    }
    // CRM timeline: French translation + detected language of foreign messages.
    const msgCols = (statsDB.prepare('PRAGMA table_info(email_messages)').all() as Array<{ name: string }>).map((r) => r.name);
    if (msgCols.length && !msgCols.includes('snippet_fr')) statsDB.exec('ALTER TABLE email_messages ADD COLUMN snippet_fr TEXT');
    if (msgCols.length && !msgCols.includes('lang')) statsDB.exec('ALTER TABLE email_messages ADD COLUMN lang TEXT');
    if (msgCols.length && !msgCols.includes('body')) statsDB.exec('ALTER TABLE email_messages ADD COLUMN body TEXT');
    // Where the RELATIONSHIP stands, which `status` cannot say.
    //
    // `status` is a sourcing state: is there an address, is the mail ready, has
    // one gone out. Audited 27/07/2026, it was found not to drift from reality
    // (one row out of eighty), so the problem was never that it lied. The
    // problem is that its vocabulary has no way to record an outcome: not
    // interested, not now call me in September, wrong person, in discussion.
    // The only gestures available were archive and reject, which erase the row
    // instead of qualifying it, so nothing learned from a conversation
    // survived to inform the next campaign.
    //
    // Separate columns rather than more `status` values, deliberately.
    // build-contacts branches on 'rejete' in two places and isArchived on
    // 'archive'; the ingester flips 'a_mailer'/'a_enrichir' to 'contacte'.
    // Adding outcomes to that field means auditing every one of those sites
    // and leaves an outcome one re-sync away from being overwritten. These
    // columns are orthogonal to all of it.
    const prospectCols = (statsDB.prepare('PRAGMA table_info(prospects)').all() as Array<{ name: string }>).map((r) => r.name);
    if (prospectCols.length && !prospectCols.includes('outcome')) {
      // 'en_discussion' | 'pas_maintenant' | 'pas_interesse' | 'mauvaise_personne',
      // or NULL for "no outcome recorded", which is not the same as a negative one.
      statsDB.exec('ALTER TABLE prospects ADD COLUMN outcome TEXT');
      statsDB.exec('CREATE INDEX IF NOT EXISTS idx_prospects_outcome ON prospects(outcome)');
    }
    // Why, in the operator's own words. Short and free text on purpose: the
    // reason a deal dies is never one of five buttons, and a wrong button
    // teaches the next campaign the wrong lesson.
    if (prospectCols.length && !prospectCols.includes('outcome_note')) statsDB.exec('ALTER TABLE prospects ADD COLUMN outcome_note TEXT');
    // YYYY-MM-DD. Set with 'pas_maintenant': until that day the contact leaves
    // the day's queue entirely, instead of coming back every ten days like
    // everyone else and being dismissed by hand each time.
    if (prospectCols.length && !prospectCols.includes('wake_up_at')) {
      statsDB.exec('ALTER TABLE prospects ADD COLUMN wake_up_at TEXT');
      statsDB.exec('CREATE INDEX IF NOT EXISTS idx_prospects_wake_up ON prospects(wake_up_at)');
    }
    // When the outcome was recorded, so a stale judgement can be told from a
    // fresh one without reading the thread.
    if (prospectCols.length && !prospectCols.includes('outcome_at')) statsDB.exec('ALTER TABLE prospects ADD COLUMN outcome_at TEXT');
  }
  return statsDB;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function closeAll(): void {
  if (bicDB) {
    bicDB.close();
    bicDB = null;
    resetStatements();
    resetChClearingStatements();
  }
  if (statsDB) {
    statsDB.close();
    statsDB = null;
    resetStatsStatements();
  }
  closeComplianceDB();
}

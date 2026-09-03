import type DatabaseType from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { resetStatements } from './bic-lookup.js';
import { resetNationalRegisterStatements } from './national-registers.js';
import { resetStatsStatements } from './stats.js';
import { closeComplianceDB } from './compliance-db.js';
import { resetChClearingStatements } from './ch-clearing.js';
import { resetPraBanksStatements } from './pra-banks.js';
import { resetOfficialIdentityStatements } from './official-identity.js';
import { resetPsdRegisterStatements } from './psd-register.js';
import { resetBgBaeStatements } from './bg-bae.js';
import { resetBlzStatements } from './de-blz.js';

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

/**
 * Whether the stats database could be opened and migrated, and why not.
 *
 * 🚨 Performance/resilience audit 2026-09-01, finding PERF-03. A corrupt
 * `stats.sqlite` used to kill the process at IMPORT time — `getStatsDB()` is
 * called as a module side effect by `src/routes/feedback.ts`, so the throw
 * happened before `serve()` ever ran. No listener existed, `/health` returned
 * nothing at all, Railway gave up after `restartPolicyMaxRetries = 3`, and the
 * only in-process watchdogs (`ops-probes`) were inside the dead process. Worst
 * case the service stayed down for a month with every automation green.
 *
 * The state below turns that total, silent failure into a diagnosed 503:
 * `/health` reports `databases.stats: "error"` with the SQLite message, Railway
 * keeps restarting a container that at least says what is wrong, and `index.ts`
 * raises an OPS alert at boot. `entrypoint.sh` never overwrites `stats.sqlite`
 * (by design — it holds the API keys), so a corrupt file survives every restart
 * unchanged: being able to READ the diagnosis is the whole fix.
 */
export interface StatsDbState {
  ok: boolean;
  error?: string;
}

let statsDbState: StatsDbState = { ok: true };

/** Last known state of the stats database. Read by `/health`. */
export function getStatsDbState(): StatsDbState {
  return statsDbState;
}

/**
 * Open and migrate the stats database once, at boot, without letting a failure
 * take the process down. Call it from `index.ts` BEFORE `buildApp()` so the
 * outcome is known by the time `/health` can be asked.
 */
export function initStatsDB(): StatsDbState {
  try {
    getStatsDB();
  } catch {
    // getStatsDB already recorded the cause in statsDbState.
  }
  return statsDbState;
}

/**
 * Bound the size of the write-ahead log (audit 2026-09-01, finding PERF-09).
 *
 * Nothing checkpointed the WAL explicitly: only SQLite's passive auto-checkpoint
 * at 1 000 pages ran, and a long-lived reader is enough to keep it from ever
 * truncating. On a Railway volume that is disk that never comes back. TRUNCATE
 * is the only mode that returns the file to zero bytes.
 *
 * Guarded and non-throwing on purpose: this is housekeeping called from the
 * retention tick, and a busy database must never turn it into a boot failure.
 * Returns true when the checkpoint completed without being blocked.
 */
export function checkpointStatsWal(): boolean {
  try {
    const [row] = getStatsDB().pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
    return row?.busy === 0;
  } catch (err) {
    console.error('[db] WAL checkpoint failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Public accessor. The open + migrate sequence lives in `openStatsDB` below;
 * this wrapper exists so that a failure is RECORDED and never leaves a
 * half-initialised handle cached — `openStatsDB` assigns `statsDB` before the
 * first PRAGMA runs, so without this every later caller would have been handed
 * back a connection whose schema migration never completed (audit 2026-09-01).
 */
export function getStatsDB(): DatabaseType.Database {
  try {
    const db = openStatsDB();
    statsDbState = { ok: true };
    return db;
  } catch (err) {
    if (statsDB) {
      try {
        statsDB.close();
      } catch {
        // A handle on a corrupt file can refuse to close; dropping it is enough.
      }
      statsDB = null;
    }
    statsDbState = { ok: false, error: err instanceof Error ? err.message : String(err) };
    throw err;
  }
}

function openStatsDB(): DatabaseType.Database {
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
      -- SIZE BUDGET of request_log (audit 2026-09-01, finding PERF-04).
      -- No backticks and no question mark below: this comment lives inside a
      -- JS template literal, where a backtick ends the string.
      -- Retention is 12 months (src/index.ts, privacy policy + DPA commitment)
      -- and is NOT shortened here: the promise is the promise. What it costs,
      -- measured with dbstat on a 1 095 000-row projection (3 000 req/day):
      --   table                        125.5 Mo
      --   idx_request_log_ip_hash       49.2 Mo   <- the heaviest
      --   idx_request_log_date          33.2 Mo
      --   idx_request_log_path          27.0 Mo
      --   idx_request_log_client_kind   17.5 Mo
      --   idx_request_log_key_prefix    11.2 Mo
      --   stats.sqlite whole           306 Mo     (22 Mo today)
      -- The heaviest index STAYS: EXPLAIN QUERY PLAN on that same projection
      -- shows /admin/scanners uses it twice, once for the ip_hash equality of
      -- the drill-down and once for the IS NOT NULL scan behind the list of top
      -- sources. Dropping it would trade 49 Mo for a full scan of 1.1 M rows on
      -- the only view that tells a scanner from a customer.
      -- No composite index was added for /stats/status-by-path either: once the
      -- query leads with the date (see getStatusByPath), the planner picks
      -- idx_request_log_date, and neither (path, created_at) nor
      -- (created_at, path) is ever chosen. Each would have cost about 40 Mo at
      -- 12 months of retention for no change of plan.
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
      -- Where we are listed, checked daily by a VPS probe. Getting listed is a
      -- one-off effort; staying listed is nobody's job, and a directory purge
      -- is silent. One row per surface per day, so a re-run corrects rather
      -- than duplicates and "last seen present" stays trustworthy.
      CREATE TABLE IF NOT EXISTS visibility_checks (
        surface    TEXT NOT NULL,
        checked_on TEXT NOT NULL,
        state      TEXT NOT NULL CHECK (state IN ('present','absent','error')),
        detail     TEXT,
        url        TEXT,
        PRIMARY KEY (surface, checked_on)
      );
      -- Mail about IBANforge from an address the CRM cannot attach to anyone.
      -- The sync only fetches threads for known addresses, so a customer who
      -- answers from a different address than the one his key is registered
      -- under vanishes: the reply arrives, and nothing says a message was set
      -- aside. Keyed by source message id so a daily re-run corrects instead of
      -- duplicating; the resolved flag is what lets the queue empty rather than
      -- grow without end.
      CREATE TABLE IF NOT EXISTS orphan_mail (
        id          TEXT PRIMARY KEY,
        sender      TEXT NOT NULL,
        subject     TEXT,
        snippet     TEXT,
        msg_date    TEXT NOT NULL,
        kind        TEXT NOT NULL CHECK (kind IN ('reply','first_contact')),
        resolved    INTEGER NOT NULL DEFAULT 0,
        resolved_as TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_orphan_pending ON orphan_mail(resolved, msg_date);
      -- Dated free-text notes per contact address — the operator's working
      -- memory ("migrating from iban.com, decision in September"). Read back
      -- into every AI draft brief, so what the operator knows, the writer
      -- knows.
      CREATE TABLE IF NOT EXISTS contact_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_contact_notes_email ON contact_notes(email);
      -- One cached French thread summary per counterpart address. thread_key
      -- fingerprints the thread state it was written against (message count +
      -- last message date), so a new message naturally invalidates the cache
      -- without any TTL bookkeeping.
      CREATE TABLE IF NOT EXISTS thread_summaries (
        email TEXT PRIMARY KEY,
        thread_key TEXT NOT NULL,
        summary_fr TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
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
    const existingCols = (
      statsDB.prepare('PRAGMA table_info(operations)').all() as Array<{ name: string }>
    ).map((r) => r.name);
    if (!existingCols.includes('hour'))
      statsDB.exec('ALTER TABLE operations ADD COLUMN hour INTEGER');
    if (!existingCols.includes('day_of_week'))
      statsDB.exec('ALTER TABLE operations ADD COLUMN day_of_week INTEGER');
    if (!existingCols.includes('error_detail'))
      statsDB.exec('ALTER TABLE operations ADD COLUMN error_detail TEXT');
    // Why a column of its own, next to error_detail: error_detail holds a
    // truncated slice of the SUBMITTED value, reject_reason holds only a
    // category from the RejectReason union. Keeping them apart is what lets us
    // count "what agents get rejected for" without retaining what they sent (DPA).
    if (!existingCols.includes('reject_reason'))
      statsDB.exec('ALTER TABLE operations ADD COLUMN reject_reason TEXT');
    statsDB.exec('CREATE INDEX IF NOT EXISTS idx_operations_reject ON operations(reject_reason)');
    // Which customer asked. request_log already carried key_prefix but holds no
    // country, and operations held the country but not who asked, so "which
    // countries does this customer check" was unanswerable — the question the
    // Clients tab exists for. Forward-only: rows written before 2026-07-30 are
    // attributed by scripts/backfill-operation-keys.ts where a single request
    // can be matched, and stay NULL where it cannot.
    if (!existingCols.includes('key_prefix'))
      statsDB.exec('ALTER TABLE operations ADD COLUMN key_prefix TEXT');
    statsDB.exec('CREATE INDEX IF NOT EXISTS idx_operations_key ON operations(key_prefix)');
    // French gist of an orphan mail (2026-09-03): the queue is read by a French
    // speaker and nearly every message in it is English. Written once by the
    // dashboard through the VPS writer; NULL until then, never regenerated.
    const orphanCols = (
      statsDB.prepare('PRAGMA table_info(orphan_mail)').all() as Array<{ name: string }>
    ).map((r) => r.name);
    if (orphanCols.length > 0 && !orphanCols.includes('gist_fr'))
      statsDB.exec('ALTER TABLE orphan_mail ADD COLUMN gist_fr TEXT');
    // The full text (03/09/2026): the sync used to send a 300-character
    // snippet and nothing else, so the queue could show a mail but never let
    // the operator READ it. `body` is the original (6,000 chars at most, as
    // the sync sends it), `body_fr` its French translation, written once on
    // demand through the VPS writer.
    if (orphanCols.length > 0 && !orphanCols.includes('body'))
      statsDB.exec('ALTER TABLE orphan_mail ADD COLUMN body TEXT');
    if (orphanCols.length > 0 && !orphanCols.includes('body_fr'))
      statsDB.exec('ALTER TABLE orphan_mail ADD COLUMN body_fr TEXT');
    const keyCols = (
      statsDB.prepare('PRAGMA table_info(api_keys)').all() as Array<{ name: string }>
    ).map((r) => r.name);
    if (!keyCols.includes('monthly_limit'))
      statsDB.exec('ALTER TABLE api_keys ADD COLUMN monthly_limit INTEGER');
    // Acquisition channel ("src" query param carried by our outbound links:
    // npm README, n8n node, directory listings…). Forward-only and best-effort:
    // NULL means "unattributed", never a guess. Added 2026-08-06 so that new
    // discovery doors can be measured from their first day.
    if (!keyCols.includes('source')) statsDB.exec('ALTER TABLE api_keys ADD COLUMN source TEXT');
    // Credits-based keys (Bundle credits product). When credits_remaining is
    // NULL the key follows the existing monthly subscription model. When it
    // is an integer >= 0 the key consumes from the prepaid bundle (and the
    // monthly_limit is ignored). Decremented atomically per call.
    if (!keyCols.includes('credits_remaining'))
      statsDB.exec('ALTER TABLE api_keys ADD COLUMN credits_remaining INTEGER');
    if (!keyCols.includes('credits_total'))
      statsDB.exec('ALTER TABLE api_keys ADD COLUMN credits_total INTEGER');
    // Stripe Checkout session id — links an api_key to the Stripe payment that
    // minted it. Used for idempotency (we never mint twice for the same session)
    // and to retrieve the raw key once via /v1/stripe/key/:session_id.
    if (!keyCols.includes('stripe_session_id')) {
      statsDB.exec('ALTER TABLE api_keys ADD COLUMN stripe_session_id TEXT');
      statsDB.exec(
        'CREATE INDEX IF NOT EXISTS idx_api_keys_stripe_session ON api_keys(stripe_session_id)',
      );
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
      statsDB.exec(
        'CREATE INDEX IF NOT EXISTS idx_api_keys_stripe_subscription ON api_keys(stripe_subscription_id)',
      );
    }
    // When a key was deactivated — drives the DPA clause 4.7 commitment:
    // telemetry attributable to a terminated customer is deleted by default
    // 30 days after termination. Keys already inactive before this column
    // existed get "now" as their deactivation date, which starts their
    // 30-day deletion countdown from this deploy (conservative default).
    if (!keyCols.includes('deactivated_at')) {
      statsDB.exec('ALTER TABLE api_keys ADD COLUMN deactivated_at TEXT');
      statsDB.exec(
        "UPDATE api_keys SET deactivated_at = datetime('now') WHERE active = 0 AND deactivated_at IS NULL",
      );
    }
    // What the buyer was ACTUALLY charged, as the payment provider reported it,
    // in the provider's own minor units (Stripe amount_total: 2000 = $20.00).
    // Added 2026-08-21 (audit B2): until now the only trace of a card purchase
    // was credits_total, and the dollar figure was re-derived from the pack
    // price table (src/lib/business-summary.ts). That derivation is silently
    // retroactive: change a price, run a promotion, refund half, and every
    // past purchase is restated to a number nobody ever paid.
    //
    // 🚨 Deliberately NOT backfilled. Rows written before this column stay
    // NULL, because "we do not know" is the truth for them: writing the
    // inferred amount would make a guess indistinguishable from a measurement
    // for every future reader. Same reason `listed` stays null in a sanctions
    // screen that could not run.
    if (!keyCols.includes('amount_paid_minor')) {
      statsDB.exec('ALTER TABLE api_keys ADD COLUMN amount_paid_minor INTEGER');
    }
    // ISO 4217, lowercase as Stripe sends it ("usd"). Stored beside the amount
    // rather than assumed: a minor-unit integer without its currency is not an
    // amount, and the pack table's implicit USD is exactly the assumption this
    // column exists to stop making.
    if (!keyCols.includes('amount_paid_currency')) {
      statsDB.exec('ALTER TABLE api_keys ADD COLUMN amount_paid_currency TEXT');
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

      -- Tombstones for the out-of-order webhook race: Stripe guarantees no
      -- delivery order, so customer.subscription.deleted can land BEFORE the
      -- checkout.session.completed that mints the key. The deleted handler
      -- found nothing to deactivate, the completed handler then minted a live
      -- OEM key tied to a dead subscription, and the idempotency barrier ate
      -- Stripe's replay of the deleted — an immortal key, invisible in logs.
      -- A subscription id recorded here refuses any later mint against it.
      CREATE TABLE IF NOT EXISTS dead_subscriptions (
        subscription_id TEXT PRIMARY KEY,
        recorded_at TEXT DEFAULT (datetime('now'))
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
      CREATE TABLE IF NOT EXISTS key_creations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_hash TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        -- The client library string and the minted key's prefix, captured at
        -- creation time. A single automated client rotating its network address
        -- keeps the same library string, so it is the field that links otherwise
        -- unrelated creations into one cohort; the prefix ties a creation row to
        -- its key so a matched cohort can be regrouped and flagged.
        user_agent TEXT,
        key_prefix TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_key_creations_ip ON key_creations(ip_hash, created_at);
      -- NOTE: the index on user_agent is created further down, AFTER the ALTER
      -- that adds the column. Creating it here would run before that migration
      -- on a database predating the column, throw "no such column", and abort
      -- the whole schema init.
      CREATE TABLE IF NOT EXISTS pending_verifications (
        email TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL,
        ip_hash TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS verification_sends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_hash TEXT,
        email_hash TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_verification_sends_ip ON verification_sends(ip_hash, created_at);
      CREATE INDEX IF NOT EXISTS idx_verification_sends_email ON verification_sends(email_hash, created_at);
      -- Where each signup came from (src/lib/signup-attribution.ts): the campaign
      -- tag our links carry, whether a browser was involved, and what that
      -- browser knew on arrival. No retention: a path, a host and labels are
      -- not personal data, and the question "which surface produces signups"
      -- is asked over months, not days.
      CREATE TABLE IF NOT EXISTS signup_attribution (
        key_prefix TEXT PRIMARY KEY,
        created_at TEXT DEFAULT (datetime('now')),
        src TEXT,
        client TEXT NOT NULL DEFAULT 'api',
        landing TEXT,
        referrer TEXT,
        utm_source TEXT,
        utm_medium TEXT,
        utm_campaign TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_signup_attribution_created ON signup_attribution(created_at);
      -- One row per creditor-file audit ("audit de fichier", 02/09/2026): the
      -- annotated workbook waits here between the upload and the Stripe
      -- payment, then for the re-download window. Bank details of third
      -- parties live in the report blob, so rows are short-lived by design:
      -- purgeExpiredAuditJobs() removes unpaid jobs after expires_at (2 h) and
      -- paid ones 24 h after payment. Nothing else reads the blob.
      CREATE TABLE IF NOT EXISTS audit_jobs (
        id TEXT PRIMARY KEY,
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        filename TEXT,
        rows INTEGER NOT NULL,
        tier TEXT NOT NULL,
        price_chf INTEGER NOT NULL,
        lang TEXT NOT NULL DEFAULT 'en',
        summary_json TEXT NOT NULL,
        preview_json TEXT NOT NULL,
        report BLOB NOT NULL,
        stripe_session_id TEXT,
        paid_at TEXT,
        payer_email TEXT,
        amount_paid_minor INTEGER,
        amount_paid_currency TEXT,
        downloads INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_audit_jobs_expires ON audit_jobs(expires_at);
      CREATE INDEX IF NOT EXISTS idx_audit_jobs_session ON audit_jobs(stripe_session_id);
      -- Durable ledger of paid audits: audit_jobs rows purge 24 h after payment,
      -- so the sales count and the revenue live here, without any report content.
      CREATE TABLE IF NOT EXISTS audit_sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        paid_at TEXT DEFAULT (datetime('now')),
        rows INTEGER NOT NULL,
        tier TEXT NOT NULL,
        price_chf INTEGER NOT NULL,
        amount_paid_minor INTEGER,
        amount_paid_currency TEXT,
        stripe_session_id TEXT,
        lang TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_sales_paid ON audit_sales(paid_at);
      -- One row per activation nudge ("your key never made its first call"),
      -- and it is the anti-repetition ledger, not a log: the daily pass refuses
      -- any address that already appears here.
      --
      -- Keyed by key_prefix so the trace names the exact key, but the SELECT
      -- that feeds the pass excludes by EMAIL. Someone holding three unused
      -- free keys is one person, and would otherwise receive three copies of
      -- the same message on the same morning. Same reasoning as
      -- src/lib/activation.ts, whose unit is deliberately the address.
      --
      -- delivered is written after the relay answers; the row itself is
      -- inserted BEFORE the send, so a crash mid-flight costs a missed nudge
      -- and never a duplicate one.
      CREATE TABLE IF NOT EXISTS activation_nudges (
        key_prefix TEXT PRIMARY KEY,
        email      TEXT NOT NULL,
        sent_at    TEXT NOT NULL DEFAULT (datetime('now')),
        delivered  INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_activation_nudges_email ON activation_nudges(email);
      -- Community radar: forum/issue threads worth answering (CRM "Forums" tab).
      -- URL is the dedup key: a thread the operator dismissed or answered must
      -- never resurrect as 'new' on the next scan (INSERT OR IGNORE semantics).
      CREATE TABLE IF NOT EXISTS forum_threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        excerpt TEXT,
        lang TEXT NOT NULL DEFAULT 'en',
        score INTEGER NOT NULL DEFAULT 0,
        score_detail TEXT,
        activity TEXT,
        thread_created_at TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        planned_for TEXT,
        draft TEXT,
        draft_fr TEXT,
        summary_fr TEXT,
        posted_url TEXT,
        notes TEXT,
        first_seen TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_forum_threads_status ON forum_threads(status, score);
      -- Marketplace presence: where IBANforge is listed / absent / pending.
      -- Definitions (name, urls, auto) come from code and are re-upserted at
      -- each tick; status/detail/checked_at come from checks; notes and the
      -- status of auto=0 rows belong to the operator and are never overwritten.
      CREATE TABLE IF NOT EXISTS marketplace_checks (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        action_url TEXT,
        status TEXT NOT NULL DEFAULT 'unknown',
        detail TEXT,
        auto INTEGER NOT NULL DEFAULT 1,
        checked_at TEXT,
        notes TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      -- Presence CHANGES are the news a watch exists for (a silent delisting
      -- must ring, not wait to be noticed). Append-only.
      CREATE TABLE IF NOT EXISTS marketplace_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_marketplace_events_at ON marketplace_events(created_at);
    `);
    // Forums tab: the reply is WRITTEN in the thread's language but READ in
    // French — two texts, two columns (draft = what gets copied/posted,
    // draft_fr = the faithful translation shown to the operator).
    // Whether the relay ACCEPTED the code for delivery. Deliberately not named
    // `delivered`: a 200 from the relay means "queued", never "arrived" — the
    // hard bounce lands thirty seconds later in a mailbox nobody reads. Added
    // 2026-08-21, after three days in which our own bounces were nearly every
    // incoming message in the business mailbox and nothing counted them.
    // NULL means "outcome unknown" (rows written before this column existed),
    // and must never be read as success.
    const vsCols = (
      statsDB.prepare('PRAGMA table_info(verification_sends)').all() as Array<{ name: string }>
    ).map((r) => r.name);
    if (vsCols.length && !vsCols.includes('relay_accepted')) {
      statsDB.exec('ALTER TABLE verification_sends ADD COLUMN relay_accepted INTEGER');
    }

    const ftCols = (
      statsDB.prepare('PRAGMA table_info(forum_threads)').all() as Array<{ name: string }>
    ).map((r) => r.name);
    if (ftCols.length && !ftCols.includes('draft_fr'))
      statsDB.exec('ALTER TABLE forum_threads ADD COLUMN draft_fr TEXT');
    // Reply watch: the radar re-reads posted threads; a reply after ours flips
    // needs_attention and pings Telegram. posted_at feeds the one-post-per-
    // platform-per-day guardrail in the UI.
    if (ftCols.length && !ftCols.includes('watch_state'))
      statsDB.exec('ALTER TABLE forum_threads ADD COLUMN watch_state TEXT');
    if (ftCols.length && !ftCols.includes('needs_attention'))
      statsDB.exec(
        'ALTER TABLE forum_threads ADD COLUMN needs_attention INTEGER NOT NULL DEFAULT 0',
      );
    if (ftCols.length && !ftCols.includes('posted_at'))
      statsDB.exec('ALTER TABLE forum_threads ADD COLUMN posted_at TEXT');
    // Track request provenance: distinguish MCP HTTP / MCP stdio / REST direct / bot / web
    const reqCols = (
      statsDB.prepare('PRAGMA table_info(request_log)').all() as Array<{ name: string }>
    ).map((r) => r.name);
    if (!reqCols.includes('client_kind')) {
      statsDB.exec('ALTER TABLE request_log ADD COLUMN client_kind TEXT');
      statsDB.exec(
        'CREATE INDEX IF NOT EXISTS idx_request_log_client_kind ON request_log(client_kind)',
      );
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
      statsDB.exec(
        'CREATE INDEX IF NOT EXISTS idx_request_log_key_prefix ON request_log(key_prefix)',
      );
    }
    // key_creations gained the client library string and minted prefix after the
    // table already existed in production; add them forward-only. Rows written
    // before this migration keep NULL for both.
    const kcCols = (
      statsDB.prepare('PRAGMA table_info(key_creations)').all() as Array<{ name: string }>
    ).map((r) => r.name);
    if (kcCols.length && !kcCols.includes('user_agent')) {
      statsDB.exec('ALTER TABLE key_creations ADD COLUMN user_agent TEXT');
    }
    if (kcCols.length && !kcCols.includes('key_prefix')) {
      statsDB.exec('ALTER TABLE key_creations ADD COLUMN key_prefix TEXT');
    }
    // Unconditional and last: the column exists by now on both paths (fresh
    // CREATE TABLE above, or the ALTER just run).
    statsDB.exec(
      'CREATE INDEX IF NOT EXISTS idx_key_creations_ua ON key_creations(user_agent, created_at)',
    );
    // Undo trail for the cohort radar: what each key's address was before the
    // radar rewrote it. The manual relabel endpoint returns this mapping in its
    // response, but the automatic radar has no caller to hand it to — so a wrong
    // match would be irreversible without persisting it here.
    statsDB.exec(`
      CREATE TABLE IF NOT EXISTS cohort_relabels (
        key_prefix TEXT NOT NULL,
        old_email TEXT NOT NULL,
        address TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_cohort_relabels_addr ON cohort_relabels(address, created_at);
    `);
    // Opt a key out of the monthly quota reset: with this set, the ceiling is
    // measured against lifetime usage instead of the current month, so a key
    // that has already spent its allowance stays spent across month boundaries.
    // Default 0 preserves the normal monthly behaviour for every existing key.
    if (!keyCols.includes('no_recredit')) {
      statsDB.exec('ALTER TABLE api_keys ADD COLUMN no_recredit INTEGER NOT NULL DEFAULT 0');
    }
    // Did WE mint this key, or did its holder ask for it?
    //
    // The distinction has no effect on quota, billing or auth. It exists for one
    // reading that was wrong without it: the Conquest badge, which claims an
    // outbound mail WON a customer. A key we fabricated and handed over
    // ourselves has a mail predating it by construction — we wrote the mail that
    // carried it — so a batch of evaluation pilots minted one spring, never used
    // by the people they were addressed to, all wore the badge. The one number
    // nobody can afford to inflate is the one that says whether prospecting is
    // worth continuing.
    //
    // Backfilled by PATTERN, never by a list of addresses: '-pilot@' is the
    // convention those keys were named with (same regex the dashboard already
    // filters pilots by), and '@cohorte.invalid' is the synthetic contact domain
    // the cohort radar assigns — an address we wrote ourselves is not somebody
    // we won. Anything else stays 0: "we do not know" is not "they came on
    // their own", and forward-only keys carry the flag from their creation.
    if (!keyCols.includes('issued_by_us')) {
      statsDB.exec('ALTER TABLE api_keys ADD COLUMN issued_by_us INTEGER NOT NULL DEFAULT 0');
      statsDB.exec(
        "UPDATE api_keys SET issued_by_us = 1 WHERE email LIKE '%-pilot@%' OR email LIKE '%@cohorte.invalid'",
      );
    }
    // x402 settlement reference — what stripe_session_id is for the card rail,
    // for the USDC one. A credit pack bought with x402 costs up to $80 and used
    // to exist only in the HTTP response that announced it: lose that response
    // and the buyer had paid for a key nobody could ever hand back. This is the
    // handle `raw_key_one_time_view` is retrieved by on that rail
    // (GET /v1/credits/recover/:ref) and the guard that stops one settlement
    // minting two packs.
    //
    // Deliberately NOT stored in stripe_session_id, even though the column
    // exists and would have worked: `src/routes/api-keys.ts` reads
    // `stripe_session_id IS NOT NULL` as "paid by card", so reusing it would
    // have booked USDC revenue as Stripe revenue in the CRM.
    if (!keyCols.includes('x402_payment_ref')) {
      statsDB.exec('ALTER TABLE api_keys ADD COLUMN x402_payment_ref TEXT');
      statsDB.exec(
        'CREATE INDEX IF NOT EXISTS idx_api_keys_x402_ref ON api_keys(x402_payment_ref)',
      );
    }
    // CRM timeline: French translation + detected language of foreign messages.
    const msgCols = (
      statsDB.prepare('PRAGMA table_info(email_messages)').all() as Array<{ name: string }>
    ).map((r) => r.name);
    if (msgCols.length && !msgCols.includes('snippet_fr'))
      statsDB.exec('ALTER TABLE email_messages ADD COLUMN snippet_fr TEXT');
    if (msgCols.length && !msgCols.includes('lang'))
      statsDB.exec('ALTER TABLE email_messages ADD COLUMN lang TEXT');
    if (msgCols.length && !msgCols.includes('body'))
      statsDB.exec('ALTER TABLE email_messages ADD COLUMN body TEXT');
    // "This one needs no answer" — a thank-you, a read receipt, a ticket bot.
    //
    // 🚨 The marker belongs to the MESSAGE, not to the contact, and that is the
    // whole design. A thread leaves the queues while its LAST datable inbound
    // carries the mark; the day they write again, the last inbound is a fresh
    // unmarked one and the thread comes back on its own. No reopening rule to
    // write, no verdict date to compare against — contrast `outcome_at` below,
    // which had to buy both. It also works for contacts who have no prospect
    // row at all (self-service customers, institutional correspondence), since
    // email_messages is keyed by address and knows nothing of sourcing.
    //
    // The four outcome values cannot express this: they describe a COMMERCIAL
    // relationship, and filing a warm thank-you under "pas_interesse" would be
    // a lie that then poisons the outcome counters.
    if (msgCols.length && !msgCols.includes('no_reply_needed')) {
      statsDB.exec(
        'ALTER TABLE email_messages ADD COLUMN no_reply_needed INTEGER NOT NULL DEFAULT 0',
      );
    }
    // Addresses whose future inbound mail is marked on arrival — the "always do
    // this for this correspondent" rule, applied by POST /v1/admin/email-messages.
    //
    // 🚨 Whole-address keys, never fragments. INTERNAL_EMAIL_RE (see
    // src/lib/internal-accounts.ts) is the cautionary tale: a fragment short
    // enough to be convenient swallowed whole customer domains, and that
    // filter mislabelled real accounts for weeks before anyone noticed. Here
    // the same mistake would bury an authority's mail silently, which is worse
    // than the problem the rule exists to solve.
    statsDB.exec(`
      CREATE TABLE IF NOT EXISTS no_reply_senders (
        address    TEXT PRIMARY KEY,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
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
    const prospectCols = (
      statsDB.prepare('PRAGMA table_info(prospects)').all() as Array<{ name: string }>
    ).map((r) => r.name);
    if (prospectCols.length && !prospectCols.includes('outcome')) {
      // 'en_discussion' | 'pas_maintenant' | 'pas_interesse' | 'mauvaise_personne',
      // or NULL for "no outcome recorded", which is not the same as a negative one.
      statsDB.exec('ALTER TABLE prospects ADD COLUMN outcome TEXT');
      statsDB.exec('CREATE INDEX IF NOT EXISTS idx_prospects_outcome ON prospects(outcome)');
    }
    // Why, in the operator's own words. Short and free text on purpose: the
    // reason a deal dies is never one of five buttons, and a wrong button
    // teaches the next campaign the wrong lesson.
    if (prospectCols.length && !prospectCols.includes('outcome_note'))
      statsDB.exec('ALTER TABLE prospects ADD COLUMN outcome_note TEXT');
    // YYYY-MM-DD. Set with 'pas_maintenant': until that day the contact leaves
    // the day's queue entirely, instead of coming back every ten days like
    // everyone else and being dismissed by hand each time.
    if (prospectCols.length && !prospectCols.includes('wake_up_at')) {
      statsDB.exec('ALTER TABLE prospects ADD COLUMN wake_up_at TEXT');
      statsDB.exec('CREATE INDEX IF NOT EXISTS idx_prospects_wake_up ON prospects(wake_up_at)');
    }
    // When the outcome was recorded, so a stale judgement can be told from a
    // fresh one without reading the thread.
    if (prospectCols.length && !prospectCols.includes('outcome_at'))
      statsDB.exec('ALTER TABLE prospects ADD COLUMN outcome_at TEXT');
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
    resetNationalRegisterStatements();
    resetPraBanksStatements();
    resetOfficialIdentityStatements();
    resetPsdRegisterStatements();
    resetBgBaeStatements();
    // Last of the register modules to be wired in: a prepared statement kept
    // across a close would answer from a dead connection on the next German
    // lookup after a reseed.
    resetBlzStatements();
  }
  if (statsDB) {
    statsDB.close();
    statsDB = null;
    resetStatsStatements();
  }
  // A recorded open failure must not outlive the connection it described: after
  // a close the next getStatsDB() decides afresh, otherwise a test (or a reseed)
  // that repairs the file would keep /health red forever (PERF-03, 2026-09-01).
  statsDbState = { ok: true };
  closeComplianceDB();
}

import type DatabaseType from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { resetStatements } from './bic-lookup.js';
import { resetNationalRegisterStatements } from './national-registers.js';
import { buildCanonicalBillableFilter, resetStatsStatements } from './stats.js';
import { closeComplianceDB } from './compliance-db.js';
import { resetChClearingStatements } from './ch-clearing.js';
import { resetPraBanksStatements } from './pra-banks.js';
import { resetOfficialIdentityStatements } from './official-identity.js';
import { resetPsdRegisterStatements } from './psd-register.js';
import { resetBgBaeStatements } from './bg-bae.js';
import { resetBlzStatements } from './de-blz.js';
import { normalizeEmail } from './email-norm.js';
import { resetDailyLedgerStatements } from './daily-ip-ledger.js';
import { resetLineageDayCache } from './lineage-facts.js';

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
      -- agent_signature (Web Bot Auth, 2026-09-09) costs nothing today: it is
      -- NULL on every unsigned request, which is all of them, and holds a short
      -- https origin otherwise. Its index is PARTIAL (signed rows only), so it
      -- stays near zero until an agent actually signs.
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

      -- Les renouvellements d'abonnement (invoice.paid, billing_reason
      -- subscription_cycle) : le seul paiement d'abonnement qu'aucune clé ne
      -- porte. Le premier paiement vit sur la clé frappée au Checkout
      -- (api_keys.amount_paid_minor) et n'entre JAMAIS ici, sinon il serait
      -- compté deux fois. Voir src/lib/subscription-payments.ts.
      --
      -- Deux unicités : l'évènement (Stripe rejoue) et la facture (la même
      -- facture annoncée sous un autre évènement ne compte qu'une fois).
      -- Un montant absent reste NULL, jamais 0 : « on ne nous l'a pas dit »
      -- n'est pas « l'abonné n'a rien payé ».
      --
      -- Hors sauvegarde (src/lib/backup.ts), comme audit_sales et
      -- processed_webhooks : ce registre se reconstitue depuis Stripe, qui garde
      -- chaque facture payée, alors que la sauvegarde ne porte que ce qui ne se
      -- reconstitue pas.
      CREATE TABLE IF NOT EXISTS subscription_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stripe_event_id TEXT NOT NULL UNIQUE,
        invoice_id TEXT NOT NULL UNIQUE,
        subscription_id TEXT NOT NULL,
        key_hash TEXT,
        amount_paid_minor INTEGER,
        amount_paid_currency TEXT,
        billing_reason TEXT,
        paid_at TEXT,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_subscription_payments_sub ON subscription_payments(subscription_id);
      CREATE INDEX IF NOT EXISTS idx_subscription_payments_paid ON subscription_payments(paid_at);
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
        domain_hash TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_verification_sends_ip ON verification_sends(ip_hash, created_at);
      CREATE INDEX IF NOT EXISTS idx_verification_sends_email ON verification_sends(email_hash, created_at);
      -- Un grant d'appareil (RFC 8628) : l'agent ouvre la ligne, l'humain
      -- l'approuve sur une page, l'agent vient chercher la clé UNE fois. La
      -- table porte aussi, sous un autre grant_type, le nonce du Checkout : c'est
      -- le MÊME circuit nonce -> clé, et deux tables jumelles auraient divergé au
      -- premier correctif.
      --
      -- 🚨 Le partage se paie en clauses WHERE, jamais en confiance : toute
      -- fonction qui lit cette table prend le rail en PARAMÈTRE OBLIGATOIRE
      -- (src/lib/device-grant.ts).
      CREATE TABLE IF NOT EXISTS device_codes (
        -- Le secret que l'agent présente pour retirer la clé. Seul son SHA-256
        -- est stocké, exactement comme api_keys.key_hash.
        device_code_hash  TEXT PRIMARY KEY,
        -- Le code court que l'humain tape. NULL pour grant_type='checkout' —
        -- SQLite tolère plusieurs NULL sous une contrainte UNIQUE, ce qui est
        -- exactement ce dont ce rail a besoin.
        user_code         TEXT UNIQUE,
        grant_type        TEXT NOT NULL DEFAULT 'device',   -- 'device' | 'checkout'
        status            TEXT NOT NULL DEFAULT 'pending',  -- pending|approved|delivered|denied|expired
        tier              TEXT,                             -- NULL | 'anonymous' | 'email'
        -- La clé frappée, une fois approuvée. key_hash relie à api_keys ;
        -- raw_key_once porte la clé en clair jusqu'au premier retrait, où la
        -- requête de retrait elle-même la met à NULL, jamais en deux temps.
        key_hash          TEXT,
        raw_key_once      TEXT,
        -- Ce que l'agent a déclaré, nettoyé et tronqué : affiché à l'humain,
        -- jamais exécuté.
        client_name       TEXT,
        reason            TEXT,
        source            TEXT,
        -- 🚨 L'EMPREINTE DU CRÉATEUR, capturée à l'ouverture du grant, parce
        -- qu'elle n'existera plus au moment de la frappe. C'est elle, et elle
        -- seule, qui part au journal des créations. approver_ip_hash est un
        -- indice d'enquête, jamais une ancre, et JAMAIS une exemption de
        -- révocation : les deux valeurs sont choisies par l'appelant.
        ip_hash           TEXT,     -- le réseau qui a OUVERT le grant (keyCreationSource)
        user_agent        TEXT,     -- l'User-Agent de l'AGENT, tronqué à 256
        approver_ip_hash  TEXT,     -- le réseau qui l'a APPROUVÉ : enquête seulement
        -- Jeton d'approbation lié au dernier lookup. Haché, jamais rendu deux fois.
        approval_token_hash        TEXT,
        approval_token_expires_at  TEXT,
        created_at        TEXT DEFAULT (datetime('now')),
        expires_at        TEXT NOT NULL,
        approved_at       TEXT,
        delivered_at      TEXT,
        last_polled_at    TEXT,
        poll_count        INTEGER NOT NULL DEFAULT 0,
        -- La branche e-mail de /approve rallonge l'echeance UNE fois, parce que
        -- le code a 6 chiffres part quand l'humain arrive et non quand le grant
        -- naît : les deux horloges ne partent pas en même temps.
        email_extended    INTEGER NOT NULL DEFAULT 0,
        -- Colonnes du rail checkout. Écrites ici parce que les deux modules
        -- partent ensemble ; sinon, en ALTER forward-only, et l'index sur
        -- stripe_session_id devrait alors être créé APRÈS cet ALTER.
        stripe_session_id TEXT,     -- NULL sur grant_type='device'
        pack              TEXT,     -- '1k' | '5k' | '25k'
        locale            TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_device_codes_expires ON device_codes(expires_at);
      CREATE INDEX IF NOT EXISTS idx_device_codes_status  ON device_codes(status, created_at);
      -- La réservation lit (ip_hash, grant_type, status, expires_at) à chaque ouverture.
      CREATE INDEX IF NOT EXISTS idx_device_codes_ip     ON device_codes(ip_hash, grant_type, status, expires_at);
      -- 🚨 Cet index sert la PURGE (la clé approuvée sans porteur) et l'alerte de
      -- support du rail checkout. Il ne sert AUCUNE clause du radar de cohortes :
      -- la clause de non-révocation qu'une révision antérieure annonçait ici est
      -- SUPPRIMÉE, et ne doit pas être réécrite au motif d'un index orphelin.
      CREATE INDEX IF NOT EXISTS idx_device_codes_key    ON device_codes(key_hash);
      -- Le webhook du paiement cherche la ligne par session quand la référence
      -- client manque.
      CREATE INDEX IF NOT EXISTS idx_device_codes_session ON device_codes(stripe_session_id);
      -- Chaque user_code présenté à lookup/approve/deny. C'est ce qui transforme
      -- « 20^8 combinaisons » en une garantie plutôt qu'en une espérance :
      -- l'entropie borne la chance d'un coup, ce journal borne le NOMBRE de coups.
      --
      -- 🚨 'route' existe pour que lookup ait son propre budget. 'hit' existe pour
      -- que seules les tentatives INFRUCTUEUSES alimentent le BUDGET, et pour rien
      -- d'autre : le DÉLAI qui en découle s'applique à tous les 404, hit compris.
      CREATE TABLE IF NOT EXISTS device_code_attempts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_hash    TEXT,
        route      TEXT NOT NULL DEFAULT 'approve',   -- 'lookup' | 'approve' | 'deny'
        hit        INTEGER NOT NULL DEFAULT 0,        -- 1 si le code existait
        created_at TEXT DEFAULT (datetime('now'))
      );
      -- Les deux index portent 'hit' en tête de queue : toutes les requêtes de
      -- plafond filtrent dessus, et un index qui ne le porte pas ferait scanner
      -- les réussites.
      CREATE INDEX IF NOT EXISTS idx_device_attempts_ip ON device_code_attempts(ip_hash, route, hit, created_at);
      CREATE INDEX IF NOT EXISTS idx_device_attempts_at ON device_code_attempts(hit, created_at);
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
        price INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        lang TEXT NOT NULL DEFAULT 'en',
        summary_json TEXT NOT NULL,
        preview_json TEXT NOT NULL,
        report BLOB NOT NULL,
        stripe_session_id TEXT,
        checkout_params_json TEXT,
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
        price INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
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
    // Le plafond d'envoi par DOMAINE de destinataire (revue du 15/09, constats
    // R9 et P4) : la colonne est ajoutée aux bases existantes, l'index APRÈS
    // l'ALTER (piège 1 du 19/08), et ne compte que les domaines qui ne sont pas
    // des fournisseurs de boîtes publics (src/lib/key-creation-guard.ts).
    const sendCols = (
      statsDB.prepare('PRAGMA table_info(verification_sends)').all() as Array<{ name: string }>
    ).map((r) => r.name);
    if (sendCols.length > 0 && !sendCols.includes('domain_hash')) {
      statsDB.exec('ALTER TABLE verification_sends ADD COLUMN domain_hash TEXT');
    }
    statsDB.exec(
      'CREATE INDEX IF NOT EXISTS idx_verification_sends_domain ON verification_sends(domain_hash, created_at)',
    );
    // La réservation Checkout disparaît avec le rapport ; aucun fichier ni délai ajouté.
    const auditCols = (
      statsDB.prepare('PRAGMA table_info(audit_jobs)').all() as Array<{ name: string }>
    ).map((r) => r.name);
    if (!auditCols.includes('checkout_params_json')) {
      statsDB.exec('ALTER TABLE audit_jobs ADD COLUMN checkout_params_json TEXT');
    }
    // 16/09/2026 : l'audit de fichier est vendu en dollars. La colonne garde le
    // prix affiché ; sa devise vit à côté, CHF pour les lignes d'avant, USD ensuite.
    for (const table of ['audit_jobs', 'audit_sales']) {
      const cols = (
        statsDB.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      ).map((r) => r.name);
      if (cols.includes('price_chf')) {
        statsDB.exec(`ALTER TABLE ${table} RENAME COLUMN price_chf TO price`);
      }
      if (!cols.includes('currency')) {
        statsDB.exec(`ALTER TABLE ${table} ADD COLUMN currency TEXT NOT NULL DEFAULT 'CHF'`);
      }
    }
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
    // ── Palier de clé (chantier « clé sans e-mail », lot 2, 15/09/2026) ──────
    //
    // PLACEMENT : après la migration x402_payment_ref, et jamais dans le bloc
    // de migrations qui commence avec `keyCols` plus haut. Le backfill
    // ci-dessous nomme credits_remaining, stripe_session_id et
    // x402_payment_ref : posé plus haut, il jetterait « no such column » sur
    // une base neuve comme sur une base ancienne, et ferait échouer TOUTE
    // l'initialisation du schéma. C'est la leçon déjà écrite sur key_creations.
    //
    // Défaut 'email' : toute clé antérieure à cette colonne est née d'un chemin
    // qui exigeait une adresse, donc le défaut est vrai pour chacune, pas
    // seulement commode. Le backfill ne corrige qu'un cas, celui où de l'argent
    // a changé de main : ces clés-là n'ont jamais été un palier gratuit, et les
    // lire comme tel ferait mentir tout compteur de « clés gratuites ».
    //
    // 🚨 Il ne pose claimed_at sur AUCUNE ligne ancienne. Rétroactivement, on
    // ne sait pas laquelle a réellement prouvé sa boîte (le code n'était exigé
    // qu'à partir de la deuxième clé d'un réseau) : inventer une preuve serait
    // pire qu'en manquer une. Sans conséquence : la dégradation du bouclier ne
    // s'applique qu'à la naissance, et le radar ne charge que des clés récentes.
    if (!keyCols.includes('tier')) {
      statsDB.exec("ALTER TABLE api_keys ADD COLUMN tier TEXT NOT NULL DEFAULT 'email'");
      statsDB.exec('ALTER TABLE api_keys ADD COLUMN claimed_at TEXT');
      statsDB.exec('ALTER TABLE api_keys ADD COLUMN claim_method TEXT');
      statsDB.exec('ALTER TABLE api_keys ADD COLUMN email_norm TEXT');
      statsDB.exec(
        `UPDATE api_keys SET tier = 'paid'
          WHERE credits_remaining IS NOT NULL
             OR stripe_session_id IS NOT NULL
             OR x402_payment_ref IS NOT NULL`,
      );
      // email_norm : backfill par la MÊME fonction que le code appellera
      // ensuite, en JS et pas en SQL, parce que le retrait des points sur les
      // deux seuls domaines qui les ignorent ne s'écrit pas en SQLite.
      const rows = statsDB.prepare('SELECT id, email FROM api_keys').all() as Array<{
        id: number;
        email: string;
      }>;
      const setNorm = statsDB.prepare('UPDATE api_keys SET email_norm = ? WHERE id = ?');
      statsDB.transaction(() => {
        for (const r of rows) setNorm.run(normalizeEmail(r.email), r.id);
      })();
    }
    // La lignée qui survit à /rotate (origin_prefix, écrit par rotateApiKey) et
    // l'épisode de bouclier (shield_episode, écrit par le disjoncteur, lot 5).
    // Sans origin_prefix, une clé tournée sort du rayon du radar pour un seul
    // appel sur une route libre-service sans plafond.
    if (!keyCols.includes('origin_prefix')) {
      statsDB.exec('ALTER TABLE api_keys ADD COLUMN origin_prefix TEXT');
    }
    if (!keyCols.includes('shield_episode')) {
      statsDB.exec('ALTER TABLE api_keys ADD COLUMN shield_episode TEXT');
    }
    // Les index viennent APRÈS les ALTER, inconditionnellement : à ce stade les
    // colonnes existent par les deux chemins (base neuve ou base migrée).
    statsDB.exec('CREATE INDEX IF NOT EXISTS idx_api_keys_tier ON api_keys(tier, created_at)');
    statsDB.exec('CREATE INDEX IF NOT EXISTS idx_api_keys_email_norm ON api_keys(email_norm)');
    statsDB.exec(
      'CREATE INDEX IF NOT EXISTS idx_api_keys_origin_prefix ON api_keys(origin_prefix)',
    );
    statsDB.exec(
      'CREATE INDEX IF NOT EXISTS idx_api_keys_shield_episode ON api_keys(shield_episode)',
    );
    // key_prefix n'a jamais porté d'unicité, et toute lecture clée dessus (le
    // rapport d'usage, le radar) mélange les porteurs d'un même préfixe. Le
    // mint refait désormais un tirage en cas de collision ; l'index ne fait que
    // figer ce que le code garantit. Sous garde : un CREATE UNIQUE INDEX nu
    // jette si un doublon existe déjà et ferait échouer TOUTE l'ouverture de la
    // base — une API qui ne démarre plus est pire qu'un index absent.
    const dupePrefixes = (
      statsDB
        .prepare(
          'SELECT COUNT(*) AS n FROM (SELECT key_prefix FROM api_keys GROUP BY key_prefix HAVING COUNT(*) > 1)',
        )
        .get() as { n: number }
    ).n;
    if (dupePrefixes === 0) {
      statsDB.exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_prefix_unique ON api_keys(key_prefix)',
      );
    } else {
      console.error(
        `[schema] ${dupePrefixes} duplicate key_prefix values: the unique index is NOT created. ` +
          'Every read keyed on key_prefix (usage report, cohort radar) mixes those holders. Resolve by hand.',
      );
      statsDB.exec('CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix)');
    }
    // Deux journaux en ajout seul, que l'appelant ne contrôle pas (spec 01
    // §3.4 et §3.5). key_claims : réclamations et envois de code, lus par la
    // clause « cette adresse porte déjà une clé », par le plafond par réseau et
    // par le détecteur d'armement. key_settlements : une ligne par règlement,
    // référence unique, montant COTÉ par le paywall et non confirmé.
    // 🚨 Les tables neuves n'entrent pas d'elles-mêmes dans la sauvegarde :
    // src/lib/backup.ts les nomme explicitement (format 2).
    statsDB.exec(`
      CREATE TABLE IF NOT EXISTS key_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        email_norm TEXT,
        key_prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        method TEXT,
        ip_hash TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_key_claims_email ON key_claims(email_norm, event, created_at);
      CREATE INDEX IF NOT EXISTS idx_key_claims_at ON key_claims(created_at);
      CREATE INDEX IF NOT EXISTS idx_key_claims_ip ON key_claims(ip_hash, event, created_at);
      CREATE TABLE IF NOT EXISTS key_settlements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_hash TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        payment_ref TEXT NOT NULL UNIQUE,
        quoted_amount_usd REAL NOT NULL,
        route TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_key_settlements_hash ON key_settlements(key_hash, created_at);
      CREATE INDEX IF NOT EXISTS idx_key_creations_created ON key_creations(created_at);
    `);
    // pending_verifications.key_prefix : NULL = défi du chemin de création,
    // comportement inchangé octet pour octet ; sinon la clé qu'un défi de
    // réclamation vise. Sans elle, un code émis pour CRÉER une clé serait
    // consommable pour en RÉCLAMER une autre, et l'inverse.
    const pvCols = (
      statsDB.prepare('PRAGMA table_info(pending_verifications)').all() as Array<{ name: string }>
    ).map((r) => r.name);
    if (pvCols.length > 0 && !pvCols.includes('key_prefix')) {
      statsDB.exec('ALTER TABLE pending_verifications ADD COLUMN key_prefix TEXT');
    }
    // ── Journal d'annulation du radar de cohortes (lot 6, 15/09/2026) ────────
    //
    // Une clé coupée pour rafale doit pouvoir être RENDUE. C'est la seule
    // écriture de tout ce chantier qui ne se rembobine pas par un revert du
    // code : la migration se laisse, le schéma reste, mais une clé désactivée
    // reste désactivée. D'où l'ancien solde, consigné ici au moment de la coupe.
    //
    // 🚨 « L'ancien solde » n'est PAS credits_remaining. Une clé mensuelle n'a
    // pas de solde : cette colonne vaut NULL pour elle (l'INSERT du mint libre
    // ne l'écrit pas). Sont donc consignés le plafond du moment
    // (prev_monthly_limit), les unités déjà consommées TOUS MOIS CONFONDUS
    // (prev_units_used — ces clés portent no_recredit, et c'est sur cette base
    // que leur plafond se mesure), prev_no_recredit et prev_active pour rendre
    // exactement l'état d'avant, et prev_credits_remaining comme témoin, pour
    // que le journal se relise sans supposer les clauses du rayon.
    //
    // 🚨 RÉTENTION : aucune purge, jamais. Poser active = 0 démarre l'horloge de
    // purgeTerminatedKeyTelemetry(30), qui supprime les lignes request_log de la
    // clé trente jours après sa désactivation. Passé ce délai, ce journal est la
    // SEULE trace de ce que la clé a fait, et une purge dessus rendrait
    // l'annulation impossible.
    //
    // 🚨 La restauration se fait par key_hash, jamais par key_prefix : ce
    // dernier n'a porté aucune unicité dans la base héritée, et un UPDATE sans
    // LIMIT sur une colonne non unique touche toutes les lignes du préfixe.
    // key_prefix et origin_prefix restent pour la lecture humaine du journal.
    //
    // 🚨 Cette table n'entre pas d'elle-même dans la sauvegarde :
    // src/lib/backup.ts nomme ses tables explicitement (format 2).
    statsDB.exec(`
      CREATE TABLE IF NOT EXISTS key_revocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_prefix TEXT NOT NULL,
        origin_prefix TEXT,
        key_hash TEXT NOT NULL,
        revoked_at TEXT NOT NULL DEFAULT (datetime('now')),
        reason TEXT NOT NULL,
        episode_id TEXT,
        anchor TEXT NOT NULL,
        anchor_share REAL NOT NULL,
        anchor_keys INTEGER NOT NULL,
        burst_from TEXT NOT NULL,
        burst_to TEXT NOT NULL,
        burst_keys INTEGER NOT NULL,
        window_minutes REAL NOT NULL,
        distinct_sources INTEGER NOT NULL,
        prev_active INTEGER NOT NULL,
        prev_monthly_limit INTEGER,
        prev_units_used INTEGER NOT NULL,
        prev_no_recredit INTEGER NOT NULL,
        prev_credits_remaining INTEGER,
        restored_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_key_revocations_episode ON key_revocations(episode_id, revoked_at);
      CREATE INDEX IF NOT EXISTS idx_key_revocations_prefix ON key_revocations(key_prefix);
      CREATE INDEX IF NOT EXISTS idx_key_revocations_hash ON key_revocations(key_hash, restored_at);
    `);
    // ── Journal des bascules du disjoncteur (lot 5, 15/09/2026) ──────────────
    //
    // Une ligne par bascule, dans les deux sens. C'est la seule trace qui
    // permette de relire un épisode APRÈS coup : quand il s'est armé, avec
    // quel volume et depuis combien de réseaux, quand et pourquoi il est
    // retombé, et combien de clés la remontée automatique a rendues.
    //
    // 🚨 `direction` et `reason` sont DEUX colonnes, pas une. Un opérateur
    // filtre sur le sens (« montre-moi les armements ») et lit le motif ;
    // un seul jeton `disarmed_capped` obligerait chaque requête à connaître
    // par cœur la liste des variantes de désarmement pour compter les
    // désarmements.
    //
    // 🚨 `"trigger"` est cité entre guillemets partout où il apparaît : c'est
    // un mot-clé SQL. SQLite l'accepte nu comme nom de colonne, mais la
    // requête recopiée ailleurs ne passerait pas, et un lecteur pressé ne le
    // saurait qu'au moment de la panne. Seule la valeur `'creations'` est
    // écrite aujourd'hui ; `'claims'` et `'trial'` sont RÉSERVÉES pour les
    // deux détecteurs qui partiront en observation seule, et qui n'existent
    // pas encore. Une colonne prévue coûte zéro ; une migration de plus sur
    // `api_keys` coûte une soirée.
    //
    // `threshold` et `window_minutes` sont consignés à chaque bascule : le jour
    // où ces bornes seront re-calées sur un nouveau relevé de la ligne de base,
    // les anciennes lignes doivent rester lisibles avec les réglages qui
    // avaient cours.
    //
    // Rétention : aucune purge. Deux lignes par épisode, quelques épisodes par
    // an — et une table qui explique une dégradation ne se jette pas.
    statsDB.exec(`
      CREATE TABLE IF NOT EXISTS breaker_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        episode_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        reason TEXT NOT NULL,
        "trigger" TEXT NOT NULL,
        creations_in_window INTEGER NOT NULL,
        distinct_sources INTEGER NOT NULL,
        threshold INTEGER NOT NULL,
        window_minutes INTEGER NOT NULL,
        undegraded INTEGER NOT NULL DEFAULT 0,
        telegram_sent INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_breaker_transitions_at ON breaker_transitions(created_at);
      CREATE INDEX IF NOT EXISTS idx_breaker_transitions_ep ON breaker_transitions(episode_id, created_at);
    `);
    // Web Bot Auth (RFC 9421): who signed the request, in one column.
    //
    // Four readings:
    //   https://host[:port]  the ORIGIN of the JWKS directory announced in the
    //                        Signature-Agent header. The origin and not the raw
    //                        string, because the identity Web Bot Auth attributes
    //                        IS the directory, and because a whole header lets the
    //                        CALLER pick our cardinality: 128 random bytes per
    //                        request would inflate a table with twelve months of
    //                        retention and turn the GROUP BY behind /admin/scanners
    //                        into a scan, on a synchronous handle sitting in front
    //                        of paying traffic.
    //   'malformed'          Signature-Agent was there but is not an https URL.
    //   'unnamed'            signed (Signature-Input) without saying where to verify.
    //   NULL                 no signature header at all — 100% of traffic in 2026.
    // We log what is RECEIVED, never what is valid: hence a sentinel rather than a
    // silent drop. The exact bad string stays in the day's access logs, not here.
    //
    // 🚨 The ALTER comes first and the index after it: an index named in the
    // CREATE TABLE block above would reference a column that does not exist yet
    // on an old database, openStatsDB() would throw, and the API would not boot.
    if (!reqCols.includes('agent_signature')) {
      statsDB.exec('ALTER TABLE request_log ADD COLUMN agent_signature TEXT');
      statsDB.exec(
        'CREATE INDEX IF NOT EXISTS idx_request_log_agent_signature ON request_log(agent_signature) WHERE agent_signature IS NOT NULL',
      );
    }
    // Le NOM de l'outil MCP appelé (22/09/2026).
    //
    // Tout `/mcp` se rangeait sous un seul chemin : `validate_iban`,
    // `check_compliance` et `request_api_key` étaient indiscernables dans le
    // journal, donc on ne pouvait pas dire ce que les agents viennent chercher
    // — alors que la route parse déjà ce nom pour compter les unités et le
    // jetait ensuite.
    //
    // 🚨 Une COLONNE et non un suffixe de `path` : les compteurs existants
    // testent l'égalité `path = '/mcp:tools-call'` (télémétrie, usage par
    // service, classification du client). Un chemin par outil les mettrait
    // tous à zéro sans qu'aucun test ne rougisse ailleurs.
    //
    // Index partiel : la colonne est NULL sur tout le trafic REST, c'est-à-dire
    // la quasi-totalité des lignes, et un index plein paierait pour elles.
    if (!reqCols.includes('tool_name')) {
      statsDB.exec('ALTER TABLE request_log ADD COLUMN tool_name TEXT');
      statsDB.exec(
        'CREATE INDEX IF NOT EXISTS idx_request_log_tool_name ON request_log(tool_name) WHERE tool_name IS NOT NULL',
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
    // Who pressed send — 'claude' (the agent wrote and sent it with no click),
    // 'dashboard' (the operator's own composer), NULL (a copy the nightly IMAP
    // sync read back, or anything that did not say).
    //
    // Nullable, unlike no_reply_needed above, and that difference is the whole
    // point. "Nobody said" and "the mailbox" are the same answer here, so NULL
    // is a truthful value rather than a missing one, and it is what lets the
    // upsert write COALESCE(excluded.origin, origin): a re-sync that knows
    // nothing keeps the mark, while a later POST that knows can still place
    // one on a row already stored. no_reply_needed could buy neither, since
    // its "unmarked" is 0 and COALESCE cannot tell 0 from a decision.
    if (msgCols.length && !msgCols.includes('origin'))
      statsDB.exec('ALTER TABLE email_messages ADD COLUMN origin TEXT');
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
    // ─── Registre des franchises d'essai (lot 4, 15/09/2026) ────────────────
    //
    // Bloc autonome posé en DERNIER, exprès : des `CREATE TABLE IF NOT EXISTS`
    // (`trial_weekly` s'y ajoute le 24/09/2026) et aucun `ALTER`, donc aucun index à créer après une colonne ajoutée et
    // aucune garde `PRAGMA table_info` (le piège du 19/08, qui empêchait l'API
    // de démarrer, n'a pas de prise ici). Le placer à la fin garde la région
    // isolée des autres chantiers qui migrent `api_keys` en parallèle.
    statsDB.exec(`
      -- Le compteur de toutes les franchises mesurées par source et par jour :
      -- l'essai REST sans clé, les appels d'outils MCP, les ouvertures de
      -- session MCP. Porté de la mémoire vers ici le 15/09/2026 : un
      -- redéploiement oubliait tout, et le compteur d'une franchise ne
      -- survivait pas à une mise en production. Ce n'est PAS une promesse de
      -- partage entre instances : le service tourne sur un seul conteneur avec
      -- un volume à attachement unique (railway.toml, numReplicas = 1), et
      -- SQLite sur volume ne suivrait pas une seconde réplique.
      --
      -- Pas de contre-apostrophe et pas de point d'interrogation dans ce
      -- commentaire : il vit dans un littéral de gabarit JS, où la
      -- contre-apostrophe termine la chaîne (même note que request_log).
      --
      -- La colonne bucket est la clé NAMESPACÉE de la SOURCE ('rest:<h>',
      -- '<h>', 'init:<h>'), où <h> est hashIp(normalizeIpForGuard(ip)) : l'IPv6
      -- repliée sur son /64 PUIS hachée avec le sel du service. Jamais une
      -- adresse, ni en clair ni entière.
      --   - le /64 parce qu'un abonné IPv6 se voit remettre un préfixe entier
      --     et peut y choisir une adresse neuve gratuitement : compter
      --     l'adresse revient à ne rien compter (key-creation-guard.ts:45-60) ;
      --   - le hachage parce que toute adresse persistée dans ce fichier est
      --     hachée (request_log.ip_hash, key_creations.ip_hash) et que rien ici
      --     n'a besoin de l'adresse en clair : la table n'est lue que par sa
      --     clé complète ou par une plage sur la colonne day.
      -- Les seaux 'unknown' et 'evt:*' n'arrivent JAMAIS ici (MEMORY_ONLY).
      --
      -- Les compteurs repartent de zéro une fois à la mise en production : les
      -- clés de seau changent de forme (même note que normalizeIpForGuard).
      --
      -- DEUX horodatages, deux signaux DIFFÉRENTS :
      --   - first_seen : quand le seau est APPARU. Posé à l'insertion, jamais
      --     réécrit. Mesure l'arrivée de sources neuves.
      --   - last_seen  : quand le seau a DÉPENSÉ pour la dernière fois.
      --     Réécrit à chaque dépense comptée. Mesure la charge, et c'est le
      --     seul des deux qu'un amorçage lent ne contourne pas.
      --
      -- Format des horodatages : celui de datetime('now'),
      -- 'YYYY-MM-DD HH:MM:SS' UTC, comme toutes les autres colonnes
      -- temporelles de ce fichier. Surtout PAS l'ISO 8601 de toISOString() :
      -- 'T' (0x54) est supérieur à l'espace (0x20) en comparaison
      -- lexicographique, donc une fenêtre glissante écrite en
      -- WHERE last_seen >= datetime('now', modificateur) serait TOUJOURS VRAIE
      -- et les 60 minutes deviendraient un compte depuis minuit, sans erreur
      -- et sans test rouge.
      CREATE TABLE IF NOT EXISTS trial_ledger (
        day        TEXT    NOT NULL,
        bucket     TEXT    NOT NULL,
        units      INTEGER NOT NULL DEFAULT 0,
        first_seen TEXT    NOT NULL,
        last_seen  TEXT    NOT NULL,
        PRIMARY KEY (day, bucket)
      ) WITHOUT ROWID;
      -- Ce qui reste d'une journée d'essai une fois ses lignes purgées.
      -- Quelques dizaines d'octets par jour, et le seul moyen de dire APRÈS
      -- COUP ce qui s'est passé. Écrite par snapshotTrialDay(), juste avant la
      -- purge, qui SORT SANS ÉCRIRE quand la journée ne compte aucun seau :
      -- sinon le passage suivant recalculerait des zéros sur une table vide et
      -- écraserait la seule trace. shield_minutes a un AUTRE écrivain, le tick
      -- du disjoncteur (lot 5) : les deux requêtes se partagent la ligne sans
      -- se marcher dessus, d'où son DEFAULT 0.
      --
      -- 🚨 Aucune source individuelle ici, même hachée : cette table est un
      -- agrégat et n'a AUCUNE politique de rétention. Une colonne « top 20 des
      -- seaux » y ferait vivre des identifiants de source plus longtemps que
      -- les 12 mois de request_log, qui est l'endroit prévu pour l'attribution
      -- fine et qui, lui, a une politique. Des COMPTES, jamais des sources.
      CREATE TABLE IF NOT EXISTS trial_daily (
        day                     TEXT    PRIMARY KEY,
        rest_buckets            INTEGER NOT NULL,
        rest_units_counted      INTEGER NOT NULL,
        rest_attempts_uncounted INTEGER NOT NULL DEFAULT 0,
        rest_over_limit         INTEGER NOT NULL,
        peak_hour_buckets       INTEGER NOT NULL,
        mcp_buckets             INTEGER NOT NULL,
        mcp_units               INTEGER NOT NULL,
        init_buckets            INTEGER NOT NULL,
        shield_minutes          INTEGER NOT NULL DEFAULT 0,
        created_at              TEXT    DEFAULT (datetime('now'))
      ) WITHOUT ROWID;
      -- Le compteur de la SEMAINE de l'essai REST sans clé (24/09/2026 :
      -- 25 appels par semaine et par source, semaine ISO en UTC). Une table à
      -- part, et non des seaux quotidiens sommés depuis le lundi : garder les
      -- lignes rest de trial_ledger sept jours ferait réécrire par des zéros,
      -- une heure après minuit, la trace que snapshotTrialDay vient d'écrire
      -- (elle ne s'abstient que sur une journée vide), et la somme par source
      -- balaierait toute la semaine sur une clé (day, bucket). trial_ledger,
      -- trial_daily et les plafonds MCP quotidiens restent donc intacts.
      --
      -- week = le lundi « YYYY-MM-DD » de la semaine ISO en UTC ; bucket = le
      -- même seau haché que trial_ledger ('rest:<h>'), jamais une adresse.
      -- Purgée par le tick horaire dès que la semaine est passée.
      CREATE TABLE IF NOT EXISTS trial_weekly (
        week   TEXT    NOT NULL,
        bucket TEXT    NOT NULL,
        units  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (week, bucket)
      ) WITHOUT ROWID;
      -- ─── Les deux portes d'une identité d'AGENT, par jour ────────────────
      -- (chantier « mesure agents », 15/09/2026)
      --
      -- Pourquoi des agrégats plutôt qu'une lecture de l'existant : device_codes
      -- est purgée a 24 h, donc toute lecture d'hier rendrait zero, sans erreur
      -- et sans test rouge ; et la surface MCP distante ne laisse dans
      -- request_log que le chemin /mcp, jamais le nom de l'outil, ou
      -- request_api_key est indiscernable d'une validation.
      --
      -- Bloc AUTONOME, comme le registre d'essai juste au-dessus : deux
      -- CREATE TABLE IF NOT EXISTS, aucun ALTER, donc aucune garde
      -- PRAGMA table_info et aucun index posé sur une colonne créée plus bas
      -- (le piege du 19/08, qui empechait l'API de demarrer).
      --
      -- Pas de contre-apostrophe et pas de point d'interrogation dans ces
      -- commentaires : ils vivent dans un litteral de gabarit JS, ou la
      -- contre-apostrophe termine la chaine.
      --
      -- 🚨 DES COMPTES, JAMAIS UNE SOURCE INDIVIDUELLE. Aucune adresse meme
      -- hachee, aucun User-Agent, aucun user_code, aucun device_code, aucune
      -- cle. C'est cette pauvrete qui autorise ces deux tables a vivre sans
      -- politique de retention, exactement comme trial_daily.
      --
      -- 🚨 La colonne source est reduite a TROIS valeurs
      -- ('web-device', 'mcp-device', 'other') par normalizeDeviceDoor. La
      -- source d'un grant est une chaine LIBRE choisie par l'appelant
      -- (normalizeGrantSource accepte [a-z0-9_-]{1,40}) : la stocker telle
      -- quelle ferait de cette colonne un jeu d'identifiants non borne, choisi
      -- par l'appelant, conserve pour toujours. Trois lignes par jour au plus.
      --
      -- Les compteurs sont incrementes AU MOMENT DE LA DECISION, par les routes
      -- et par la purge, jamais recalcules. Consequence a lire avant de lire
      -- les chiffres : expired veut dire « expiration TRANCHEE par la purge ce
      -- jour-la », pas « grant dont le TTL est passe » ; et opened ne s'additionne
      -- pas en approved + denied + expired + delivered, parce qu'un grant encore
      -- en attente au moment de la lecture n'est dans aucun seau terminal.
      CREATE TABLE IF NOT EXISTS device_grant_daily (
        day                TEXT    NOT NULL,
        source             TEXT    NOT NULL,
        opened             INTEGER NOT NULL DEFAULT 0,
        rate_limited       INTEGER NOT NULL DEFAULT 0,
        approved_anonymous INTEGER NOT NULL DEFAULT 0,
        approved_email     INTEGER NOT NULL DEFAULT 0,
        denied             INTEGER NOT NULL DEFAULT 0,
        expired            INTEGER NOT NULL DEFAULT 0,
        delivered          INTEGER NOT NULL DEFAULT 0,
        created_at         TEXT    DEFAULT (datetime('now')),
        PRIMARY KEY (day, source)
      ) WITHOUT ROWID;
      -- Le haut de l'entonnoir MCP distant : ouvertures de session, appels
      -- d'outils, et appels de l'outil qui demande une cle.
      --
      -- 🚨 Ces trois compteurs sont des APPELS SANS IDENTITE : cette surface
      -- sert sans cle, donc AUCUNE de ces lignes n'est rattachable a une
      -- lignee. Le funnel les publie dans un bloc a part avec cette note.
      --
      -- tool_calls compte des APPELS D'OUTILS et non des unites facturees :
      -- request_api_key coute zero unite (MCP_FREE_TOOLS) et reste un appel a
      -- mesurer, alors que le registre trial_ledger, lui, ne compte que des
      -- unites et ne le voit donc pas du tout.
      CREATE TABLE IF NOT EXISTS mcp_remote_daily (
        day          TEXT    PRIMARY KEY,
        sessions     INTEGER NOT NULL DEFAULT 0,
        tool_calls   INTEGER NOT NULL DEFAULT 0,
        key_requests INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT    DEFAULT (datetime('now'))
      ) WITHOUT ROWID;
    `);
    migrateLineageFacts(statsDB);
  }
  return statsDB;
}

/**
 * Les faits de mesure de l'essai : une ligne par LIGNÉE de clé (lot M,
 * 15/09/2026, contrat de mesure du même jour).
 *
 * Posé en DERNIER, après le registre d'essai du lot 4, et sorti dans sa propre
 * fonction pour qu'un chantier voisin qui migre `api_keys` ne se retrouve pas à
 * fusionner dans la même région de fichier. Il nomme `origin_prefix`,
 * `claimed_at`, `tier` et `key_settlements` : tous posés plus haut, donc
 * l'ordre est celui qu'exige le piège 1 du 19/08 (un index ou un backfill qui
 * nomme une colonne créée plus bas fait échouer TOUTE l'ouverture, et l'API ne
 * démarre plus).
 *
 * Les trois rattrapages sont écrits pour pouvoir être rejoués : le premier ne
 * touche que les lignes à `lineage_hash IS NULL`, le deuxième est un
 * `INSERT OR IGNORE`, le troisième ne s'exécute que si le deuxième a
 * réellement inséré quelque chose.
 */
function migrateLineageFacts(statsDB: DatabaseType.Database): void {
  // ─── 1. La référence interne stable, sur api_keys ─────────────────────────
  //
  // Le contrat l'exige : « les préfixes de clé ne constituent pas des
  // identifiants uniques garantis : employer côté serveur une référence
  // interne stable, conserver origin_prefix pour la compatibilité du radar ».
  // La référence est la `key_hash` de la clé NÉE : elle est unique par
  // construction (contrainte UNIQUE d'origine), elle ne voyage jamais dans une
  // réponse, et elle survit à N rotations parce que `rotateApiKey` la recopie.
  const keyCols = (
    statsDB.prepare('PRAGMA table_info(api_keys)').all() as Array<{ name: string }>
  ).map((r) => r.name);
  if (!keyCols.includes('lineage_hash')) {
    statsDB.exec('ALTER TABLE api_keys ADD COLUMN lineage_hash TEXT');
  }
  // L'index APRÈS l'ALTER, inconditionnellement : à ce stade la colonne existe
  // par les deux chemins (base neuve ou base migrée).
  statsDB.exec('CREATE INDEX IF NOT EXISTS idx_api_keys_lineage ON api_keys(lineage_hash)');

  // ─── 2. La table des faits ────────────────────────────────────────────────
  //
  // Une ligne par lignée, et les « premiers » écrits UNE fois : toute écriture
  // passe par un COALESCE, donc rejouer le même fait deux fois ne change rien.
  // Le dédoublonnage est une propriété de la forme, pas d'un identifiant
  // d'événement à comparer.
  //
  // Pas de contre-apostrophe et pas de point d'interrogation dans les
  // commentaires SQL ci-dessous : ils vivent dans un littéral de gabarit JS,
  // ou la contre-apostrophe termine la chaîne.
  //
  // AUCUN corps métier, aucun IBAN, aucune adresse, aucune IP, aucune clé,
  // aucun secret : des hachages, des dates UTC au format de datetime('now'),
  // des routes canoniques et des contextes pris dans des valeurs contrôlées.
  statsDB.exec(`
    CREATE TABLE IF NOT EXISTS lineage_facts (
      -- La key_hash de la clé née. Jamais servie, jamais journalisée ailleurs.
      lineage_hash              TEXT PRIMARY KEY,
      -- Format de datetime('now'), 'YYYY-MM-DD HH:MM:SS' UTC, comme toutes les
      -- autres colonnes temporelles de ce fichier. Surtout PAS l'ISO 8601 de
      -- toISOString() : 'T' (0x54) est superieur a l'espace (0x20) en
      -- comparaison lexicographique, donc une fenetre glissante ecrite en
      -- WHERE ... >= datetime('now', modificateur) serait TOUJOURS VRAIE.
      birth_at                  TEXT,
      -- Le palier lu A LA NAISSANCE quand la ligne est ecrite au fil de l'eau.
      -- Sur une ligne RATTRAPEE, c'est le palier COURANT de la cle d'origine :
      -- une reclamation reecrit la colonne tier sur place, donc le palier de
      -- naissance n'est pas reconstituable apres coup. Approximation assumee et
      -- sans consequence : les indicateurs ne lisent que les lignes au fil de
      -- l'eau.
      birth_tier                TEXT,
      birth_source              TEXT,
      -- Page d'arrivée (chemin canonique seulement), site référent réduit à son
      -- DOMAINE, et page sur laquelle la clé a été remise. Lus de
      -- signup_attribution, qui les valide déjà champ par champ. NULL = inconnu,
      -- jamais une valeur devinée. delivery_page reste NULL tant que le site
      -- n'envoie pas la page de remise : signup_attribution ne porte
      -- aujourd'hui que la page d'ARRIVEE.
      entry_landing             TEXT,
      entry_referrer_domain     TEXT,
      delivery_page             TEXT,
      -- Le premier appel métier 2xx, sa route canonique, et le contexte observé.
      first_success_at          TEXT,
      first_success_route       TEXT,
      -- 'demo' (panneau du site), 'unknown' (client sans marqueur) ou 'traces'
      -- (premier observe dans les traces conservées, donc reconstitué après
      -- coup et jamais confondu avec un fait écrit au fil de l'eau).
      first_success_context     TEXT,
      -- Premier succès dont le contexte n'est PAS 'demo'. « Hors panneau »
      -- signifie contexte observé, pas preuve d'un vrai dossier : la part de
      -- contexte inconnu est publiée à côté. JAMAIS posé par un rattrapage,
      -- ou l'on déduirait « production » d'une trace muette.
      first_unmarked_success_at TEXT,
      -- Un succès dans [premier succès + 7 j, premier succès + 14 j[. Calculé
      -- A L'ECRITURE parce qu'il ne se déduit pas de first/last : une lignée
      -- active en semaine 2 puis en semaine 5 a un last_success hors fenêtre.
      week2_success_at          TEXT,
      last_success_at           TEXT,
      -- Le jour UTC du dernier succès compté, qui rend success_days idempotent
      -- EN BASE et pas seulement en mémoire : sans lui, un redéploiement en
      -- milieu de journée vide le cache mémoire et compte le jour deux fois.
      last_success_day          TEXT,
      success_days              INTEGER NOT NULL DEFAULT 0,
      first_claim_at            TEXT,
      claim_method              TEXT,
      first_settlement_at       TEXT,
      settlement_count          INTEGER NOT NULL DEFAULT 0,
      -- La clé PAYEE remise à ce porteur, quand le rapprochement est sans
      -- ambiguïté. Reliée commercialement, jamais fusionnée : ni les quotas ni
      -- les droits ne se réunissent (contrat du 15/09).
      paid_key_hash             TEXT,
      paid_key_delivered_at     TEXT,
      paid_first_success_at     TEXT,
      -- 1 = ligne reconstituée à la migration, 0 = ligne écrite au fil de l'eau.
      -- C'est ce drapeau qui donne un sens à « depuis le démarrage de la
      -- nouvelle mesure » : les dénominateurs ne retiennent que les lignes à 0.
      backfilled                INTEGER NOT NULL DEFAULT 0,
      updated_at                TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_lineage_facts_birth ON lineage_facts(backfilled, birth_at);
    CREATE INDEX IF NOT EXISTS idx_lineage_facts_paid ON lineage_facts(paid_key_hash);
    CREATE INDEX IF NOT EXISTS idx_lineage_facts_first ON lineage_facts(first_success_at);
  `);

  // ─── 2bis. La FAMILLE de client d'un succès (« mesure agents », 15/09) ────
  //
  // Deux colonnes ajoutées APRÈS le CREATE ci-dessus, gardées par
  // `PRAGMA table_info` : sur une base neuve la table vient d'être créée sans
  // elles, sur une base migrée elles peuvent déjà être là, et un ALTER répété
  // ferait échouer TOUTE l'ouverture (le piège du 19/08 : l'API ne démarre
  // plus). Aucun index dessus, volontairement : la ventilation du funnel est un
  // balayage de la cohorte déjà filtrée par `idx_lineage_facts_birth`, et un
  // index de faible cardinalité (huit valeurs) ne servirait qu'à coûter une
  // écriture de plus sur le chemin chaud.
  //
  // 🚨 Une FAMILLE prise dans une liste fermée, jamais l'User-Agent lui-même :
  // voir `lineage-clients.ts`, qui porte la liste et la raison.
  const lineageCols = (
    statsDB.prepare('PRAGMA table_info(lineage_facts)').all() as Array<{ name: string }>
  ).map((r) => r.name);
  if (!lineageCols.includes('first_success_client')) {
    statsDB.exec('ALTER TABLE lineage_facts ADD COLUMN first_success_client TEXT');
  }
  if (!lineageCols.includes('last_success_client')) {
    statsDB.exec('ALTER TABLE lineage_facts ADD COLUMN last_success_client TEXT');
  }

  // ─── 3. Rattrapage de lineage_hash, en JS, une fois ───────────────────────
  //
  // En JS et pas en SQL parce que le cas ambigu se DECIDE : une clé qui porte
  // un origin_prefix dont plusieurs lignes revendiquent le préfixe n'a pas de
  // lignée connaissable, et le contrat dit d'écarter la correspondance, pas de
  // choisir la première. Écartée, elle devient sa propre lignée.
  //
  // 🚨 Jamais de regroupement par `email = 'anonymous'` : la sentinelle est
  // partagée par tout le monde, et le contrat l'interdit nommément — ce serait
  // réunir toutes les clés anonymes du service en une seule lignée.
  const needsLineage = statsDB
    .prepare('SELECT 1 AS one FROM api_keys WHERE lineage_hash IS NULL LIMIT 1')
    .get() as { one: number } | undefined;
  if (needsLineage) {
    const rows = statsDB
      .prepare(
        'SELECT id, key_hash, origin_prefix FROM api_keys WHERE lineage_hash IS NULL ORDER BY id',
      )
      .all() as Array<{ id: number; key_hash: string; origin_prefix: string | null }>;
    // Un préfixe vers UNE seule key_hash, et seulement quand il est unique.
    const byPrefix = new Map<string, string | null>();
    for (const r of statsDB.prepare('SELECT key_prefix, key_hash FROM api_keys').all() as Array<{
      key_prefix: string;
      key_hash: string;
    }>) {
      byPrefix.set(r.key_prefix, byPrefix.has(r.key_prefix) ? null : r.key_hash);
    }
    const setLineage = statsDB.prepare('UPDATE api_keys SET lineage_hash = ? WHERE id = ?');
    let ambiguous = 0;
    statsDB.transaction(() => {
      for (const r of rows) {
        let lineage = r.key_hash;
        if (r.origin_prefix) {
          const resolved = byPrefix.get(r.origin_prefix);
          if (resolved) lineage = resolved;
          else ambiguous++;
        }
        setLineage.run(lineage, r.id);
      }
    })();
    if (ambiguous > 0) {
      console.warn(
        `[lineage] correspondance ambiguë écartée pour ${ambiguous} clé(s) : ` +
          'origin_prefix sans ligne unique, chacune devient sa propre lignée',
      );
    }
  }

  // ─── 4. Rattrapage des naissances, depuis api_keys ────────────────────────
  //
  // La ligne d'ORIGINE d'une lignée est celle dont key_hash = lineage_hash.
  // birth_at prend le MIN du groupe plutôt que la date de cette ligne : si elle
  // a disparu, la lignée garde une naissance plausible au lieu de n'en avoir
  // aucune. Palier, source et attribution restent lus sur la ligne d'origine,
  // et valent NULL quand elle manque — inconnu, pas devine.
  const inserted = statsDB
    .prepare(
      `INSERT OR IGNORE INTO lineage_facts
         (lineage_hash, birth_at, birth_tier, birth_source, entry_landing, entry_referrer_domain,
          first_claim_at, claim_method, first_settlement_at, settlement_count, backfilled, updated_at)
       SELECT k.lineage_hash,
              MIN(k.created_at),
              (SELECT o.tier   FROM api_keys o WHERE o.key_hash = k.lineage_hash),
              (SELECT o.source FROM api_keys o WHERE o.key_hash = k.lineage_hash),
              (SELECT a.landing  FROM signup_attribution a
                 JOIN api_keys o ON o.key_prefix = a.key_prefix
                WHERE o.key_hash = k.lineage_hash),
              (SELECT a.referrer FROM signup_attribution a
                 JOIN api_keys o ON o.key_prefix = a.key_prefix
                WHERE o.key_hash = k.lineage_hash),
              (SELECT MIN(c.claimed_at) FROM api_keys c
                WHERE c.lineage_hash = k.lineage_hash AND c.claimed_at IS NOT NULL),
              (SELECT c.claim_method FROM api_keys c
                WHERE c.lineage_hash = k.lineage_hash AND c.claimed_at IS NOT NULL
                ORDER BY c.claimed_at LIMIT 1),
              (SELECT MIN(s.created_at) FROM key_settlements s
                 JOIN api_keys j ON j.key_hash = s.key_hash
                WHERE j.lineage_hash = k.lineage_hash),
              (SELECT COUNT(*) FROM key_settlements s
                 JOIN api_keys j ON j.key_hash = s.key_hash
                WHERE j.lineage_hash = k.lineage_hash),
              1,
              datetime('now')
         FROM api_keys k
        WHERE k.lineage_hash IS NOT NULL
        GROUP BY k.lineage_hash`,
    )
    .run();

  // ─── 5. Rattrapage des « premiers » depuis request_log ────────────────────
  //
  // Seulement quand l'étape 4 a réellement inséré : au deuxième démarrage elle
  // n'insère plus rien et ce balayage ne coûte rien. Le résultat est étiqueté
  // 'traces', c'est-à-dire « premier OBSERVE dans les traces conservées » : la
  // purge des 12 mois a pu emporter le vrai premier appel, et le contrat exige
  // que les deux ne soient jamais confondus.
  //
  // Le filtre est celui de la mesure au fil de l'eau, par ÉGALITÉ sur la route
  // canonique. Il compte donc moins qu'un LIKE : une ligne écrite avant la
  // normalisation des chemins n'y entre pas. Assumé — réintroduire le préfixe
  // textuel ferait diverger le rattrapage du fil de l'eau, et le contrat
  // interdit de reconnaître une route à son seul préfixe.
  //
  // 🚨 SOUS try/catch, et c'est la seule étape qui l'est : les quatre
  // précédentes sont structurelles, celle-ci ne fait que reconstituer un passé.
  // Une exception ici remonterait jusqu'à openStatsDB(), et l'API ne
  // démarrerait plus — le prix exact du piège du 19/08, pour un agrément. Si
  // elle échoue, la reconstruction est perdue (l'étape 4 n'insérera plus rien
  // au démarrage suivant) et la mesure au fil de l'eau reste entière.
  //
  // C'est aussi le seul balayage lourd du bloc : il lit request_log en entier,
  // une fois, au tout premier démarrage après la livraison. À regarder dans les
  // journaux de déploiement.
  if (inserted.changes > 0) {
    try {
      backfillLineageFirstsFromTraces(statsDB);
    } catch (err) {
      console.error(
        '[lineage] rattrapage des premiers depuis les traces abandonné :',
        err instanceof Error ? err.message : err,
      );
    }
  }
  // Même garde que ci-dessus : une remise à niveau est un agrément, jamais une
  // raison de ne pas démarrer.
  try {
    repairBackfilledRouteVerbs(statsDB);
  } catch (err) {
    console.error(
      '[lineage] remise à niveau des routes rattrapées abandonnée :',
      err instanceof Error ? err.message : err,
    );
  }
}

/** Étape 5 de la migration ci-dessus, sortie pour que son échec soit borné. */
function backfillLineageFirstsFromTraces(statsDB: DatabaseType.Database): void {
  const billable = buildCanonicalBillableFilter();
  const traces = statsDB
    .prepare(
      `SELECT k.lineage_hash AS lineage,
              MIN(r.created_at) AS first_at,
              MAX(r.created_at) AS last_at,
              COUNT(DISTINCT date(r.created_at)) AS days,
              -- La route de la PREMIERE ligne : created_at est de largeur fixe,
              -- donc le minimum lexicographique de la concaténation est celui
              -- de la date, et le suffixe est la route qui l'accompagne — au
              -- MEME format que le fil de l'eau, verbe compris (canonicalRouteOf).
              MIN(r.created_at || '|' || r.method || ' ' || r.path) AS first_pair
         FROM request_log r
         JOIN api_keys k ON k.key_prefix = r.key_prefix
        WHERE r.key_prefix IS NOT NULL
          AND r.status >= 200 AND r.status < 300
          AND k.lineage_hash IS NOT NULL
          AND (${billable.sql})
          AND r.key_prefix NOT IN (
            SELECT key_prefix FROM api_keys
             GROUP BY key_prefix HAVING COUNT(DISTINCT lineage_hash) > 1)
        GROUP BY k.lineage_hash`,
    )
    .all(...billable.params) as Array<{
    lineage: string;
    first_at: string;
    last_at: string;
    days: number;
    first_pair: string;
  }>;
  const update = statsDB.prepare(
    `UPDATE lineage_facts
        SET first_success_at      = COALESCE(first_success_at, ?),
            first_success_route   = COALESCE(first_success_route, ?),
            first_success_context = COALESCE(first_success_context, 'traces'),
            last_success_at       = COALESCE(last_success_at, ?),
            last_success_day      = COALESCE(last_success_day, ?),
            success_days          = MAX(success_days, ?),
            updated_at            = datetime('now')
      WHERE lineage_hash = ? AND first_success_at IS NULL`,
  );
  statsDB.transaction(() => {
    for (const t of traces) {
      const route = t.first_pair.slice(t.first_at.length + 1);
      update.run(t.first_at, route, t.last_at, t.last_at.slice(0, 10), t.days, t.lineage);
    }
  })();
}

/**
 * Remise à niveau des routes rattrapées SANS verbe (première livraison du 15/09,
 * qui écrivait le seul chemin) : le verbe d'une famille métier se déduit de sa
 * route, et le fil de l'eau écrit « VERBE chemin ». Idempotent : ne touche que
 * les lignes 'traces' dont la route ne porte pas encore d'espace.
 */
function repairBackfilledRouteVerbs(statsDB: DatabaseType.Database): void {
  statsDB
    .prepare(
      `UPDATE lineage_facts
          SET first_success_route = CASE
                WHEN first_success_route LIKE '/v1/bic/%' OR first_success_route LIKE '/v1/ch/clearing/%'
                THEN 'GET ' ELSE 'POST ' END || first_success_route
        WHERE first_success_context = 'traces'
          AND first_success_route IS NOT NULL
          AND first_success_route NOT LIKE '% %'`,
    )
    .run();
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
    // Le registre d'essai garde ses huit requêtes préparées au niveau module :
    // sans cette ligne, la première dépense après une réouverture répondrait
    // depuis une connexion morte (même motif que resetBlzStatements ci-dessus).
    resetDailyLedgerStatements();
    // Le cache de jour de la mesure des lignées (lot M) survivait à une
    // réouverture : une écriture sautée après fermeture puis réouverture, sans
    // qu'aucun test ne rougisse (revue du 15/09, constat R5).
    resetLineageDayCache();
  }
  // A recorded open failure must not outlive the connection it described: after
  // a close the next getStatsDB() decides afresh, otherwise a test (or a reseed)
  // that repairs the file would keep /health red forever (PERF-03, 2026-09-01).
  statsDbState = { ok: true };
  closeComplianceDB();
}

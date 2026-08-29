/**
 * The first-call machine, I/O half: reads the key ledger, sends the one nudge,
 * writes the founder draft, and runs itself once a day inside the API process.
 *
 * Same shape as the cohort and lifecycle radars (an hourly tick that asks kv
 * whether a run is due, so the daily cadence survives a redeploy without ever
 * double-firing after one) and the same contract: nothing here may throw into
 * the server, and nothing here runs on a request path.
 *
 * What leaves on its own, and what does not:
 *   - the activation nudge is SENT, at most once per address, ever;
 *   - the founder draft is only WRITTEN, into the CRM, for Claude-Alain to
 *     read, edit and send by hand. No code path in this repository sends it.
 *
 * Kill switch: ACTIVATION_NUDGE_DISABLED=1 stops the sending half. Drafts keep
 * being written, because nothing leaves the building when a draft is created.
 */
import { getStatsDB } from './db.js';
import { kvGet, kvSet } from './forum-radar-server.js';
import { isEmailConfigured, sendActivationNudgeEmail } from './email.js';
import { loadAliasMap, toCanonical } from './email-aliases.js';
import { buildFounderDraft, draftId } from './activation-nudge.js';
import {
  DRAFT_LOOKBACK_HOURS,
  DRAFT_MAX_PER_PASS,
  NUDGE_MAX_AGE_DAYS,
  NUDGE_MAX_PER_PASS,
  NUDGE_MIN_AGE_HOURS,
  isExcludedFromOutreach,
  selectNudgeCandidates,
  type NudgeCandidateRow,
} from './activation-nudge.js';

const TICK_MS = 60 * 60 * 1000;
/** Offset from the lifecycle (5'), forum (3'), prospect (4') and cohort (6') radars. */
const BOOT_DELAY_MS = 7 * 60 * 1000;
/** Daily, redeploy-proof: a restart cannot make the pass fire twice in a day. */
const DUE_AFTER_MS = 20 * 60 * 60 * 1000;

const KV_LAST_RUN = 'activation_nudge_last_run';
const KV_LAST_REPORT = 'activation_nudge_last_report';

/** SQLite refuses more than 999 bound parameters on older builds; stay well under. */
const IN_CHUNK = 400;

export interface ActivationPassReport {
  finished_at: string;
  nudges_enabled: boolean;
  /** Why the sending half stayed quiet, when it did. */
  nudges_skipped_reason?: 'kill_switch' | 'mail_not_configured';
  nudge_candidates: number;
  nudges_sent: number;
  nudges_failed: number;
  nudged: Array<{ email: string; key_prefix: string; delivered: boolean }>;
  draft_candidates: number;
  drafts_created: number;
  drafted: string[];
  errors: string[];
}

export function isNudgeDisabled(): boolean {
  const v = (process.env.ACTIVATION_NUDGE_DISABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

// ---------------------------------------------------------------------------
// Reading the ledger
// ---------------------------------------------------------------------------

/**
 * Keys old enough to have been used, young enough for the message to be true,
 * belonging to an address this pass has never written to.
 *
 * The anti-repetition clause is on EMAIL, not on key_prefix: three unused keys
 * behind one mailbox are one person (see the table comment in ./db.ts).
 *
 * Exclusions are applied in JS afterwards, not in SQL, exactly like
 * loadCreations() in ./cohort-radar-server.ts: the internal-account rule is one
 * regexp with an env-driven tail, and expressing it as a bound IN-list is what
 * blew past SQLite's parameter ceiling here once already.
 */
function loadNudgeCandidates(): NudgeCandidateRow[] {
  const db = getStatsDB();
  const rows = db
    .prepare(
      `SELECT k.key_prefix, k.email, k.created_at,
              COALESCE(u.total, 0) AS usage_units,
              MAX(COALESCE(k.credits_total, 0) - COALESCE(k.credits_remaining, 0), 0) AS credits_used
         FROM api_keys k
         LEFT JOIN (SELECT key_hash, SUM(count) AS total FROM api_usage GROUP BY key_hash) u
                ON u.key_hash = k.key_hash
        WHERE k.active = 1
          AND k.created_at <= datetime('now', ?)
          AND k.created_at >= datetime('now', ?)
          AND NOT EXISTS (SELECT 1 FROM activation_nudges n WHERE n.email = k.email)
        ORDER BY k.created_at DESC`,
    )
    .all(`-${NUDGE_MIN_AGE_HOURS} hours`, `-${NUDGE_MAX_AGE_DAYS} days`) as Array<
    Omit<NudgeCandidateRow, 'logged_calls'>
  >;

  const kept = rows.filter((r) => !isExcludedFromOutreach(r.email));
  if (kept.length === 0) return [];

  // The third silence: no authenticated call was ever logged for this prefix,
  // whatever its status. Batched, because request_log is the big table.
  const called = new Set<string>();
  const prefixes = kept.map((r) => r.key_prefix);
  for (let i = 0; i < prefixes.length; i += IN_CHUNK) {
    const chunk = prefixes.slice(i, i + IN_CHUNK);
    const found = db
      .prepare(
        `SELECT DISTINCT key_prefix FROM request_log
          WHERE key_prefix IN (${chunk.map(() => '?').join(',')})`,
      )
      .all(...chunk) as Array<{ key_prefix: string }>;
    for (const f of found) called.add(f.key_prefix);
  }

  return kept.map((r) => ({ ...r, logged_calls: called.has(r.key_prefix) ? 1 : 0 }));
}

/**
 * Addresses whose first key is a day or two old, for the founder draft.
 *
 * OLDEST first, the opposite of the nudge. A signup drops out of this window
 * for good once it passes DRAFT_LOOKBACK_HOURS, so serving the newest first is
 * how the oldest starve: on a busy couple of days they would be pushed past the
 * per-pass ceiling every time and fall off the edge never having been written
 * about. Closest to the edge goes first.
 */
function loadDraftCandidates(): Array<{ email: string; created_at: string }> {
  const rows = getStatsDB()
    .prepare(
      `SELECT k.email, k.created_at
         FROM api_keys k
        WHERE k.active = 1
          AND k.created_at >= datetime('now', ?)
        ORDER BY k.created_at ASC`,
    )
    .all(`-${DRAFT_LOOKBACK_HOURS} hours`) as Array<{ email: string; created_at: string }>;
  return rows.filter((r) => !isExcludedFromOutreach(r.email));
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Writes the founder draft for one address, and refuses in three cases: an
 * existing conversation of any direction, an existing draft under the same id,
 * or a race between the two.
 *
 * ON CONFLICT DO NOTHING, deliberately the opposite of the ingest endpoint
 * (POST /v1/admin/email-messages upserts, because a re-sync must refresh a
 * message). Here an existing draft may be one Claude-Alain has already edited,
 * and overwriting his text with a generated one is the single worst thing this
 * pass could do.
 *
 * Returns true only when a row was actually created.
 */
function createFounderDraftIfAbsent(canonicalEmail: string, now: Date): boolean {
  const db = getStatsDB();
  // Any existing message at all, in either direction, means this is not a
  // silent new signup: a thread exists and a generated draft has no place in it.
  const existing = db
    .prepare('SELECT 1 FROM email_messages WHERE customer_email = ? LIMIT 1')
    .get(canonicalEmail);
  if (existing) return false;

  const { subject, body } = buildFounderDraft();
  const res = db
    .prepare(
      `INSERT INTO email_messages (id, customer_email, direction, msg_date, subject, snippet, body, counterparty)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, '')
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(
      draftId(canonicalEmail),
      canonicalEmail,
      now.toISOString().slice(0, 16),
      subject.slice(0, 500),
      body.replace(/\s+/g, ' ').trim().slice(0, 280),
      body.slice(0, 6000),
    );
  return res.changes > 0;
}

/**
 * Claims the single nudge for an address BEFORE the mail is attempted.
 *
 * Order matters and is not the one the radars use for Telegram. A nudge lost to
 * a crash costs one message nobody sees; a nudge sent twice costs the
 * credibility of the only channel where this product speaks in the first
 * person. So the claim is written first, and a delivery that then fails leaves
 * a visible `delivered = 0` row in the admin report rather than a second send.
 *
 * Returns false when another pass already claimed this address.
 */
function claimNudge(email: string, keyPrefix: string): boolean {
  const res = getStatsDB()
    .prepare(
      `INSERT INTO activation_nudges (key_prefix, email, sent_at, delivered)
       VALUES (?, ?, datetime('now'), 0)
       ON CONFLICT(key_prefix) DO NOTHING`,
    )
    .run(keyPrefix, email);
  return res.changes > 0;
}

function markDelivered(keyPrefix: string): void {
  getStatsDB().prepare('UPDATE activation_nudges SET delivered = 1 WHERE key_prefix = ?').run(keyPrefix);
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

let running = false;

export async function runActivationPass(now: Date = new Date()): Promise<ActivationPassReport> {
  const report: ActivationPassReport = {
    finished_at: now.toISOString(),
    nudges_enabled: !isNudgeDisabled(),
    nudge_candidates: 0,
    nudges_sent: 0,
    nudges_failed: 0,
    nudged: [],
    draft_candidates: 0,
    drafts_created: 0,
    drafted: [],
    errors: [],
  };
  if (running) {
    report.errors.push('already_running');
    return report;
  }
  running = true;
  try {
    // --- 1. The nudge -----------------------------------------------------
    const candidates = selectNudgeCandidates(loadNudgeCandidates(), NUDGE_MAX_PER_PASS);
    report.nudge_candidates = candidates.length;

    if (isNudgeDisabled()) {
      report.nudges_skipped_reason = 'kill_switch';
    } else if (!isEmailConfigured()) {
      // Claiming an address while no relay exists would burn its only nudge on
      // a send that never happened. Nothing is claimed until mail can leave.
      report.nudges_skipped_reason = 'mail_not_configured';
    } else {
      for (const cand of candidates) {
        const email = cand.email.trim().toLowerCase();
        try {
          if (!claimNudge(email, cand.key_prefix)) continue;
          const ok = await sendActivationNudgeEmail({ to: email, keyPrefix: cand.key_prefix });
          if (ok) {
            markDelivered(cand.key_prefix);
            report.nudges_sent++;
          } else {
            report.nudges_failed++;
          }
          report.nudged.push({ email, key_prefix: cand.key_prefix, delivered: ok });
        } catch (err) {
          report.errors.push(`nudge ${cand.key_prefix}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // --- 2. The founder draft --------------------------------------------
    const aliasMap = loadAliasMap();
    const seen = new Set<string>();
    const draftRows = loadDraftCandidates();
    for (const row of draftRows) {
      // The ceiling counts drafts WRITTEN, not addresses looked at. An address
      // that already has a thread costs one indexed SELECT and nothing else, so
      // letting it eat a slot would let a backlog of already-handled customers
      // crowd out the new signup this pass exists for.
      if (report.drafts_created >= DRAFT_MAX_PER_PASS) break;
      // Alias-resolved like the ingest endpoint, or a second address would
      // split the thread in two and the "already has a thread" guard would
      // miss the half it does not know about.
      const canonical = toCanonical(row.email.trim().toLowerCase(), aliasMap);
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      report.draft_candidates++;
      try {
        if (createFounderDraftIfAbsent(canonical, now)) {
          report.drafts_created++;
          report.drafted.push(canonical);
        }
      } catch (err) {
        report.errors.push(`draft ${canonical}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    kvSet(KV_LAST_REPORT, JSON.stringify(report));
    kvSet(KV_LAST_RUN, report.finished_at);
    return report;
  } finally {
    running = false;
  }
}

export function isActivationPassRunning(): boolean {
  return running;
}

export function lastActivationReport(): { last_run_at: string | null; report: ActivationPassReport | null } {
  let parsed: ActivationPassReport | null;
  try {
    parsed = JSON.parse(kvGet(KV_LAST_REPORT) ?? 'null') as ActivationPassReport | null;
  } catch {
    parsed = null;
  }
  return { last_run_at: kvGet(KV_LAST_RUN) ?? null, report: parsed };
}

/** The durable ledger: who has already received their one nudge, and whether it landed. */
export function getNudgeLedger(
  limit = 200,
): Array<{ key_prefix: string; email: string; sent_at: string; delivered: number }> {
  return getStatsDB()
    .prepare(
      `SELECT key_prefix, email, sent_at, delivered FROM activation_nudges
        ORDER BY sent_at DESC LIMIT ?`,
    )
    .all(Math.max(1, Math.min(1000, limit))) as Array<{
    key_prefix: string;
    email: string;
    sent_at: string;
    delivered: number;
  }>;
}

/** Hourly tick, at most one pass per ~day. Never throws upward. */
export function startActivationNudge(): void {
  const tick = async (): Promise<void> => {
    try {
      const last = kvGet(KV_LAST_RUN);
      if (last && Date.now() - new Date(last).getTime() < DUE_AFTER_MS) return;
      await runActivationPass();
    } catch (err) {
      console.error('[activation-nudge] pass failed:', err instanceof Error ? err.message : err);
    }
  };
  setTimeout(() => void tick(), BOOT_DELAY_MS).unref();
  setInterval(() => void tick(), TICK_MS).unref();
}

/**
 * Lifecycle radar, run INSIDE the API process.
 *
 * This job used to run in a CI workflow, which meant the full customer ledger
 * (GET /v1/admin/keys) transited an external runner every day — a processor
 * the privacy policy then had to declare. Running it here, the data never
 * leaves the machine that already holds it; only the formatted report (key
 * prefixes and company/domain labels, no email addresses) goes out, to the
 * operator's Telegram.
 *
 * Mechanics: an hourly tick checks whether a run is due (last run > 20 h ago,
 * so the daily cadence survives redeploys without ever double-firing after
 * one). The runner calls its own admin endpoints over loopback — same JSON
 * contract the detection logic has always consumed, no route refactor — and
 * persists the anti-repetition state in stats.sqlite instead of a CI cache.
 * Send-before-save is preserved: if Telegram delivery throws, the state is
 * not advanced and the same events retry on the next due run.
 */
import { getStatsDB } from './db.js';
import {
  detectEvents,
  diffAgainstState,
  fetchAdmin,
  formatReport,
  type ClientActivityResponse,
  type KeysResponse,
  type RadarState,
} from './lifecycle-radar.js';

const TICK_MS = 60 * 60 * 1000; // hourly "is a run due?" check
const DUE_AFTER_MS = 20 * 60 * 60 * 1000; // daily cadence, redeploy-proof
const BOOT_DELAY_MS = 5 * 60 * 1000; // let the server settle first

const STATE_KEY = 'lifecycle_radar_state';

function ensureKvTable(): void {
  getStatsDB().exec(`
    CREATE TABLE IF NOT EXISTS kv_state (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function loadState(): RadarState {
  try {
    ensureKvTable();
    const row = getStatsDB()
      .prepare('SELECT value FROM kv_state WHERE key = ?')
      .get(STATE_KEY) as { value: string } | undefined;
    if (!row) return { keys: {} };
    const parsed = JSON.parse(row.value) as Partial<RadarState>;
    return { last_run_at: parsed.last_run_at, keys: parsed.keys ?? {} };
  } catch {
    return { keys: {} };
  }
}

function saveState(state: RadarState): void {
  ensureKvTable();
  getStatsDB()
    .prepare(
      `INSERT INTO kv_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(STATE_KEY, JSON.stringify(state));
}

/** Telegram caps messages at 4096 chars; split on newlines under a safe limit. */
function splitForTelegram(text: string, limit = 3900): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let buf = '';
  for (const para of text.split('\n')) {
    if ((buf + '\n' + para).length > limit && buf) {
      chunks.push(buf);
      buf = para;
    } else {
      buf = buf ? `${buf}\n${para}` : para;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

async function sendTelegram(token: string, chat: string, text: string): Promise<void> {
  for (const chunk of splitForTelegram(text)) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'User-Agent': 'ibanforge-backend', // some WAFs 403 the default node UA
      },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ chat_id: chat, text: chunk, disable_web_page_preview: true }),
    });
    const body = (await res.json()) as { ok: boolean; description?: string };
    if (!body.ok) throw new Error(`Telegram send failed: ${body.description}`);
  }
}

async function runOnce(port: number): Promise<void> {
  const secret = process.env.ADMIN_SECRET ?? '';
  const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  const chat = process.env.TELEGRAM_CHAT_ID ?? '';
  if (!secret || !token || !chat) {
    console.log('[radar] ADMIN_SECRET/TELEGRAM_* not set — lifecycle radar skipped');
    return;
  }

  const base = `http://127.0.0.1:${port}`;
  const now = new Date();
  const [keysRes, activity] = await Promise.all([
    fetchAdmin<KeysResponse>(base, secret, '/v1/admin/keys'),
    fetchAdmin<ClientActivityResponse>(base, secret, '/v1/admin/client-activity'),
  ]);

  const state = loadState();
  const lastRunAt = state.last_run_at ? new Date(state.last_run_at) : undefined;
  const events = detectEvents(keysRes.keys, { now, lastRunAt });
  const { fresh, nextState } = diffAgainstState(events, state, now);

  if (fresh.length) {
    // Send BEFORE persisting: a failed delivery must retry the same events on
    // the next due run, not silently swallow them.
    console.log(`[radar] ${fresh.length} new event(s) → Telegram`);
    await sendTelegram(token, chat, formatReport(fresh, { now, activity }));
  } else {
    console.log(`[radar] ${events.length} active event(s), 0 new — nothing sent`);
  }
  saveState(nextState);
}

/** Hourly tick; runs at most once per ~day. Never throws into the server. */
export function startLifecycleRadar(port: number): void {
  const tick = async (): Promise<void> => {
    try {
      const state = loadState();
      const last = state.last_run_at ? new Date(state.last_run_at).getTime() : 0;
      if (Date.now() - last < DUE_AFTER_MS) return;
      await runOnce(port);
    } catch (err) {
      console.error('[radar] run failed:', err instanceof Error ? err.message : err);
    }
  };
  setTimeout(() => void tick(), BOOT_DELAY_MS).unref();
  setInterval(() => void tick(), TICK_MS).unref();
}

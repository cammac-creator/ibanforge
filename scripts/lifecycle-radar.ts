/**
 * Daily lifecycle radar for IBANforge API keys.
 *
 * Pulls the admin key ledger (GET /v1/admin/keys) and per-client activity
 * (GET /v1/admin/client-activity), both X-Admin-Secret protected, detects
 * commercial lifecycle events (quota exhaustion, idle paid packs, new corporate
 * leads, corporate keys gone quiet), de-duplicates against a small persisted
 * state, and — only when something is new — pushes ONE compact French alert to
 * the Dory Telegram bot. It never emails anyone: the commercial gesture stays
 * human.
 *
 * Runs from .github/workflows/lifecycle-radar.yml (daily 05:30 UTC). All inputs
 * come from env / GitHub Actions secrets: ADMIN_SECRET, TELEGRAM_DORY_TOKEN,
 * TELEGRAM_CHAT_ID. State is persisted via actions/cache (RADAR_STATE_DIR) in
 * CI, and falls back to os.tmpdir() locally. Native fetch (Node 20+), no deps.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectEvents,
  diffAgainstState,
  fetchAdmin,
  formatReport,
  type ClientActivityResponse,
  type KeysResponse,
  type RadarState,
} from '../src/lib/lifecycle-radar.js';

const API_BASE = process.env.IBANFORGE_API_BASE ?? 'https://api.ibanforge.com';
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? '';
const BOT_TOKEN = process.env.TELEGRAM_DORY_TOKEN ?? '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';

function requireEnv(): void {
  const missing = [
    ['ADMIN_SECRET', ADMIN_SECRET],
    ['TELEGRAM_DORY_TOKEN', BOT_TOKEN],
    ['TELEGRAM_CHAT_ID', CHAT_ID],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// State: actions/cache directory in CI, os.tmpdir() locally
// ---------------------------------------------------------------------------

function statePath(): string {
  const dir = process.env.RADAR_STATE_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    return join(dir, 'state.json');
  }
  return join(tmpdir(), 'ibanforge-lifecycle-radar-state.json');
}

function loadState(path: string): RadarState {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<RadarState>;
    return { last_run_at: parsed.last_run_at, keys: parsed.keys ?? {} };
  } catch {
    return { keys: {} };
  }
}

function saveState(path: string, state: RadarState): void {
  writeFileSync(path, JSON.stringify(state), 'utf8');
}

// ---------------------------------------------------------------------------
// Telegram (same send pattern as scripts/weekly-veille.ts)
// ---------------------------------------------------------------------------

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

async function sendToDory(text: string): Promise<void> {
  for (const chunk of splitForTelegram(text)) {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: chunk,
        disable_web_page_preview: true,
      }),
    });
    const body = (await res.json()) as { ok: boolean; description?: string };
    if (!body.ok) throw new Error(`Telegram send failed: ${body.description}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  requireEnv();
  const now = new Date();

  console.log('[radar] fetching admin keys + client activity…');
  const [keysRes, activity] = await Promise.all([
    fetchAdmin<KeysResponse>(API_BASE, ADMIN_SECRET, '/v1/admin/keys'),
    fetchAdmin<ClientActivityResponse>(API_BASE, ADMIN_SECRET, '/v1/admin/client-activity'),
  ]);

  const path = statePath();
  const state = loadState(path);
  const lastRunAt = state.last_run_at ? new Date(state.last_run_at) : undefined;

  const events = detectEvents(keysRes.keys, { now, lastRunAt });
  const { fresh, nextState } = diffAgainstState(events, state, now);

  if (fresh.length) {
    // Send BEFORE persisting: if delivery throws we skip the save and retry the
    // same events next run rather than silently swallowing them.
    console.log(`[radar] ${fresh.length} new event(s) → sending to Dory…`);
    await sendToDory(formatReport(fresh, { now, activity }));
  } else {
    console.log(`[radar] ${events.length} active event(s), 0 new → no Telegram sent.`);
  }

  saveState(path, nextState);
  console.log('[radar] done.');
}

main().catch((err) => {
  console.error('[radar] FAILED:', err);
  process.exitCode = 1;
});

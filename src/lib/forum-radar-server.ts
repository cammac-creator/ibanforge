/**
 * Community radar, run INSIDE the API process (same architecture as the
 * lifecycle radar: pure logic in forum-radar.ts, I/O here, daily cadence that
 * survives redeploys via kv_state).
 *
 * Every external probe is fail-soft PER SOURCE: one flaky directory or a
 * rate-limited search must never abort the tick, and never flip an existing
 * listing to 'absent' (network errors keep the previous status and only
 * record the failure in the report).
 *
 * GitHub search runs unauthenticated (10 req/min per IP): the four queries
 * are spaced 7 s apart, which keeps a daily tick far under the ceiling.
 */
import { getStatsDB } from './db.js';
import {
  MARKETPLACES,
  finalizeCandidate,
  interpretCheck,
  parseGitHubIssues,
  parseHN,
  parsePullpush,
  parseStackExchange,
  type MarketplaceDef,
  type ScoredThread,
  type ThreadCandidate,
} from './forum-radar.js';

const TICK_MS = 60 * 60 * 1000;
const DUE_AFTER_MS = 20 * 60 * 60 * 1000;
const BOOT_DELAY_MS = 3 * 60 * 1000; // offset from the lifecycle radar's 5 min
const FETCH_TIMEOUT_MS = 15_000;
const GITHUB_SPACING_MS = 7_000;
const LOOKBACK_DAYS = 90;

const KV_LAST_SCAN = 'forum_radar_last_scan_at';
const KV_LAST_REPORT = 'forum_radar_last_report';

export interface ScanReport {
  started_at: string;
  finished_at: string;
  threads: { inserted: number; seen: number; refreshed: number };
  marketplaces: { checked: number; skipped: number };
  errors: string[];
}

function ensureKvTable(): void {
  getStatsDB().exec(`
    CREATE TABLE IF NOT EXISTS kv_state (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function kvGet(key: string): string | undefined {
  ensureKvTable();
  const row = getStatsDB().prepare('SELECT value FROM kv_state WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

function kvSet(key: string, value: string): void {
  ensureKvTable();
  getStatsDB()
    .prepare(
      `INSERT INTO kv_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value);
}

async function fetchText(
  url: string,
  accept = 'application/json',
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ibanforge-radar/1.0', Accept: accept, ...extraHeaders },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await res.text().catch(() => '');
  return { status: res.status, body };
}

/**
 * GitHub's search API refuses unauthenticated calls from datacenter IPs
 * (observed: 403 from Railway on the very first tick). An optional read-only
 * GITHUB_TOKEN in the environment unlocks the source; without it the source
 * fails soft and the scan report says so.
 */
function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN ?? '';
  return token ? { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' } : {};
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Thread sources
// ---------------------------------------------------------------------------

interface ThreadSource {
  name: string;
  /** Sequential on purpose where the provider rate-limits by IP. */
  fetchAll: (sinceEpoch: number, sinceISO: string) => Promise<ThreadCandidate[]>;
}

const SE_BASE = 'https://api.stackexchange.com/2.3';

async function seQuery(path: string): Promise<ThreadCandidate[]> {
  const { status, body } = await fetchText(`${SE_BASE}${path}`);
  if (status !== 200) throw new Error(`SE HTTP ${status}`);
  const site = path.includes('site=money') ? 'money_se' : 'stackoverflow';
  return parseStackExchange(JSON.parse(body), site);
}

const THREAD_SOURCES: ThreadSource[] = [
  {
    name: 'stackexchange',
    fetchAll: async (since) => {
      const out: ThreadCandidate[] = [];
      // filter=withbody so the scorer sees the question text, not the title alone.
      const qs = [
        `/questions?order=desc&sort=creation&tagged=iban&site=stackoverflow&pagesize=20&fromdate=${since}&filter=withbody`,
        `/search/advanced?order=desc&sort=creation&q=%22bic%20from%20iban%22&site=stackoverflow&pagesize=20&fromdate=${since}&filter=withbody`,
        `/search/advanced?order=desc&sort=creation&q=%22verification%20of%20payee%22&site=stackoverflow&pagesize=20&fromdate=${since}&filter=withbody`,
        `/search/advanced?order=desc&sort=creation&q=iban&site=money&pagesize=20&fromdate=${since}&filter=withbody`,
      ];
      for (const q of qs) out.push(...(await seQuery(q)));
      return out;
    },
  },
  {
    name: 'github',
    fetchAll: async (_since, sinceISO) => {
      const out: ThreadCandidate[] = [];
      const queries = [
        `"IBAN validation" is:issue state:open created:>${sinceISO}`,
        `"verification of payee" is:issue created:>${sinceISO}`,
        `"QR-IBAN" is:issue created:>${sinceISO}`,
        `IBAN BIC lookup is:issue state:open created:>${sinceISO}`,
      ];
      for (let i = 0; i < queries.length; i++) {
        if (i > 0) await sleep(GITHUB_SPACING_MS);
        const { status, body } = await fetchText(
          `https://api.github.com/search/issues?per_page=20&q=${encodeURIComponent(queries[i])}`,
          'application/vnd.github+json',
          githubHeaders(),
        );
        if (status !== 200) {
          throw new Error(`GitHub HTTP ${status}${process.env.GITHUB_TOKEN ? '' : ' (GITHUB_TOKEN absent — source désactivée)'}`);
        }
        out.push(...parseGitHubIssues(JSON.parse(body)));
      }
      return out;
    },
  },
  {
    name: 'hackernews',
    fetchAll: async (since) => {
      const out: ThreadCandidate[] = [];
      for (const q of ['IBAN', '"verification of payee"']) {
        const { status, body } = await fetchText(
          `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=15&numericFilters=created_at_i>${since}`,
        );
        if (status !== 200) throw new Error(`HN HTTP ${status}`);
        out.push(...parseHN(JSON.parse(body)));
      }
      return out;
    },
  },
  {
    name: 'reddit-archive',
    fetchAll: async (since) => {
      const { status, body } = await fetchText(
        `https://api.pullpush.io/reddit/search/submission/?q=iban%20validation&size=15&after=${since}`,
      );
      if (status !== 200) throw new Error(`pullpush HTTP ${status}`);
      return parsePullpush(JSON.parse(body));
    },
  },
];

function upsertThread(t: ScoredThread): 'inserted' | 'refreshed' | 'known' {
  const db = getStatsDB();
  const ins = db
    .prepare(
      `INSERT OR IGNORE INTO forum_threads
         (url, source, title, excerpt, lang, score, score_detail, activity, thread_created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(t.url, t.source, t.title, t.excerpt, t.lang, t.score, t.scoreDetail, t.activity, t.threadCreatedAt);
  if (ins.changes === 1) return 'inserted';
  // Refresh live metrics on rows the operator has not touched yet; a thread
  // already worked (any status beyond 'new') is theirs, never overwritten.
  const upd = db
    .prepare(
      `UPDATE forum_threads
         SET activity = ?, score = ?, score_detail = ?, updated_at = datetime('now')
       WHERE url = ? AND status = 'new'`,
    )
    .run(t.activity, t.score, t.scoreDetail, t.url);
  return upd.changes === 1 ? 'refreshed' : 'known';
}

async function scanThreads(report: ScanReport): Promise<void> {
  const sinceEpoch = Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 86400;
  const sinceISO = new Date(Date.now() - LOOKBACK_DAYS * 86400 * 1000).toISOString().slice(0, 10);
  for (const source of THREAD_SOURCES) {
    try {
      const candidates = await source.fetchAll(sinceEpoch, sinceISO);
      report.threads.seen += candidates.length;
      for (const c of candidates) {
        const scored = finalizeCandidate(c);
        if (!scored) continue;
        const res = upsertThread(scored);
        if (res === 'inserted') report.threads.inserted++;
        if (res === 'refreshed') report.threads.refreshed++;
      }
    } catch (err) {
      report.errors.push(`${source.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Marketplace checks
// ---------------------------------------------------------------------------

/** Definitions are code; rows carry state. Re-assert the definition fields. */
export function ensureMarketplaceRows(): void {
  const db = getStatsDB();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO marketplace_checks (slug, name, url, action_url, auto, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const upd = db.prepare(
    `UPDATE marketplace_checks SET name = ?, url = ?, action_url = ?, auto = ? WHERE slug = ?`,
  );
  for (const m of MARKETPLACES) {
    const auto = m.kind === 'manual' ? 0 : 1;
    ins.run(m.slug, m.name, m.url, m.actionUrl ?? null, auto, m.kind === 'manual' ? 'manual' : 'unknown');
    upd.run(m.name, m.url, m.actionUrl ?? null, auto, m.slug);
  }
}

const BAZAAR_PAGE_LIMIT = 500;
const BAZAAR_MAX_PAGES = 60;

/** Count our resources in the paginated CDP catalog (JSON.parse, never regex). */
async function countBazaar(target: string): Promise<number> {
  const found = new Set<string>();
  for (let page = 0; page < BAZAAR_MAX_PAGES; page++) {
    const { status, body } = await fetchText(`${target}?limit=${BAZAAR_PAGE_LIMIT}&offset=${page * BAZAAR_PAGE_LIMIT}`);
    if (status !== 200) throw new Error(`Bazaar HTTP ${status}`);
    const data = JSON.parse(body) as { items?: Array<{ resource?: unknown }>; pagination?: { total?: unknown } };
    for (const item of data.items ?? []) {
      if (typeof item.resource === 'string' && item.resource.startsWith('https://api.ibanforge.com')) {
        found.add(item.resource);
      }
    }
    const total = Number(data.pagination?.total ?? 0);
    if ((page + 1) * BAZAAR_PAGE_LIMIT >= total) break;
  }
  return found.size;
}

function checkDue(def: MarketplaceDef, checkedAt: string | null): boolean {
  if (def.kind === 'manual') return false;
  if (!checkedAt) return true;
  const age = Date.now() - new Date(checkedAt).getTime();
  return age >= def.cadenceHours * 3600 * 1000;
}

async function runOneCheck(def: MarketplaceDef): Promise<{ status: string; detail: string }> {
  if (def.kind === 'bazaar') {
    const n = await countBazaar(def.checkTarget ?? '');
    return interpretCheck(def, 200, String(n));
  }
  const { status, body } = await fetchText(def.checkTarget ?? '', 'application/json, text/html;q=0.8');
  return interpretCheck(def, status, body);
}

async function scanMarketplaces(report: ScanReport, force = false): Promise<void> {
  ensureMarketplaceRows();
  const db = getStatsDB();
  const rows = db.prepare('SELECT slug, checked_at FROM marketplace_checks').all() as Array<{
    slug: string;
    checked_at: string | null;
  }>;
  const byslug = new Map(rows.map((r) => [r.slug, r.checked_at]));
  for (const def of MARKETPLACES) {
    if (def.kind === 'manual') continue;
    if (!force && !checkDue(def, byslug.get(def.slug) ?? null)) {
      report.marketplaces.skipped++;
      continue;
    }
    try {
      const out = await runOneCheck(def);
      db.prepare(
        `UPDATE marketplace_checks
           SET status = ?, detail = ?, checked_at = datetime('now'), updated_at = datetime('now')
         WHERE slug = ?`,
      ).run(out.status, out.detail, def.slug);
      report.marketplaces.checked++;
    } catch (err) {
      // Keep the last known status; a probe failure is not an absence.
      db.prepare(
        `UPDATE marketplace_checks
           SET detail = ?, checked_at = datetime('now'), updated_at = datetime('now')
         WHERE slug = ?`,
      ).run(`sonde en échec: ${err instanceof Error ? err.message : String(err)}`, def.slug);
      report.errors.push(`${def.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

let scanning = false;

export async function runScan(what: 'threads' | 'marketplaces' | 'all' = 'all', force = false): Promise<ScanReport> {
  const report: ScanReport = {
    started_at: new Date().toISOString(),
    finished_at: '',
    threads: { inserted: 0, seen: 0, refreshed: 0 },
    marketplaces: { checked: 0, skipped: 0 },
    errors: [],
  };
  if (scanning) {
    report.errors.push('scan déjà en cours');
    report.finished_at = new Date().toISOString();
    return report;
  }
  scanning = true;
  try {
    if (what !== 'marketplaces') await scanThreads(report);
    if (what !== 'threads') await scanMarketplaces(report, force);
  } finally {
    scanning = false;
  }
  report.finished_at = new Date().toISOString();
  kvSet(KV_LAST_SCAN, report.finished_at);
  kvSet(KV_LAST_REPORT, JSON.stringify(report));
  return report;
}

export function lastScanInfo(): { last_scan_at: string | null; last_report: ScanReport | null; scanning: boolean } {
  let parsed: ScanReport | null = null;
  try {
    const raw = kvGet(KV_LAST_REPORT);
    if (raw) parsed = JSON.parse(raw) as ScanReport;
  } catch {
    parsed = null;
  }
  return { last_scan_at: kvGet(KV_LAST_SCAN) ?? null, last_report: parsed, scanning };
}

/** Hourly tick; a full scan at most once per ~day. Never throws upward. */
export function startForumRadar(): void {
  const tick = async (): Promise<void> => {
    try {
      ensureMarketplaceRows();
      const last = kvGet(KV_LAST_SCAN);
      if (last && Date.now() - new Date(last).getTime() < DUE_AFTER_MS) return;
      const report = await runScan('all');
      console.log(
        `[forum-radar] scan: +${report.threads.inserted} fils (${report.threads.seen} vus), ` +
          `${report.marketplaces.checked} places vérifiées, ${report.errors.length} erreur(s)`,
      );
    } catch (err) {
      console.error('[forum-radar] run failed:', err instanceof Error ? err.message : err);
    }
  };
  setTimeout(() => void tick(), BOOT_DELAY_MS).unref();
  setInterval(() => void tick(), TICK_MS).unref();
}

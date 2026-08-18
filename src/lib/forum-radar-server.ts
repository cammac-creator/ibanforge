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
import { generateDraft, translateToFr } from './forum-draft-gen.js';
import { recordVisibility, type VisibilityState } from './visibility.js';
import {
  DISMISSED_REPO_MALUS,
  MARKETPLACES,
  MIN_SCORE,
  finalizeCandidate,
  interpretCheck,
  parseDiscourse,
  parseGitHubIssues,
  parseHN,
  parseOdooSearch,
  parsePullpush,
  parseStackExchange,
  repoOfUrl,
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
  drafts: { generated: number; failed: number };
  watch: { checked: number; flagged: number };
  autodetect: { checked: number; found: number };
  events: number;
  errors: string[];
}

/** Short operator ping, same channel the lifecycle radar uses. Throws on failure
 *  so callers can keep send-before-save semantics. Silently no-ops unconfigured. */
export async function sendTelegramShort(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  const chat = process.env.TELEGRAM_CHAT_ID ?? '';
  if (!token || !chat) return false;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'User-Agent': 'ibanforge-backend' },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ chat_id: chat, text: text.slice(0, 3900), disable_web_page_preview: true }),
  });
  const body = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; description?: string };
  if (!body.ok) throw new Error(`Telegram: ${body.description ?? res.status}`);
  return true;
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

export function kvGet(key: string): string | undefined {
  ensureKvTable();
  const row = getStatsDB().prepare('SELECT value FROM kv_state WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function kvSet(key: string, value: string): void {
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
      // filter=withbody so the scorer sees the question text, not the title
      // alone. The SE API has no OR, hence one query per phrase; the daily
      // budget (8 calls) stays far under the 300/day unauthenticated quota.
      const qs = [
        `/questions?order=desc&sort=creation&tagged=iban&site=stackoverflow&pagesize=20&fromdate=${since}&filter=withbody`,
        `/questions?order=desc&sort=creation&tagged=sepa&site=stackoverflow&pagesize=20&fromdate=${since}&filter=withbody`,
        `/search/advanced?order=desc&sort=creation&q=%22bic%20from%20iban%22&site=stackoverflow&pagesize=20&fromdate=${since}&filter=withbody`,
        `/search/advanced?order=desc&sort=creation&q=%22verification%20of%20payee%22&site=stackoverflow&pagesize=20&fromdate=${since}&filter=withbody`,
        `/search/advanced?order=desc&sort=creation&q=%22qr-iban%22&site=stackoverflow&pagesize=20&fromdate=${since}&filter=withbody`,
        `/search/advanced?order=desc&sort=creation&q=%22swift%20code%22&site=stackoverflow&pagesize=20&fromdate=${since}&filter=withbody`,
        `/search/advanced?order=desc&sort=creation&q=%22virtual%20iban%22&site=stackoverflow&pagesize=20&fromdate=${since}&filter=withbody`,
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
        `"QR-IID" is:issue created:>${sinceISO}`,
        `IBAN BIC lookup is:issue state:open created:>${sinceISO}`,
        `"virtual iban" is:issue created:>${sinceISO}`,
        `"swift code" lookup is:issue state:open created:>${sinceISO}`,
        `bankleitzahl is:issue created:>${sinceISO}`,
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
      for (const q of ['IBAN', '"verification of payee"', '"SEPA instant"']) {
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
      const out: ThreadCandidate[] = [];
      for (const q of ['iban validation', 'verify iban', 'virtual iban']) {
        const { status, body } = await fetchText(
          `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(q)}&size=15&after=${since}`,
        );
        if (status !== 200) throw new Error(`pullpush HTTP ${status}`);
        out.push(...parsePullpush(JSON.parse(body)));
      }
      return out;
    },
  },
  {
    // Discourse forums all expose /search.json; one generic fetcher, several
    // communities where an answer can actually be posted.
    name: 'discourse',
    fetchAll: async () => {
      const out: ThreadCandidate[] = [];
      const targets: Array<[string, string]> = [
        ['community.n8n.io', 'IBAN'],
        ['discuss.frappe.io', 'IBAN validation'],
        ['discuss.frappe.io', 'bank account validation'],
        ['community.retool.com', 'IBAN'],
      ];
      for (const [host, q] of targets) {
        const { status, body } = await fetchText(
          `https://${host}/search.json?q=${encodeURIComponent(q)}`,
          'application/json',
        );
        if (status !== 200) throw new Error(`${host} HTTP ${status}`);
        out.push(...parseDiscourse(JSON.parse(body), host));
      }
      return out;
    },
  },
  {
    name: 'odoo-forum',
    fetchAll: async () => {
      const out: ThreadCandidate[] = [];
      for (const q of ['IBAN', 'SEPA direct debit']) {
        const { status, body } = await fetchText(
          `https://www.odoo.com/forum/help-1?search=${encodeURIComponent(q)}`,
          'text/html',
        );
        if (status !== 200) throw new Error(`odoo HTTP ${status}`);
        out.push(...parseOdooSearch(body));
      }
      return out;
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

/** Repos whose backlog the operator dismissed twice: their new items get a malus. */
function dismissedRepoSet(): Set<string> {
  const rows = getStatsDB()
    .prepare(`SELECT url FROM forum_threads WHERE status = 'dismissed'`)
    .all() as Array<{ url: string }>;
  const counts = new Map<string, number>();
  for (const r of rows) {
    const repo = repoOfUrl(r.url);
    if (repo) counts.set(repo, (counts.get(repo) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, n]) => n >= 2).map(([repo]) => repo));
}

async function scanThreads(report: ScanReport): Promise<void> {
  const sinceEpoch = Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 86400;
  const sinceISO = new Date(Date.now() - LOOKBACK_DAYS * 86400 * 1000).toISOString().slice(0, 10);
  const mutedRepos = dismissedRepoSet();
  for (const source of THREAD_SOURCES) {
    try {
      const candidates = await source.fetchAll(sinceEpoch, sinceISO);
      report.threads.seen += candidates.length;
      for (const c of candidates) {
        const scored = finalizeCandidate(c);
        if (!scored) continue;
        const repo = repoOfUrl(scored.url);
        if (repo && mutedRepos.has(repo)) {
          scored.score = Math.max(0, scored.score - DISMISSED_REPO_MALUS);
          scored.scoreDetail = `${scored.scoreDetail} · repo écarté ×2 (-${DISMISSED_REPO_MALUS})`;
          if (scored.score < MIN_SCORE) continue;
        }
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
// Posted-reply autodetection — the operator never ticks "answered" by hand
// ---------------------------------------------------------------------------

/** Our public identities per platform. GitHub is fixed; the Stack Exchange
 *  numeric user id only exists once the account is created (env-configured). */
const GITHUB_LOGIN = process.env.FORUM_GITHUB_LOGIN ?? 'cammac-creator';

async function detectPostedReplies(report: ScanReport): Promise<void> {
  const db = getStatsDB();
  const soUserId = process.env.SO_USER_ID ?? '';
  const rows = db
    .prepare(
      `SELECT id, url, source FROM forum_threads
       WHERE status IN ('new', 'to_answer', 'drafted', 'planned')
         AND source IN ('github', 'stackoverflow', 'money_se')`,
    )
    .all() as Array<{ id: number; url: string; source: string }>;

  const markPosted = db.prepare(
    `UPDATE forum_threads
       SET status = 'posted', posted_url = ?, posted_at = COALESCE(posted_at, ?),
           updated_at = datetime('now')
     WHERE id = ?`,
  );

  for (const row of rows) {
    try {
      if (row.source === 'github') {
        const m = /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/.exec(row.url);
        if (!m) continue;
        const { status, body } = await fetchText(
          `https://api.github.com/repos/${m[1]}/${m[2]}/issues/${m[3]}/comments?per_page=100`,
          'application/vnd.github+json',
          githubHeaders(),
        );
        if (status !== 200) throw new Error(`GitHub HTTP ${status}`);
        const comments = JSON.parse(body) as Array<{
          user?: { login?: string };
          html_url?: string;
          created_at?: string;
        }>;
        const mine = comments.find((c) => (c.user?.login ?? '').toLowerCase() === GITHUB_LOGIN.toLowerCase());
        report.autodetect.checked++;
        if (mine) {
          markPosted.run(mine.html_url ?? row.url, mine.created_at ?? new Date().toISOString(), row.id);
          report.autodetect.found++;
        }
        continue;
      }
      // Stack Exchange needs the account's numeric id; silently manual until set.
      if (!soUserId) continue;
      const qm = /questions\/(\d+)/.exec(row.url);
      if (!qm) continue;
      const site = row.source === 'money_se' ? 'money' : 'stackoverflow';
      const { status, body } = await fetchText(`${SE_BASE}/questions/${qm[1]}/answers?site=${site}&pagesize=50`);
      if (status !== 200) throw new Error(`SE HTTP ${status}`);
      const answers = (JSON.parse(body) as { items?: Array<{ owner?: { user_id?: number }; answer_id?: number }> })
        .items ?? [];
      const mine = answers.find((a) => String(a.owner?.user_id ?? '') === soUserId);
      report.autodetect.checked++;
      if (mine?.answer_id) {
        markPosted.run(`https://${site === 'money' ? 'money.stackexchange' : 'stackoverflow'}.com/a/${mine.answer_id}`, new Date().toISOString(), row.id);
        report.autodetect.found++;
      }
    } catch (err) {
      report.errors.push(`autodetect #${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Reply watch — a posted thread that moves again deserves attention
// ---------------------------------------------------------------------------

interface WatchState {
  gh_comments?: number;
  so_activity?: number;
  so_score?: number;
  checked_at?: string;
}

async function watchPostedThreads(report: ScanReport): Promise<void> {
  const db = getStatsDB();
  const rows = db
    .prepare(
      `SELECT id, url, source, title, posted_url, watch_state FROM forum_threads
       WHERE status = 'posted' AND posted_url IS NOT NULL AND posted_url != ''`,
    )
    .all() as Array<{ id: number; url: string; source: string; title: string; posted_url: string; watch_state: string | null }>;

  for (const row of rows) {
    try {
      let state: WatchState = {};
      try {
        state = row.watch_state ? (JSON.parse(row.watch_state) as WatchState) : {};
      } catch {
        state = {};
      }
      let fresh: WatchState | null = null;
      let news = '';

      if (row.source === 'github') {
        const m = /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/.exec(row.url);
        if (!m) continue;
        const { status, body } = await fetchText(
          `https://api.github.com/repos/${m[1]}/${m[2]}/issues/${m[3]}`,
          'application/vnd.github+json',
          githubHeaders(),
        );
        if (status !== 200) throw new Error(`GitHub HTTP ${status}`);
        const issue = JSON.parse(body) as { comments?: number };
        const comments = issue.comments ?? 0;
        fresh = { ...state, gh_comments: comments, checked_at: new Date().toISOString() };
        // First watch pass only records the baseline; growth after that rings.
        if (typeof state.gh_comments === 'number' && comments > state.gh_comments) {
          news = `${comments - state.gh_comments} nouveau(x) commentaire(s)`;
        }
      } else if (row.source === 'stackoverflow' || row.source === 'money_se') {
        const site = row.source === 'money_se' ? 'money' : 'stackoverflow';
        const qm = /questions\/(\d+)/.exec(row.url);
        if (!qm) continue;
        const { status, body } = await fetchText(
          `${SE_BASE}/questions/${qm[1]}?site=${site}&filter=default`,
        );
        if (status !== 200) throw new Error(`SE HTTP ${status}`);
        const q = (JSON.parse(body) as { items?: Array<{ last_activity_date?: number }> }).items?.[0];
        const activity = q?.last_activity_date ?? 0;
        fresh = { ...state, so_activity: activity, checked_at: new Date().toISOString() };
        const am = /\/a\/(\d+)/.exec(row.posted_url);
        if (am) {
          const ans = await fetchText(`${SE_BASE}/answers/${am[1]}?site=${site}`);
          if (ans.status === 200) {
            const a = (JSON.parse(ans.body) as { items?: Array<{ score?: number }> }).items?.[0];
            if (typeof a?.score === 'number') fresh.so_score = a.score;
          }
        }
        if (typeof state.so_activity === 'number' && activity > state.so_activity) {
          news = 'nouvelle activité sur le fil';
        }
      } else {
        continue; // hn/reddit/manual: nothing reliable to watch yet
      }

      report.watch.checked++;
      if (news) {
        // Send BEFORE saving the new baseline: a failed ping retries next tick.
        await sendTelegramShort(`💬 Forums IBANforge : ${news} après ta réponse\n${row.title.slice(0, 90)}\n${row.url}`);
        db.prepare(
          `UPDATE forum_threads SET watch_state = ?, needs_attention = 1, updated_at = datetime('now') WHERE id = ?`,
        ).run(JSON.stringify(fresh), row.id);
        report.watch.flagged++;
      } else if (fresh) {
        db.prepare(`UPDATE forum_threads SET watch_state = ? WHERE id = ?`).run(JSON.stringify(fresh), row.id);
      }
    } catch (err) {
      report.errors.push(`watch #${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Draft backfill — every workable thread must carry its reply draft
// ---------------------------------------------------------------------------

/** Cost guard: at most N generations per scan; the daily tick catches up. */
const DRAFTS_PER_SCAN = 6;

async function backfillDrafts(report: ScanReport): Promise<void> {
  const db = getStatsDB();
  // Two kinds of missing text: no draft at all (full generation), or a draft
  // that lacks its French mirror (translate it, NEVER regenerate: the draft
  // may be validated or hand-edited and must survive verbatim).
  const rows = db
    .prepare(
      `SELECT id, url, source, title, excerpt, lang, notes, draft
       FROM forum_threads
       WHERE (draft IS NULL OR draft = '' OR draft_fr IS NULL OR draft_fr = '')
         AND status NOT IN ('dismissed', 'posted')
       ORDER BY score DESC, first_seen DESC
       LIMIT ?`,
    )
    .all(DRAFTS_PER_SCAN) as Array<{
    id: number;
    url: string;
    source: string;
    title: string;
    excerpt: string | null;
    lang: string;
    notes: string | null;
    draft: string | null;
  }>;

  for (const row of rows) {
    try {
      const hasDraft = Boolean(row.draft && row.draft.trim());
      if (hasDraft) {
        const fr = row.lang === 'fr' ? row.draft : await translateToFr(row.draft as string);
        if (fr === null) {
          report.errors.push('drafts: ANTHROPIC_API_KEY absente — traduction sautée');
          return;
        }
        db.prepare(`UPDATE forum_threads SET draft_fr = ?, updated_at = datetime('now') WHERE id = ?`).run(fr, row.id);
        report.drafts.generated++;
        continue;
      }
      const out = await generateDraft({
        title: row.title,
        excerpt: row.excerpt ?? '',
        url: row.url,
        lang: row.lang,
        source: row.source,
        notes: row.notes ?? '',
      });
      if (out === null) {
        report.errors.push('drafts: ANTHROPIC_API_KEY absente — génération sautée');
        return;
      }
      // The operator's seeded summary wins over a generated one. draft_fr may
      // come back empty on the JSON fallback path; the next tick translates it.
      db.prepare(
        `UPDATE forum_threads
           SET draft = ?,
               draft_fr = ?,
               summary_fr = COALESCE(NULLIF(summary_fr, ''), ?),
               status = CASE WHEN status = 'new' THEN 'drafted' ELSE status END,
               updated_at = datetime('now')
         WHERE id = ?`,
      ).run(out.draft, out.draftFr, out.summaryFr, row.id);
      report.drafts.generated++;
    } catch (err) {
      report.drafts.failed++;
      report.errors.push(`draft #${row.id}: ${err instanceof Error ? err.message : String(err)}`);
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

/**
 * Bridge to the overview's visibility panel. Two watches told two different
 * stories (the VPS probe said "catalogue 8400+" while the radar counted the
 * real 15k-row catalog, and the day's wins — Aegis, Cline — never appeared),
 * so the radar now publishes its checks into visibility_checks too. Shared
 * surfaces reuse the probe's exact names so rows refresh instead of
 * duplicating; radar-only surfaces appear under new names; the VPS probe
 * keeps the surfaces the radar does not cover (modulus UK, public-apis…).
 */
const VISIBILITY_SURFACE: Record<string, string> = {
  'cdp-bazaar': 'CDP x402 discovery',
  'npm-mcp': 'npm ibanforge-mcp',
  'mcp-registry': 'registre MCP officiel',
  'awesome-x402': 'awesome-x402',
  'api-evangelist': 'apis.io / API Evangelist',
  aegis: 'Aegis (registre de confiance)',
  'cline-marketplace': 'Cline MCP Marketplace',
  'apis-guru': 'APIs.guru',
  'mcp-so': 'mcp.so',
  'x402-list': 'x402-list.com',
};

function visibilityStateOf(status: string): VisibilityState {
  if (status === 'listed') return 'present';
  if (status === 'absent' || status === 'dead' || status === 'pending') return 'absent';
  return 'error';
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
  const rows = db.prepare('SELECT slug, status, checked_at FROM marketplace_checks').all() as Array<{
    slug: string;
    status: string;
    checked_at: string | null;
  }>;
  const byslug = new Map(rows.map((r) => [r.slug, r]));
  for (const def of MARKETPLACES) {
    if (def.kind === 'manual') continue;
    const prev = byslug.get(def.slug);
    if (!force && !checkDue(def, prev?.checked_at ?? null)) {
      report.marketplaces.skipped++;
      continue;
    }
    try {
      const out = await runOneCheck(def);
      // A status TRANSITION is the news the watch exists for. The very first
      // resolution (from 'unknown') is a baseline, not an event.
      if (prev && prev.status !== out.status && prev.status !== 'unknown') {
        db.prepare(
          `INSERT INTO marketplace_events (slug, from_status, to_status, detail) VALUES (?, ?, ?, ?)`,
        ).run(def.slug, prev.status, out.status, out.detail);
        report.events++;
        try {
          await sendTelegramShort(
            `📊 Marketplace IBANforge : ${def.name}\n${prev.status} → ${out.status}\n${out.detail}\n${def.url}`,
          );
        } catch (err) {
          report.errors.push(`event telegram ${def.slug}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      db.prepare(
        `UPDATE marketplace_checks
           SET status = ?, detail = ?, checked_at = datetime('now'), updated_at = datetime('now')
         WHERE slug = ?`,
      ).run(out.status, out.detail, def.slug);
      const surface = VISIBILITY_SURFACE[def.slug];
      if (surface) {
        try {
          recordVisibility({ surface, state: visibilityStateOf(out.status), detail: out.detail, url: def.url });
        } catch {
          /* the overview panel is a mirror; a failed write must not fail the check */
        }
      }
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
    drafts: { generated: 0, failed: 0 },
    watch: { checked: 0, flagged: 0 },
    autodetect: { checked: 0, found: 0 },
    events: 0,
    errors: [],
  };
  if (scanning) {
    report.errors.push('scan déjà en cours');
    report.finished_at = new Date().toISOString();
    return report;
  }
  scanning = true;
  try {
    if (what !== 'marketplaces') {
      await scanThreads(report);
      // Drafts come right after discovery so a thread never sits in the tab
      // without its reply text (the operator asked for no Generate button).
      await backfillDrafts(report);
      // Autodetection runs before the watch so a freshly detected reply gets
      // its baseline in the same pass.
      await detectPostedReplies(report);
      await watchPostedThreads(report);
    }
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

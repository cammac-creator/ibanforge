/**
 * Community radar — pure logic for the CRM "Forums" tab.
 *
 * Two jobs, no I/O so everything is unit-testable under `npm run check`:
 *
 * 1. THREADS. Turn raw search payloads (Stack Exchange, GitHub issues, HN
 *    Algolia, pullpush) into scored thread candidates. The score is a plain
 *    keyword weighting, deliberately transparent: the operator reads
 *    score_detail and can tell in one glance why a thread surfaced. A thread
 *    is only worth surfacing when someone describes a problem the API solves;
 *    library-internal bugs and Stripe-SDK questions are penalised.
 *
 * 2. MARKETPLACES. The list of surfaces where IBANforge should be visible
 *    (directories, MCP marketplaces, curated lists) plus the pure
 *    interpretation of each check response. Definitions live here in code —
 *    they are public facts about public directories; the STATE lives in the
 *    marketplace_checks table.
 *
 * All I/O (fetching, DB upserts, scheduling) lives in forum-radar-server.ts,
 * mirroring the lifecycle-radar split.
 */

// ---------------------------------------------------------------------------
// Thread candidates
// ---------------------------------------------------------------------------

export interface ThreadCandidate {
  url: string;
  source: 'stackoverflow' | 'money_se' | 'github' | 'hn' | 'reddit';
  title: string;
  excerpt: string;
  activity: string; // human summary: "27 pts · 10 rép. · 66 441 vues"
  threadCreatedAt: string; // ISO date
}

export interface ScoredThread extends ThreadCandidate {
  score: number;
  scoreDetail: string;
  lang: 'en' | 'de' | 'fr';
}

/**
 * Keyword weights. Positive = the thread talks about a problem we solve;
 * negative = a context where answering would be noise (someone else's SDK
 * bug, XML plumbing, fake-data generators). Multi-word phrases are matched
 * as substrings on the lowercased title+excerpt.
 */
const KEYWORDS: Array<{ re: RegExp; weight: number; label: string }> = [
  { re: /\biban\b/, weight: 15, label: 'iban' },
  { re: /\bbic\b|swift code/, weight: 15, label: 'bic' },
  { re: /valid(?:ate|ation|ator|ité)?/, weight: 10, label: 'validation' },
  { re: /qr-?iban|qr-?iid|qr[- ]bill|qr-?rechnung/, weight: 30, label: 'qr-suisse' },
  { re: /verification of payee|\bvop\b|namensabgleich/, weight: 30, label: 'vop' },
  { re: /direct debit|\bsdd\b|lastschrift|prélèvement/, weight: 20, label: 'sdd' },
  { re: /bank name|which bank|bank lookup|bank code|bankleitzahl|\bblz\b/, weight: 15, label: 'bank-lookup' },
  { re: /clearing|bc-?nummer/, weight: 20, label: 'clearing' },
  { re: /swiss|suisse|schweiz|\bch\b/, weight: 10, label: 'suisse' },
  { re: /virtual iban|\bviban\b/, weight: 25, label: 'viban' },
  { re: /sanction|screening/, weight: 15, label: 'sanctions' },
  { re: /\bsepa\b/, weight: 10, label: 'sepa' },
  { re: /\bmcp\b|ai agent|llm agent/, weight: 15, label: 'agents' },
  { re: /\bstripe\b/, weight: -10, label: 'stripe(-)' },
  { re: /\bxml\b|xsd/, weight: -5, label: 'xml(-)' },
  { re: /generate (?:random|fake)|fake iban/, weight: -15, label: 'fake-gen(-)' },
];

/** A candidate below this score is search noise and is never inserted. */
export const MIN_SCORE = 30;

/**
 * Per-platform reply length limits, in characters. `max` is the hard platform
 * ceiling (posting above it fails or truncates); `comfy` is the etiquette
 * ceiling above which a forum reply starts reading like a blog post. Sources:
 * Stack Exchange bodies cap at 30 000, GitHub comments at 65 536, Reddit
 * comments at 10 000; HN has no documented cap, so only etiquette applies.
 */
export const PLATFORM_LIMITS: Record<string, { max: number | null; comfy: number }> = {
  stackoverflow: { max: 30_000, comfy: 2_500 },
  money_se: { max: 30_000, comfy: 2_500 },
  github: { max: 65_536, comfy: 2_500 },
  reddit: { max: 10_000, comfy: 2_500 },
  hn: { max: null, comfy: 2_000 },
  manual: { max: null, comfy: 3_000 },
};

/** "owner/repo" for a GitHub thread URL, null elsewhere. Dismissing two
 *  threads of the same repo teaches the radar to stop surfacing its backlog. */
export function repoOfUrl(url: string): string | null {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\//.exec(url);
  return m ? m[1].toLowerCase() : null;
}

/** Score malus applied to threads of a repo the operator already dismissed twice. */
export const DISMISSED_REPO_MALUS = 25;

export function scoreThread(title: string, excerpt: string): { score: number; detail: string } {
  const hay = `${title}\n${excerpt}`.toLowerCase();
  let score = 0;
  const hits: string[] = [];
  for (const k of KEYWORDS) {
    if (k.re.test(hay)) {
      score += k.weight;
      hits.push(k.label);
    }
  }
  return { score: Math.max(0, Math.min(100, score)), detail: hits.join(' · ') };
}

/**
 * Cheap language sniff for routing the DRAFT language (the reply must be in
 * the thread's language, the UI summary stays French). Two function-word hits
 * decide; English is the default because every covered platform is
 * English-first.
 */
export function detectLang(text: string): 'en' | 'de' | 'fr' {
  const hay = ` ${text.toLowerCase()} `;
  const de = [' der ', ' die ', ' das ', ' und ', ' für ', ' nicht ', ' eine ', 'ß', ' werden '];
  const fr = [' le ', ' la ', ' les ', ' est ', ' une ', ' avec ', ' pour ', ' que '];
  const count = (words: string[]): number => words.reduce((a, w) => a + (hay.includes(w) ? 1 : 0), 0);
  if (count(de) >= 2) return 'de';
  if (count(fr) >= 2) return 'fr';
  return 'en';
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function iso(epochSeconds: unknown): string {
  const n = typeof epochSeconds === 'number' ? epochSeconds : 0;
  return n > 0 ? new Date(n * 1000).toISOString().slice(0, 10) : '';
}

export function finalizeCandidate(c: ThreadCandidate): ScoredThread | null {
  const { score, detail } = scoreThread(c.title, c.excerpt);
  if (score < MIN_SCORE) return null;
  return { ...c, score, scoreDetail: detail, lang: detectLang(`${c.title} ${c.excerpt}`) };
}

// --- Stack Exchange -------------------------------------------------------

interface SEItem {
  title?: string;
  link?: string;
  body?: string;
  score?: number;
  answer_count?: number;
  view_count?: number;
  creation_date?: number;
}

export function parseStackExchange(payload: unknown, source: 'stackoverflow' | 'money_se'): ThreadCandidate[] {
  const items = ((payload as { items?: SEItem[] })?.items ?? []).filter((i) => i.link && i.title);
  return items.map((i) => ({
    url: String(i.link),
    source,
    title: stripHtml(String(i.title)),
    excerpt: stripHtml(String(i.body ?? '')).slice(0, 400),
    activity: `${i.score ?? 0} pts · ${i.answer_count ?? 0} rép. · ${i.view_count ?? 0} vues`,
    threadCreatedAt: iso(i.creation_date),
  }));
}

// --- GitHub issue search --------------------------------------------------

interface GHItem {
  html_url?: string;
  title?: string;
  body?: string | null;
  state?: string;
  comments?: number;
  created_at?: string;
}

export function parseGitHubIssues(payload: unknown): ThreadCandidate[] {
  const items = ((payload as { items?: GHItem[] })?.items ?? []).filter((i) => i.html_url && i.title);
  return items.map((i) => ({
    url: String(i.html_url),
    source: 'github' as const,
    title: stripHtml(String(i.title)),
    excerpt: stripHtml(String(i.body ?? '')).slice(0, 400),
    activity: `${i.state ?? '?'} · ${i.comments ?? 0} comm.`,
    threadCreatedAt: String(i.created_at ?? '').slice(0, 10),
  }));
}

// --- Hacker News (Algolia) ------------------------------------------------

interface HNHit {
  objectID?: string;
  title?: string;
  story_title?: string;
  story_text?: string;
  points?: number;
  num_comments?: number;
  created_at?: string;
}

export function parseHN(payload: unknown): ThreadCandidate[] {
  const hits = ((payload as { hits?: HNHit[] })?.hits ?? []).filter((h) => h.objectID && (h.title || h.story_title));
  return hits.map((h) => ({
    url: `https://news.ycombinator.com/item?id=${h.objectID}`,
    source: 'hn' as const,
    title: stripHtml(String(h.title ?? h.story_title)),
    excerpt: stripHtml(String(h.story_text ?? '')).slice(0, 400),
    activity: `${h.points ?? 0} pts · ${h.num_comments ?? 0} comm.`,
    threadCreatedAt: String(h.created_at ?? '').slice(0, 10),
  }));
}

// --- Reddit archive (pullpush, read-only) ---------------------------------

interface PPItem {
  permalink?: string;
  title?: string;
  selftext?: string;
  subreddit?: string;
  score?: number;
  num_comments?: number;
  created_utc?: number;
}

export function parsePullpush(payload: unknown): ThreadCandidate[] {
  const items = ((payload as { data?: PPItem[] })?.data ?? []).filter((i) => i.permalink && i.title);
  return items.map((i) => ({
    url: `https://reddit.com${i.permalink}`,
    source: 'reddit' as const,
    title: stripHtml(String(i.title)),
    excerpt: stripHtml(String(i.selftext ?? '')).slice(0, 400),
    activity: `r/${i.subreddit ?? '?'} · ${i.score ?? 0} pts · ${i.num_comments ?? 0} comm.`,
    threadCreatedAt: iso(i.created_utc),
  }));
}

// ---------------------------------------------------------------------------
// Marketplace presence
// ---------------------------------------------------------------------------

export type CheckKind =
  | 'bazaar' // CDP catalog, paginated JSON, count our resources
  | 'github_issue' // a submission issue whose state we track
  | 'http_contains' // fetch a page, look for a marker string
  | 'npm' // npm registry package
  | 'raw_contains' // raw.githubusercontent file, look for a marker
  | 'dead_watch' // known-dead surface: alive again would be news
  | 'manual'; // no reliable automated probe — operator keeps notes

export interface MarketplaceDef {
  slug: string;
  name: string;
  /** Public page a human opens to see the listing (or where it should be). */
  url: string;
  /** Where to act (submission issue, form) when something needs doing. */
  actionUrl?: string;
  kind: CheckKind;
  /** URL the automated check fetches (unused for kind=manual). */
  checkTarget?: string;
  /** Marker looked up in the response body for *_contains kinds. */
  marker?: string;
  /** Re-check cadence. Heavy targets (7 MB catalogs) are weekly. */
  cadenceHours: number;
}

/**
 * Every surface where being listed (or knowingly absent) matters. All URLs
 * are public directories; states are computed at runtime and stored in DB.
 */
export const MARKETPLACES: MarketplaceDef[] = [
  {
    slug: 'cdp-bazaar',
    name: 'Bazaar CDP (x402)',
    url: 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources',
    kind: 'bazaar',
    checkTarget: 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources',
    cadenceHours: 24,
  },
  {
    slug: 'aegis',
    name: 'Aegis (registre de confiance)',
    url: 'https://aegis.borisinc.com/discover?q=iban',
    kind: 'http_contains',
    checkTarget: 'https://aegis.borisinc.com/discover?q=iban',
    marker: 'ibanforge',
    cadenceHours: 24,
  },
  {
    slug: 'cline-marketplace',
    name: 'Cline MCP Marketplace',
    url: 'https://github.com/cline/mcp-marketplace/issues/1462',
    actionUrl: 'https://github.com/cline/mcp-marketplace/issues/1462',
    kind: 'github_issue',
    checkTarget: 'https://api.github.com/repos/cline/mcp-marketplace/issues/1462',
    cadenceHours: 24,
  },
  {
    slug: 'npm-mcp',
    name: 'npm (ibanforge-mcp)',
    url: 'https://www.npmjs.com/package/ibanforge-mcp',
    kind: 'npm',
    checkTarget: 'https://registry.npmjs.org/ibanforge-mcp',
    cadenceHours: 24,
  },
  {
    slug: 'mcp-registry',
    name: 'Registre MCP officiel',
    url: 'https://registry.modelcontextprotocol.io/v0/servers?search=ibanforge',
    kind: 'http_contains',
    checkTarget: 'https://registry.modelcontextprotocol.io/v0/servers?search=ibanforge',
    marker: 'ibanforge',
    cadenceHours: 24,
  },
  {
    slug: 'mcp-so',
    name: 'mcp.so',
    url: 'https://mcp.so/server/ibanforge',
    kind: 'http_contains',
    checkTarget: 'https://mcp.so/server/ibanforge',
    marker: 'ibanforge',
    cadenceHours: 168,
  },
  {
    slug: 'awesome-x402',
    name: 'awesome-x402 (liste GitHub)',
    url: 'https://github.com/xpaysh/awesome-x402',
    kind: 'raw_contains',
    checkTarget: 'https://raw.githubusercontent.com/xpaysh/awesome-x402/main/README.md',
    marker: 'ibanforge',
    cadenceHours: 168,
  },
  {
    slug: 'apis-guru',
    name: 'APIs.guru (répertoire OpenAPI)',
    url: 'https://apis.guru/',
    actionUrl: 'https://github.com/APIs-guru/openapi-directory/issues',
    kind: 'http_contains',
    checkTarget: 'https://api.apis.guru/v2/list.json',
    marker: 'ibanforge',
    cadenceHours: 168,
  },
  {
    slug: 'api-evangelist',
    name: 'API Evangelist (fiche + agent readiness)',
    url: 'https://github.com/api-evangelist/providers/blob/main/_providers/ibanforge.md',
    kind: 'raw_contains',
    checkTarget: 'https://raw.githubusercontent.com/api-evangelist/providers/main/_providers/ibanforge.md',
    marker: 'ibanforge',
    cadenceHours: 168,
  },
  {
    slug: 'x402-list',
    name: 'x402-list.com',
    url: 'https://x402-list.com',
    kind: 'dead_watch',
    checkTarget: 'https://x402-list.com',
    cadenceHours: 168,
  },
  {
    slug: 'glama',
    name: 'Glama (annuaire MCP)',
    url: 'https://glama.ai/mcp/servers',
    kind: 'manual',
    cadenceHours: 0,
  },
  {
    slug: 'postman',
    name: 'Postman API Network',
    url: 'https://www.postman.com/explore',
    kind: 'manual',
    cadenceHours: 0,
  },
  {
    slug: 'apis-io',
    name: 'apis.io',
    url: 'https://apis.io',
    kind: 'manual',
    cadenceHours: 0,
  },
  {
    slug: 'agentic-market',
    name: 'Agentic Market (auto-Bazaar)',
    url: 'https://agenticmarket.xyz',
    kind: 'manual',
    cadenceHours: 0,
  },
];

export type PresenceStatus = 'listed' | 'absent' | 'pending' | 'dead' | 'manual' | 'unknown';

export interface CheckOutcome {
  status: PresenceStatus;
  detail: string;
}

/**
 * Interpret one fetched check response. Pure: HTTP status + body text in,
 * verdict out. Network errors are handled by the caller (status stays as it
 * was, detail records the failure) — a flaky probe must never flip a listing
 * to 'absent'.
 */
export function interpretCheck(def: MarketplaceDef, httpStatus: number, body: string): CheckOutcome {
  switch (def.kind) {
    case 'bazaar': {
      // Caller aggregates the paginated scan and passes "N" as body.
      const n = parseInt(body, 10) || 0;
      return n > 0
        ? { status: 'listed', detail: `${n} ressource${n > 1 ? 's' : ''} au catalogue` }
        : { status: 'absent', detail: '0 ressource — refaire un micro-règlement (rien n’indexe rétroactivement)' };
    }
    case 'github_issue': {
      if (httpStatus !== 200) return { status: 'unknown', detail: `GitHub HTTP ${httpStatus}` };
      try {
        const issue = JSON.parse(body) as { state?: string; comments?: number; updated_at?: string };
        if (issue.state === 'open') {
          return {
            status: 'pending',
            detail: `soumission en file (issue ouverte, ${issue.comments ?? 0} comm., maj ${String(issue.updated_at ?? '').slice(0, 10)})`,
          };
        }
        return { status: 'manual', detail: 'issue fermée — vérifier si listé ou refusé' };
      } catch {
        return { status: 'unknown', detail: 'réponse GitHub illisible' };
      }
    }
    case 'http_contains':
    case 'raw_contains': {
      if (httpStatus === 404) return { status: 'absent', detail: 'fiche absente (404)' };
      if (httpStatus !== 200) return { status: 'unknown', detail: `HTTP ${httpStatus}` };
      const found = def.marker ? body.toLowerCase().includes(def.marker) : false;
      if (!found) return { status: 'absent', detail: 'répond mais ne nous liste pas' };
      // Aegis exposes tier/score in the payload; surface them when present.
      const tier = /"tier"\s*:\s*"([a-z_]+)"/i.exec(body)?.[1];
      const score = /"(?:trust_)?score"\s*:\s*([0-9.]+)/i.exec(body)?.[1];
      const extra = tier || score ? ` (${[tier, score].filter(Boolean).join(' · ')})` : '';
      return { status: 'listed', detail: `présent${extra}` };
    }
    case 'npm': {
      if (httpStatus === 404) return { status: 'absent', detail: 'paquet introuvable' };
      if (httpStatus !== 200) return { status: 'unknown', detail: `HTTP ${httpStatus}` };
      try {
        const pkg = JSON.parse(body) as { 'dist-tags'?: { latest?: string }; time?: Record<string, string> };
        const v = pkg['dist-tags']?.latest ?? '?';
        const when = pkg.time?.[v]?.slice(0, 10) ?? '';
        return { status: 'listed', detail: `v${v} publiée${when ? ` le ${when}` : ''}` };
      } catch {
        return { status: 'unknown', detail: 'réponse npm illisible' };
      }
    }
    case 'dead_watch': {
      if (httpStatus >= 200 && httpStatus < 400) {
        return { status: 'manual', detail: 'le service répond à nouveau — à re-regarder' };
      }
      return { status: 'dead', detail: `mort confirmé (HTTP ${httpStatus})` };
    }
    case 'manual':
      return { status: 'manual', detail: 'vérification manuelle' };
  }
}

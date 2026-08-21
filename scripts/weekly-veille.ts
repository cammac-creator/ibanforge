/**
 * Weekly market-watch (veille) for IBANforge.
 *
 * 1. Pulls conversion figures (/admin/business-summary) and usage stats
 *    (/stats + /stats/history), all STATS_TOKEN-protected.
 * 2. Researches the market via Claude + the web_search tool.
 * 3. Sends a concise French report to Claude-Alain via the Dory Telegram bot.
 *
 * Runs weekly from .github/workflows/weekly-veille.yml. All inputs come from env
 * (GitHub Actions secrets): ANTHROPIC_API_KEY, STATS_TOKEN, TELEGRAM_BOT_TOKEN,
 * TELEGRAM_CHAT_ID. No external deps — native fetch (Node 20+).
 * Set VEILLE_DRY_RUN=1 to print the report instead of sending it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THE 2026-08-17 AUDIT FOUND, AND WHAT IT CHANGED HERE
 *
 * • The comparison window was one day. /stats/history defaults to period=7 and
 *   returns 8 rows, so slice(-14,-7) yielded a SINGLE row. One report announced
 *   a jump of several hundred percent on a week where traffic had not moved.
 *   Fixed by asking for the window we actually slice, and by refusing to print
 *   a delta when the previous window is short. A missing delta is a small loss;
 *   an invented one costs the reader's trust in every other line.
 *
 * • The revenue line counted our own test settlements as income, and ignored
 *   the credit packs — the only money that ever arrived. Both rails are now
 *   reported, and the on-chain one is split against a configured list of our
 *   own payer wallets.
 *
 * • "Errors" folded 402 in. A 402 is the paywall answering an anonymous probe:
 *   the product working. It hid a 5xx rate worth being proud of.
 *
 * • A weekly total said nothing about how many customers produced it. One
 *   client finishing a migration over two days reads exactly like steady
 *   demand.
 *
 * • Nothing here ever opened the customer ledger, so the most engaged unpaid
 *   user in the base had been invisible for months. Conversion figures now
 *   lead the report, and they lead the research prompt too: fed only traffic
 *   counters, an analyst can only ever propose more traffic.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { pathToFileURL } from 'node:url';
import { runDiscoverabilityCanary } from './discoverability-canary.js';

const API_BASE = process.env.IBANFORGE_API_BASE ?? 'https://api.ibanforge.com';
const STATS_TOKEN = process.env.STATS_TOKEN ?? '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';
const MODEL = process.env.VEILLE_MODEL ?? 'claude-sonnet-4-6';
const DRY_RUN = process.env.VEILLE_DRY_RUN === '1';

/**
 * Days of history to ask for. We slice 7 against the 7 before, so we must
 * request 14 — the default of 7 is what made "previous week" mean one day.
 */
const HISTORY_DAYS = 14;
const WINDOW = 7;

type DayRow = {
  date: string;
  iban_validate: number;
  iban_batch: number;
  bic_lookup: number;
  revenue_usdc: number;
  revenue_attempted_usdc: number;
  total_requests: number;
  s2xx: number;
  s4xx: number;
  s5xx: number;
};

type Stats = {
  total_requests: number;
  requests_today: number;
  requests_by_path: Array<{ path: string; count: number; avg_ms: number }>;
};

/** Shape of GET /admin/business-summary (src/routes/admin-business.ts). */
type BusinessSummary = {
  window_days: number;
  radar?: { last_run_at: string | null; hours_since: number | null; stale: boolean };
  credits: {
    sold_credits: number;
    sold_usd: number;
    sold_usd_is_estimate: boolean;
    /** Accounts whose dollars came from the price table, not the processor. */
    sold_usd_deduced_accounts: number;
    consumed_credits: number;
    consumption_pct: number;
    paying_accounts: number;
    idle_accounts: number;
    accounts: Array<{
      key_prefix: string;
      domain: string;
      sold: number;
      consumed: number;
      pct: number;
      usd: number;
      amount_source: 'measured' | 'deduced';
    }>;
    accounts_omitted: number;
  };
  keys: {
    total: number;
    external: number;
    never_called: number;
    active_this_month: number;
    at_cap_this_month: number;
  };
  steady_unpaid: Array<{
    key_prefix: string;
    domain: string;
    months_active: number;
    used_this_month: number;
    used_all_time: number;
  }>;
  steady_unpaid_omitted: number;
  clients: { distinct: number; active_days: number; top_share_pct: number };
  traffic: {
    total: number;
    payment_required: number;
    errors: number;
    error_pct: number;
    discovery: number;
    discovery_pct: number;
  };
};

/** Shape of the fields we read from GET /admin/revenue. */
type Revenue = {
  total_received_usdc: number;
  received_external_usdc?: number;
  received_internal_usdc?: number;
  internal_payers_configured?: boolean;
  accuracy_note?: string;
};

function requireEnv(): void {
  const missing = [
    ['ANTHROPIC_API_KEY', ANTHROPIC_API_KEY],
    ['STATS_TOKEN', STATS_TOKEN],
    ['TELEGRAM_BOT_TOKEN', BOT_TOKEN],
    ['TELEGRAM_CHAT_ID', CHAT_ID],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
}

async function getJSON<T>(path: string, timeoutMs = 20_000): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${STATS_TOKEN}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

function fmtPct(now: number, prev: number): string {
  if (prev === 0) return now === 0 ? '=' : 'nouveau';
  const d = Math.round(((now - prev) / prev) * 100);
  return `${d >= 0 ? '+' : ''}${d}%`;
}

/**
 * Aggregate the last 7 days against the 7 before.
 *
 * 🚨 `comparable` is the whole point. Comparing a 7-day sum to whatever
 * happens to sit in the earlier slice is how a flat week was published as a
 * jump of several hundred percent: the previous "week" held one day. When the
 * earlier window is short, the caller must print WHY there is no delta rather
 * than a number computed from a different number of days.
 */
export function weekly(history: DayRow[], window = WINDOW) {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted.slice(-window);
  const prev = sorted.slice(-2 * window, -window);
  const comparable = prev.length === window && last.length === window;
  const sum = (rows: DayRow[], k: keyof DayRow) =>
    rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);

  const delta = (now: number, before: number) =>
    comparable ? fmtPct(now, before) : `fenêtre incomplète : ${prev.length}/${window} j`;

  const req = sum(last, 'total_requests');
  const rev = sum(last, 'revenue_usdc');
  const paid = sum(last, 'iban_validate') + sum(last, 'iban_batch') + sum(last, 'bic_lookup');

  return {
    range: last.length ? `${last[0].date} → ${last[last.length - 1].date}` : 'n/a',
    days: last.length,
    comparable,
    req,
    reqDelta: delta(req, sum(prev, 'total_requests')),
    rev,
    revDelta: delta(rev, sum(prev, 'revenue_usdc')),
    paid,
  };
}

const n = (v: number) => v.toLocaleString('fr-CH');

/**
 * Conversion first, deliberately. Everything below it is traffic, and traffic
 * has not been the constraint for months — this block is what the report is
 * for.
 */
export function conversionSection(b: BusinessSummary | null): string {
  if (!b) return '💰 CONVERSION\n(indisponible cette semaine — /admin/business-summary injoignable)';

  const c = b.credits;
  const lines = [
    '💰 CONVERSION',
    `• Crédits vendus : ${n(c.sold_credits)} ($${c.sold_usd}${c.sold_usd_is_estimate ? ' estimé' : ''})` +
      ` · consommés : ${n(c.consumed_credits)} (${c.consumption_pct}%)`,
    `• Comptes payants : ${c.paying_accounts}` +
      (c.idle_accounts ? ` — dont ${c.idle_accounts} pack(s) jamais ouvert(s) (<5% consommé)` : ''),
  ];

  for (const a of c.accounts) {
    lines.push(`   – ${a.key_prefix} (${a.domain}) : ${n(a.consumed)}/${n(a.sold)} = ${a.pct}%`);
  }
  if (c.accounts_omitted > 0) lines.push(`   – (+${c.accounts_omitted} autres comptes payants)`);

  if (b.steady_unpaid.length) {
    lines.push(`• Réguliers NON payants : ${b.steady_unpaid.length}`);
    for (const s of b.steady_unpaid) {
      lines.push(
        `   – ${s.key_prefix} (${s.domain}) : ${s.months_active} mois d'affilée,` +
          ` ${n(s.used_all_time)} appels au total, ${n(s.used_this_month)} ce mois`,
      );
    }
    if (b.steady_unpaid_omitted > 0) lines.push(`   – (+${b.steady_unpaid_omitted} autres)`);
  } else {
    lines.push('• Réguliers non payants : aucun ce mois');
  }

  lines.push(
    `• Palier gratuit : ${b.keys.external} clés externes · ${b.keys.never_called} jamais appelée(s)` +
      ` · ${b.keys.active_this_month} active(s) ce mois · ${b.keys.at_cap_this_month} au plafond`,
  );

  // The daily alert on "a key just hit its cap" lives in the API process. A
  // scheduler that has quietly stopped looks exactly like a calm week, so its
  // silence has to be reported rather than assumed benign.
  if (b.radar?.stale) {
    lines.push(
      '• ⚠️ Radar quotidien MUET : ' +
        (b.radar.last_run_at
          ? `dernier tour il y a ${b.radar.hours_since} h`
          : 'aucun tour enregistré') +
        ' — les alertes plafond atteint et pack inutilisé ne partent plus',
    );
  }
  return lines.join('\n');
}

export function statsSection(
  stats: Stats,
  w: ReturnType<typeof weekly>,
  b: BusinessSummary | null,
  rev: Revenue | null,
): string {
  const top = (stats.requests_by_path ?? [])
    .filter((p) => !/favicon|robots|^\/$|\.ico/.test(p.path))
    .slice(0, 5)
    .map((p) => `${p.path} (${n(p.count)})`)
    .join(', ');

  const lines = [
    `📈 TRAFIC (${w.days} derniers jours)`,
    `• Requêtes : ${n(w.req)} (${w.reqDelta}${w.comparable ? ' vs semaine préc.' : ''})`,
  ];

  if (b) {
    lines.push(
      `• Découverte (catalogues, MCP) : ${b.traffic.discovery_pct}% du trafic` +
        ` — ${n(b.traffic.discovery)} lectures de notre propre fiche`,
      // A 402 is the paywall answering an anonymous probe, not a fault.
      `• Erreurs hors 402 : ${b.traffic.error_pct}% · 402 émis : ${n(b.traffic.payment_required)}`,
    );
  }

  // 🚨 Two different populations, and merging them would repeat the mistake
  // this report exists to stop. `paid` counts billed OPERATIONS from the daily
  // stats (a batch of a hundred bills a hundred); the client figures count
  // authenticated CALLS in the request log, free tier included. Writing
  // "N paid calls — M distinct clients" would claim those M clients made those
  // N calls, which is not what either number says.
  lines.push(`• Appels payants (opérations facturées) : ${n(w.paid)}`);
  if (b) {
    lines.push(
      `• Clients authentifiés : ${b.clients.distinct} sur ${b.clients.active_days} jour(s) actif(s)` +
        (b.clients.top_share_pct >= 50
          ? `, dont ${b.clients.top_share_pct}% des appels par un seul`
          : ''),
    );
  }

  // Two rails, and the small one used to be the only one reported.
  const revLine = `• Revenu x402 (appels réglés) : $${w.rev.toFixed(3)} (${w.revDelta})`;
  if (!rev) {
    lines.push(`${revLine} — on-chain non mesuré cette semaine`);
  } else if (rev.internal_payers_configured && rev.received_external_usdc != null) {
    lines.push(
      `${revLine}`,
      `• On-chain reçu : $${rev.total_received_usdc.toFixed(3)} dont` +
        ` $${(rev.received_internal_usdc ?? 0).toFixed(3)} de nos propres tests` +
        ` → externe réel : $${rev.received_external_usdc.toFixed(3)}`,
    );
  } else {
    // Saying nothing would imply the whole amount is external, which is the
    // error this line exists to stop.
    lines.push(
      `${revLine}`,
      `• On-chain reçu : $${rev.total_received_usdc.toFixed(3)} — ⚠️ part de nos tests non départagée` +
        ' (X402_INTERNAL_PAYERS non configuré)',
    );
  }

  lines.push(`• Total cumulé : ${n(stats.total_requests)} requêtes`, `• Top endpoints : ${top}`);
  return lines.join('\n');
}

async function research(statsSummary: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Tu es l'analyste de veille marché d'IBANforge. Date du jour : ${today}.

IBANforge est une API B2B (solo founder) : validation d'IBAN, lookup BIC/SWIFT, clearing suisse (BC-Nummer/QR-IID, donnée unique), screening compliance (sanctions/FATF/SEPA/VoP, score de risque), exposée nativement en MCP et en micropaiements x402 — positionnée "agent-native".

OBJECTIF DE CETTE VEILLE : comprendre POURQUOI CEUX QUI ESSAIENT N'ACHÈTENT PAS, et trouver ce qui lèverait ce blocage.

Ce n'est pas un objectif de visibilité. La visibilité est faite : le service est présent sur la quasi-totalité des surfaces de découverte visées (catalogues MCP, x402/Bazaar, awesome-lists, annuaires d'API). Ce qui ne bouge pas, c'est la conversion. Ne propose donc PAS "être listé quelque part de plus" sauf si tu peux montrer que ce canal amène des ACHETEURS, pas des robots d'indexation.

Position actuelle (factuel, chiffres réels) :
${statsSummary}

Lis d'abord le bloc CONVERSION ci-dessus. Les signaux qui comptent : un pack acheté puis jamais consommé, une clé qui appelle tous les mois sans jamais payer, une clé émise puis jamais utilisée, un total d'appels produit par un seul client. Chacun raconte un blocage différent (mauvais produit, pas assez de friction au palier gratuit, échec du premier appel, dépendance à un client).

Recherche sur le WEB les développements RÉCENTS (cette semaine / ce mois) qui ouvrent une porte pour IBANforge, en couvrant ces 8 axes :
1. Réglementaire (VoP, Instant Payments Reg, AMLR/AMLA, vIBAN, FATF, SEPA)
2. Concurrents (iban.com, IBANAPI… : prix, pannes, features, trous)
3. Distribution (nouveaux registres MCP, marketplaces, awesome-lists, bazaar x402)
4. Demande/leads (discussions Reddit/HN/StackOverflow "validate IBAN/get BIC", appels d'offres)
5. Écosystème agents/x402 — en particulier les canaux plateformes où naissent des agents DÉJÀ PAYEURS : Amazon Bedrock AgentCore Payments (découverte via le Bazaar x402 monté dans son Gateway — nous y sommes indexés), Cloudflare wallet handles, Coinbase CDP Agentic Wallets. Signale toute NOUVELLE surface de découverte branchée sur un wallet, et tout signal d'acheteur venu de ces canaux.
6. Contenu/SEO (mots-clés, pages comparatives, newsletters fintech)
7. Partenariats/intégrations (ERP type Odoo, compta, PSP, vendors compliance)
8. Pricing/monétisation

Réponds en FRANÇAIS, en TEXTE BRUT (pas de markdown, pas de ** ni de #), concis (rapport Telegram). Structure EXACTEMENT comme ceci :

🧩 CE QUE DISENT LES CHIFFRES DE CONVERSION
• [1 à 3 lignes maximum, chacune une lecture du bloc CONVERSION et ce qu'elle implique. Uniquement ce que les chiffres montrent, pas d'hypothèse habillée en fait.]

🚪 PORTES QUI S'OUVRENT
• [titre court] — pourquoi maintenant (1 phrase). Action : [action concrète]. Source : [URL]
(3 à 5 entrées, les plus actionnables, ancrées sur des faits réels trouvés cette semaine)

🔭 PISTES À CREUSER
• [piste plus exploratoire] — 1 ligne. (2 à 3 entrées)

Pas d'intro ni de conclusion. Si tu ne trouves rien de récent sur un axe, ne l'invente pas.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(240_000),
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = (await res.json()) as {
    type?: string;
    error?: { message: string };
    content?: Array<{ type: string; text?: string }>;
  };
  if (data.type === 'error' || !data.content) {
    throw new Error(`Anthropic error: ${data.error?.message ?? JSON.stringify(data)}`);
  }
  const text = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
  if (!text) throw new Error('Anthropic returned no text');
  return text;
}

/**
 * AI-recommendability baseline. The one documented discovery channel (an Odoo integrator,
 * 2026-06-25) was "Claude Code has recommended". Assistants with web search
 * recommend from what surfaces in the SERPs at question time — this tracks,
 * week over week, whether IBANforge shows up for the canonical buyer queries.
 */
async function recommendability(): Promise<string> {
  const prompt = `Tu mesures la "recommandabilité IA" d'IBANforge (ibanforge.com), une API de validation IBAN + BIC + compliance avec free tier 200 appels/mois sans carte.

Un développeur qui demande à un assistant IA (Claude, ChatGPT, Gemini, Perplexity) « quelle API IBAN utiliser » reçoit une recommandation construite depuis la recherche web. Fais UNE recherche web par requête ci-dessous et note ce qui ressort :

1. "best IBAN validation API free tier"
2. "IBAN validation API"
3. "BIC SWIFT lookup API"
4. "IBAN sanctions screening API"
5. "IBAN prüfen API" (marché DE)
6. "swiss QR-IBAN validation API"

Réponds en FRANÇAIS, TEXTE BRUT, EXACTEMENT ce format compact (une ligne par requête) :

🤖 RECOMMANDABILITÉ IA (baseline hebdo)
1. [top 3 acteurs vus] — IBANforge visible : OUI/NON
2. …(idem pour les 6)
Score : IBANforge visible sur X/6 requêtes.
Plus grosse absence à corriger : [1 phrase concrète]

Ne rien inventer : si une recherche ne montre pas IBANforge, dis NON.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(240_000),
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = (await res.json()) as {
    type?: string;
    error?: { message: string };
    content?: Array<{ type: string; text?: string }>;
  };
  if (data.type === 'error' || !data.content) {
    throw new Error(`Anthropic error: ${data.error?.message ?? JSON.stringify(data)}`);
  }
  const text = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
  if (!text) throw new Error('Anthropic returned no text');
  return text;
}

function frDate(): string {
  return new Date().toLocaleDateString('fr-CH', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/** Telegram caps messages at 4096 chars; split on blank lines, then newlines. */
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

/**
 * Optional inputs: a weekly report must still go out when one of them is down.
 * Each returns null on failure and the formatter says so in words, because a
 * silently missing line reads as a zero.
 */
async function optional<T>(label: string, path: string, timeoutMs?: number): Promise<T | null> {
  try {
    return await getJSON<T>(path, timeoutMs);
  } catch (err) {
    console.warn(`[veille] ${label} unavailable: ${(err as Error).message}`);
    return null;
  }
}

async function main(): Promise<void> {
  requireEnv();
  console.log('[veille] fetching stats…');
  const [stats, history, business, revenue] = await Promise.all([
    getJSON<Stats>('/stats'),
    getJSON<DayRow[]>(`/stats/history?period=${HISTORY_DAYS}`),
    optional<BusinessSummary>('business summary', `/admin/business-summary?days=${WINDOW}`),
    // The on-chain scan walks Base in chunks and regularly takes ~20 s.
    optional<Revenue>('on-chain revenue', '/admin/revenue', 90_000),
  ]);
  const w = weekly(history);
  const conversionBlock = conversionSection(business);
  const statsBlock = statsSection(stats, w, business, revenue);

  console.log('[veille] researching opportunities…');
  let researchBlock: string;
  try {
    researchBlock = await research(`${conversionBlock}\n\n${statsBlock}`);
  } catch (err) {
    // Never lose the stats report just because research failed.
    researchBlock = `🚪 PORTES QUI S'OUVRENT\n(recherche indisponible cette semaine : ${(err as Error).message})`;
  }

  console.log('[veille] measuring AI recommendability…');
  let recoBlock: string;
  try {
    recoBlock = await recommendability();
  } catch (err) {
    recoBlock = `🤖 RECOMMANDABILITÉ IA\n(mesure indisponible cette semaine : ${(err as Error).message})`;
  }

  // Piste C (18/08) : sonder l'API déployée comme un crawler de registre.
  // Le x402 tourne en free mode partout sauf en prod, donc AUCUN test ne
  // peut attraper une régression du « 402 universel » — seul ce canari le voit.
  console.log('[veille] running discoverability canary…');
  let canaryBlock: string;
  try {
    canaryBlock = await runDiscoverabilityCanary();
  } catch (err) {
    canaryBlock = `🕯️ CANARI DÉCOUVRABILITÉ\n(canari indisponible cette semaine : ${(err as Error).message})`;
  }

  const report = [
    `🔔 VEILLE IBANFORGE — ${frDate()}`,
    `Semaine ${w.range}`,
    '',
    conversionBlock,
    '',
    statsBlock,
    '',
    researchBlock,
    '',
    recoBlock,
    '',
    canaryBlock,
    '',
    '— Dory · veille auto hebdomadaire',
  ].join('\n');

  if (DRY_RUN) {
    console.log('[veille] DRY RUN — rien n’est envoyé.\n');
    console.log(report);
    return;
  }
  console.log('[veille] sending via Dory…');
  await sendToDory(report);
  console.log('[veille] done.');
}

// Only run when invoked as a script. Without this guard, importing the module
// to unit-test the window logic would fire a real weekly report.
const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error('[veille] FAILED:', err);
    process.exitCode = 1;
  });
}

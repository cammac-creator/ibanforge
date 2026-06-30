/**
 * Weekly market-watch (veille) for IBANforge.
 *
 * 1. Pulls real usage stats (/stats + /stats/history, STATS_TOKEN-protected).
 * 2. Researches market opportunities via Claude + the web_search tool, across
 *    8 opportunity types (regulatory, competitors, distribution, demand/leads,
 *    agent economy, content/SEO, partnerships, pricing).
 * 3. Sends a concise French report to Claude-Alain via the Dory Telegram bot.
 *
 * Runs weekly from .github/workflows/weekly-veille.yml. All inputs come from env
 * (GitHub Actions secrets): ANTHROPIC_API_KEY, STATS_TOKEN, TELEGRAM_BOT_TOKEN,
 * TELEGRAM_CHAT_ID. No external deps — native fetch (Node 20+).
 */

const API_BASE = process.env.IBANFORGE_API_BASE ?? 'https://api.ibanforge.com';
const STATS_TOKEN = process.env.STATS_TOKEN ?? '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';
const MODEL = process.env.VEILLE_MODEL ?? 'claude-sonnet-4-6';

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

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${STATS_TOKEN}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

function fmtPct(now: number, prev: number): string {
  if (prev === 0) return now === 0 ? '=' : 'nouveau';
  const d = Math.round(((now - prev) / prev) * 100);
  return `${d >= 0 ? '+' : ''}${d}%`;
}

/** Aggregate the last 7 days vs the 7 days before that. */
function weekly(history: DayRow[]) {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const last7 = sorted.slice(-7);
  const prev7 = sorted.slice(-14, -7);
  const sum = (rows: DayRow[], k: keyof DayRow) =>
    rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);

  const req = sum(last7, 'total_requests');
  const reqPrev = sum(prev7, 'total_requests');
  const rev = sum(last7, 'revenue_usdc');
  const revPrev = sum(prev7, 'revenue_usdc');
  const paid =
    sum(last7, 'iban_validate') + sum(last7, 'iban_batch') + sum(last7, 'bic_lookup');
  const s4 = sum(last7, 's4xx');
  const s5 = sum(last7, 's5xx');
  const errPct = req > 0 ? Math.round(((s4 + s5) / req) * 100) : 0;

  return {
    range: last7.length
      ? `${last7[0].date} → ${last7[last7.length - 1].date}`
      : 'n/a',
    req,
    reqDelta: fmtPct(req, reqPrev),
    rev,
    revDelta: fmtPct(rev, revPrev),
    paid,
    errPct,
  };
}

function statsSection(stats: Stats, w: ReturnType<typeof weekly>): string {
  const top = (stats.requests_by_path ?? [])
    .filter((p) => !/favicon|robots|^\/$|\.ico/.test(p.path))
    .slice(0, 5)
    .map((p) => `${p.path} (${p.count.toLocaleString('fr-CH')})`)
    .join(', ');
  return [
    '📈 STATS (7 derniers jours)',
    `• Requêtes : ${w.req.toLocaleString('fr-CH')} (${w.reqDelta} vs semaine préc.)`,
    `• Revenu : $${w.rev.toFixed(3)} (${w.revDelta})`,
    `• Appels payants : ${w.paid}`,
    `• Erreurs 4xx/5xx : ${w.errPct}%`,
    `• Total cumulé : ${stats.total_requests.toLocaleString('fr-CH')} requêtes`,
    `• Top endpoints : ${top}`,
  ].join('\n');
}

async function research(statsSummary: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Tu es l'analyste de veille marché d'IBANforge. Date du jour : ${today}.

IBANforge est une API B2B (solo founder) : validation d'IBAN, lookup BIC/SWIFT, clearing suisse (BC-Nummer/QR-IID, donnée unique), screening compliance (sanctions/FATF/SEPA/VoP, score de risque), exposée nativement en MCP et en micropaiements x402 — positionnée "agent-native". Objectif : plus de profit et de visibilité.

Position actuelle (factuel) :
${statsSummary}

Recherche sur le WEB les développements RÉCENTS (cette semaine / ce mois) qui ouvrent une porte pour IBANforge, en couvrant ces 8 axes :
1. Réglementaire (VoP, Instant Payments Reg, AMLR/AMLA, vIBAN, FATF, SEPA)
2. Concurrents (iban.com, IBANAPI… : prix, pannes, features, trous)
3. Distribution (nouveaux registres MCP, marketplaces, awesome-lists, bazaar x402)
4. Demande/leads (discussions Reddit/HN/StackOverflow "validate IBAN/get BIC", appels d'offres)
5. Écosystème agents/x402 (frameworks adoptant MCP, AP2, USDC/Base)
6. Contenu/SEO (mots-clés, pages comparatives, newsletters fintech)
7. Partenariats/intégrations (ERP type Odoo, compta, PSP, vendors compliance)
8. Pricing/monétisation

Réponds en FRANÇAIS, en TEXTE BRUT (pas de markdown, pas de ** ni de #), concis (rapport Telegram). Structure EXACTEMENT comme ceci :

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

async function main(): Promise<void> {
  requireEnv();
  console.log('[veille] fetching stats…');
  const [stats, history] = await Promise.all([
    getJSON<Stats>('/stats'),
    getJSON<DayRow[]>('/stats/history'),
  ]);
  const w = weekly(history);
  const statsBlock = statsSection(stats, w);

  console.log('[veille] researching opportunities…');
  let researchBlock: string;
  try {
    researchBlock = await research(statsBlock);
  } catch (err) {
    // Never lose the stats report just because research failed.
    researchBlock = `🚪 PORTES QUI S'OUVRENT\n(recherche indisponible cette semaine : ${(err as Error).message})`;
  }

  const report = [
    `🔔 VEILLE IBANFORGE — ${frDate()}`,
    `Semaine ${w.range}`,
    '',
    statsBlock,
    '',
    researchBlock,
    '',
    '— Dory · veille auto hebdomadaire',
  ].join('\n');

  console.log('[veille] sending via Dory…');
  await sendToDory(report);
  console.log('[veille] done.');
}

main().catch((err) => {
  console.error('[veille] FAILED:', err);
  process.exitCode = 1;
});

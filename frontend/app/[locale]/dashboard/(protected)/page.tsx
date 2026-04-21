import { LineChart } from '@/components/line-chart';
import { StackedBarChart } from '@/components/stacked-bar-chart';
import { StatCardV2 } from '@/components/dashboard/stat-card-v2';
import { ProgressBars } from '@/components/dashboard/progress-bars';
import { StatusByPathTable, type StatusByPathRow } from '@/components/dashboard/status-by-path-table';
import { BusinessFunnelChart, type BusinessFunnelDay } from '@/components/dashboard/business-funnel-chart';
import { InfoDot } from '@/components/dashboard/info-dot';
import { getTranslations, getLocale } from 'next-intl/server';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const STATS_TOKEN = process.env.STATS_TOKEN || '';
const statsHeaders: HeadersInit = STATS_TOKEN ? { Authorization: `Bearer ${STATS_TOKEN}` } : {};

function fmt(n: number, locale: string): string {
  return n.toLocaleString(locale);
}

interface StatsResponse {
  total_requests: number;
  requests_today: number;
  requests_by_path: Array<{ path: string; count: number; avg_ms: number }>;
  requests_by_status: Array<{ status_group: string; count: number }>;
  total_operations: number;
  by_type: {
    iban_validate: { total: number; valid_count: number; success_rate: number };
    iban_batch: { total: number; valid_count: number; success_rate: number };
    bic_lookup: { total: number; found_count: number; hit_rate: number };
  };
  total_revenue_usdc: number;
  top_countries: Array<{ country: string; count: number }>;
  last_7_days: Array<{ date: string; total: number; revenue: number }>;
  bic_database_entries: number;
}

interface HistoryEntry {
  date: string;
  iban_validate: number;
  iban_batch: number;
  bic_lookup: number;
  revenue_usdc: number;
  total_requests: number;
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
}

async function fetchStats(): Promise<StatsResponse | null> {
  try {
    const res = await fetch(`${API_URL}/stats`, { cache: 'no-store', headers: statsHeaders });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchHistory(): Promise<HistoryEntry[]> {
  try {
    const res = await fetch(`${API_URL}/stats/history?period=30`, { cache: 'no-store', headers: statsHeaders });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function fetchStatusByPath(): Promise<StatusByPathRow[]> {
  try {
    const res = await fetch(`${API_URL}/stats/status-by-path?period=30`, { cache: 'no-store', headers: statsHeaders });
    if (!res.ok) return [];
    const data = (await res.json()) as { rows?: StatusByPathRow[] };
    return data.rows ?? [];
  } catch {
    return [];
  }
}

async function fetchBusinessFunnel(): Promise<BusinessFunnelDay[]> {
  try {
    const res = await fetch(`${API_URL}/stats/business-funnel?period=30`, { cache: 'no-store', headers: statsHeaders });
    if (!res.ok) return [];
    const data = (await res.json()) as { rows?: BusinessFunnelDay[] };
    return data.rows ?? [];
  } catch {
    return [];
  }
}

export default async function DashboardPage() {
  const t = await getTranslations('dashboard');
  const locale = await getLocale();
  const [stats, history, statusByPath, funnel] = await Promise.all([
    fetchStats(),
    fetchHistory(),
    fetchStatusByPath(),
    fetchBusinessFunnel(),
  ]);

  if (!stats) {
    return (
      <div className="flex flex-col gap-6">
        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-8 text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
            <span className="text-red-400 text-xl">!</span>
          </div>
          <p className="text-zinc-300 font-medium">{t('error.apiUnavailable')}</p>
          <p className="text-sm text-zinc-500 mt-1">
            {t('error.apiUnavailableDescription')}
          </p>
        </div>
      </div>
    );
  }

  // Today's calls
  const todayCalls =
    history.length > 0
      ? (history[history.length - 1].iban_validate ?? 0) +
        (history[history.length - 1].iban_batch ?? 0) +
        (history[history.length - 1].bic_lookup ?? 0)
      : 0;

  // Yesterday's calls for trend
  const yesterdayCalls =
    history.length > 1
      ? (history[history.length - 2].iban_validate ?? 0) +
        (history[history.length - 2].iban_batch ?? 0) +
        (history[history.length - 2].bic_lookup ?? 0)
      : 0;

  const todayTrend: 'up' | 'down' | 'neutral' =
    yesterdayCalls === 0
      ? 'neutral'
      : todayCalls > yesterdayCalls
        ? 'up'
        : todayCalls < yesterdayCalls
          ? 'down'
          : 'neutral';

  const trendPct =
    yesterdayCalls > 0
      ? `${Math.abs(Math.round(((todayCalls - yesterdayCalls) / yesterdayCalls) * 100))}%`
      : undefined;

  // Revenue trend
  const todayRevenue = history.length > 0 ? (history[history.length - 1].revenue_usdc ?? 0) : 0;
  const yesterdayRevenue = history.length > 1 ? (history[history.length - 2].revenue_usdc ?? 0) : 0;
  const revenueTrend: 'up' | 'down' | 'neutral' =
    yesterdayRevenue === 0
      ? 'neutral'
      : todayRevenue > yesterdayRevenue
        ? 'up'
        : todayRevenue < yesterdayRevenue
          ? 'down'
          : 'neutral';
  const revenueTrendPct =
    yesterdayRevenue > 0
      ? `${Math.abs(Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100))}%`
      : undefined;

  // Sparklines — last 7 days of history
  const last7 = history.slice(-7);
  const callsSparkline = last7.map(
    (d) => (d.iban_validate ?? 0) + (d.iban_batch ?? 0) + (d.bic_lookup ?? 0),
  );
  const revenueSparkline = last7.map((d) => d.revenue_usdc ?? 0);

  // Success rate
  const ibanTotal = stats.by_type.iban_validate?.total ?? 0;
  const ibanValid = stats.by_type.iban_validate?.valid_count ?? 0;
  const successRate = ibanTotal > 0 ? ((ibanValid / ibanTotal) * 100).toFixed(1) : '—';

  // Line chart config (API operations only)
  const lineConfig = [
    { key: 'iban_validate', color: '#f59e0b', label: t('chart.legends.ibanValidate') },
    { key: 'iban_batch', color: '#3b82f6', label: t('chart.legends.ibanBatch') },
    { key: 'bic_lookup', color: '#22c55e', label: t('chart.legends.bicLookup') },
  ];

  // Endpoint breakdown for ProgressBars
  const endpointTotal =
    (stats.by_type.iban_validate?.total ?? 0) +
    (stats.by_type.iban_batch?.total ?? 0) +
    (stats.by_type.bic_lookup?.total ?? 0);

  const progressItems = [
    {
      label: t('chart.legends.ibanValidate'),
      value: stats.by_type.iban_validate?.total ?? 0,
      color: '#f59e0b',
      total: endpointTotal,
    },
    {
      label: t('chart.legends.ibanBatch'),
      value: stats.by_type.iban_batch?.total ?? 0,
      color: '#3b82f6',
      total: endpointTotal,
    },
    {
      label: t('chart.legends.bicLookup'),
      value: stats.by_type.bic_lookup?.total ?? 0,
      color: '#22c55e',
      total: endpointTotal,
    },
  ];

  const topCountries = (stats.top_countries ?? []).slice(0, 5);
  const maxCountryCount = topCountries.length > 0 ? topCountries[0].count : 1;

  // Requests by path for the table
  const requestsByPath = stats.requests_by_path ?? [];
  const requestsByStatus = stats.requests_by_status ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* Stat cards — 4 columns */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCardV2
          title="Total requests"
          value={fmt(stats.total_requests ?? 0, locale)}
          accentColor="#a855f7"
          hint="Toutes les requêtes HTTP vues par le serveur depuis le début, y compris /mcp, scanners et health checks."
        />
        <StatCardV2
          title={t('stats.today')}
          value={fmt(stats.requests_today ?? 0, locale)}
          accentColor="#8b5cf6"
          hint="Requêtes HTTP reçues depuis minuit UTC (tous paths confondus)."
        />
        <StatCardV2
          title={t('stats.today') + ' (API)'}
          value={fmt(todayCalls, locale)}
          trend={
            trendPct
              ? {
                  direction: todayTrend,
                  label: t('stats.vsYesterday', { percent: trendPct }),
                }
              : undefined
          }
          sparkline={callsSparkline}
          accentColor="#f59e0b"
          hint="Uniquement les opérations métier du jour (validate + batch + bic_lookup). Exclut les 4xx/5xx et /mcp."
        />
        <StatCardV2
          title={t('stats.totalRevenue')}
          value={`$${(stats.total_revenue_usdc ?? 0).toFixed(4)}`}
          trend={
            revenueTrendPct
              ? {
                  direction: revenueTrend,
                  label: t('stats.vsYesterday', { percent: revenueTrendPct }),
                }
              : undefined
          }
          sparkline={revenueSparkline}
          accentColor="#22c55e"
          hint="Revenu USDC réellement perçu (x402). Depuis le fix du 17 avril, les revenus affichés = revenus collectés. L’historique avant cette date contient ~$0.23 de revenus fantômes non corrigés."
        />
        <StatCardV2
          title={t('stats.successRate')}
          value={successRate !== '—' ? `${successRate}%` : '—'}
          trend={
            successRate !== '—'
              ? {
                  direction: parseFloat(successRate) >= 95 ? 'up' : 'down',
                  label: `${successRate}%`,
                }
              : undefined
          }
          accentColor="#3b82f6"
          hint="% d’IBAN jugés valides parmi les IBAN soumis à /v1/iban/validate. Un taux bas signifie que les appelants envoient beaucoup d’IBAN mal formés."
        />
      </div>

      {/* NEW: Business funnel — the chart that actually tells the conversion story */}
      <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
        <div className="mb-4 flex items-center gap-2">
          <p className="text-sm font-medium text-zinc-300">Funnel métier — 30 jours</p>
          <InfoDot>
            Seules les requêtes sur les endpoints facturables (IBAN / BIC / CH clearing)
            avec la bonne méthode HTTP. Le bruit (scanner, robots, favicon, trafic
            discovery) est exclu.
            <br />
            <br />
            <strong className="text-emerald-400">Paid success</strong> = l’agent a payé (x402) ou utilisé sa clé API et reçu 2xx.
            <br />
            <strong className="text-amber-400">Paywall hit</strong> = agent intéressé mais sans auth → 402. C’est là que se joue la conversion.
            <br />
            <strong className="text-violet-400">Auth / quota</strong> = 401 (mauvaise clé) ou 429 (quota mensuel atteint).
            <br />
            <strong className="text-yellow-400">Bad input</strong> = 400 (body mal formé, IBAN manquant).
            <br />
            <strong className="text-red-400">Server error</strong> = 5xx, doit rester à zéro.
          </InfoDot>
        </div>
        <BusinessFunnelChart data={funnel} />
      </div>

      {/* Status-code × path — the "where do the 4xx actually come from?" table */}
      <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
        <div className="mb-4 flex items-center gap-2">
          <p className="text-sm font-medium text-zinc-300">Status × endpoint — 30 days</p>
          <InfoDot>
            Pour chaque path, la mini-barre montre la part 2xx/3xx/4xx/5xx.
            Survole un segment ou un chiffre pour l’explication.
            <br />
            <strong>Lecture rapide</strong> : pastille verte = endpoint sain ; orange = beaucoup de 4xx (paywall, scanners) ; rouge = 5xx → à investiguer.
          </InfoDot>
        </div>
        <StatusByPathTable rows={statusByPath} />
      </div>

      {/* Summary row: aggregate status + response codes */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Status codes (overall) */}
        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
          <div className="mb-4 flex items-center gap-2">
            <p className="text-sm font-medium text-zinc-300">Response status codes</p>
            <InfoDot>Ventilation globale toutes routes confondues, depuis le démarrage du tracking.</InfoDot>
          </div>
          {requestsByStatus.length > 0 ? (
            <div className="space-y-3">
              {requestsByStatus.map((row) => {
                const color = row.status_group === '2xx' ? '#22c55e' : row.status_group === '3xx' ? '#f59e0b' : row.status_group === '4xx' ? '#eab308' : '#ef4444';
                const totalReqs = requestsByStatus.reduce((s, r) => s + r.count, 0);
                const pct = totalReqs > 0 ? (row.count / totalReqs) * 100 : 0;
                return (
                  <div key={row.status_group}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                        <span className="text-sm font-mono text-zinc-300">{row.status_group}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-zinc-400">{fmt(row.count, locale)}</span>
                        <span className="text-xs font-mono text-zinc-600 w-12 text-right">{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="h-2 w-full rounded-full bg-zinc-800/60 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center text-zinc-600 text-sm">No request data yet</div>
          )}
        </div>

        {/* Fastest / slowest endpoints */}
        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
          <div className="mb-4 flex items-center gap-2">
            <p className="text-sm font-medium text-zinc-300">Top endpoints by volume</p>
            <InfoDot>Top 15 paths par nombre de requêtes depuis le démarrage. Le détail par classe de statut se lit dans la table ci-dessus.</InfoDot>
          </div>
          {requestsByPath.length > 0 ? (
            <div className="space-y-2">
              {requestsByPath.map((row) => {
                const maxCount = requestsByPath[0]?.count || 1;
                const pct = (row.count / maxCount) * 100;
                return (
                  <div key={row.path}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-mono text-zinc-300 truncate max-w-[60%]">{row.path}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-mono text-zinc-600">{row.avg_ms}ms</span>
                        <span className="text-xs font-mono text-purple-400">{fmt(row.count, locale)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-zinc-800/60 overflow-hidden">
                      <div className="h-full rounded-full bg-purple-500/40" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center text-zinc-600 text-sm">No request data yet</div>
          )}
        </div>
      </div>

      {/* Two columns: ProgressBars + Top 5 countries */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Endpoint breakdown */}
        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
          <div className="mb-4 flex items-center gap-2">
            <p className="text-sm font-medium text-zinc-300">{t('chart.endpointBreakdown')}</p>
            <InfoDot>Répartition des opérations métier (IBAN/BIC) entre les trois endpoints facturables. Ne couvre pas /v1/iban/compliance ni /v1/ch/clearing.</InfoDot>
          </div>
          {endpointTotal > 0 ? (
            <ProgressBars items={progressItems} />
          ) : (
            <div className="flex h-32 items-center justify-center text-zinc-500 text-sm">
              {t('chart.noData')}
            </div>
          )}
        </div>

        {/* Top 5 countries */}
        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
          <div className="mb-4 flex items-center gap-2">
            <p className="text-sm font-medium text-zinc-300">{t('chart.top10Countries')}</p>
            <InfoDot>Déduit du code pays ISO extrait de l’IBAN ou du BIC validé. « XX » = BIC test/internal.</InfoDot>
          </div>
          {topCountries.length > 0 ? (
            <div className="space-y-2.5">
              {topCountries.map((row, i) => {
                const pct = maxCountryCount > 0 ? (row.count / maxCountryCount) * 100 : 0;
                return (
                  <div key={row.country} className="flex items-center gap-3">
                    <span className="w-5 text-xs text-zinc-600 text-right font-mono">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm text-zinc-200 truncate">
                          {t.has(`countries.${row.country}`) ? t(`countries.${row.country}` as Parameters<typeof t>[0]) : row.country}
                        </span>
                        <span className="text-xs font-mono text-amber-400 ml-2 flex-shrink-0">
                          {fmt(row.count, locale)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-amber-500/40"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center text-zinc-500 text-sm">
              {t('chart.noCountryData')}
            </div>
          )}
        </div>
      </div>

      {/* Legacy charts kept in footer — useful for infra-level debugging
          (scanner detection, bot waves, per-class noise ratios) even if not
          the best lens for business conversion. */}
      <div className="mt-2 border-t border-zinc-800/60 pt-6">
        <p className="mb-3 text-xs uppercase tracking-wider text-zinc-600">Vue brute — toutes requêtes HTTP (infra)</p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Original stacked bar: ALL requests incl. scanner/noise */}
          <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
            <div className="mb-4 flex items-center gap-2">
              <p className="text-sm font-medium text-zinc-300">Requests — 30 days</p>
              <InfoDot>
                Total des requêtes HTTP par jour, toutes routes confondues y compris scanner, /favicon.ico, /robots.txt et discovery. Garde un œil sur la pente globale et les 5xx, mais pour la conversion business regarde plutôt le graphique « Funnel métier » en haut de page.
              </InfoDot>
            </div>
            {history.length > 0 ? (
              <StackedBarChart
                data={history}
                bars={[
                  { key: 's2xx', color: '#3b82f6', label: '2xx' },
                  { key: 's3xx', color: '#f59e0b', label: '3xx' },
                  { key: 's4xx', color: '#eab308', label: '4xx' },
                  { key: 's5xx', color: '#ef4444', label: '5xx' },
                ]}
              />
            ) : (
              <div className="flex h-64 items-center justify-center text-zinc-500 text-sm">
                {t('chart.noHistoryData')}
              </div>
            )}
          </div>

          {/* Line chart — business ops per type */}
          <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
            <div className="mb-4 flex items-center gap-2">
              <p className="text-sm font-medium text-zinc-300">{t('chart.apiCalls30d')}</p>
              <InfoDot>
                Opérations métier qui ont atteint le handler (2xx uniquement), ventilées par type d’endpoint. Ne compte pas les 402 / 400 / 429.
              </InfoDot>
            </div>
            {history.length > 0 ? (
              <LineChart data={history} lines={lineConfig} />
            ) : (
              <div className="flex h-64 items-center justify-center text-zinc-500 text-sm">
                {t('chart.noHistoryData')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

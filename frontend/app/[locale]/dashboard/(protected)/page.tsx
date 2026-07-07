import { StackedBarChart } from '@/components/stacked-bar-chart';
import { StatCardV2 } from '@/components/dashboard/stat-card-v2';
import { BusinessFunnelChart, type BusinessFunnelDay } from '@/components/dashboard/business-funnel-chart';
import { Heatmap } from '@/components/dashboard/heatmap';
import { ErrorTable } from '@/components/dashboard/error-table';
import { InfoDot } from '@/components/dashboard/info-dot';
import { RevenueCard } from '@/components/dashboard/revenue-card';
import { LiveHealthStrip } from '@/components/dashboard/live-health-strip';
import { getTranslations, getLocale } from 'next-intl/server';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const STATS_TOKEN = process.env.STATS_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const statsHeaders: HeadersInit = STATS_TOKEN ? { Authorization: `Bearer ${STATS_TOKEN}` } : {};

const VALID_PERIODS = [7, 30, 90] as const;
type ValidPeriod = (typeof VALID_PERIODS)[number];

function fmt(n: number, locale: string): string {
  return n.toLocaleString(locale);
}

// ---------------------------------------------------------------- types
interface StatsResponse {
  total_requests: number;
  requests_today: number;
  requests_by_path: Array<{ path: string; count: number; avg_ms: number }>;
  by_type: {
    iban_validate: { total: number; valid_count: number; success_rate: number };
    iban_batch: { total: number; valid_count: number; success_rate: number };
    bic_lookup: { total: number; found_count: number; hit_rate: number };
  };
  total_revenue_usdc: number;
  top_countries: Array<{ country: string; count: number }>;
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

interface KeyRow {
  key_prefix: string;
  email: string;
  monthly_limit: number | null;
  active: number;
  created_at: string;
  used: number;
}
interface KeysResponse {
  month: string;
  keys: KeyRow[];
}

interface ErrorsResponse {
  error_rate: {
    iban_validate: { rate: number; trend: number[] };
    bic_lookup: { rate: number; trend: number[] };
  };
  top_invalid_ibans: Array<{ prefix: string; country: string; count: number; error_type: string }>;
  top_missing_bics: Array<{ bic: string; country: string; count: number }>;
}

interface HourlyResponse {
  heatmap: Array<{ day: number; hour: number; total: number }>;
}

// ---------------------------------------------------------------- fetchers
async function getJSON<T>(path: string, headers: HeadersInit): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: 'no-store', headers });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- lead helpers
function daysSince(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000);
}
function classify(row: KeyRow): { label: string; color: string; bg: string } {
  const limit = row.monthly_limit ?? 200;
  const isPilot = limit > 200;
  const isSilent = row.used === 0;
  const isAtRisk = limit > 0 && row.used / limit >= 0.8;
  const created = daysSince(row.created_at);
  if (!row.active) return { label: 'inactive', color: '#71717a', bg: '#27272a' };
  if (isPilot && isSilent && created >= 3) return { label: 'silent', color: '#f59e0b', bg: '#451a03' };
  if (isPilot && isSilent) return { label: 'pending', color: '#a78bfa', bg: '#2e1065' };
  if (isAtRisk) return { label: 'at-risk', color: '#ef4444', bg: '#450a0a' };
  if (row.used > 0) return { label: 'active', color: '#22c55e', bg: '#052e16' };
  return { label: 'unused', color: '#71717a', bg: '#27272a' };
}

// ================================================================ page
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations('dashboard');
  const locale = await getLocale();
  const params = await searchParams;
  const periodParam = Number(params.period ?? 30);
  const period: ValidPeriod = VALID_PERIODS.includes(periodParam as ValidPeriod)
    ? (periodParam as ValidPeriod)
    : 30;

  const [stats, history, funnel, keysData, errors, hourly] = await Promise.all([
    getJSON<StatsResponse>('/stats', statsHeaders),
    getJSON<HistoryEntry[]>(`/stats/history?period=${period}`, statsHeaders),
    getJSON<{ rows?: BusinessFunnelDay[] }>(`/stats/business-funnel?period=${period}`, statsHeaders),
    ADMIN_SECRET ? getJSON<KeysResponse>('/v1/admin/keys', { 'X-Admin-Secret': ADMIN_SECRET }) : Promise.resolve(null),
    getJSON<ErrorsResponse>(`/stats/errors?period=${period}`, statsHeaders),
    getJSON<HourlyResponse>(`/stats/hourly?period=${period}`, statsHeaders),
  ]);

  if (!stats) {
    return (
      <div className="rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
          <span className="text-xl text-red-400">!</span>
        </div>
        <p className="font-medium text-[var(--fg-2)]">{t('error.apiUnavailable')}</p>
        <p className="mt-1 text-sm text-[var(--fg-4)]">{t('error.apiUnavailableDescription')}</p>
      </div>
    );
  }

  const hist = history ?? [];
  const funnelRows = funnel?.rows ?? [];

  // --- KPIs: today's API operations + trend + sparkline
  const ops = (d?: HistoryEntry) =>
    d ? (d.iban_validate ?? 0) + (d.iban_batch ?? 0) + (d.bic_lookup ?? 0) : 0;
  const todayCalls = ops(hist[hist.length - 1]);
  const yesterdayCalls = ops(hist[hist.length - 2]);
  const callsTrend: 'up' | 'down' | 'neutral' =
    yesterdayCalls === 0 ? 'neutral' : todayCalls > yesterdayCalls ? 'up' : todayCalls < yesterdayCalls ? 'down' : 'neutral';
  const callsTrendPct =
    yesterdayCalls > 0 ? `${Math.abs(Math.round(((todayCalls - yesterdayCalls) / yesterdayCalls) * 100))}%` : undefined;
  const callsSparkline = hist.slice(-7).map(ops);

  const todayRevenue = hist[hist.length - 1]?.revenue_usdc ?? 0;
  const yesterdayRevenue = hist[hist.length - 2]?.revenue_usdc ?? 0;
  const revTrend: 'up' | 'down' | 'neutral' =
    yesterdayRevenue === 0 ? 'neutral' : todayRevenue > yesterdayRevenue ? 'up' : todayRevenue < yesterdayRevenue ? 'down' : 'neutral';
  const revTrendPct =
    yesterdayRevenue > 0 ? `${Math.abs(Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100))}%` : undefined;
  const revenueSparkline = hist.slice(-7).map((d) => d.revenue_usdc ?? 0);

  const ibanTotal = stats.by_type?.iban_validate?.total ?? 0;
  const ibanValid = stats.by_type?.iban_validate?.valid_count ?? 0;
  const successRate = ibanTotal > 0 ? ((ibanValid / ibanTotal) * 100).toFixed(1) : '—';

  // --- Leads / pilots
  const allKeys = keysData?.keys ?? [];
  const pilots = allKeys
    .filter((k) => (k.monthly_limit ?? 200) > 200)
    .sort((a, b) => b.used - a.used);
  const activePilots = pilots.filter((k) => k.used > 0).length;
  const silentPilots = pilots.filter((k) => k.used === 0 && daysSince(k.created_at) >= 3);

  // --- Quality
  const ibanErrRate = errors?.error_rate?.iban_validate?.rate ?? 0;
  const ibanErrTrend = errors?.error_rate?.iban_validate?.trend ?? [];
  const bicMissRate = errors?.error_rate?.bic_lookup?.rate ?? 0;
  const bicMissTrend = errors?.error_rate?.bic_lookup?.trend ?? [];
  const ibanRows = errors?.top_invalid_ibans ?? [];
  const bicRows = errors?.top_missing_bics ?? [];

  // --- Top countries (all-time, from /stats)
  const topCountries = (stats.top_countries ?? []).slice(0, 6);
  const maxCountry = topCountries[0]?.count ?? 1;

  const heatmapData = hourly?.heatmap ?? [];

  const card = 'rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 p-5';
  const sectionTitle = 'flex items-center gap-2 text-sm font-medium text-[var(--fg-2)]';

  return (
    <div className="flex flex-col gap-6">
      {/* 0. Live health */}
      <LiveHealthStrip />

      {/* 1. KPI row — the four numbers that matter */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCardV2
          title={`Appels API (${t('stats.today')})`}
          value={fmt(todayCalls, locale)}
          trend={callsTrendPct ? { direction: callsTrend, label: t('stats.vsYesterday', { percent: callsTrendPct }) } : undefined}
          sparkline={callsSparkline}
          accentColor="#f59e0b"
          hint="Opérations métier facturables du jour (validate + batch + bic_lookup). Exclut le bruit (4xx/5xx, /mcp, scanners)."
        />
        <StatCardV2
          title={t('stats.totalRevenue')}
          value={`$${(stats.total_revenue_usdc ?? 0).toFixed(4)}`}
          trend={revTrendPct ? { direction: revTrend, label: t('stats.vsYesterday', { percent: revTrendPct }) } : undefined}
          sparkline={revenueSparkline}
          accentColor="#22c55e"
          hint="Revenu USDC réellement perçu (x402), cumulé. L'historique avant le 17 avril contient ~$0.23 de revenus fantômes non corrigés."
        />
        <StatCardV2
          title={t('stats.successRate')}
          value={successRate !== '—' ? `${successRate}%` : '—'}
          trend={successRate !== '—' ? { direction: parseFloat(successRate) >= 95 ? 'up' : 'down', label: `${successRate}%` } : undefined}
          accentColor="#3b82f6"
          hint="% d'IBAN jugés valides parmi ceux soumis à /v1/iban/validate. Un taux bas = beaucoup d'IBAN mal formés en entrée."
        />
        <StatCardV2
          title="Clients pilotes"
          value={String(pilots.length)}
          trend={pilots.length > 0 ? { direction: activePilots > 0 ? 'up' : 'neutral', label: `${activePilots} actifs` } : undefined}
          accentColor="#a855f7"
          hint="Clés à quota relevé (> 200/mois). « actifs » = ont déjà appelé l'API ce mois. Les silencieux sont listés ci-dessous."
        />
      </div>

      {/* 2. Conversion funnel — where the money leaks (primacy) */}
      <div className={card}>
        <div className="mb-4 flex items-center gap-2">
          <p className={sectionTitle}>Funnel de conversion — {period} jours</p>
          <InfoDot>
            Seules les requêtes sur les endpoints facturables (IBAN / BIC / CH clearing) avec la bonne méthode HTTP. Le bruit (scanner, robots, discovery) est exclu, ainsi que les clés internes (tes tests, les audits Claude, le playground) — le funnel ne mesure que la demande réelle du marché.
            <br />
            <br />
            <strong className="text-[var(--ok)]">Paid success</strong> = l’agent a payé (x402) ou utilisé sa clé et reçu 2xx.
            <br />
            <strong className="text-amber-400">Paywall hit</strong> = agent intéressé mais sans auth → 402. C’est là que se joue la conversion.
            <br />
            <strong className="text-violet-400">Auth / quota</strong> = 401 (mauvaise clé) ou 429 (quota atteint).
            <br />
            <strong className="text-yellow-400">Bad input</strong> = 400 (body mal formé).
            <br />
            <strong className="text-red-400">Server error</strong> = 5xx, doit rester à zéro.
          </InfoDot>
        </div>
        <BusinessFunnelChart data={funnelRows} />
      </div>

      {/* 3. Leads — silent pilots to chase (primacy) */}
      <div className={card}>
        <div className="mb-4 flex items-center justify-between gap-2">
          <p className={sectionTitle}>Clients & leads{keysData ? ` — ${keysData.month}` : ''}</p>
          {silentPilots.length > 0 && (
            <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-400">
              {silentPilots.length} à relancer
            </span>
          )}
        </div>

        {!keysData ? (
          <div className="flex h-24 items-center justify-center text-sm text-[var(--fg-5)]">
            ADMIN_SECRET non configuré — gestion des clés indisponible.
          </div>
        ) : (
          <>
            {silentPilots.length > 0 && (
              <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="mb-2 text-xs font-medium text-amber-300">⚠ Pilotes silencieux (clé créée, jamais utilisée ≥ 3 j) — à relancer</p>
                <ul className="space-y-1">
                  {silentPilots.map((k) => (
                    <li key={k.key_prefix} className="text-xs text-amber-200">
                      <span className="font-mono text-amber-400">{k.key_prefix}</span> — {k.email}{' '}
                      <span className="text-amber-500/60">({daysSince(k.created_at)} j)</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {pilots.length === 0 ? (
              <div className="flex h-24 items-center justify-center text-sm text-[var(--fg-5)]">Aucun client pilote pour l’instant.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--ink-4)] text-left text-xs uppercase tracking-wide text-[var(--fg-4)]">
                      <th className="pb-2 font-medium">Client</th>
                      <th className="pb-2 font-medium">Créé</th>
                      <th className="pb-2 font-medium">Usage</th>
                      <th className="pb-2 font-medium">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pilots.map((k) => {
                      const limit = k.monthly_limit ?? 200;
                      const pct = limit > 0 ? Math.round((k.used / limit) * 100) : 0;
                      const status = classify(k);
                      return (
                        <tr key={k.key_prefix} className="border-b border-[var(--ink-4)]/50 last:border-0">
                          <td className="py-3">
                            <div className="flex flex-col">
                              <span className="max-w-[260px] truncate text-[var(--fg-1)]">{k.email}</span>
                              <span className="font-mono text-[10px] text-[var(--fg-5)]">{k.key_prefix}</span>
                            </div>
                          </td>
                          <td className="py-3 text-xs text-[var(--fg-3)]">{daysSince(k.created_at)} j</td>
                          <td className="py-3">
                            <div className="flex items-center gap-3">
                              <span className="w-24 font-mono text-xs text-[var(--fg-2)]">
                                {fmt(k.used, locale)} / {fmt(limit, locale)}
                              </span>
                              <div className="h-1.5 max-w-[120px] flex-1 overflow-hidden rounded-full bg-[var(--ink-4)]/60">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: status.color }} />
                              </div>
                            </div>
                          </td>
                          <td className="py-3">
                            <span
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                              style={{ color: status.color, backgroundColor: status.bg }}
                            >
                              {status.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* 4. Revenue (live USDC wallet) */}
      <RevenueCard />

      {/* 5. Traffic — trend + geography */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={card}>
          <div className="mb-4 flex items-center gap-2">
            <p className={sectionTitle}>Requêtes HTTP — {period} jours</p>
            <InfoDot>Total des requêtes par jour, toutes routes (y compris scanner, discovery). Surveille la pente et surtout les 5xx (rouge).</InfoDot>
          </div>
          {hist.length > 0 ? (
            <StackedBarChart
              data={hist}
              bars={[
                { key: 's2xx', color: '#3b82f6', label: '2xx' },
                { key: 's3xx', color: '#f59e0b', label: '3xx' },
                { key: 's4xx', color: '#eab308', label: '4xx' },
                { key: 's5xx', color: '#ef4444', label: '5xx' },
              ]}
            />
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-[var(--fg-4)]">{t('chart.noHistoryData')}</div>
          )}
        </div>

        <div className={card}>
          <div className="mb-4 flex items-center gap-2">
            <p className={sectionTitle}>Top pays (cumulé)</p>
            <InfoDot>Déduit du code pays ISO de l’IBAN/BIC validé. « XX » = BIC test/internal. Cumulé depuis le début (non filtré par période).</InfoDot>
          </div>
          {topCountries.length > 0 ? (
            <div className="space-y-2.5">
              {topCountries.map((row, i) => {
                const pct = maxCountry > 0 ? (row.count / maxCountry) * 100 : 0;
                const label = t.has(`countries.${row.country}`) ? t(`countries.${row.country}` as Parameters<typeof t>[0]) : row.country;
                return (
                  <div key={row.country} className="flex items-center gap-3">
                    <span className="w-5 text-right font-mono text-xs text-[var(--fg-5)]">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center justify-between">
                        <span className="truncate text-sm text-[var(--fg-1)]">{label}</span>
                        <span className="ml-2 flex-shrink-0 font-mono text-xs text-amber-400">{fmt(row.count, locale)}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--ink-4)]">
                        <div className="h-full rounded-full bg-amber-500/40" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center text-sm text-[var(--fg-4)]">{t('chart.noCountryData')}</div>
          )}
        </div>
      </div>

      {/* 6. Quality — error rates + what's actually failing */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCardV2 title="Taux erreur IBAN" value={`${ibanErrRate.toFixed(2)}%`} sparkline={ibanErrTrend} accentColor="#ef4444" hint="% de /v1/iban/validate renvoyant invalide, sur la période." />
        <StatCardV2 title="Taux miss BIC" value={`${bicMissRate.toFixed(2)}%`} sparkline={bicMissTrend} accentColor="#eab308" hint="% de /v1/bic/:code sans correspondance, sur la période." />
        <StatCardV2 title="Pilotes silencieux" value={String(silentPilots.length)} accentColor="#f59e0b" hint="Clés pilotes créées mais jamais utilisées depuis ≥ 3 jours — opportunités de relance." />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ErrorTable
          title="Top IBAN invalides"
          columns={[
            { key: 'prefix', label: 'Préfixe', mono: true },
            { key: 'country', label: 'Pays' },
            { key: 'count', label: 'Nb', mono: true },
            { key: 'error_type', label: 'Type' },
          ]}
          rows={ibanRows}
          emptyMessage="Aucune erreur IBAN sur la période."
        />
        <ErrorTable
          title="Top BIC manquants"
          columns={[
            { key: 'bic', label: 'BIC', mono: true },
            { key: 'country', label: 'Pays' },
            { key: 'count', label: 'Nb', mono: true },
          ]}
          rows={bicRows}
          emptyMessage="Aucun BIC manquant sur la période."
        />
      </div>

      {/* 7. Activity heatmap — when the traffic happens */}
      <Heatmap data={heatmapData} />
    </div>
  );
}

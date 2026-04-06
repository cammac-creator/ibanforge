import { StatCard } from '@/components/stat-card';
import { LineChart } from '@/components/line-chart';
import { DonutChart } from '@/components/donut-chart';
import { DashboardHeader } from '@/components/dashboard/dashboard-header';
import { QuickActions } from '@/components/dashboard/quick-actions';
import Link from 'next/link';
import { getTranslations, getLocale } from 'next-intl/server';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const STATS_TOKEN = process.env.STATS_TOKEN || '';
const statsHeaders: HeadersInit = STATS_TOKEN ? { Authorization: `Bearer ${STATS_TOKEN}` } : {};

function fmt(n: number, locale: string): string {
  return n.toLocaleString(locale);
}

interface StatsResponse {
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

export default async function DashboardPage() {
  const t = await getTranslations('dashboard');
  const locale = await getLocale();
  const [stats, history] = await Promise.all([fetchStats(), fetchHistory()]);

  if (!stats) {
    return (
      <div className="flex flex-col gap-6">
        <DashboardHeader />
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
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

  const weekCalls = Array.isArray(stats.last_7_days)
    ? stats.last_7_days.reduce((sum, day) => sum + (day.total ?? 0), 0)
    : 0;

  const donutData = [
    { name: t('chart.legends.ibanValidate'), value: stats.by_type.iban_validate?.total ?? 0, color: '#f59e0b' },
    { name: t('chart.legends.ibanBatch'), value: stats.by_type.iban_batch?.total ?? 0, color: '#3b82f6' },
    { name: t('chart.legends.bicLookup'), value: stats.by_type.bic_lookup?.total ?? 0, color: '#22c55e' },
  ];

  const lineConfig = [
    { key: 'iban_validate', color: '#f59e0b', label: t('chart.legends.ibanValidate') },
    { key: 'iban_batch', color: '#3b82f6', label: t('chart.legends.ibanBatch') },
    { key: 'bic_lookup', color: '#22c55e', label: t('chart.legends.bicLookup') },
  ];

  const topCountries = (stats.top_countries ?? []).slice(0, 10);
  const maxCountryCount = topCountries.length > 0 ? topCountries[0].count : 1;

  return (
    <div className="flex flex-col gap-6 max-w-7xl">
      <DashboardHeader />

      {/* Stat cards — 4 columns */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t('stats.today')}
          value={fmt(todayCalls, locale)}
          subtitle={t('stats.apiCalls')}
          trend={todayTrend}
          trendLabel={trendPct ? t('stats.vsYesterday', { percent: trendPct }) : undefined}
        />
        <StatCard
          title={t('stats.thisWeek')}
          value={fmt(weekCalls, locale)}
          subtitle={t('stats.last7Days')}
        />
        <StatCard
          title={t('stats.totalRevenue')}
          value={`$${(stats.total_revenue_usdc ?? 0).toFixed(4)}`}
          subtitle={t('stats.usdcCollected')}
        />
        <StatCard
          title={t('stats.bicDatabase')}
          value={fmt(stats.bic_database_entries ?? 39243, locale)}
          subtitle={t('stats.gleifEntries')}
        />
      </div>

      {/* Line chart — full width */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-medium text-zinc-300">{t('chart.apiCalls30d')}</p>
          <Link
            href={`/${locale}/dashboard/api-stats`}
            className="text-xs text-amber-400/70 hover:text-amber-400 transition"
          >
            {t('chart.viewDetails')}
          </Link>
        </div>
        {history.length > 0 ? (
          <LineChart data={history} lines={lineConfig} />
        ) : (
          <div className="flex h-64 items-center justify-center text-zinc-500 text-sm">
            {t('chart.noHistoryData')}
          </div>
        )}
      </div>

      {/* Two columns: Donut + Countries */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Donut chart */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="mb-2 text-sm font-medium text-zinc-300">{t('chart.endpointBreakdown')}</p>
          {donutData.some((d) => d.value > 0) ? (
            <DonutChart data={donutData} />
          ) : (
            <div className="flex h-64 items-center justify-center text-zinc-500 text-sm">
              {t('chart.noData')}
            </div>
          )}
        </div>

        {/* Top 10 countries */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="mb-4 text-sm font-medium text-zinc-300">{t('chart.top10Countries')}</p>
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
                          {t.has(`countries.${row.country}`) ? t(`countries.${row.country}` as any) : row.country}
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

      {/* Quick actions */}
      <QuickActions />
    </div>
  );
}

import { LineChart } from '@/components/line-chart';
import { StatCard } from '@/components/stat-card';
import { PeriodSelector } from './period-selector';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function fmt(n: number): string {
  return n.toLocaleString('fr-CH');
}

function rateColor(rate: number): string {
  if (rate >= 90) return 'text-green-400';
  if (rate >= 70) return 'text-yellow-400';
  return 'text-red-400';
}

function rateBg(rate: number): string {
  if (rate >= 90) return 'bg-green-500/10';
  if (rate >= 70) return 'bg-yellow-500/10';
  return 'bg-red-500/10';
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
    const res = await fetch(`${API_URL}/stats`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchHistory(period: number): Promise<HistoryEntry[]> {
  try {
    const res = await fetch(`${API_URL}/stats/history?period=${period}`, { cache: 'no-store' });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function ApiStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const params = await searchParams;
  const rawPeriod = parseInt(params.period ?? '30', 10);
  const period = [7, 30, 90].includes(rawPeriod) ? rawPeriod : 30;

  const [stats, history] = await Promise.all([fetchStats(), fetchHistory(period)]);

  if (!stats) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold text-white">API Stats</h1>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
            <span className="text-red-400 text-xl">!</span>
          </div>
          <p className="text-zinc-300 font-medium">API indisponible</p>
          <p className="text-sm text-zinc-500 mt-1">Le backend n&apos;est pas joignable.</p>
        </div>
      </div>
    );
  }

  const totalByType = {
    iban_validate: stats.by_type.iban_validate?.total ?? 0,
    iban_batch: stats.by_type.iban_batch?.total ?? 0,
    bic_lookup: stats.by_type.bic_lookup?.total ?? 0,
  };
  const grandTotal = totalByType.iban_validate + totalByType.iban_batch + totalByType.bic_lookup;

  const periodTotal = history.reduce(
    (acc, row) => ({
      iban_validate: acc.iban_validate + (row.iban_validate ?? 0),
      iban_batch: acc.iban_batch + (row.iban_batch ?? 0),
      bic_lookup: acc.bic_lookup + (row.bic_lookup ?? 0),
      revenue: acc.revenue + (row.revenue_usdc ?? 0),
    }),
    { iban_validate: 0, iban_batch: 0, bic_lookup: 0, revenue: 0 },
  );

  const periodCalls = periodTotal.iban_validate + periodTotal.iban_batch + periodTotal.bic_lookup;

  const lineConfig = [
    { key: 'iban_validate', color: '#f59e0b', label: 'IBAN validate' },
    { key: 'iban_batch', color: '#3b82f6', label: 'IBAN batch' },
    { key: 'bic_lookup', color: '#22c55e', label: 'BIC lookup' },
  ];

  const endpoints = [
    {
      name: 'POST /v1/iban/validate',
      type: 'iban_validate' as const,
      color: 'text-amber-400',
      dotColor: 'bg-amber-400',
      total: totalByType.iban_validate,
      periodCount: periodTotal.iban_validate,
      price: '$0.005',
      successRate: stats.by_type.iban_validate?.success_rate ?? 100,
    },
    {
      name: 'POST /v1/iban/batch',
      type: 'iban_batch' as const,
      color: 'text-blue-400',
      dotColor: 'bg-blue-400',
      total: totalByType.iban_batch,
      periodCount: periodTotal.iban_batch,
      price: '$0.020',
      successRate: stats.by_type.iban_batch?.success_rate ?? 100,
    },
    {
      name: 'GET /v1/bic/:code',
      type: 'bic_lookup' as const,
      color: 'text-green-400',
      dotColor: 'bg-green-400',
      total: totalByType.bic_lookup,
      periodCount: periodTotal.bic_lookup,
      price: '$0.003',
      successRate: stats.by_type.bic_lookup?.hit_rate ?? 100,
    },
  ];

  // Recent activity from last entries of history
  const recentDays = history.slice(-5).reverse();

  return (
    <div className="flex flex-col gap-6 max-w-7xl">
      {/* Header with period selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">API Stats</h1>
          <p className="text-sm text-zinc-500 mt-1">Analyse détaillée par endpoint</p>
        </div>
        <PeriodSelector current={period} />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total opérations"
          value={fmt(grandTotal)}
          subtitle="Depuis le début"
        />
        <StatCard
          title={`Appels (${period}j)`}
          value={fmt(periodCalls)}
          subtitle={`${period} derniers jours`}
        />
        <StatCard
          title="Revenu total"
          value={`$${(stats.total_revenue_usdc ?? 0).toFixed(4)}`}
          subtitle="USDC collectés"
        />
        <StatCard
          title={`Revenu (${period}j)`}
          value={`$${periodTotal.revenue.toFixed(4)}`}
          subtitle={`${period} derniers jours`}
        />
      </div>

      {/* Line chart */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <p className="mb-4 text-sm font-medium text-zinc-300">
          Appels API — {period} derniers jours
        </p>
        {history.length > 0 ? (
          <LineChart data={history} lines={lineConfig} />
        ) : (
          <div className="flex h-64 items-center justify-center text-zinc-500 text-sm">
            Aucune donnée pour cette période
          </div>
        )}
      </div>

      {/* Endpoint breakdown — enhanced */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <p className="mb-4 text-sm font-medium text-zinc-300">Détail par endpoint</p>
        <div className="space-y-3">
          {endpoints.map((ep) => {
            const share = grandTotal > 0 ? ((ep.total / grandTotal) * 100).toFixed(1) : '0.0';
            return (
              <div
                key={ep.type}
                className="rounded-lg border border-zinc-800/50 bg-zinc-800/20 p-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${ep.dotColor}`} />
                    <span className={`font-mono text-sm font-medium ${ep.color}`}>{ep.name}</span>
                    <span className="text-xs text-zinc-600 ml-1">{ep.price}/appel</span>
                  </div>
                  {/* Success rate badge */}
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${rateColor(ep.successRate)} ${rateBg(ep.successRate)}`}
                  >
                    {ep.successRate.toFixed(1)}% {ep.type === 'bic_lookup' ? 'hit rate' : 'succès'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-xs text-zinc-500 mb-0.5">Période ({period}j)</p>
                    <p className="text-lg font-mono font-semibold text-zinc-200">{fmt(ep.periodCount)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500 mb-0.5">All time</p>
                    <p className="text-lg font-mono font-semibold text-zinc-400">{fmt(ep.total)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500 mb-0.5">Part</p>
                    <p className="text-lg font-mono font-semibold text-zinc-400">{share}%</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent activity */}
      {recentDays.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="mb-4 text-sm font-medium text-zinc-300">Activité récente</p>
          <div className="space-y-2">
            {recentDays.map((day) => {
              const dayTotal =
                (day.iban_validate ?? 0) + (day.iban_batch ?? 0) + (day.bic_lookup ?? 0);
              return (
                <div
                  key={day.date}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-zinc-800/30"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-zinc-500 w-20">{day.date}</span>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-amber-400">{fmt(day.iban_validate ?? 0)} valid</span>
                      <span className="text-zinc-700">|</span>
                      <span className="text-blue-400">{fmt(day.iban_batch ?? 0)} batch</span>
                      <span className="text-zinc-700">|</span>
                      <span className="text-green-400">{fmt(day.bic_lookup ?? 0)} BIC</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="font-mono text-zinc-300">{fmt(dayTotal)} total</span>
                    <span className="font-mono text-amber-400/70">
                      ${(day.revenue_usdc ?? 0).toFixed(4)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

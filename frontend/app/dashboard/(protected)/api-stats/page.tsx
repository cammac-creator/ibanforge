import { LineChart } from '@/components/line-chart';
import { StatCard } from '@/components/stat-card';
import { PeriodSelector } from './period-selector';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface StatsResponse {
  total_operations: number;
  by_type: {
    iban_validate: number;
    iban_batch: number;
    bic_lookup: number;
  };
  total_revenue_usdc: number;
  top_countries: Array<{ country: string; count: number }>;
  last_7_days: number;
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
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-white">API Stats</h1>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center text-zinc-400">
          API unavailable — the backend is not reachable. Start the API server and refresh.
        </div>
      </div>
    );
  }

  const totalByType = {
    iban_validate: stats.by_type.iban_validate ?? 0,
    iban_batch: stats.by_type.iban_batch ?? 0,
    bic_lookup: stats.by_type.bic_lookup ?? 0,
  };
  const grandTotal = totalByType.iban_validate + totalByType.iban_batch + totalByType.bic_lookup;

  // Compute success rates from history (assumed 100% if no error field present)
  const periodTotal = history.reduce(
    (acc, row) => ({
      iban_validate: acc.iban_validate + (row.iban_validate ?? 0),
      iban_batch: acc.iban_batch + (row.iban_batch ?? 0),
      bic_lookup: acc.bic_lookup + (row.bic_lookup ?? 0),
    }),
    { iban_validate: 0, iban_batch: 0, bic_lookup: 0 },
  );

  const lineConfig = [
    { key: 'iban_validate', color: '#f59e0b', label: 'IBAN validate' },
    { key: 'iban_batch', color: '#3b82f6', label: 'IBAN batch' },
    { key: 'bic_lookup', color: '#22c55e', label: 'BIC lookup' },
  ];

  const endpoints = [
    {
      name: 'POST /v1/iban/validate',
      type: 'iban_validate',
      color: 'text-amber-400',
      total: totalByType.iban_validate,
      periodCount: periodTotal.iban_validate,
      price: '$0.005',
    },
    {
      name: 'POST /v1/iban/batch',
      type: 'iban_batch',
      color: 'text-blue-400',
      total: totalByType.iban_batch,
      periodCount: periodTotal.iban_batch,
      price: '$0.020',
    },
    {
      name: 'GET /v1/bic/:code',
      type: 'bic_lookup',
      color: 'text-green-400',
      total: totalByType.bic_lookup,
      periodCount: periodTotal.bic_lookup,
      price: '$0.003',
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">API Stats</h1>
          <p className="text-sm text-zinc-500 mt-1">Detailed endpoint breakdown</p>
        </div>
        <PeriodSelector current={period} />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          title="Total operations"
          value={grandTotal.toLocaleString()}
          subtitle="All time"
        />
        <StatCard
          title={`Calls (${period}d)`}
          value={(periodTotal.iban_validate + periodTotal.iban_batch + periodTotal.bic_lookup).toLocaleString()}
          subtitle={`Last ${period} days`}
        />
        <StatCard
          title="Total revenue"
          value={`$${(stats.total_revenue_usdc ?? 0).toFixed(4)}`}
          subtitle="USDC collected"
        />
      </div>

      {/* Line chart */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <p className="mb-4 text-sm font-medium text-zinc-300">
          API calls — last {period} days
        </p>
        {history.length > 0 ? (
          <LineChart data={history} lines={lineConfig} />
        ) : (
          <div className="flex h-64 items-center justify-center text-zinc-500 text-sm">
            No history data for this period
          </div>
        )}
      </div>

      {/* Endpoint breakdown */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <p className="mb-4 text-sm font-medium text-zinc-300">Endpoint breakdown</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="pb-2 pr-4">Endpoint</th>
              <th className="pb-2 pr-4 text-right">Price</th>
              <th className="pb-2 pr-4 text-right">Period calls</th>
              <th className="pb-2 text-right">All time</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((ep) => (
              <tr key={ep.type} className="border-b border-zinc-800/50 last:border-0">
                <td className={`py-3 pr-4 font-mono text-xs ${ep.color}`}>{ep.name}</td>
                <td className="py-3 pr-4 text-right text-zinc-400">{ep.price}</td>
                <td className="py-3 pr-4 text-right font-mono text-zinc-200">
                  {ep.periodCount.toLocaleString()}
                </td>
                <td className="py-3 text-right font-mono text-zinc-400">
                  {ep.total.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Top countries */}
      {stats.top_countries && stats.top_countries.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="mb-4 text-sm font-medium text-zinc-300">Top 10 countries</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="pb-2 pr-4">#</th>
                <th className="pb-2 pr-4">Country</th>
                <th className="pb-2 text-right">Calls</th>
                <th className="pb-2 text-right">Share</th>
              </tr>
            </thead>
            <tbody>
              {stats.top_countries.slice(0, 10).map((row, i) => {
                const share = grandTotal > 0 ? ((row.count / grandTotal) * 100).toFixed(1) : '0.0';
                return (
                  <tr key={row.country} className="border-b border-zinc-800/50 last:border-0">
                    <td className="py-2 pr-4 text-zinc-500">{i + 1}</td>
                    <td className="py-2 pr-4 text-zinc-200">{row.country}</td>
                    <td className="py-2 pr-4 text-right font-mono text-amber-400">
                      {row.count.toLocaleString()}
                    </td>
                    <td className="py-2 text-right text-zinc-500">{share}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

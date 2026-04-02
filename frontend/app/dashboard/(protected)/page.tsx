import { StatCard } from '@/components/stat-card';
import { LineChart } from '@/components/line-chart';
import { DonutChart } from '@/components/donut-chart';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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

async function fetchHistory(): Promise<HistoryEntry[]> {
  try {
    const res = await fetch(`${API_URL}/stats/history?period=30`, { cache: 'no-store' });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function DashboardPage() {
  const [stats, history] = await Promise.all([fetchStats(), fetchHistory()]);

  if (!stats) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-white">Overview</h1>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center text-zinc-400">
          API unavailable — the backend is not reachable. Start the API server and refresh.
        </div>
      </div>
    );
  }

  const todayCalls =
    history.length > 0
      ? (history[history.length - 1].iban_validate ?? 0) +
        (history[history.length - 1].iban_batch ?? 0) +
        (history[history.length - 1].bic_lookup ?? 0)
      : 0;

  const weekCalls = Array.isArray(stats.last_7_days)
    ? stats.last_7_days.reduce((sum, day) => sum + (day.total ?? 0), 0)
    : 0;

  const donutData = [
    { name: 'IBAN validate', value: stats.by_type.iban_validate?.total ?? 0, color: '#f59e0b' },
    { name: 'IBAN batch', value: stats.by_type.iban_batch?.total ?? 0, color: '#3b82f6' },
    { name: 'BIC lookup', value: stats.by_type.bic_lookup?.total ?? 0, color: '#22c55e' },
  ];

  const lineConfig = [
    { key: 'iban_validate', color: '#f59e0b', label: 'IBAN validate' },
    { key: 'iban_batch', color: '#3b82f6', label: 'IBAN batch' },
    { key: 'bic_lookup', color: '#22c55e', label: 'BIC lookup' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Overview</h1>
        <p className="text-sm text-zinc-500 mt-1">API usage at a glance</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          title="Today"
          value={todayCalls.toLocaleString()}
          subtitle="API calls today"
        />
        <StatCard
          title="This week"
          value={weekCalls.toLocaleString()}
          subtitle="Last 7 days"
        />
        <StatCard
          title="Total revenue"
          value={`$${(stats.total_revenue_usdc ?? 0).toFixed(4)}`}
          subtitle="USDC collected"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="col-span-2 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="mb-4 text-sm font-medium text-zinc-300">API calls — last 30 days</p>
          {history.length > 0 ? (
            <LineChart data={history} lines={lineConfig} />
          ) : (
            <div className="flex h-64 items-center justify-center text-zinc-500 text-sm">
              No history data available
            </div>
          )}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="mb-2 text-sm font-medium text-zinc-300">Endpoint distribution</p>
          {donutData.some((d) => d.value > 0) ? (
            <DonutChart data={donutData} />
          ) : (
            <div className="flex h-64 items-center justify-center text-zinc-500 text-sm">
              No data yet
            </div>
          )}
        </div>
      </div>

      {/* Top countries table */}
      {stats.top_countries && stats.top_countries.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="mb-4 text-sm font-medium text-zinc-300">Top 10 countries</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="pb-2 pr-4">#</th>
                <th className="pb-2 pr-4">Country</th>
                <th className="pb-2 text-right">Calls</th>
              </tr>
            </thead>
            <tbody>
              {stats.top_countries.slice(0, 10).map((row, i) => (
                <tr key={row.country} className="border-b border-zinc-800/50 last:border-0">
                  <td className="py-2 pr-4 text-zinc-500">{i + 1}</td>
                  <td className="py-2 pr-4 text-zinc-200">{row.country}</td>
                  <td className="py-2 text-right font-mono text-amber-400">
                    {row.count.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { StatCard } from '@/components/stat-card';
import { LineChart } from '@/components/line-chart';
import { DonutChart } from '@/components/donut-chart';
import { DashboardHeader } from '@/components/dashboard/dashboard-header';
import { QuickActions } from '@/components/dashboard/quick-actions';
import Link from 'next/link';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const STATS_TOKEN = process.env.STATS_TOKEN || '';
const statsHeaders: HeadersInit = STATS_TOKEN ? { Authorization: `Bearer ${STATS_TOKEN}` } : {};

/** ISO country code -> full country name */
const COUNTRY_NAMES: Record<string, string> = {
  CH: 'Suisse', DE: 'Allemagne', FR: 'France', IT: 'Italie', AT: 'Autriche',
  GB: 'Royaume-Uni', ES: 'Espagne', NL: 'Pays-Bas', BE: 'Belgique', LU: 'Luxembourg',
  PT: 'Portugal', IE: 'Irlande', SE: 'Suède', DK: 'Danemark', NO: 'Norvège',
  FI: 'Finlande', PL: 'Pologne', CZ: 'Tchéquie', HU: 'Hongrie', GR: 'Grèce',
  RO: 'Roumanie', BG: 'Bulgarie', HR: 'Croatie', SK: 'Slovaquie', SI: 'Slovénie',
  EE: 'Estonie', LV: 'Lettonie', LT: 'Lituanie', CY: 'Chypre', MT: 'Malte',
  US: 'États-Unis', CA: 'Canada', AU: 'Australie', JP: 'Japon', CN: 'Chine',
  BR: 'Brésil', MX: 'Mexique', IN: 'Inde', RU: 'Russie', TR: 'Turquie',
  SA: 'Arabie Saoudite', AE: 'Émirats Arabes Unis', IL: 'Israël', ZA: 'Afrique du Sud',
  SG: 'Singapour', HK: 'Hong Kong', KR: 'Corée du Sud', TW: 'Taïwan',
  MA: 'Maroc', TN: 'Tunisie', EG: 'Égypte', NG: 'Nigeria',
  LI: 'Liechtenstein', MC: 'Monaco', SM: 'Saint-Marin', AD: 'Andorre',
};

function countryLabel(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

function fmt(n: number): string {
  return n.toLocaleString('fr-CH');
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
  const [stats, history] = await Promise.all([fetchStats(), fetchHistory()]);

  if (!stats) {
    return (
      <div className="flex flex-col gap-6">
        <DashboardHeader />
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
            <span className="text-red-400 text-xl">!</span>
          </div>
          <p className="text-zinc-300 font-medium">API indisponible</p>
          <p className="text-sm text-zinc-500 mt-1">
            Le backend n&apos;est pas joignable. Démarrez le serveur API et rafraîchissez.
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
    { name: 'IBAN validate', value: stats.by_type.iban_validate?.total ?? 0, color: '#f59e0b' },
    { name: 'IBAN batch', value: stats.by_type.iban_batch?.total ?? 0, color: '#3b82f6' },
    { name: 'BIC lookup', value: stats.by_type.bic_lookup?.total ?? 0, color: '#22c55e' },
  ];

  const lineConfig = [
    { key: 'iban_validate', color: '#f59e0b', label: 'IBAN validate' },
    { key: 'iban_batch', color: '#3b82f6', label: 'IBAN batch' },
    { key: 'bic_lookup', color: '#22c55e', label: 'BIC lookup' },
  ];

  const topCountries = (stats.top_countries ?? []).slice(0, 10);
  const maxCountryCount = topCountries.length > 0 ? topCountries[0].count : 1;

  return (
    <div className="flex flex-col gap-6 max-w-7xl">
      <DashboardHeader />

      {/* Stat cards — 4 columns */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Aujourd'hui"
          value={fmt(todayCalls)}
          subtitle="Appels API"
          trend={todayTrend}
          trendLabel={trendPct ? `${trendPct} vs hier` : undefined}
        />
        <StatCard
          title="Cette semaine"
          value={fmt(weekCalls)}
          subtitle="7 derniers jours"
        />
        <StatCard
          title="Revenu total"
          value={`$${(stats.total_revenue_usdc ?? 0).toFixed(4)}`}
          subtitle="USDC collectés"
        />
        <StatCard
          title="Base BIC"
          value={fmt(stats.bic_database_entries ?? 39243)}
          subtitle="Entrées GLEIF"
        />
      </div>

      {/* Line chart — full width */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-medium text-zinc-300">Appels API — 30 derniers jours</p>
          <Link
            href="/dashboard/api-stats"
            className="text-xs text-amber-400/70 hover:text-amber-400 transition"
          >
            Voir détails →
          </Link>
        </div>
        {history.length > 0 ? (
          <LineChart data={history} lines={lineConfig} />
        ) : (
          <div className="flex h-64 items-center justify-center text-zinc-500 text-sm">
            Aucune donnée historique disponible
          </div>
        )}
      </div>

      {/* Two columns: Donut + Countries */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Donut chart */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="mb-2 text-sm font-medium text-zinc-300">Répartition par endpoint</p>
          {donutData.some((d) => d.value > 0) ? (
            <DonutChart data={donutData} />
          ) : (
            <div className="flex h-64 items-center justify-center text-zinc-500 text-sm">
              Aucune donnée
            </div>
          )}
        </div>

        {/* Top 10 countries */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="mb-4 text-sm font-medium text-zinc-300">Top 10 pays</p>
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
                          {countryLabel(row.country)}
                        </span>
                        <span className="text-xs font-mono text-amber-400 ml-2 flex-shrink-0">
                          {fmt(row.count)}
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
              Aucune donnée pays
            </div>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <QuickActions />
    </div>
  );
}

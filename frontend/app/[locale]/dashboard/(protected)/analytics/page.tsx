import { LineChart } from '@/components/line-chart';
import { Heatmap } from '@/components/dashboard/heatmap';
import { getTranslations } from 'next-intl/server';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const STATS_TOKEN = process.env.STATS_TOKEN || '';
const statsHeaders: HeadersInit = STATS_TOKEN ? { Authorization: `Bearer ${STATS_TOKEN}` } : {};

const VALID_PERIODS = [7, 30, 90] as const;
type ValidPeriod = (typeof VALID_PERIODS)[number];

interface HeatmapDataPoint {
  day: number;
  hour: number;
  total: number;
}

interface HourlyResponse {
  heatmap: HeatmapDataPoint[];
  peak_hours: { start: number; end: number; days: number[] };
  weekend_drop_pct: number;
}

interface EndpointShareEntry {
  date: string;
  iban_validate: number;
  iban_batch: number;
  bic_lookup: number;
}

interface GeoTrendEntry {
  date: string;
  [country: string]: string | number;
}

interface PatternsResponse {
  endpoint_share_trend: EndpointShareEntry[];
  geo_trend: GeoTrendEntry[];
  top_countries_list: string[];
}

async function fetchHourly(period: number): Promise<HourlyResponse | null> {
  try {
    const res = await fetch(`${API_URL}/stats/hourly?period=${period}`, {
      cache: 'no-store',
      headers: statsHeaders,
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchPatterns(period: number): Promise<PatternsResponse | null> {
  try {
    const res = await fetch(`${API_URL}/stats/patterns?period=${period}`, {
      cache: 'no-store',
      headers: statsHeaders,
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

const GEO_COLORS = ['#f59e0b', '#3b82f6', '#22c55e', '#a855f7', '#ef4444'];

const DAY_INDEX_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations('dashboard');
  const params = await searchParams;
  const periodParam = Number(params.period ?? 30);
  const period: ValidPeriod = VALID_PERIODS.includes(periodParam as ValidPeriod)
    ? (periodParam as ValidPeriod)
    : 30;

  const [hourly, patterns] = await Promise.all([
    fetchHourly(period),
    fetchPatterns(period),
  ]);

  const heatmapData = hourly?.heatmap ?? [];
  const peakHours = hourly?.peak_hours;
  const weekendDrop = hourly?.weekend_drop_pct;

  // Endpoint share trend lines
  const endpointLines = [
    { key: 'iban_validate', color: '#f59e0b', label: t('chart.legends.ibanValidate') },
    { key: 'iban_batch', color: '#3b82f6', label: t('chart.legends.ibanBatch') },
    { key: 'bic_lookup', color: '#22c55e', label: t('chart.legends.bicLookup') },
  ];

  // Geo trend lines — one per country in top_countries_list
  const topCountriesList = patterns?.top_countries_list ?? [];
  const geoLines = topCountriesList.map((country, i) => ({
    key: country,
    color: GEO_COLORS[i % GEO_COLORS.length],
    label: country,
  }));

  // Peak day labels
  const peakDayLabels =
    peakHours?.days
      .map((d) => {
        const key = DAY_INDEX_KEYS[d];
        if (!key) return String(d);
        return t(`analytics.heatmap.days.${key}`);
      })
      .join(', ') ?? '—';

  return (
    <div className="flex flex-col gap-6">
      {/* Heatmap */}
      <Heatmap data={heatmapData} />

      {/* Peak activity card */}
      {peakHours && (
        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
          <p className="text-sm font-semibold text-white mb-4">
            {t('analytics.peak.title')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
                {t('analytics.peak.hours', { start: peakHours.start, end: peakHours.end })}
              </p>
              <p className="text-lg font-mono font-bold text-amber-400">
                {peakHours.start}h – {peakHours.end}h
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
                {t('analytics.peak.days', { days: peakDayLabels })}
              </p>
              <p className="text-sm font-medium text-white">{peakDayLabels}</p>
            </div>
            {weekendDrop !== undefined && weekendDrop !== null && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
                  {t('analytics.peak.weekendDrop', { pct: weekendDrop.toFixed(1) })}
                </p>
                <p className="text-lg font-mono font-bold text-blue-400">
                  -{weekendDrop.toFixed(1)}%
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Two-column charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Endpoint share trend */}
        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
          <p className="text-sm font-medium text-zinc-300 mb-4">
            {t('analytics.endpointTrend.title')}
          </p>
          {patterns?.endpoint_share_trend && patterns.endpoint_share_trend.length > 0 ? (
            <LineChart data={patterns.endpoint_share_trend} lines={endpointLines} />
          ) : (
            <div className="flex h-48 items-center justify-center text-zinc-500 text-sm">
              {t('chart.noHistoryData')}
            </div>
          )}
        </div>

        {/* Geographic trend */}
        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
          <p className="text-sm font-medium text-zinc-300 mb-4">
            {t('analytics.geoTrend.title')}
          </p>
          {patterns?.geo_trend && patterns.geo_trend.length > 0 && geoLines.length > 0 ? (
            <LineChart data={patterns.geo_trend as Record<string, string | number>[]} lines={geoLines} />
          ) : (
            <div className="flex h-48 items-center justify-center text-zinc-500 text-sm">
              {t('chart.noHistoryData')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

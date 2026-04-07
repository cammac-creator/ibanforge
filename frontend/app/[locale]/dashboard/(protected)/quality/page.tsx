import { StatCardV2 } from '@/components/dashboard/stat-card-v2';
import { ErrorTable } from '@/components/dashboard/error-table';
import { getTranslations } from 'next-intl/server';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const STATS_TOKEN = process.env.STATS_TOKEN || '';
const statsHeaders: HeadersInit = STATS_TOKEN ? { Authorization: `Bearer ${STATS_TOKEN}` } : {};

const VALID_PERIODS = [7, 30, 90] as const;
type ValidPeriod = (typeof VALID_PERIODS)[number];

interface ErrorRateEntry {
  rate: number;
  trend: number[];
}

interface TopInvalidIban {
  prefix: string;
  country: string;
  count: number;
  error_type: string;
}

interface TopMissingBic {
  bic: string;
  country: string;
  count: number;
}

interface ErrorsByCountry {
  country: string;
  count: number;
}

interface ErrorsResponse {
  error_rate: {
    iban_validate: ErrorRateEntry;
    bic_lookup: ErrorRateEntry;
  };
  top_invalid_ibans: TopInvalidIban[];
  top_missing_bics: TopMissingBic[];
  errors_by_country: ErrorsByCountry[];
}

interface HistoryEntry {
  date: string;
  iban_validate: number;
  iban_batch: number;
  bic_lookup: number;
  revenue_usdc: number;
}

async function fetchErrors(period: number): Promise<ErrorsResponse | null> {
  try {
    const res = await fetch(`${API_URL}/stats/errors?period=${period}`, {
      cache: 'no-store',
      headers: statsHeaders,
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchHistory(period: number): Promise<HistoryEntry[]> {
  try {
    const res = await fetch(`${API_URL}/stats/history?period=${period}`, {
      cache: 'no-store',
      headers: statsHeaders,
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function QualityPage({
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

  const [errors, history] = await Promise.all([
    fetchErrors(period),
    fetchHistory(period),
  ]);

  // Stat card values
  const ibanErrorRate = errors?.error_rate?.iban_validate?.rate ?? 0;
  const ibanErrorTrend = errors?.error_rate?.iban_validate?.trend ?? [];
  const bicMissRate = errors?.error_rate?.bic_lookup?.rate ?? 0;
  const bicMissTrend = errors?.error_rate?.bic_lookup?.trend ?? [];

  // Total errors from history
  const totalCalls = history.reduce(
    (sum, d) =>
      sum + (d.iban_validate ?? 0) + (d.iban_batch ?? 0) + (d.bic_lookup ?? 0),
    0,
  );
  const totalErrors = Math.round(totalCalls * (ibanErrorRate / 100));

  // Errors by country for bar display
  const errorsByCountry = errors?.errors_by_country ?? [];
  const maxErrCount = errorsByCountry.length > 0 ? errorsByCountry[0].count : 1;

  // ErrorTable rows
  const ibanRows = (errors?.top_invalid_ibans ?? []).map((row) => ({
    prefix: row.prefix,
    country: row.country,
    count: row.count,
    error_type: row.error_type,
  }));

  const bicRows = (errors?.top_missing_bics ?? []).map((row) => ({
    bic: row.bic,
    country: row.country,
    count: row.count,
  }));

  const ibanColumns = [
    { key: 'prefix', label: t('quality.topInvalidIbans.prefix'), mono: true },
    { key: 'country', label: t('quality.topInvalidIbans.country') },
    { key: 'count', label: t('quality.topInvalidIbans.count'), mono: true },
    { key: 'error_type', label: 'Type' },
  ];

  const bicColumns = [
    { key: 'bic', label: t('quality.topMissingBics.bic'), mono: true },
    { key: 'country', label: t('quality.topMissingBics.country') },
    { key: 'count', label: t('quality.topMissingBics.count'), mono: true },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCardV2
          title={t('quality.errorRate.ibanValidate')}
          value={`${ibanErrorRate.toFixed(2)}%`}
          trend={
            ibanErrorTrend.length >= 2
              ? {
                  direction:
                    ibanErrorTrend[ibanErrorTrend.length - 1] >
                    ibanErrorTrend[ibanErrorTrend.length - 2]
                      ? 'down'
                      : 'up',
                  label: `${ibanErrorRate.toFixed(2)}%`,
                }
              : undefined
          }
          sparkline={ibanErrorTrend}
          accentColor="#ef4444"
        />
        <StatCardV2
          title={t('quality.errorRate.bicLookup')}
          value={`${bicMissRate.toFixed(2)}%`}
          trend={
            bicMissTrend.length >= 2
              ? {
                  direction:
                    bicMissTrend[bicMissTrend.length - 1] >
                    bicMissTrend[bicMissTrend.length - 2]
                      ? 'down'
                      : 'up',
                  label: `${bicMissRate.toFixed(2)}%`,
                }
              : undefined
          }
          sparkline={bicMissTrend}
          accentColor="#eab308"
        />
        <StatCardV2
          title={t('quality.errorRate.totalErrors')}
          value={totalErrors.toLocaleString()}
          accentColor="#ef4444"
        />
      </div>

      {/* Two ErrorTables */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ErrorTable
          title={t('quality.topInvalidIbans.title')}
          columns={ibanColumns}
          rows={ibanRows}
          emptyMessage={t('quality.topInvalidIbans.noData')}
        />
        <ErrorTable
          title={t('quality.topMissingBics.title')}
          columns={bicColumns}
          rows={bicRows}
          emptyMessage={t('quality.topMissingBics.noData')}
        />
      </div>

      {/* Errors by country */}
      {errorsByCountry.length > 0 && (
        <div className="rounded-xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900 to-zinc-900/60 p-5">
          <p className="text-sm font-medium text-zinc-300 mb-4">
            {t('quality.errorsByCountry.title')}
          </p>
          <div className="space-y-2.5">
            {errorsByCountry.map((row, i) => {
              const pct = maxErrCount > 0 ? (row.count / maxErrCount) * 100 : 0;
              return (
                <div key={`${row.country}-${i}`} className="flex items-center gap-3">
                  <span className="w-5 text-xs text-zinc-600 text-right font-mono">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-sm text-zinc-200 truncate">{row.country}</span>
                      <span className="text-xs font-mono text-red-400 ml-2 flex-shrink-0">
                        {row.count.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-red-500/40"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
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

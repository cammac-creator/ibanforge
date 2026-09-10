'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  BarChart as RechartsBarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { ChartMarker } from '@/components/stacked-bar-chart';
import { formatGrouped } from '@/lib/format-grouped';
import {
  businessFunnelRows,
  formatRequestDay,
  isCurrentUtcDay,
  type BusinessFunnelDay,
  type BusinessFunnelRow,
} from '@/lib/business-funnel';

export type { BusinessFunnelDay } from '@/lib/business-funnel';

const BARS = [
  { key: 'success', color: '#22c55e' },
  { key: 'paywall', color: '#f59e0b' },
  { key: 'auth_or_quota', color: '#8b5cf6' },
  { key: 'bad_input', color: '#eab308' },
  { key: 'server_error', color: '#ef4444' },
] as const;

// Une couleur distincte des cinq statuts pour le repère de cohortes.
const COHORT_COLOR = '#d0a548';

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ payload: BusinessFunnelRow }>; label?: string }) {
  const t = useTranslations('dashboard.overview.details.businessFunnelChart');
  const locale = useLocale();
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const total = row.total;
  const pct = (n: number) => (total > 0 ? ` (${formatGrouped((n / total) * 100, locale)}%)` : '');
  return (
    <div className="rounded-md border border-[var(--ink-5)]/60 bg-[var(--ink-0)]/95 px-3 py-2 text-xs text-[var(--fg-1)] shadow-lg shadow-black/40 backdrop-blur">
      <div className="mb-1.5 font-semibold text-[var(--fg-1)]">
        {label} · {t('total', { count: formatGrouped(total, locale) })}
      </div>
      {total > 0 ? (
        <>
          <div className="mb-1 text-[11px] text-[var(--fg-3)]">
            {t('successShare')} : <span className="font-mono text-[var(--ok)]">{formatGrouped(row.successShare, locale)}%</span>
          </div>
          <div className="space-y-0.5 border-t border-[var(--ink-4)] pt-1.5">
            {BARS.map((b) => {
              const v = row[b.key];
              if (v === 0) return null;
              return (
                <div key={b.key} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
                  <span className="text-[var(--fg-3)]">{t(`series.${b.key}`)}</span>
                  <span className="ml-auto font-mono text-[var(--fg-1)] tabular-nums">
                    {formatGrouped(v, locale)}
                    <span className="text-[var(--fg-5)]">{pct(v)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="text-[var(--fg-4)] text-[11px]">{t('emptyDay')}</div>
      )}
      {row.cohort_units > 0 && (
        <div className="mt-1.5 flex items-center gap-2 border-t border-[var(--ink-4)] pt-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COHORT_COLOR }} />
          <span className="text-[var(--fg-3)]">{t('cohortValue')}</span>
          <span className="ml-auto font-mono tabular-nums" style={{ color: COHORT_COLOR }}>
            {formatGrouped(row.cohort_units, locale)}
          </span>
        </div>
      )}
    </div>
  );
}

export function BusinessFunnelChart({
  data,
  markers,
  cohortByDate,
  todayUtc,
}: {
  data: BusinessFunnelDay[];
  markers?: ChartMarker[];
  /** Jour ISO vers volume des validations de cohortes, hors total métier. */
  cohortByDate?: Record<string, number>;
  todayUtc: string;
}) {
  const t = useTranslations('dashboard.overview.details.businessFunnelChart');
  const locale = useLocale();
  const rows = businessFunnelRows(data, cohortByDate);
  const hasCohort = rows.some((r) => r.cohort_units > 0);

  if (rows.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-[var(--fg-4)] text-sm">
        {t('empty')}
      </div>
    );
  }

  const lastIdx = rows.length - 1;
  const lastIsPartial = isCurrentUtcDay(rows[lastIdx]?.date, todayUtc);

  // Un repère par jour ; les libellés du même jour restent réunis.
  const dates = new Set(rows.map((r) => r.date));
  const markersByDate = new Map<string, string>();
  for (const m of markers ?? []) {
    const day = m.date.slice(0, 10);
    if (!dates.has(day)) continue;
    markersByDate.set(day, markersByDate.has(day) ? `${markersByDate.get(day)} · ${m.label}` : m.label);
  }

  return (
    <div>
      <p className="mb-3 text-[12px] leading-relaxed text-[var(--fg-4)]">{t('reading')}</p>
      <ResponsiveContainer width="100%" height={280}>
        <RechartsBarChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="date"
            tick={{ fill: '#71717a', fontSize: 11 }}
            axisLine={{ stroke: '#27272a' }}
            tickLine={false}
            tickFormatter={(v: string) => formatRequestDay(v, locale)}
          />
          <YAxis
            tick={{ fill: '#71717a', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
            allowDecimals={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#27272a40' }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#a1a1aa', paddingTop: 8 }} />
          {BARS.map((b) => (
            <Bar key={b.key} dataKey={b.key} name={t(`series.${b.key}`)} fill={b.color} stackId="funnel" radius={[0, 0, 0, 0]}>
              {rows.map((row, i) => (
                <Cell key={row.date} fillOpacity={lastIsPartial && i === lastIdx ? 0.3 : 1} />
              ))}
            </Bar>
          ))}
          {/* Le repère et son espace restent hors total, à échelle réduite. */}
          {hasCohort && (
            <Bar dataKey="cohort_gap" stackId="funnel" fill="transparent" legendType="none" isAnimationActive={false} />
          )}
          {hasCohort && (
            <Bar dataKey="cohort_scaled" name={t('cohortLegend')} fill={COHORT_COLOR} stackId="funnel" radius={[2, 2, 2, 2]} isAnimationActive={false} />
          )}
          {[...markersByDate.entries()].map(([day]) => (
            <ReferenceLine key={day} x={day} stroke="#a78bfa" strokeDasharray="4 3" strokeOpacity={0.7} />
          ))}
        </RechartsBarChart>
      </ResponsiveContainer>
      {markersByDate.size > 0 && (
        <p className="mt-2 text-[11px] leading-snug text-violet-300/80">
          {t('markers')} : {[...markersByDate.entries()].map(([day, label]) => `${formatRequestDay(day, locale)} ${label}`).join(' · ')}
        </p>
      )}
      {hasCohort && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-[var(--fg-4)]">
          <span aria-hidden className="mt-0.5 h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: COHORT_COLOR, opacity: 0.7 }} />
          <span>{t('cohortNote')}</span>
        </p>
      )}
      {lastIsPartial && (
        <p className="mt-2 text-[11px] leading-snug text-[var(--fg-4)]">{t('partialDay')}</p>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  NATURE_KEYS,
  summariseTrend,
  type NatureKey,
  type TrafficTrendDay,
} from '@/lib/traffic-trend';
import { formatGrouped } from '@/lib/format-grouped';
import { audienceDate } from '@/lib/dashboard/audience-model';
import { Panel } from './primitives';
import styles from './audience.module.css';

export const COLORS: Record<NatureKey, string> = {
  with_key: '#fbbf24',
  agent: '#a78bfa',
  declared_bot: '#94a3b8',
  browser: '#2dd4bf',
  anonymous_api: '#60a5fa',
  internal: '#64748b',
};
const tooltipStyle = {
  background: '#142131',
  border: '1px solid #475569',
  borderRadius: 12,
  color: '#f1f5f9',
  fontSize: 13,
};
const axis = (v: number) => (v >= 1000 ? `${Number((v / 1000).toFixed(1))}k` : String(v));

export function TrafficChart({ days, today }: { days: TrafficTrendDay[]; today: string }) {
  const t = useTranslations('dashboard.audience'),
    locale = useLocale();
  const [hidden, setHidden] = useState<NatureKey[]>([]),
    [errors, setErrors] = useState(true);
  const summary = summariseTrend(days);
  return (
    <Panel title={t('trafficTitle')} note={t('trafficNote')}>
      <div className={styles.chartHeadline}>
        <strong>{formatGrouped(summary.total, locale)}</strong>
        <span>
          {t('requests')} · {audienceDate(days[0]?.date ?? null)} → {audienceDate(today)}
        </span>
      </div>
      {summary.mismatchDays > 0 && (
        <p className={styles.notice}>{t('trafficMismatch', { count: summary.mismatchDays })}</p>
      )}
      {days.some((d) => d.date > today) && <p className={styles.notice}>{t('futureDates')}</p>}
      <div className={styles.chart} role="img" aria-label={t('trafficChartLabel')}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart
            data={days}
            margin={{ top: 12, right: 8, bottom: 0, left: -14 }}
            accessibilityLayer
          >
            <CartesianGrid stroke="#334155" vertical={false} strokeDasharray="3 5" />
            <XAxis
              dataKey="date"
              tickFormatter={(d) => `${String(d).slice(8, 10)}.${String(d).slice(5, 7)}`}
              minTickGap={32}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={axis}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(d) => audienceDate(String(d))}
              formatter={(v, name) => [formatGrouped(Number(v), locale), name]}
            />
            {NATURE_KEYS.filter((k) => !hidden.includes(k)).map((k) => (
              <Area
                key={k}
                type="linear"
                dataKey={k}
                name={t(`nature.${k}`)}
                stackId="traffic"
                stroke={COLORS[k]}
                fill={COLORS[k]}
                fillOpacity={0.6}
                isAnimationActive={false}
              />
            ))}
            {errors && (
              <Line
                type="linear"
                dataKey="not_found"
                name={t('notFound')}
                stroke="#fb7185"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className={styles.caption}>
        {t('todayPartial')} {t('legendHelp')}
      </p>
      <div className={styles.legend}>
        {NATURE_KEYS.map((k) => (
          <button
            key={k}
            aria-pressed={!hidden.includes(k)}
            onClick={() => setHidden((h) => (h.includes(k) ? h.filter((v) => v !== k) : [...h, k]))}
          >
            <i style={{ background: COLORS[k] }} aria-hidden />
            <span>{t(`nature.${k}`)}</span>
            <strong>{formatGrouped(summary.byNature[k], locale)}</strong>
          </button>
        ))}
        <button aria-pressed={errors} onClick={() => setErrors(!errors)}>
          <i style={{ background: '#fb7185' }} aria-hidden />
          <span>{t('notFound')}</span>
          <strong>{formatGrouped(summary.notFound, locale)}</strong>
        </button>
      </div>
      <details className={styles.disclosure}>
        <summary>{t('definitions')}</summary>
        <dl className={styles.definitions}>
          {NATURE_KEYS.map((k) => (
            <div key={k}>
              <dt>{t(`nature.${k}`)}</dt>
              <dd>{t(`natureNote.${k}`)}</dd>
            </div>
          ))}
        </dl>
        <p>{t('errorsOverlap')}</p>
      </details>
      <details className={styles.disclosure}>
        <summary>{t('dailyData')}</summary>
        <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={t('dailyData')}>
          <table>
            <caption className="sr-only">{t('dailyData')}</caption>
            <thead>
              <tr>
                <th>{t('date')}</th>
                <th>{t('requests')}</th>
                {NATURE_KEYS.map((k) => (
                  <th key={k}>{t(`nature.${k}`)}</th>
                ))}
                <th>404</th>
                <th>402</th>
                <th>5xx</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.date}>
                  <th>
                    {audienceDate(d.date)}
                    {d.date === today ? ' *' : ''}
                  </th>
                  <td>{formatGrouped(d.total, locale)}</td>
                  {NATURE_KEYS.map((k) => (
                    <td key={k}>{formatGrouped(d[k], locale)}</td>
                  ))}
                  <td>{formatGrouped(d.not_found, locale)}</td>
                  <td>{formatGrouped(d.paywall, locale)}</td>
                  <td>{formatGrouped(d.server_error, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Panel>
  );
}

export function GoogleChart({
  weeks,
}: {
  weeks: Array<{ start: string; end: string; clicks: number; impressions: number }>;
}) {
  const t = useTranslations('dashboard.audience'),
    locale = useLocale();
  const [metric, setMetric] = useState<'clicks' | 'impressions'>('clicks');
  return (
    <>
      <div className={styles.segment} aria-label={t('googleMetric')}>
        {(['clicks', 'impressions'] as const).map((k) => (
          <button key={k} aria-pressed={metric === k} onClick={() => setMetric(k)}>
            {t(k)}
          </button>
        ))}
      </div>
      <div
        className={styles.chart}
        role="img"
        aria-label={t('googleChartLabel', { metric: t(metric) })}
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart
            data={weeks}
            margin={{ top: 12, right: 8, bottom: 0, left: -14 }}
            accessibilityLayer
          >
            <CartesianGrid stroke="#334155" vertical={false} strokeDasharray="3 5" />
            <XAxis
              dataKey="start"
              tickFormatter={(d) => `${String(d).slice(8, 10)}.${String(d).slice(5, 7)}`}
              tick={{ fill: '#94a3b8', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={axis}
              allowDecimals={false}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(d) => audienceDate(String(d))}
              formatter={(v) => [formatGrouped(Number(v), locale), t(metric)]}
            />
            <Bar
              dataKey={metric}
              fill="#2dd4bf"
              maxBarSize={72}
              radius={[6, 6, 0, 0]}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

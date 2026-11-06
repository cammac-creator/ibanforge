'use client';

import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatGrouped } from '@/lib/format-grouped';
import { HOURLY_DAYS, hourRange, hourlyDate, readHourlyActivity } from '@/lib/dashboard/hourly-activity';
import styles from './heatmap.module.css';

export function Heatmap({ value, periodDays }: { value: unknown; periodDays: number }) {
  const t = useTranslations('dashboard.analytics.heatmap'), locale = useLocale(), id = useId();
  const [day, setDay] = useState(0), [hour, setHour] = useState(12);
  const data = readHourlyActivity(value, periodDays);
  const fmt = (n: number) => formatGrouped(n, locale);
  const dayName = (d: number) => t(`daysFull.${HOURLY_DAYS[d]}`);
  const counts = data?.grid[day] ?? [], max = Math.max(0, ...counts);
  return (
    <section className={styles.panel} data-hourly-activity={data ? 'available' : 'unavailable'}>
      <header><p className={styles.eyebrow}>{t('eyebrow')}</p><h3>{t('title')}</h3><p>{t('subtitle')}</p></header>
      {!data ? <p className={styles.notice} role="status">{t('unavailable')}</p> : <>
        <p className={styles.period}>{t('period', { days: periodDays, from: hourlyDate(data.start), to: hourlyDate(data.end) })}</p>
        <dl className={styles.metrics}>
          <div><dt>{t('total')}</dt><dd data-hourly-total>{fmt(data.total)}</dd></div>
          <div><dt>{t('peak')}</dt><dd>{data.peak ? dayName(data.peak.day) : '—'}<p>{data.peak ? `${hourRange(data.peak.hour)} UTC · ${t('operations', { count: data.peak.count })}` : t('noPeak')}</p></dd></div>
        </dl>
        <p className={styles.note}>{t('aggregateNote')}</p>
        {data.total === 0 ? <p className={styles.notice}>{t('noData')}</p> : null}
        <div className={styles.controls}>
          <label htmlFor={`${id}-day`}>{t('chooseDay')}<select id={`${id}-day`} value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {HOURLY_DAYS.map((key, d) => <option key={key} value={d}>{dayName(d)}</option>)}
          </select></label>
          <p>{t('dayTotal', { day: dayName(day), count: data.byDay[day] })}</p>
        </div>
        <div className={styles.bars} aria-hidden="true">
          {counts.map((n, h) => <div key={h} data-selected={h === hour || undefined}><span style={{ height: `${max > 0 ? n / max * 100 : 0}%` }} /><small>{h % 3 === 0 ? `${h}h` : ''}</small></div>)}
        </div>
        <label className={styles.hour} htmlFor={`${id}-hour`}>{t('chooseHour')}
          <input id={`${id}-hour`} type="range" min={0} max={23} step={1} value={hour}
            aria-valuetext={t('selected', { day: dayName(day), hour: hourRange(hour), count: counts[hour] })}
            onChange={(e) => setHour(Number(e.target.value))} />
        </label>
        <output className={styles.selection} htmlFor={`${id}-day ${id}-hour`} aria-live="polite" data-hourly-selection>
          <strong>{dayName(day)} · {hourRange(hour)} UTC</strong><span>{t('operations', { count: counts[hour] })}</span>
        </output>
        <details className={styles.details}>
          <summary>{t('table')}</summary>
          <div className={styles.scroll} tabIndex={0} role="region" aria-label={t('table')}>
            <table><caption className="sr-only">{t('table')} · UTC</caption>
              <thead><tr><th scope="col">{t('day')}</th>{Array.from({ length: 24 }, (_, h) => <th scope="col" key={h}>{h}h</th>)}<th scope="col">{t('totalShort')}</th></tr></thead>
              <tbody>{data.grid.map((row, d) => <tr key={d}><th scope="row">{dayName(d)}</th>{row.map((n, h) => <td key={h} data-nonzero={n > 0 || undefined}>{fmt(n)}</td>)}<td>{fmt(data.byDay[d])}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
        <details className={styles.details}><summary>{t('method')}</summary><p>{t('scope')}</p><p>{t('limits')}</p></details>
      </>}
    </section>
  );
}

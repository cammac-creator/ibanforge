'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { TrafficTrendDay } from '@/lib/traffic-trend';
import { formatGrouped } from '@/lib/format-grouped';
import { audienceDate } from '@/lib/dashboard/audience-model';
import styles from './audience.module.css';

/** Les deux lectures du trafic gardent les mêmes anomalies accessibles hors des totaux. */
export function FutureTrafficDates({ days }: { days: TrafficTrendDay[] }) {
  const t = useTranslations('dashboard.audience');
  const locale = useLocale();
  if (days.length === 0) return null;
  return (
    <details className={styles.disclosure} data-traffic-future>
      <summary>{t('futureDates', { count: days.length })}</summary>
      <p>{t('futureExcluded')}</p>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={t('futureDetails')}>
        <table>
          <caption className="sr-only">{t('futureDetails')}</caption>
          <thead><tr><th>{t('date')}</th><th>{t('requests')}</th></tr></thead>
          <tbody>{days.map((day) => <tr key={day.date}>
            <th>{audienceDate(day.date)}</th><td>{formatGrouped(day.total, locale)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

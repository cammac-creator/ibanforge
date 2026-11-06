'use client';

import { useTranslations } from 'next-intl';
import type { SearchConsole } from '@/lib/dashboard-overview';
import { googleReadAt } from '@/lib/dashboard/search-console';
import { audienceDate } from '@/lib/dashboard/audience-model';
import styles from './audience.module.css';

/** La synthèse et l’onglet Google indiquent la même période et la même fraîcheur. */
export function GoogleReading({ google }: { google: SearchConsole }) {
  const t = useTranslations('dashboard.audience');
  const weeks = [...google.weeks].sort((a, b) => a.start.localeCompare(b.start));
  return (
    <div className={styles.googleReading} data-google-reading>
      {!!weeks.length && (
        <p className={styles.caption}>
          {t('googleSeriesWindow', {
            from: audienceDate(weeks[0].start),
            to: audienceDate(weeks.at(-1)!.end),
          })}
        </p>
      )}
      <p className={google.stale ? styles.notice : styles.caption}>
        {t(google.stale ? 'googleStale' : 'googleFresh', { date: googleReadAt(google.fetched_at) })}
      </p>
      {google.refreshing && (
        <p className={styles.notice} role="status">
          {t('googleRefreshing')}
        </p>
      )}
    </div>
  );
}

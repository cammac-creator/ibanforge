'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatGrouped } from '@/lib/format-grouped';
import {
  readEntryBuckets,
  TRIAL_INDICATORS,
  type AudienceFunnel,
} from '@/lib/dashboard/audience-model';
import { Panel, Unavailable } from './primitives';
import styles from './audience.module.css';

function EntryDimension({
  funnel,
  dimension,
}: {
  funnel: AudienceFunnel;
  dimension: 'referrer' | 'page';
}) {
  const t = useTranslations('dashboard.audience');
  const locale = useLocale();
  const rows = readEntryBuckets(funnel, dimension);
  if (!rows) return <Unavailable />;
  const active = [...rows].filter((r) => r.lineages > 0).sort((a, b) => b.lineages - a.lineages);
  if (!active.length) return <p className={styles.empty}>{t('entry.empty')}</p>;
  return (
    <div className={styles.entryGrid}>
      {active.map((row) => (
        <article className={styles.entryCard} key={row.name}>
          <h3>{t(`entry.${dimension}.${row.name}`)}</h3>
          <p>{t('entry.trials', { count: formatGrouped(row.lineages, locale) })}</p>
          <dl>
            {TRIAL_INDICATORS.map((key) => (
              <div key={key}>
                <dt>{t(`indicator.${key}`)}</dt>
                <dd>
                  <strong>
                    {row[key].value === null
                      ? '—'
                      : `${formatGrouped(row[key].value * 100, locale, 1)} %`}
                  </strong>
                  <span>
                    {row[key].value === null
                      ? t('notMeasurable')
                      : t('sample', {
                          n: formatGrouped(row[key].numerator, locale),
                          d: formatGrouped(row[key].denominator, locale),
                        })}
                  </span>
                  <small>{t('pending', { count: row[key].pending })}</small>
                </dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  );
}

export function EntryPanel({ funnel }: { funnel: AudienceFunnel }) {
  const t = useTranslations('dashboard.audience');
  return (
    <Panel title={t('entry.title')} note={t('entry.note')}>
      <p className={styles.notice}>{t('entry.limits')}</p>
      <h3 className={styles.entryHeading}>{t('entry.referrerTitle')}</h3>
      <EntryDimension funnel={funnel} dimension="referrer" />
      <details className={styles.disclosure}>
        <summary>{t('entry.pageTitle')}</summary>
        <EntryDimension funnel={funnel} dimension="page" />
      </details>
      <p className={styles.caption}>{t('entry.distinct')}</p>
    </Panel>
  );
}

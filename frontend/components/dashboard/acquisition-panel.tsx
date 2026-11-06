import { getTranslations } from 'next-intl/server';
import { formatGrouped } from '@/lib/format-grouped';
import { readAcquisitionSources, readAcquisitionCohorts } from '@/lib/dashboard/acquisition-read';
import { InfoDot } from './info-dot';
import styles from './acquisition.module.css';
export type { AcquisitionSourceRow, AcquisitionCohortRow } from '@/lib/dashboard/acquisition-read';

/** Origines et semaines des comptes conservés : leur accès ne constitue pas une vente prouvée. */
export async function AcquisitionPanel({ sources, cohorts, locale, periodDays, nowIso }: {
  sources: unknown; cohorts: unknown; locale: string; periodDays?: number; nowIso: string;
}) {
  const t = await getTranslations('dashboard.acquisition');
  const rows = readAcquisitionSources(sources), weeks = readAcquisitionCohorts(cohorts, nowIso);
  const maxSource = Math.max(1, ...(rows ?? []).map(row => row.signups));
  const maxWeek = Math.max(1, ...(weeks ?? []).map(row => row.signups));
  const fmt = (n: number) => formatGrouped(n, locale);
  const pct = (n: number, population: number) => population === 0 ? '—' : `${formatGrouped(n, locale)} %`;
  return <div className={styles.panels} data-acquisition>
    <section className={styles.panel} data-acquisition-sources>
      <div className={styles.heading}><h3>{t('sourcesTitle')}</h3><InfoDot>{t('sourcesHint')}</InfoDot></div>
      <p className={styles.note}>{periodDays === 30 || periodDays === 90 ? t('period', { days: periodDays }) : t('periodUnknown')} {t('scope')}</p>
      {rows === null ? <p role="status" className={styles.note}>{t('unavailable')}</p> : rows.length === 0 ?
        <p className={styles.note}>{t('emptySources')}</p> : <ul className={styles.list}>{rows.map(row => <li className={styles.item} key={row.source}>
          <p className={styles.source} data-source-name>{row.source === 'direct' ? t('direct') : row.source}</p>
          <div className={styles.bar} aria-hidden><span style={{ width: `${row.signups / maxSource * 100}%` }} /></div>
          <dl className={styles.metrics}>
            <div><dt>{t('accounts')}</dt><dd>{fmt(row.signups)}</dd></div>
            <div><dt>{t('called')}</dt><dd>{fmt(row.called)}</dd></div>
            <div><dt>{t('accessShort')}</dt><dd>{fmt(row.paying)}</dd></div>
          </dl>
        </li>)}</ul>}
      <p className={styles.note}>{t('accessNote')}</p>
    </section>
    <section className={styles.panel} data-acquisition-cohorts>
      <div className={styles.heading}><h3>{t('weeksTitle')}</h3><InfoDot>{t('weeksHint')}</InfoDot></div>
      <p className={styles.note}>{t('weeksNote')}</p>
      {weeks === null ? <p role="status" className={styles.note}>{t('unavailable')}</p> : weeks.length === 0 ?
        <p className={styles.note}>{t('emptyWeeks')}</p> : <ol className={styles.cohorts}>{weeks.map(row => <li className={styles.item} key={row.week_start} data-acquisition-week={row.week_start}>
          <div className={styles.week}><span>{t('weekOf', { date: row.week_start })}</span>{row.partial && <span className={styles.partial}>{t('inProgress')}</span>}</div>
          <p className={styles.count}>{fmt(row.signups)} <small>{t('accounts')}</small></p>
          <div className={styles.bar} aria-hidden><span style={{ width: `${row.signups / maxWeek * 100}%`, ...(row.partial ? { backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 3px, #ffffff88 3px 6px)' } : {}) }} /></div>
          <dl className={styles.cohortMetrics}>
            <div><dt>{t('calledShare')}</dt><dd>{pct(row.called_pct, row.signups)}</dd></div>
            <div><dt>{t('accessShare')}</dt><dd>{pct(row.paid_pct, row.signups)}</dd></div>
          </dl>
        </li>)}</ol>}
      <p className={styles.note}>{t('roundedNote')}</p>
    </section>
  </div>;
}

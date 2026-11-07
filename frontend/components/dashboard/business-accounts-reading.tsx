import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowUpRight, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { formatGrouped } from '@/lib/format-grouped';
import { localePath } from '@/lib/locale-path';
import { readViewTimestamp } from '@/lib/dashboard/view-freshness';
import { businessAccountsHref, readBusinessAccounts, type BusinessCohort } from '@/lib/dashboard/business-accounts';
import { readFailureReason, type Fetched } from './overview/fetching';
import styles from './business-accounts.module.css';

export async function BusinessAccountsReading({ promise, cohort, locale, nowIso }: {
  promise: Promise<Fetched<unknown>>; cohort: BusinessCohort; locale: string; nowIso: string;
}) {
  const [t, failure] = await Promise.all([getTranslations('dashboard.businessAccounts'), getTranslations('dashboard.overview.failed')]);
  const response = await promise;
  const data = response.ok ? readBusinessAccounts(response.data, cohort, nowIso) : null;
  if (!data) return <div className={styles.notice} role="status" data-business-accounts-unavailable>
    <strong>{t('unavailable')}</strong>
    <p>{response.ok ? t('invalidFormat') : failure(readFailureReason(response.status), { status: response.status })}</p>
    <p>{t('unavailableNote')}</p>
  </div>;
  const fmt = (value: number) => formatGrouped(value, locale);
  const date = (iso: string) => { const d = readViewTimestamp(iso)!; return `${d.date} · ${d.time}`; };
  return <section className={styles.reading} data-business-accounts aria-label={t(`cohort.${cohort}`)}>
    <div className={styles.summary}>
      <div><Users aria-hidden size={20} /><strong>{fmt(data.total)}</strong><span>{t('accounts', { count: data.total })}</span></div>
      <p>{t('window', { start: data.window.start, end: data.window.end })}</p>
      <p>{t('readAt', { at: date(data.generated_at) })}</p>
    </div>
    {data.rows.length === 0 ? <div className={styles.empty}><h2>{t('empty')}</h2><p>{t('emptyNote')}</p></div> :
      <ul className={styles.cards}>{data.rows.map(row => <li key={row.email} className={styles.card} data-business-account>
        <h2>{row.email}</h2>
        <dl>
          <div><dt>{t('created')}</dt><dd>{date(row.created_at)}</dd></div>
          <div><dt>{t('firstPurchase')}</dt><dd>{row.first_purchase_at ? date(row.first_purchase_at) : t('noPurchase')}</dd></div>
          <div><dt>{t('activeDays')}</dt><dd>{fmt(row.active_days)}</dd></div>
          <div><dt>{t('lastActive')}</dt><dd>{row.last_active_day ?? t('noActivity')}</dd></div>
        </dl>
        <Link prefetch={false} className={styles.open} href={`${localePath(locale, '/dashboard/clients')}?open=${encodeURIComponent(row.email)}`}>
          {t('open')}<span className="sr-only"> {row.email}</span><ArrowUpRight aria-hidden size={16} />
        </Link>
      </li>)}</ul>}
    <nav className={styles.pagination} aria-label={t('pagination')}>
      {data.page > 1 && <Link prefetch={false} href={businessAccountsHref(locale, cohort, data.page - 1)}><ChevronLeft aria-hidden size={16} />{t('previous')}</Link>}
      <span>{t('page', { page: fmt(data.page), pages: fmt(data.pages) })}</span>
      {data.page < data.pages && <Link prefetch={false} href={businessAccountsHref(locale, cohort, data.page + 1)}>{t('next')}<ChevronRight aria-hidden size={16} /></Link>}
    </nav>
    <details className={styles.explanation}><summary>{t('understand')}</summary><p>{t('scope')}</p><p>{t(`definition.${cohort}`)}</p>
      <p>{t('dates')}</p><p>{t('difference')}</p></details>
  </section>;
}

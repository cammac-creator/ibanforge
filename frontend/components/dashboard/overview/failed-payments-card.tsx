import { getTranslations } from 'next-intl/server';
import { CreditCard } from 'lucide-react';
import { formatGrouped } from '@/lib/format-grouped';
import { toZurich } from '@/lib/crm/zurich';
import { formatMinorMap } from '@/lib/dashboard/stripe-revenue';
import { attemptDay, declineKey, retainedFailedPayments, type FailedAttempt } from '@/lib/dashboard/failed-payments';
import styles from './failed-payments.module.css';

/** Des refus observés, avec leur couverture et leurs limites ; aucune vente perdue déduite. */
export async function FailedPaymentsCard({ value, locale }: { value: unknown; locale: string }) {
  const t = await getTranslations({ locale, namespace: 'dashboard.overview' });
  const data = retainedFailedPayments(value);
  const rows = (attempts: FailedAttempt[], offset = 0) => <ul className={styles.attempts}>
    {attempts.map((a, i) => <li key={`${a.created_at}-${offset + i}`}>
      <div className={styles.rowHeading}>
        <span>{attemptDay(a.created_at)} · UTC</span>
        <strong>{a.amount_minor === null || a.currency === null ? '—' : formatMinorMap({ [a.currency]: a.amount_minor }, locale)}</strong>
      </div>
      <p className={styles.email}>{a.email ?? t('failedPayments.noEmail')}</p>
      <div className={styles.outcome}>
        <span>{t(`failedPayments.reason.${declineKey(a.decline_reason)}`)}</span>
        <span className={a.recovered ? styles.paid : styles.pending}>
          {t(a.email === null ? 'failedPayments.matchUnknown' : a.recovered ? 'failedPayments.recovered' : 'failedPayments.lost')}
        </span>
      </div>
      {a.recovered_at && <p className={styles.note}>{t('failedPayments.laterAt', { day: attemptDay(a.recovered_at) })}</p>}
    </li>)}
  </ul>;
  return <section className={styles.card} data-failed-payments={data ? 'available' : 'unavailable'}>
    <h3><CreditCard size={18} aria-hidden />{t('failedPayments.title')}</h3>
    {!data ? <p role="status" className={styles.warning}>{t('failedPayments.unavailable')}</p> : <>
      <p className={styles.note}>{t('failedPayments.period', { days: data.period_days, from: data.window_start.slice(0,16).replace('T',' '), to: data.observed_until.slice(0,16).replace('T',' ') })}</p>
      <p className={styles.note}>{t('failedPayments.accountScope')}</p>
      {!data.coverage.complete && <p role="status" className={styles.warning}>{t('failedPayments.partial')}</p>}
      {data.attempts === 0 ? <p className={styles.empty}>{t(data.coverage.complete ? 'failedPayments.none' : 'failedPayments.nonePartial')}</p> : <>
        <dl className={styles.metrics}>
          <div><dt>{t('failedPayments.attempts')}</dt><dd data-failed-count="attempts">{formatGrouped(data.attempts, locale)}</dd></div>
          <div><dt>{t('failedPayments.unrecovered')}</dt><dd data-failed-count="unrecovered">{formatGrouped(data.unrecovered_buyers, locale)}</dd></div>
          <div><dt>{t('failedPayments.withoutEmail')}</dt><dd data-failed-count="unknown">{formatGrouped(data.attempts_without_email, locale)}</dd></div>
        </dl>
        <p className={styles.note}>{t('failedPayments.recoveredNote')}</p>
        <p className={styles.note}>{t('failedPayments.buyers', { count: data.distinct_buyers })}</p>
        {rows(data.latest.slice(0,6))}
        {data.latest.length > 6 && <details className={styles.details}><summary>{t('failedPayments.more', { count: data.latest.length - 6 })}</summary>{rows(data.latest.slice(6),6)}</details>}
        <p className={styles.note}>{t('failedPayments.shown', { shown: data.latest.length, total: data.attempts })}</p>
      </>}
      <p className={styles.note}>{t('failedPayments.readAt', { at: toZurich(data.read_at).slice(0,16).replace('T',' ') })}</p>
      <details className={styles.details}>
        <summary>{t('failedPayments.method')}</summary>
        <ul className={styles.method}>
          {(['source','recoveredRule','notCharged','limits'] as const).map((k)=><li key={k}>{t(`failedPayments.${k}`)}</li>)}
          <li>{t('failedPayments.coverage', { pages: data.coverage.pages_read, charges: data.coverage.charges_read })}</li>
        </ul>
      </details>
    </>}
  </section>;
}

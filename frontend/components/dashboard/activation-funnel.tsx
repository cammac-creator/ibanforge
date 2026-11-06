import { getTranslations } from 'next-intl/server';
import { formatGrouped } from '@/lib/format-grouped';
import { readActivationFunnel, observedDelay } from '@/lib/dashboard/acquisition-read';
import { stepPercent } from '@/lib/dashboard/activation-funnel-math';
import { InfoDot } from './info-dot';
import styles from './acquisition.module.css';
export type { ActivationFunnelData } from '@/lib/dashboard/acquisition-read';

/** Des états indépendants de comptes, pas les étapes obligatoires d’une vente. */
export async function ActivationFunnel({ funnel, locale }: { funnel: unknown; locale: string }) {
  const t = await getTranslations('dashboard.acquisition');
  const data = readActivationFunnel(funnel);
  const fmt = (n: number, digits = 0) => formatGrouped(n, locale, digits);
  const delay = (hours: unknown, sample: unknown) => {
    const value = observedDelay(hours, sample);
    if (!value) return <>{t('notMeasurable')}</>;
    const duration = value.hours < 1 ? t('underHour') : value.hours < 48
      ? t('hours', { value: fmt(Math.round(value.hours)) }) : t('days', { value: fmt(value.hours / 24, 1) });
    return <>{duration}<small>{value.sample === null ? t('sampleUnknown') : t('sample', { count: fmt(value.sample) })}</small></>;
  };
  const steps = [['signed_up', 'created'], ['first_call', 'called'], ['hit_limit', 'refused'], ['purchased', 'access']] as const;
  return <section className={styles.panel} data-activation-summary>
    <div className={styles.heading}><h3>{t('activationTitle')}</h3><InfoDot>{t('activationHint')}</InfoDot></div>
    {!data ? <p role="status" className={styles.note}>{t('unavailable')}</p> : <>
      <p className={styles.note}>{t('period', { days: data.period_days })} {t('scope')}</p>
      <dl className={styles.funnelMetrics}>{steps.map(([key, label], index) => {
        const share = stepPercent(data[key], data.signed_up, index);
        return <div className={styles.item} key={key}><dt>{t(label)}</dt><dd>{fmt(data[key])}
          {index > 0 && <p className={styles.share}>{share === null ? t('notMeasurable') : t('share', { percent: fmt(share) })}</p>}
        </dd></div>;
      })}</dl>
      <p className={styles.note}>{t('accessNote')} {t('refusalsNote')}</p>
      <details className={styles.disclosure}>
        <summary>{t('delaysTitle')}</summary>
        <p className={styles.note}>{t('delaysNote')}</p>
        <dl className={styles.delays}>
          <div><dt>{t('firstCallDelay')}</dt><dd>{delay(data.median_hours_signup_to_first_call, data.median_n_signup_to_first_call)}</dd></div>
          <div><dt>{t('creditKeyDelay')}</dt><dd>{delay(data.median_hours_first_call_to_purchase, data.median_n_first_call_to_purchase)}</dd></div>
        </dl>
      </details>
    </>}
  </section>;
}

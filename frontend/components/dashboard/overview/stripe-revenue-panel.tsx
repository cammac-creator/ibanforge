import { getTranslations } from 'next-intl/server';
import { collectedView, formatMinorMap, type StripeRevenuePayload } from '@/lib/dashboard/stripe-revenue';
import { readSalesDays, salesPeriod } from '@/lib/dashboard/stripe-sales';
import { formatGrouped } from '@/lib/format-grouped';
import { StripeSalesHistory } from './stripe-sales-history';
import styles from './stripe-revenue.module.css';

/** Ventes du produit et règlements du compte restent deux périmètres visibles. */
export async function StripeRevenuePanel({ data, locale, nowIso }: {
  data: StripeRevenuePayload; locale: string; nowIso: string;
}) {
  const t = await getTranslations({ locale, namespace: 'dashboard.overview' });
  const old = await getTranslations({ locale, namespace: 'dashboard.overview.money.collected' });
  const view = collectedView(data, locale);
  const stripe = data.stripe;
  const days = stripe ? readSalesDays(stripe) : null;
  // Le navigateur reçoit seulement la fenêtre maximale affichable.
  const start = days && stripe ? salesPeriod(days, stripe.read_at, 90).start : null;
  const recentDays = days && start ? Object.fromEntries(Object.entries(days).filter(([day]) => day >= start)) : null;
  const stale = stripe && Date.parse(nowIso) - Date.parse(stripe.read_at) > data.cache_ttl_seconds * 1000 + 60_000;
  return <div className={styles.panel} data-stripe-panel>
    {view.testMode && <p role="status" className={styles.warning}>{old('testMode')}</p>}
    {view.partial && <p role="status" className={styles.warning}>{old('partial')}</p>}
    {stale && <p role="status" className={styles.warning}>{t('money.premium.stale')}</p>}
    {recentDays && stripe ? <StripeSalesHistory days={recentDays} readAt={stripe.read_at} />
      : <p className={styles.warning}>{t(stripe ? 'money.premium.seriesUnavailable' : 'money.premium.stripeUnavailable')}</p>}
    <div className={styles.support}>
      <section className={styles.card} aria-label={t('money.premium.lifetime')}>
        <p className={styles.eyebrow}>{t('money.premium.retainedHistory')}</p>
        <h3>{t(view.mode === 'stripe' ? 'money.premium.lifetime' : 'money.premium.derivedTitle')}</h3>
        <p className={styles.total}>{view.headline}</p>
        <p className={styles.note}>{t(view.mode === 'stripe' ? 'money.premium.lifetimeNote' : 'money.premium.derivedNote')}</p>
        <dl className={styles.rows}>
          {view.kinds.map((k) => <div key={k.kind}><dt>{old(`kinds.${k.kind}`)}</dt><dd>{k.amount}</dd></div>)}
          {stripe && <div><dt>{t('money.premium.payments')}</dt><dd>{formatGrouped(stripe.ibanforge.count, locale)}</dd></div>}
        </dl>
        {view.refunded && <p className={styles.note}>{old('refunded', { amount: view.refunded })}</p>}
        {view.excluded > 0 && <p className={styles.warning}>{old('derivedExcluded', { count: view.excluded })}</p>}
      </section>
      <section className={styles.card} aria-label={t('money.premium.settlement')}>
        <p className={styles.eyebrow}>{t('money.premium.wholeAccount')}</p>
        <h3>{t('money.premium.settlement')}</h3>
        <p className={styles.note}>{t('money.premium.settlementNote')}</p>
        <dl className={styles.rows}>
          <div><dt>{t('money.premium.paid')}</dt><dd>{view.paidOut ?? '—'}</dd></div>
          <div><dt>{t('money.premium.awaiting')}</dt><dd>{view.awaiting ?? '—'}</dd></div>
          <div><dt>{t('money.premium.net')}</dt><dd>{view.net ?? '—'}</dd></div>
        </dl>
        {view.netUnknown > 0 && <p className={styles.warning}>{old('netUnknown', { count: view.netUnknown })}</p>}
        {view.other !== null && <p className={styles.warning}>{old('other', { amount: view.other })}</p>}
        {stripe && <details className={styles.details}>
          <summary>{t('money.premium.settlementDetails')}</summary>
          <p className={styles.note}>{t('money.premium.netNote')}</p>
          <dl className={styles.rows}>
            <div><dt>{t('money.premium.available')}</dt><dd>{stripe.balance ? formatMinorMap(stripe.balance.available, locale) : '—'}</dd></div>
            <div><dt>{t('money.premium.pending')}</dt><dd>{stripe.balance ? formatMinorMap(stripe.balance.pending, locale) : '—'}</dd></div>
            <div><dt>{t('money.premium.inTransit')}</dt><dd>{stripe.payouts ? formatMinorMap(stripe.payouts.in_transit.amount, locale) : '—'}</dd></div>
            <div><dt>{t('money.premium.fees')}</dt><dd>{stripe.account.net_unknown === stripe.account.count && stripe.account.count > 0 ? '—' : formatMinorMap(stripe.account.fees, locale)}</dd></div>
          </dl>
        </details>}
      </section>
    </div>
    {view.readAt && <p className={styles.note}>{old('readAt', { at: view.readAt })}. {t('money.premium.refreshNote')}</p>}
  </div>;
}

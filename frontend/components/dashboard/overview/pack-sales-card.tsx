import { getTranslations } from 'next-intl/server';
import { packUsdLabel, type PackSalesSnapshot } from '@/lib/dashboard/pack-sales';
import { overviewCard } from './section';

/** Un détail issu de la même lecture que la tuile, indépendant de la disponibilité du portefeuille. */
export async function PackSalesCard({ data, locale }: { data: PackSalesSnapshot | null; locale: string }) {
  const t = await getTranslations({ locale, namespace: 'dashboard.overview' });
  if (!data) return (
    <div className={overviewCard}>
      <h3 className="text-sm font-medium text-[var(--fg-2)]">{t('money.packSales.title')}</h3>
      <p className="mt-2 text-sm text-amber-300">{t('money.packSales.unavailable')}</p>
    </div>
  );
  const stripe = data.stripe;
  const omissions = [
    ['missing', stripe.amount_missing_groups],
    ['otherCurrency', stripe.other_currency_groups],
    ['invalid', stripe.invalid_amount_groups],
    ['conflicting', stripe.conflicting_groups],
  ] as const;
  return (
    <div className={overviewCard}>
      <h3 className="text-sm font-medium text-[var(--fg-2)]">{t('money.packSales.title')}</h3>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-mono text-2xl font-semibold text-[var(--ok)]" data-pack-amount>{packUsdLabel(data, locale)}</p>
        <p className="text-xs text-[var(--fg-4)]">{t('money.packSales.coverage', { known: stripe.usd_known_groups, total: stripe.groups })}</p>
      </div>
      <p className="mt-2 text-xs text-[var(--fg-4)]">{t('money.packSales.amountScope')}</p>
      {stripe.groups === 0 ? <p className="mt-2 text-xs text-[var(--fg-4)]">{t('money.packSales.empty')}</p> : null}
      {stripe.usd_zero_groups > 0 ? <p className="mt-2 text-xs text-[var(--fg-4)]">{t('money.packSales.zero', { count: stripe.usd_zero_groups })}</p> : null}
      {omissions.some(([, count]) => count > 0) ? (
        <ul className="mt-3 space-y-1 text-xs text-amber-300">
          {omissions.filter(([, count]) => count > 0).map(([key, count]) => <li key={key}>{t(`money.packSales.${key}`, { count })}</li>)}
        </ul>
      ) : null}
      <div className="mt-4 border-t border-[var(--ink-4)]/60 pt-3 text-xs text-[var(--fg-4)]">
        <p>{t('money.packSales.x402', { count: data.x402.distinct_references })}</p>
        <p className="mt-1 text-[var(--fg-5)]">{t('money.packSales.x402Note')}</p>
      </div>
      <details className="mt-4 border-t border-[var(--ink-4)]/60 pt-3 text-xs">
        <summary className="cursor-pointer font-medium text-[var(--fg-3)]">{t('money.packSales.quality')}</summary>
        <ul className="mt-2 space-y-1 text-[var(--fg-4)]">
          <li>{t('money.packSales.unattributed', { count: data.unattributed_credit_keys })}</li>
          <li>{t('money.packSales.granted', { count: data.granted_credit_keys })}</li>
          <li>{t('money.packSales.internal', { count: data.excluded_internal_credit_keys })}</li>
          <li>{t('money.packSales.duplicates', { count: data.duplicate_reference_rows })}</li>
          <li>{t('money.packSales.ambiguous', { count: data.ambiguous_rail_keys })}</li>
        </ul>
        <p className="mt-2 text-[var(--fg-5)]">{t('money.packSales.keysNote')}</p>
      </details>
      <p className="mt-3 text-[11px] text-[var(--fg-5)]">{t('money.packSales.reading', { at: data.generated_at.replace('T', ' ').slice(0, 19) })}</p>
    </div>
  );
}

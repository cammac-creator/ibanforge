import Link from 'next/link';
import { Suspense } from 'react';
import { localePath } from '@/lib/locale-path';
import { getTranslations } from 'next-intl/server';
import { RevenueCard } from '../revenue-card';
import type { DigestEntry } from '../weekly-digest-card';
import type { ActivationClientRow } from '../clients-table';
import type { BuildInput } from '@/lib/crm/build-contacts';
import type { PackSalesSnapshot } from '@/lib/dashboard/pack-sales';
import type { Fetched } from './fetching';
import { OverviewSection } from './section';
import { MoneyLoading, MoneyStripe, MoneyAttempts, MoneyAccountMetrics, MoneyPacks, MoneyRefusals, MoneyBuyers, MoneyDigest } from './money-readings';

/** Chaque source rend son état dès sa résolution, sans attendre les lectures voisines. */
export async function MoneySection({
  compact = false,
  locale,
  period,
  nowIso,
  paymentAttemptsPromise,
  clientsPromise,
  crmPromise,
  digestPromise,
  packSalesPromise,
  failedPaymentsPromise,
  stripeRevenuePromise,
}: {
  compact?: boolean;
  locale: string;
  period: number;
  /** Instant partagé par toutes les lectures de la page : voir one-clock.ts. */
  nowIso: string;
  paymentAttemptsPromise: Promise<Fetched<unknown>>;
  clientsPromise: Promise<Fetched<ActivationClientRow[]>>;
  crmPromise: Promise<BuildInput | null>;
  digestPromise: Promise<Fetched<{ digests: DigestEntry[] }>>;
  packSalesPromise: Promise<Fetched<PackSalesSnapshot>>;
  failedPaymentsPromise: Promise<Fetched<unknown>>;
  /** GET /v1/admin/stripe-revenue : l'argent encaissé lu chez Stripe, ou son repli. */
  stripeRevenuePromise: Promise<Fetched<unknown>>;
}) {
  const [t, w] = await Promise.all([getTranslations('dashboard.overview'), getTranslations('dashboard.workspace')]);
  const loading = (source: string, label: string) => <MoneyLoading source={source} message={t('money.loading', { source: label })} />;
  const stripe = <Suspense fallback={loading('stripe', t('money.collected.title'))}>
    <MoneyStripe promise={stripeRevenuePromise} packsPromise={packSalesPromise} locale={locale} nowIso={nowIso} compact={compact} />
  </Suspense>;
  const refusals = <Suspense fallback={loading('refusals', t('failedPayments.title'))}>
    <MoneyRefusals promise={failedPaymentsPromise} locale={locale} />
  </Suspense>;
  return <OverviewSection step={1} title={compact ? w('revenue') : t('money.title')}
    lead={compact ? w('revenueSummary') : t('money.lead')}
    aside={compact ? <Link href={`${localePath(locale, '/dashboard')}?view=revenue&period=${period}`}
      className="rounded-lg border border-[var(--ink-4)] px-3 py-2 text-xs text-amber-300">{w('revenueDetails')} →</Link> : undefined}>
    {compact ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{stripe}{refusals}</div> : <>
      {stripe}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Suspense fallback={loading('attempts', t('money.x402'))}>
          <MoneyAttempts promise={paymentAttemptsPromise} locale={locale} nowIso={nowIso} />
        </Suspense>
        <Suspense fallback={<>{loading('unused', t('money.unused'))}{loading('accounts', t('money.clients'))}</>}>
          <MoneyAccountMetrics promise={clientsPromise} locale={locale} nowIso={nowIso} />
        </Suspense>
      </div>
      <p className="text-xs text-[var(--fg-4)]">{t('money.retainedKeysNote')}</p>
      <Suspense fallback={loading('packs', t('money.packSales.title'))}>
        <MoneyPacks promise={packSalesPromise} locale={locale} />
      </Suspense>
      {refusals}
      <Suspense fallback={loading('buyers', t('money.buyers'))}>
        <MoneyBuyers promise={clientsPromise} crmPromise={crmPromise} locale={locale} nowIso={nowIso} />
      </Suspense>
      <RevenueCard />
      <Suspense fallback={loading('digest', t('money.digest'))}>
        <MoneyDigest promise={digestPromise} locale={locale} nowIso={nowIso} />
      </Suspense>
      <p className="text-[11px] text-[var(--fg-5)]">{t('money.windows', { days: period })}</p>
    </>}
  </OverviewSection>;
}

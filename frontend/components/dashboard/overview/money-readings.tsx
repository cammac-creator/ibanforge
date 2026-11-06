import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { formatGrouped } from '@/lib/format-grouped';
import { moneySummary } from '@/lib/dashboard-overview';
import { dailySparkline } from '@/lib/dashboard/daily-sparkline';
import { readPaymentAttempts } from '@/lib/dashboard/payment-attempts';
import { readStripeRevenuePayload } from '@/lib/dashboard/stripe-revenue';
import { packUsdLabel, retainedPackSales, type PackSalesSnapshot } from '@/lib/dashboard/pack-sales';
import type { BuildInput } from '@/lib/crm/build-contacts';
import type { ActivationClientRow } from '../clients-table';
import { StatCardV2 } from '../stat-card-v2';
import { InfoDot } from '../info-dot';
import styles from '../workspace.module.css';
import { WeeklyDigestCard, type DigestEntry } from '../weekly-digest-card';
import { StripeRevenuePanel } from './stripe-revenue-panel';
import { CollectedCard } from './collected-card';
import { PackSalesCard } from './pack-sales-card';
import { FailedPaymentsCard } from './failed-payments-card';
import { ClientLinks } from './client-links';
import { FetchFailed, type Fetched } from './fetching';
import { snapshotOnce, writableIds } from './one-clock';
import { overviewCard } from './section';

type Reading<T> = { promise: Promise<Fetched<T>>; locale: string };

/** Un état de lecture ne ressemble ni à un montant nul, ni à une panne. */
export function MoneyLoading({ source, message }: { source: string; message: string }) {
  return <div data-money-loading={source} role="status" aria-busy="true"
    className="flex min-h-28 items-center gap-3 rounded-2xl border border-[var(--ink-4)] bg-[var(--ink-2)] p-5 text-sm text-[var(--fg-3)]">
    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--fg-4)] motion-safe:animate-pulse" />
    <span>{message}</span>
  </div>;
}

async function PackFallback({ promise, locale }: Reading<PackSalesSnapshot>) {
  const t = await getTranslations('dashboard.overview');
  const res = await promise;
  return <StatCardV2 title={t('money.packs')} value={packUsdLabel(res.ok ? retainedPackSales(res.data) : null, locale)}
    accentColor="#22c55e" hint={t('money.packsHint')} />;
}

/** Stripe attend seulement sa propre lecture ; le repli des packs attend à son tour si nécessaire. */
export async function MoneyStripe({ promise, packsPromise, locale, nowIso, compact }: Reading<unknown> & {
  packsPromise: Promise<Fetched<PackSalesSnapshot>>; nowIso: string; compact: boolean;
}) {
  const t = await getTranslations('dashboard.overview');
  const res = await promise;
  const data = res.ok ? readStripeRevenuePayload(res.data) : null;
  if (data) return compact ? <CollectedCard data={data} locale={locale} /> : <StripeRevenuePanel data={data} locale={locale} nowIso={nowIso} />;
  return <div className="flex min-w-0 flex-col gap-3" data-money-stripe-unavailable>
    <p role="status" className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-[var(--fg-2)]">
      {t('money.premium.readUnavailable')}
    </p>
    <Suspense fallback={<MoneyLoading source="pack-fallback" message={t('money.loading', { source: t('money.packs') })} />}>
      <PackFallback promise={packsPromise} locale={locale} />
    </Suspense>
  </div>;
}

/** Cumul et série quotidienne de tentatives : ils restent indépendants de Stripe. */
export async function MoneyAttempts({ promise, nowIso }: Reading<unknown> & { nowIso: string }) {
  const t = await getTranslations('dashboard.overview');
  const res = await promise;
  const data = res.ok ? readPaymentAttempts(res.data) : null;
  const series = dailySparkline(data?.days, 'attempted_usdc', nowIso);
  return <StatCardV2 title={t('money.x402')} value={data ? `${data.total_attempted_usdc.toFixed(4)} USDC` : '—'}
    sparkline={series.values} sparklinePartialLast={series.partialLast} accentColor="#14b8a6" hint={t('money.x402Hint')}
    detail={<><p>{t('money.x402Cumulative')}</p>{series.values.length >= 2 &&
      <p>{t(series.partialLast ? 'money.x402PartialCurve' : 'money.x402DailyCurve')}</p>}</>} />;
}

export async function MoneyAccountMetrics({ promise, locale, nowIso }: Reading<ActivationClientRow[]> & { nowIso: string }) {
  const t = await getTranslations('dashboard.overview');
  const res = await promise;
  const money = moneySummary(res.ok ? res.data ?? [] : [], new Date(nowIso));
  return <>
    <StatCardV2 title={t('money.unused')} value={money.creditsSold > 0 ? formatGrouped(money.creditsUnused, locale) : '—'}
      accentColor="#f59e0b" hint={t('money.unusedHint')} />
    <div className={styles.statCard}>
      <div className="mb-3 flex items-center gap-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--fg-4)]">{t('money.clients')}</p>
        <InfoDot>{res.ok ? t('money.clientsHint', { active: money.payingActive, pilots: money.activePilots }) : t('money.accountsUnread')}</InfoDot>
      </div>
      <dl className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-xs text-[var(--fg-3)]">{t('money.accountsWithCredits')}</dt>
          <dd data-account-count="credits" className="font-mono text-xl font-semibold text-[var(--fg-1)]">{res.ok ? formatGrouped(money.paying, locale) : '—'}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-xs text-[var(--fg-3)]">{t('money.accountsExtendedQuota')}</dt>
          <dd data-account-count="quota" className="font-mono text-xl font-semibold text-[var(--fg-1)]">{res.ok ? formatGrouped(money.pilots, locale) : '—'}</dd>
        </div>
      </dl>
    </div>
  </>;
}

export async function MoneyPacks({ promise, locale }: Reading<PackSalesSnapshot>) {
  const res = await promise;
  return <PackSalesCard data={res.ok ? retainedPackSales(res.data) : null} locale={locale} />;
}

export async function MoneyRefusals({ promise, locale }: Reading<unknown>) {
  const res = await promise;
  return <FailedPaymentsCard value={res.ok ? res.data : null} locale={locale} />;
}

/** Les liens de contact gardent la même lecture CRM et le même instant de référence. */
export async function MoneyBuyers({ promise, crmPromise, locale, nowIso }: Reading<ActivationClientRow[]> & {
  crmPromise: Promise<BuildInput | null>; nowIso: string;
}) {
  const t = await getTranslations('dashboard.overview');
  const [clientsRes, crm] = await Promise.all([promise, crmPromise]);
  const money = moneySummary(clientsRes.ok ? clientsRes.data ?? [] : [], new Date(nowIso));
  const snap = crm ? snapshotOnce(crm, nowIso) : null;
  const writable = snap ? writableIds(snap) : null;
  const fmt = (n: number) => formatGrouped(n, locale);
  return (
          <div className={overviewCard}>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-[var(--fg-2)]">{t('money.buyers')}</p>
              {money.creditsSold > 0 && (
                <p className="text-[11px] text-[var(--fg-4)]">
                  {t('money.recorded', { count: fmt(money.creditsSold) })}
                </p>
              )}
            </div>
            {!clientsRes.ok ? (
              <FetchFailed name={t('money.buyers')} status={clientsRes.status} />
            ) : money.buyers.length === 0 ? (
              <p className="text-sm text-[var(--fg-5)]">{t('money.buyersEmpty')}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {money.buyers.slice(0, 5).map((b) => (
                  <li key={b.email} className="flex items-center gap-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate text-[var(--fg-1)]" title={b.email}>
                      {b.email}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-emerald-300">
                      {fmt(b.creditsRemaining)}/{fmt(b.creditsTotal)}
                    </span>
                    <span className="hidden shrink-0 text-[11px] text-[var(--fg-4)] sm:inline">
                      {b.idleDays === null
                        ? t('money.neverCalled')
                        : t('money.idle', { days: b.idleDays })}
                    </span>
                    <ClientLinks
                      locale={locale}
                      email={b.email}
                      canWrite={writable === null || writable.has(b.email.toLowerCase())}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
  );
}

export async function MoneyDigest({ promise, nowIso }: Reading<{ digests: DigestEntry[] }> & { nowIso: string }) {
  const t = await getTranslations('dashboard.overview');
  const res = await promise;
  const digests = res.data?.digests ?? [];
  if (digests.length === 0) return null;
  return <details open={new Date(nowIso).getUTCDay() === 1} className={overviewCard}>
    <summary className="cursor-pointer text-sm font-medium text-[var(--fg-2)]"><span aria-hidden>🗞 </span>{t('money.digest')}</summary>
    <div className="mt-3"><WeeklyDigestCard digests={digests} /></div>
  </details>;
}

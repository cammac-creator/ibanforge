import { getTranslations } from 'next-intl/server';
import { StatCardV2 } from '../stat-card-v2';
import { RevenueCard } from '../revenue-card';
import { WeeklyDigestCard, type DigestEntry } from '../weekly-digest-card';
import type { ActivationClientRow } from '../clients-table';
import type { BuildInput } from '@/lib/crm/build-contacts';
import { moneySummary } from '@/lib/dashboard-overview';
import { packUsdLabel, retainedPackSales, type PackSalesSnapshot } from '@/lib/dashboard/pack-sales';
import { PackSalesCard } from './pack-sales-card';
import { ClientLinks } from './client-links';
import { FetchFailed, type Fetched } from './fetching';
import { snapshotOnce, writableIds } from './one-clock';
import { OverviewSection, overviewCard } from './section';
import type { HistoryEntry, StatsResponse } from './types';

/** Montants conservés, crédits recensés et portefeuille gardent leurs périmètres propres. */
export async function MoneySection({
  locale,
  period,
  nowIso,
  statsPromise,
  historyPromise,
  clientsPromise,
  crmPromise,
  digestPromise,
  packSalesPromise,
}: {
  locale: string;
  period: number;
  /** The page's single instant: see one-clock.ts. */
  nowIso: string;
  statsPromise: Promise<Fetched<StatsResponse>>;
  historyPromise: Promise<Fetched<HistoryEntry[]>>;
  clientsPromise: Promise<Fetched<ActivationClientRow[]>>;
  crmPromise: Promise<BuildInput | null>;
  digestPromise: Promise<Fetched<{ digests: DigestEntry[] }>>;
  packSalesPromise: Promise<Fetched<PackSalesSnapshot>>;
}) {
  const t = await getTranslations('dashboard.overview');
  const [statsRes, historyRes, clientsRes, crm, digestRes, packsRes] = await Promise.all([
    statsPromise,
    historyPromise,
    clientsPromise,
    crmPromise,
    digestPromise,
    packSalesPromise,
  ]);

  const now = new Date(nowIso);
  const fmt = (n: number) => n.toLocaleString(locale);
  const money = moneySummary(clientsRes.data ?? [], now);
  const snap = crm ? snapshotOnce(crm, nowIso) : null;
  const writable = snap ? writableIds(snap) : null;
  const packs = packsRes.ok ? retainedPackSales(packsRes.data) : null;

  // Real day-over-day delta, from the daily series. The one badge on this page
  // that was NOT a delta (ENS-02) has been removed rather than faked.
  const hist = historyRes.data ?? [];
  const todayRevenue = hist[hist.length - 1]?.revenue_usdc ?? 0;
  const yesterdayRevenue = hist[hist.length - 2]?.revenue_usdc ?? 0;
  const revTrendPct =
    yesterdayRevenue > 0
      ? `${Math.abs(Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100))}%`
      : undefined;
  const revTrend: 'up' | 'down' | 'neutral' =
    yesterdayRevenue === 0 ? 'neutral' : todayRevenue > yesterdayRevenue ? 'up' : todayRevenue < yesterdayRevenue ? 'down' : 'neutral';

  const digests = digestRes.data?.digests ?? [];
  // Folded from Tuesday on. The digest is excellent and weekly; on Wednesday
  // it occupied the best place on the screen with prose read two days earlier,
  // and more than a full phone screen of it. A cockpit sorts by freshness.
  const isMonday = now.getUTCDay() === 1;

  return (
    <OverviewSection step={1} title={t('money.title')} lead={t('money.lead')}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCardV2
          title={t('money.packs')}
          value={packUsdLabel(packs, locale)}
          accentColor="#22c55e"
          hint={t('money.packsHint')}
        />
        <StatCardV2
          title={t('money.x402')}
          value={
            statsRes.data
              ? `${(statsRes.data.total_revenue_usdc_clean ?? statsRes.data.total_revenue_usdc ?? 0).toFixed(4)} USDC`
              : '—'
          }
          trend={revTrendPct ? { direction: revTrend, label: t('money.vsYesterday', { percent: revTrendPct }) } : undefined}
          sparkline={hist.slice(-7).map((d) => d.revenue_usdc ?? 0)}
          accentColor="#14b8a6"
          hint={t('money.x402Hint')}
        />
        <StatCardV2
          title={t('money.unused')}
          value={money.creditsSold > 0 ? fmt(money.creditsUnused) : '—'}
          accentColor="#f59e0b"
          hint={t('money.unusedHint')}
        />
        <StatCardV2
          title={t('money.clients')}
          value={clientsRes.ok ? `${money.paying} / ${money.pilots}` : '—'}
          accentColor="#a855f7"
          hint={t('money.clientsHint', { active: money.payingActive, pilots: money.activePilots })}
        />
      </div>

      <p className="text-xs text-[var(--fg-4)]">{t('money.retainedKeysNote')}</p>
      <PackSalesCard data={packs} locale={locale} />

      {/* Les comptes à crédits restent accessibles sans les confondre avec des ventes. */}
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
                  {b.idleDays === null ? t('money.neverCalled') : t('money.idle', { days: b.idleDays })}
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

      {/* Le portefeuille se lit séparément des références Stripe conservées. */}
      <RevenueCard />

      {digests.length > 0 && (
        <details open={isMonday} className={overviewCard}>
          <summary className="cursor-pointer text-sm font-medium text-[var(--fg-2)]">
            <span aria-hidden>🗞 </span>
            {t('money.digest')}
          </summary>
          <div className="mt-3">
            <WeeklyDigestCard digests={digests} />
          </div>
        </details>
      )}

      <p className="text-[11px] text-[var(--fg-5)]">{t('money.windows', { days: period })}</p>
    </OverviewSection>
  );
}

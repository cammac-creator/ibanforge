import { getTranslations } from 'next-intl/server';
import { ActivationFunnel } from '../activation-funnel';
import { TopUsersToday } from '../top-users-today';
import { LivingToolCard, type DemandGapsPayload, type FeedbackReport } from '../living-tool-card';
import type { ActivationClientRow } from '../clients-table';
import type { BuildInput } from '@/lib/crm/build-contacts';
import { topUsers } from '@/lib/crm/top-users';
import { recentSignups, type SignupSources, type AuditStats } from '@/lib/dashboard-overview';
import { StatCardV2 } from '../stat-card-v2';
import { ClientLinks } from './client-links';
import { SignupSourcesCard } from './signup-sources-card';
import { AuditStatsCard } from './audit-stats-card';
import { FetchFailed, type Fetched } from './fetching';
import { snapshotOnce, writableIds } from './one-clock';
import { OverviewSection, overviewCard } from './section';
import type { ActivationData, HistoryEntry } from './types';

/**
 * Section 4 — what is new.
 *
 * Four blocks that answer the same question and used to sit two thousand
 * pixels apart: the activation funnel, today's podium, the two learning loops
 * of the 🌱 card (unserved demand and agent feedback), and the people who
 * signed up this week. Mostly a move rather than a rewrite, which is why it is
 * the cheapest section of the rebuild and one of the most useful: the day's
 * novelty now fits on one screen.
 */
export async function NewSection({
  locale,
  nowIso,
  activationPromise,
  clientsPromise,
  crmPromise,
  historyPromise,
  demandGapsPromise,
  feedbackPromise,
  sourcesPromise,
  auditStatsPromise,
}: {
  locale: string;
  /** The page's single instant: see one-clock.ts. */
  nowIso: string;
  activationPromise: Promise<Fetched<ActivationData>>;
  clientsPromise: Promise<Fetched<ActivationClientRow[]>>;
  crmPromise: Promise<BuildInput | null>;
  historyPromise: Promise<Fetched<HistoryEntry[]>>;
  demandGapsPromise: Promise<Fetched<DemandGapsPayload>>;
  feedbackPromise: Promise<Fetched<{ open: number; reports: FeedbackReport[] }>>;
  sourcesPromise: Promise<Fetched<SignupSources>>;
  auditStatsPromise: Promise<Fetched<AuditStats>>;
}) {
  const t = await getTranslations('dashboard.overview');
  const [activationRes, clientsRes, crm, historyRes, gapsRes, feedbackRes] = await Promise.all([
    activationPromise,
    clientsPromise,
    crmPromise,
    historyPromise,
    demandGapsPromise,
    feedbackPromise,
  ]);

  const snap = crm ? snapshotOnce(crm, nowIso) : null;
  const writable = snap ? writableIds(snap) : null;
  const podium = crm && snap ? topUsers(crm.keys, crm.activityByKey, snap.todayUtc) : null;
  const signups = recentSignups(clientsRes.data ?? [], new Date(nowIso));

  /**
   * Units served today, UTC (ENS-18, and the wording fix of 01/09/2026).
   *
   * Named "Appels API" until now, which was wrong twice: a batch of 100 IBANs
   * writes 100 into these counters, so they count OPERATIONS and not calls;
   * and the buckets come from the UTC day while customer freshness elsewhere
   * is counted on the Europe/Zurich calendar, so "today" meant two different
   * days on one page without either one being labelled.
   */
  const ops = (d?: HistoryEntry) =>
    d ? (d.iban_validate ?? 0) + (d.iban_batch ?? 0) + (d.bic_lookup ?? 0) : 0;
  const hist = historyRes.data ?? [];
  const todayOps = ops(hist[hist.length - 1]);
  const yesterdayOps = ops(hist[hist.length - 2]);
  const opsTrendPct =
    yesterdayOps > 0
      ? `${Math.abs(Math.round(((todayOps - yesterdayOps) / yesterdayOps) * 100))}%`
      : undefined;
  const opsTrend: 'up' | 'down' | 'neutral' =
    yesterdayOps === 0
      ? 'neutral'
      : todayOps > yesterdayOps
        ? 'up'
        : todayOps < yesterdayOps
          ? 'down'
          : 'neutral';

  return (
    <OverviewSection step={5} title={t('fresh.title')} lead={t('fresh.lead')}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCardV2
          title={t('fresh.opsToday')}
          value={historyRes.ok ? todayOps.toLocaleString(locale) : '—'}
          trend={
            opsTrendPct
              ? { direction: opsTrend, label: t('money.vsYesterday', { percent: opsTrendPct }) }
              : undefined
          }
          sparkline={hist.slice(-7).map(ops)}
          accentColor="#f59e0b"
          hint={t('fresh.opsTodayHint')}
        />
        <div className="sm:col-span-2">
          {podium && snap && (
            <TopUsersToday top={podium} todayUtc={snap.todayUtc} locale={locale} />
          )}
        </div>
      </div>

      {activationRes.data ? (
        <ActivationFunnel funnel={activationRes.data.funnel} />
      ) : (
        <FetchFailed name={t('fresh.funnel')} status={activationRes.status} />
      )}

      <div className={overviewCard}>
        <p className="mb-2 text-sm font-medium text-[var(--fg-2)]">
          {t('fresh.signups', { count: signups.total })}
        </p>
        {!clientsRes.ok ? (
          <FetchFailed name={t('fresh.signups', { count: 0 })} status={clientsRes.status} />
        ) : signups.rows.length === 0 ? (
          <p className="text-[12px] text-[var(--fg-5)]">{t('fresh.signupsEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {signups.rows.map((s) => (
              <li key={s.email} className="flex items-center gap-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-[var(--fg-1)]" title={s.email}>
                  {s.email}
                </span>
                <span
                  className={`shrink-0 text-[11px] ${s.called ? 'text-emerald-400' : 'text-[var(--fg-4)]'}`}
                >
                  {s.called ? t('fresh.called') : t('fresh.notCalled')}
                </span>
                <span className="hidden shrink-0 text-[11px] text-[var(--fg-5)] sm:inline">
                  {t('fresh.signedUp', { days: s.days ?? 0 })}
                </span>
                <ClientLinks
                  locale={locale}
                  email={s.email}
                  canWrite={writable === null || writable.has(s.email.toLowerCase())}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <SignupSourcesCard sourcesPromise={sourcesPromise} locale={locale} />

      <AuditStatsCard statsPromise={auditStatsPromise} locale={locale} />

      {/* Loops 1 and 2 of the 🌱 card. Loop 3 (register freshness) is up in
          "what is broken", where an outdated register belongs. */}
      <LivingToolCard
        loops={['demand', 'feedback']}
        gaps={gapsRes.data}
        gapsFailed={gapsRes.ok ? null : gapsRes.status}
        feedbackOpen={feedbackRes.data?.open ?? 0}
        feedbackFailed={feedbackRes.ok ? null : feedbackRes.status}
        reports={feedbackRes.data?.reports ?? []}
        sources={[]}
      />
    </OverviewSection>
  );
}

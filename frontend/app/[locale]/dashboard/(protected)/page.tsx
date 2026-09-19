import { Suspense } from 'react';
import { overviewView } from '@/lib/dashboard/workspace';
import { OverviewNavigation } from '@/components/dashboard/overview/navigation';
import { AudienceSection } from '@/components/dashboard/audience/section';
import { audienceSince } from '@/lib/dashboard/audience-model';
import { getLocale } from 'next-intl/server';
import type { BusinessFunnelDay } from '@/components/dashboard/business-funnel-chart';
import type { ChannelRow } from '@/components/dashboard/channels-panel';
import type { CohortFootprint } from '@/components/dashboard/cohort-study-panel';
import type { ActivationClientRow } from '@/components/dashboard/clients-table';
import type { DigestEntry } from '@/components/dashboard/weekly-digest-card';
import type {
  DemandGapsPayload,
  FeedbackReport,
  SourceFreshnessEntry,
} from '@/components/dashboard/living-tool-card';
import type { OrphanMailRow } from '@/components/dashboard/orphan-mail-panel';
import type { StatusByPathRow } from '@/components/dashboard/status-by-path-table';
import { BrokenSection } from '@/components/dashboard/overview/broken-section';
import { ChaseSection } from '@/components/dashboard/overview/chase-section';
import { DetailsSection } from '@/components/dashboard/overview/details-section';
import { ApiDownBanner, HealthStrip, OverviewHeader } from '@/components/dashboard/overview/header';
import { MoneySection } from '@/components/dashboard/overview/money-section';
import type { PackSalesSnapshot } from '@/lib/dashboard/pack-sales';
import type { FailedPaymentsSnapshot } from '@/lib/dashboard/failed-payments';
import { NewSection } from '@/components/dashboard/overview/new-section';
import { TrafficSection } from '@/components/dashboard/overview/traffic-section';
import { SectionSkeleton } from '@/components/dashboard/overview/section';
import { fetchJSON, notFetched, type Fetched } from '@/components/dashboard/overview/fetching';
import type {
  ActivationData,
  ErrorsResponse,
  HistoryEntry,
  HourlyResponse,
  StatsResponse,
} from '@/components/dashboard/overview/types';
import { fetchCrmData } from '@/lib/crm/build-contacts';
import { fetchTrafficTrend } from '@/lib/traffic-trend';
import {
  fetchSearchConsole,
  type SearchConsole,
  type SignupSources,
  type AuditStats,
  type WebEventsSummary,
} from '@/lib/dashboard-overview';

/** Quatre vues pour séparer le travail quotidien des analyses détaillées.
 * Les lectures utiles à la vue démarrent ensemble et restent sous Suspense.
 * Une lecture indisponible conserve toujours son état, jamais un zéro implicite.
 */

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const STATS_TOKEN = process.env.STATS_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const statsHeaders: HeadersInit = STATS_TOKEN ? { Authorization: `Bearer ${STATS_TOKEN}` } : {};
const adminHeaders: HeadersInit = { 'X-Admin-Secret': ADMIN_SECRET };

const VALID_PERIODS = [7, 30, 90] as const;
type ValidPeriod = (typeof VALID_PERIODS)[number];

const stats = <T,>(path: string) => fetchJSON<T>(`${API_URL}${path}`, statsHeaders);
/** An admin read, or a read that never happened when the secret is absent. */
const admin = <T,>(path: string): Promise<Fetched<T>> =>
  ADMIN_SECRET ? fetchJSON<T>(`${API_URL}${path}`, adminHeaders) : Promise.resolve(notFetched<T>());

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getLocale();
  const params = await searchParams;
  const view = overviewView(params.view);
  const money = view === 'today' || view === 'revenue';
  const growth = view === 'growth';
  const service = view === 'service';
  const statsFor = <T,>(enabled: boolean, path: string) =>
    enabled ? stats<T>(path) : Promise.resolve(notFetched<T>());
  const adminFor = <T,>(enabled: boolean, path: string) =>
    enabled ? admin<T>(path) : Promise.resolve(notFetched<T>());
  const periodParam = Number(params.period ?? 30);
  const period: ValidPeriod = VALID_PERIODS.includes(periodParam as ValidPeriod)
    ? (periodParam as ValidPeriod)
    : 30;

  // Every read starts here and is awaited by the section that needs it. Kicked
  // off before the first <Suspense>, so they still run together — the win of
  // the old single Promise.all is kept, its cost (nothing on screen until the
  // slowest one landed) is not.
  const statsP = stats<StatsResponse>('/stats');
  const historyP = stats<HistoryEntry[]>(`/stats/history?period=${period}`);
  const funnelP = statsFor<{ rows?: BusinessFunnelDay[] }>(
    service,
    `/stats/business-funnel?period=${period}`,
  );
  const errorsP = statsFor<ErrorsResponse>(service, `/stats/errors?period=${period}`);
  const hourlyP = statsFor<HourlyResponse>(service, `/stats/hourly?period=${period}`);
  const eventsP = statsFor<{ events: Array<{ created_at: string; kind: string; label: string }> }>(
    service,
    `/stats/events?period=${period}`,
  );
  const statusByPathP = statsFor<{ rows: StatusByPathRow[] }>(
    service,
    `/stats/status-by-path?period=${period}`,
  );
  const sourcesP = statsFor<{ by_client_kind: ChannelRow[] }>(
    service,
    `/stats/sources?period=${period}`,
  );
  const patternsP = statsFor<{ geo_trend: Array<Record<string, number | string>> }>(
    service,
    `/stats/patterns?period=${period}`,
  );
  const cohortFootprintP = statsFor<CohortFootprint>(service, '/stats/cohort-footprint');
  const healthP = service
    ? fetchJSON<{ bic_sources?: SourceFreshnessEntry[] }>(`${API_URL}/health`, {})
    : Promise.resolve(notFetched<{ bic_sources?: SourceFreshnessEntry[] }>());

  // Per-email activation. Only 30 and 90 are served upstream, and only the
  // funnel/sources/cohorts of this payload depend on the window at all.
  const activationP = admin<ActivationData>(`/v1/admin/activation?days=${period === 90 ? 90 : 30}`);
  const digestP = adminFor<{ digests: DigestEntry[] }>(
    view === 'revenue',
    '/v1/admin/digest?limit=8',
  );
  const orphanP = adminFor<{ orphans: OrphanMailRow[]; pending: number }>(
    view === 'today',
    '/v1/admin/orphan-mail',
  );
  const demandGapsP = adminFor<DemandGapsPayload>(growth, '/v1/admin/demand-gaps?days=30');
  const feedbackP = adminFor<{ open: number; reports: FeedbackReport[] }>(
    growth,
    '/v1/admin/feedback?limit=10',
  );
  const signupSourcesP = adminFor<SignupSources>(growth, '/v1/admin/signup-sources?days=30');
  // Same channels over the week, for the trial group of the doors card: its
  // conversion is a key, and the card shows every figure on 7 and 30 days.
  const signupSourcesWeekP = adminFor<SignupSources>(growth, '/v1/admin/signup-sources?days=7');
  const auditStatsP = adminFor<AuditStats>(growth, '/v1/admin/audit-stats?days=30');
  const packSalesP = adminFor<PackSalesSnapshot>(money, '/v1/admin/pack-sales');
  // 90 jours fixes : un refus de la semaine passée reste actionnable, la période
  // du reste de l'écran n'a pas de sens ici.
  const failedPaymentsP = adminFor<FailedPaymentsSnapshot>(
    money,
    '/v1/admin/failed-payments?days=90',
  );
  // What the landing page's visitors click (audit n° 32, 2026-09-05): the
  // week for the pulse, the month for the shape.
  const doorsWeekP = adminFor<WebEventsSummary>(growth, '/v1/admin/web-events?days=7');
  const doorsMonthP = adminFor<WebEventsSummary>(growth, '/v1/admin/web-events?days=30');
  /**
   * What Google sends the site. NOT read through `admin()`: the route answers
   * 502 with the last reading attached when Google refuses, and `fetchJSON`
   * drops the body of any non-2xx — the card would show an empty box on the one
   * day the previous week's figures are worth the most. `fetchSearchConsole`
   * keeps that body; the missing-secret branch stays here like every other.
   */
  const searchConsoleP =
    ADMIN_SECRET && growth
      ? fetchSearchConsole(API_URL, adminHeaders)
      : Promise.resolve(notFetched<SearchConsole>());
  // Swallows its own failures already; the catch is belt and braces, because a
  // promise created here and awaited three sections down would otherwise be an
  // unhandled rejection before anyone looks at it.
  const crmP = fetchCrmData().catch(() => null);

  /**
   * ENS-11 (the double read of /v1/admin/activation) is NOT closed here, and
   * the reason is worth writing down so the next reader does not re-attempt it.
   *
   * The endpoint is read twice per render: once above, once inside
   * fetchCrmData at days=90. Both calls return the SAME client list —
   * `getActivation` builds `clients` from every key and only funnel, sources
   * and cohorts depend on `days` (src/lib/activation.ts) — so there is no
   * disagreement between them, only a round trip. Sourcing the rows from
   * `crm.activation` instead would not remove that round trip either, because
   * the funnel still needs the direct read; and lib/crm/build-contacts declares
   * a deliberately NARROWER projection of those rows (no signup_at, no
   * last_seen_at, no free_quota), so reading them from there would take an
   * unchecked cast to buy nothing.
   *
   * The fix belongs upstream, in one line outside this file's reach: give
   * fetchCrmData an optional `days` and have it return the raw activation
   * payload, so this page can drop its own call and read funnel, sources and
   * cohorts from the CRM one.
   */
  const clientsP: Promise<Fetched<ActivationClientRow[]>> = activationP.then((a) => ({
    ok: a.ok,
    status: a.status,
    data: a.data?.clients ?? null,
  }));

  /**
   * One instant for the whole page, handed to every section.
   *
   * It dates the reading in the header AND it is the clock crmSnapshot is
   * given. Five sections resolving independently would otherwise each take
   * their own new Date(), which is the failure snapshot.ts warns about in its
   * own docstring: two counts of the same thing, taken either side of midnight,
   * disagreeing on one screen.
   *
   * ⚠️ TWO ROLES, one value. Do not replace it with a fixed or cached string to
   * "stabilise the header": it is also what decides who counts as due for a
   * follow-up. Same pattern as contacts/page.tsx and clients/page.tsx, which
   * pass `new Date().toISOString()` to the same badge in production.
   */
  const readAtIso = new Date().toISOString();
  // La route funnel part de `since` ; son paramètre `days` n'est pas une fenêtre glissante.
  const audienceFunnelP = adminFor<unknown>(
    growth, `/v1/admin/funnel?since=${audienceSince(period, readAtIso)}`,
  );
  const audienceWebP = period === 7 ? doorsWeekP
    : period === 30 ? doorsMonthP
      : adminFor<WebEventsSummary>(growth, '/v1/admin/web-events?days=90');
  const audienceSourcesP = period === 7 ? signupSourcesWeekP
    : period === 30 ? signupSourcesP
      : adminFor<SignupSources>(growth, '/v1/admin/signup-sources?days=90');
  // 180 days: the card compares each window with the one before it, and the
  // 90-day window needs the 90 before it to say so.
  const trendP = growth ? fetchTrafficTrend(180) : null;

  return (
    <div className={`flex min-w-0 flex-col ${growth ? 'gap-4' : 'gap-7'}`}>
      <OverviewHeader readAtIso={readAtIso} audience={growth} />
      <OverviewNavigation view={view} period={period} />

      <Suspense
        fallback={<div className="h-[70px] animate-pulse rounded-xl bg-[var(--ink-2)]/60" />}
      >
        <HealthStrip statsPromise={statsP} compact={!service} />
      </Suspense>
      <Suspense fallback={null}>
        <ApiDownBanner statsPromise={statsP} />
      </Suspense>

      {view === 'today' && (
        <Suspense fallback={<SectionSkeleton tall />}>
          <ChaseSection
            locale={locale}
            nowIso={readAtIso}
            clientsPromise={clientsP}
            crmPromise={crmP}
            orphanPromise={orphanP}
          />
        </Suspense>
      )}

      {money && (
        <Suspense fallback={<SectionSkeleton rows={4} />}>
          <MoneySection
            compact={view === 'today'}
            locale={locale}
            period={period}
            nowIso={readAtIso}
            statsPromise={statsP}
            historyPromise={historyP}
            clientsPromise={clientsP}
            crmPromise={crmP}
            digestPromise={digestP}
            packSalesPromise={packSalesP}
            failedPaymentsPromise={failedPaymentsP}
          />
        </Suspense>
      )}

      {service && (
        <Suspense fallback={<SectionSkeleton rows={3} />}>
          <BrokenSection
            period={period}
            statsPromise={statsP}
            errorsPromise={errorsP}
            statusByPathPromise={statusByPathP}
            healthPromise={healthP}
          />
        </Suspense>
      )}

      {growth && trendP && (
        <Suspense fallback={<SectionSkeleton tall />}>
          <AudienceSection
            activationPromise={activationP}
            trendPromise={trendP}
            webPromise={audienceWebP}
            sourcesPromise={audienceSourcesP}
            googlePromise={searchConsoleP}
            funnelPromise={audienceFunnelP}
            nowIso={readAtIso}
            period={period}
          >
            <TrafficSection nowIso={readAtIso} trendPromise={trendP} />
            <NewSection
              locale={locale}
              nowIso={readAtIso}
              activationPromise={activationP}
              clientsPromise={clientsP}
              crmPromise={crmP}
              historyPromise={historyP}
              demandGapsPromise={demandGapsP}
              feedbackPromise={feedbackP}
              sourcesPromise={signupSourcesP}
              sourcesWeekPromise={signupSourcesWeekP}
              auditStatsPromise={auditStatsP}
              doorsWeekPromise={doorsWeekP}
              doorsMonthPromise={doorsMonthP}
            />
          </AudienceSection>
        </Suspense>
      )}

      {service && (
        <Suspense fallback={<SectionSkeleton />}>
          <DetailsSection
            locale={locale}
            period={period}
            nowIso={readAtIso}
            historyPromise={historyP}
            funnelPromise={funnelP}
            eventsPromise={eventsP}
            errorsPromise={errorsP}
            hourlyPromise={hourlyP}
            statusByPathPromise={statusByPathP}
            sourcesPromise={sourcesP}
            patternsPromise={patternsP}
            statsPromise={statsP}
            activationPromise={activationP}
            cohortFootprintPromise={cohortFootprintP}
            crmPromise={crmP}
          />
        </Suspense>
      )}
    </div>
  );
}

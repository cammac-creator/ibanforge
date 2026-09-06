import { Suspense } from 'react';
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
import type { SignupSources, AuditStats, WebEventsSummary } from '@/lib/dashboard-overview';

/**
 * The founder's cockpit.
 *
 * Rebuilt on 2026-09-01 from an audit (ENS-01..ENS-24) that found the page to
 * be a chronological stack of twenty-two blocks, six and a half thousand
 * pixels tall: at 7 a.m. the money was at 1 700 px, what was broken at
 * 5 300 px, and the follow-ups due were a number with no button anywhere near
 * it. It answers five questions in order now, one section each:
 *
 *   1. the money            4. what is new
 *   2. who to chase today   5. the 30-day detail, folded shut
 *   3. what is broken
 *
 * Two structural rules hold the rest together:
 *
 * • Nothing is awaited here. The upstream reads start together (they were
 *   already parallel and that was never the problem) and are handed to async
 *   sections under <Suspense>, so the shell paints immediately instead of
 *   holding the PREVIOUS screen still for the three seconds a cold upstream
 *   costs. There is a loading.tsx beside this file for the same reason.
 *   The /stats failure that used to be a full-page early return is now one
 *   streamed banner, because that early return was itself the await that made
 *   streaming impossible.
 *
 * • Every block distinguishes "the fetch failed" from "the data is zero". A
 *   broken STATS_TOKEN once rendered as four days of empty charts that read
 *   exactly like a traffic collapse.
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
  const funnelP = stats<{ rows?: BusinessFunnelDay[] }>(`/stats/business-funnel?period=${period}`);
  const errorsP = stats<ErrorsResponse>(`/stats/errors?period=${period}`);
  const hourlyP = stats<HourlyResponse>(`/stats/hourly?period=${period}`);
  const eventsP = stats<{ events: Array<{ created_at: string; kind: string; label: string }> }>(
    `/stats/events?period=${period}`,
  );
  const statusByPathP = stats<{ rows: StatusByPathRow[] }>(
    `/stats/status-by-path?period=${period}`,
  );
  const sourcesP = stats<{ by_client_kind: ChannelRow[] }>(`/stats/sources?period=${period}`);
  const patternsP = stats<{ geo_trend: Array<Record<string, number | string>> }>(
    `/stats/patterns?period=${period}`,
  );
  const cohortFootprintP = stats<CohortFootprint>('/stats/cohort-footprint');
  const healthP = fetchJSON<{ bic_sources?: SourceFreshnessEntry[] }>(`${API_URL}/health`, {});

  // Per-email activation. Only 30 and 90 are served upstream, and only the
  // funnel/sources/cohorts of this payload depend on the window at all.
  const activationP = admin<ActivationData>(`/v1/admin/activation?days=${period === 90 ? 90 : 30}`);
  const digestP = admin<{ digests: DigestEntry[] }>('/v1/admin/digest?limit=8');
  const orphanP = admin<{ orphans: OrphanMailRow[]; pending: number }>('/v1/admin/orphan-mail');
  const demandGapsP = admin<DemandGapsPayload>('/v1/admin/demand-gaps?days=30');
  const feedbackP = admin<{ open: number; reports: FeedbackReport[] }>(
    '/v1/admin/feedback?limit=10',
  );
  const signupSourcesP = admin<SignupSources>('/v1/admin/signup-sources?days=30');
  const auditStatsP = admin<AuditStats>('/v1/admin/audit-stats?days=30');
  // What the landing page's visitors click (audit n° 32, 2026-09-05): the
  // week for the pulse, the month for the shape.
  const doorsWeekP = admin<WebEventsSummary>('/v1/admin/web-events?days=7');
  const doorsMonthP = admin<WebEventsSummary>('/v1/admin/web-events?days=30');
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
  // 180 days: the card compares each window with the one before it, and the
  // 90-day window needs the 90 before it to say so.
  const trendP = fetchTrafficTrend(180);

  return (
    <div className="flex min-w-0 flex-col gap-7">
      <OverviewHeader period={period} readAtIso={readAtIso} />

      <Suspense
        fallback={<div className="h-[70px] animate-pulse rounded-xl bg-[var(--ink-2)]/60" />}
      >
        <HealthStrip statsPromise={statsP} />
      </Suspense>
      <Suspense fallback={null}>
        <ApiDownBanner statsPromise={statsP} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton rows={4} />}>
        <MoneySection
          locale={locale}
          period={period}
          nowIso={readAtIso}
          statsPromise={statsP}
          historyPromise={historyP}
          clientsPromise={clientsP}
          crmPromise={crmP}
          digestPromise={digestP}
        />
      </Suspense>

      <Suspense fallback={<SectionSkeleton tall />}>
        <TrafficSection nowIso={readAtIso} trendPromise={trendP} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton tall />}>
        <ChaseSection
          locale={locale}
          nowIso={readAtIso}
          clientsPromise={clientsP}
          crmPromise={crmP}
          orphanPromise={orphanP}
        />
      </Suspense>

      <Suspense fallback={<SectionSkeleton rows={3} />}>
        <BrokenSection
          period={period}
          statsPromise={statsP}
          errorsPromise={errorsP}
          statusByPathPromise={statusByPathP}
          healthPromise={healthP}
        />
      </Suspense>

      <Suspense fallback={<SectionSkeleton tall />}>
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
          auditStatsPromise={auditStatsP}
          doorsWeekPromise={doorsWeekP}
          doorsMonthPromise={doorsMonthP}
        />
      </Suspense>

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
    </div>
  );
}

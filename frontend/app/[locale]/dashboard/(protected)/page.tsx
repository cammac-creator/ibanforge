import { StackedBarChart, type ChartMarker } from '@/components/stacked-bar-chart';
import { StatCardV2 } from '@/components/dashboard/stat-card-v2';
import { BusinessFunnelChart, type BusinessFunnelDay } from '@/components/dashboard/business-funnel-chart';
import { ClientsTable, type ActivationClientRow } from '@/components/dashboard/clients-table';
import { ActivationFunnel, type ActivationFunnelData } from '@/components/dashboard/activation-funnel';
import {
  AcquisitionPanel,
  type AcquisitionSourceRow,
  type AcquisitionCohortRow,
} from '@/components/dashboard/acquisition-panel';
import { Heatmap } from '@/components/dashboard/heatmap';
import { WeeklyDigestCard, type DigestEntry } from '@/components/dashboard/weekly-digest-card';
import {
  LivingToolCard,
  type DemandGapsPayload,
  type FeedbackReport,
  type SourceFreshnessEntry,
} from '@/components/dashboard/living-tool-card';
import { StatusByPathTable, type StatusByPathRow } from '@/components/dashboard/status-by-path-table';
import { ChannelsPanel, type ChannelRow } from '@/components/dashboard/channels-panel';
import { ErrorTable } from '@/components/dashboard/error-table';
import { InfoDot } from '@/components/dashboard/info-dot';
import { RevenueCard } from '@/components/dashboard/revenue-card';
import { LiveHealthStrip } from '@/components/dashboard/live-health-strip';
import { TopUsersToday } from '@/components/dashboard/top-users-today';
import { FunnelPanel } from '@/components/crm/funnel-panel';
import { fetchCrmData, SEEDED_PILOT_RE, type BuildInput } from '@/lib/crm/build-contacts';
import { BY_CAMPAIGN, BY_CONFIDENCE, BY_COUNTRY, BY_SEGMENT, funnelBy } from '@/lib/crm/funnel';
import { reservoir } from '@/lib/crm/priority';
import { ReservoirCard } from '@/components/dashboard/reservoir-card';
import { OrphanMailPanel, type OrphanMailRow } from '@/components/dashboard/orphan-mail-panel';
import { CohortStudyPanel, type CohortFootprint } from '@/components/dashboard/cohort-study-panel';
import { FOLLOWUP_DAYS } from '@/lib/crm/situation';
import { crmSnapshot } from '@/lib/crm/snapshot';
import { topUsers } from '@/lib/crm/top-users';
import { getTranslations, getLocale } from 'next-intl/server';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const STATS_TOKEN = process.env.STATS_TOKEN || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const statsHeaders: HeadersInit = STATS_TOKEN ? { Authorization: `Bearer ${STATS_TOKEN}` } : {};

const VALID_PERIODS = [7, 30, 90] as const;
type ValidPeriod = (typeof VALID_PERIODS)[number];

function fmt(n: number, locale: string): string {
  return n.toLocaleString(locale);
}

// ---------------------------------------------------------------- types
interface StatsResponse {
  total_requests: number;
  requests_today: number;
  requests_by_path: Array<{ path: string; count: number; avg_ms: number }>;
  by_type: {
    iban_validate: { total: number; valid_count: number; success_rate: number };
    iban_batch: { total: number; valid_count: number; success_rate: number };
    bic_lookup: { total: number; found_count: number; hit_rate: number };
  };
  total_revenue_usdc: number;
  total_revenue_usdc_clean: number;
  last_write_at: string | null;
  top_countries: Array<{ country: string; count: number }>;
}

interface ActivationData {
  clients: ActivationClientRow[];
  funnel: ActivationFunnelData;
  sources: AcquisitionSourceRow[];
  cohorts: AcquisitionCohortRow[];
}

interface HistoryEntry {
  date: string;
  expected_min: number | null;
  expected_max: number | null;
  iban_validate: number;
  iban_batch: number;
  bic_lookup: number;
  revenue_usdc: number;
  total_requests: number;
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
}

interface ErrorsResponse {
  error_rate: {
    iban_validate: { rate: number; trend: number[] };
    bic_lookup: { rate: number; trend: number[] };
  };
  top_invalid_ibans: Array<{ prefix: string; country: string; count: number; error_type: string }>;
  top_missing_bics: Array<{ bic: string; country: string; count: number }>;
}

interface HourlyResponse {
  heatmap: Array<{ day: number; hour: number; total: number }>;
}

// ---------------------------------------------------------------- fetchers
interface Fetched<T> {
  ok: boolean;
  /** HTTP status; 0 = network failure/timeout. */
  status: number;
  data: T | null;
}

/**
 * Every block distinguishes "the fetch failed" from "the data is zero".
 * A broken STATS_TOKEN once rendered as four days of empty charts that read
 * exactly like a traffic collapse — a failed fetch must say so, in its own
 * words, instead of drawing zeros.
 */
async function fetchJSON<T>(path: string, headers: HeadersInit): Promise<Fetched<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: 'no-store', headers });
    if (!res.ok) return { ok: false, status: res.status, data: null };
    return { ok: true, status: res.status, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

function FetchFailed({ name, status }: { name: string; status: number }) {
  return (
    <div className="flex h-24 flex-col items-center justify-center gap-1 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
      <p className="text-sm font-medium text-red-300">{name} — récupération en échec</p>
      <p className="text-xs text-[var(--fg-4)]">
        {status === 0 ? 'API injoignable (timeout ou réseau)' : status === 401 || status === 403 ? `HTTP ${status} — jeton invalide ou tourné` : `HTTP ${status}`}
        . Ce bloc n&rsquo;affiche pas des zéros : les données n&rsquo;ont pas pu être lues.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- contact base
/**
 * What the contact base looks like right now: who called today, what state the
 * relationships are in, what each campaign produced.
 *
 * This used to sit on /dashboard/contacts, stacked above the CRM. Watching the
 * base and working in it are two gestures, and the second one is what the
 * Contacts page is for, so the watching moved here.
 *
 * A plain Server Component with no state: everything it shows is derived from
 * the payload the page already fetched. Its own component rather than inline
 * JSX so the whole block narrows `crm` once and the page body stays readable.
 *
 * Every figure it shows comes from crmSnapshot, which the Contacts page reads
 * too. Nothing here recomputes a number the other page also shows.
 */
function ContactBase({ crm, locale }: { crm: BuildInput; locale: string }) {
  const snap = crmSnapshot(crm);
  const top = topUsers(crm.keys, crm.activityByKey, snap.todayUtc);

  // What is actually left to write to, which the "Prospects" total does not
  // say: a total that reads as a reserve when the high confidence reserve is
  // empty is worse than no figure at all.
  const tank = reservoir(snap.active);

  // Computed from the contacts already built, so the funnel can never disagree
  // with the figures beside it. Archived rows are excluded like everywhere else.
  const bySegment = funnelBy(snap.active, BY_SEGMENT);
  const byCampaign = funnelBy(snap.active, BY_CAMPAIGN);
  const byConfidence = funnelBy(snap.active, BY_CONFIDENCE);
  const byCountry = funnelBy(snap.active, BY_COUNTRY);

  return (
    <>
      <TopUsersToday top={top} todayUtc={snap.todayUtc} locale={locale} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCardV2
          title="Revenu clients"
          value={`$${snap.revenueUsd}`}
          accentColor="#22c55e"
          hint="CA réel des payants (packs Stripe). x402 non attribuable par client."
        />
        <StatCardV2
          title="Tu as la balle"
          value={String(snap.ballWithUs)}
          accentColor="#3b82f6"
          hint="Fils dont le dernier message est entrant : ils attendent ta réponse."
        />
        <StatCardV2
          title="Relances dues"
          value={String(snap.followupDue)}
          accentColor="#f59e0b"
          hint={`Plus de ${FOLLOWUP_DAYS} jours sans réponse depuis ton dernier mail.${snap.asleep ? ` ${snap.asleep} contact${snap.asleep > 1 ? 's' : ''} en veille jusqu'à une date ne sont pas comptés ici.` : ''}`}
        />
        <StatCardV2
          title="Gratuits actifs"
          value={String(snap.freeActive)}
          accentColor="#eab308"
          hint="Clés gratuites qui appellent réellement l’API, candidats à la conversion."
        />
        <ReservoirCard reservoir={tank} todayUtc={snap.todayUtc} />
        <StatCardV2
          title="Clients"
          value={String(snap.clients)}
          accentColor="#a855f7"
          hint="Contacts qui ont une clé API."
        />
      </div>

      <FunnelPanel
        bySegment={bySegment}
        byCampaign={byCampaign}
        byConfidence={byConfidence}
        byCountry={byCountry}
      />
    </>
  );
}

// ================================================================ page
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations('dashboard');
  const locale = await getLocale();
  const params = await searchParams;
  const periodParam = Number(params.period ?? 30);
  const period: ValidPeriod = VALID_PERIODS.includes(periodParam as ValidPeriod)
    ? (periodParam as ValidPeriod)
    : 30;

  const [statsRes, historyRes, funnelRes, activationRes, errorsRes, hourlyRes, eventsRes, digestRes, statusByPathRes, sourcesRes, patternsRes, cohortFootprintRes, orphanRes, crm, demandGapsRes, feedbackRes, healthRes] = await Promise.all([
    fetchJSON<StatsResponse>('/stats', statsHeaders),
    fetchJSON<HistoryEntry[]>(`/stats/history?period=${period}`, statsHeaders),
    fetchJSON<{ rows?: BusinessFunnelDay[] }>(`/stats/business-funnel?period=${period}`, statsHeaders),
    // Per-email activation: the clients table, human funnel, sources and
    // cohorts all read this one payload. Only 30 and 90 are served upstream.
    ADMIN_SECRET
      ? fetchJSON<ActivationData>(`/v1/admin/activation?days=${period === 90 ? 90 : 30}`, { 'X-Admin-Secret': ADMIN_SECRET })
      : Promise.resolve({ ok: false, status: 0, data: null } satisfies Fetched<ActivationData>),
    fetchJSON<ErrorsResponse>(`/stats/errors?period=${period}`, statsHeaders),
    fetchJSON<HourlyResponse>(`/stats/hourly?period=${period}`, statsHeaders),
    fetchJSON<{ events: Array<{ created_at: string; kind: string; label: string }> }>(
      `/stats/events?period=${period}`,
      statsHeaders,
    ),
    ADMIN_SECRET
      ? fetchJSON<{ digests: DigestEntry[] }>('/v1/admin/digest?limit=8', { 'X-Admin-Secret': ADMIN_SECRET })
      : Promise.resolve({ ok: false, status: 0, data: null } satisfies Fetched<{ digests: DigestEntry[] }>),
    fetchJSON<{ rows: StatusByPathRow[] }>(`/stats/status-by-path?period=${period}`, statsHeaders),
    fetchJSON<{ by_client_kind: ChannelRow[] }>(`/stats/sources?period=${period}`, statsHeaders),
    fetchJSON<{ geo_trend: Array<Record<string, number | string>> }>(`/stats/patterns?period=${period}`, statsHeaders),
    // Study view of the regrouped cohorts — discreet, folded shut, rendered last.
    fetchJSON<CohortFootprint>('/stats/cohort-footprint', statsHeaders),
    // Mail the CRM cannot attach to anyone. No admin secret means no panel,
    // not a broken page. (The listing watch moved to Forums → Vitrines on
    // 18/08/2026; this page no longer duplicates it.)
    ADMIN_SECRET
      ? fetchJSON<{ orphans: OrphanMailRow[]; pending: number }>('/v1/admin/orphan-mail', { 'X-Admin-Secret': ADMIN_SECRET })
      : Promise.resolve({ ok: false, status: 0, data: null } satisfies Fetched<{ orphans: OrphanMailRow[]; pending: number }>),
    fetchCrmData(),
    // The living-tool loops (01/09/2026): the demand ledger, the feedback
    // reader, and /health's per-source freshness. Health is public; the two
    // admin reads degrade to an empty card half, never a broken page.
    ADMIN_SECRET
      ? fetchJSON<DemandGapsPayload>('/v1/admin/demand-gaps?days=30', { 'X-Admin-Secret': ADMIN_SECRET })
      : Promise.resolve({ ok: false, status: 0, data: null } satisfies Fetched<DemandGapsPayload>),
    ADMIN_SECRET
      ? fetchJSON<{ open: number; reports: FeedbackReport[] }>('/v1/admin/feedback?limit=10', { 'X-Admin-Secret': ADMIN_SECRET })
      : Promise.resolve({ ok: false, status: 0, data: null } satisfies Fetched<{ open: number; reports: FeedbackReport[] }>),
    fetchJSON<{ bic_sources?: SourceFreshnessEntry[] }>('/health', {}),
  ]);

  const stats = statsRes.data;
  if (!stats) {
    return (
      <div className="rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
          <span className="text-xl text-red-400">!</span>
        </div>
        <p className="font-medium text-[var(--fg-2)]">{t('error.apiUnavailable')}</p>
        <p className="mt-1 text-sm text-[var(--fg-4)]">
          {t('error.apiUnavailableDescription')}{' '}
          {statsRes.status === 401 || statsRes.status === 403
            ? `(HTTP ${statsRes.status} — le jeton stats est invalide ou vient d'être tourné.)`
            : statsRes.status !== 0
              ? `(HTTP ${statsRes.status})`
              : '(injoignable)'}
        </p>
      </div>
    );
  }

  const activation = activationRes.data;
  const history = historyRes.data;
  const hist = history ?? [];
  const funnelRows = funnelRes.data?.rows ?? [];
  // Cohort validations per day, for the discreet marker on the funnel chart.
  const cohortByDate: Record<string, number> = Object.fromEntries(
    (cohortFootprintRes.data?.timeline ?? []).map((d) => [d.day, d.count]),
  );
  const errors = errorsRes.data;
  const hourly = hourlyRes.data;
  const chartMarkers: ChartMarker[] = (eventsRes.data?.events ?? []).map((e) => ({
    date: e.created_at.slice(0, 10),
    label: e.label,
    kind: e.kind,
  }));

  // --- KPIs: today's API operations + trend + sparkline
  const ops = (d?: HistoryEntry) =>
    d ? (d.iban_validate ?? 0) + (d.iban_batch ?? 0) + (d.bic_lookup ?? 0) : 0;
  const todayCalls = ops(hist[hist.length - 1]);
  const yesterdayCalls = ops(hist[hist.length - 2]);
  const callsTrend: 'up' | 'down' | 'neutral' =
    yesterdayCalls === 0 ? 'neutral' : todayCalls > yesterdayCalls ? 'up' : todayCalls < yesterdayCalls ? 'down' : 'neutral';
  const callsTrendPct =
    yesterdayCalls > 0 ? `${Math.abs(Math.round(((todayCalls - yesterdayCalls) / yesterdayCalls) * 100))}%` : undefined;
  const callsSparkline = hist.slice(-7).map(ops);

  const todayRevenue = hist[hist.length - 1]?.revenue_usdc ?? 0;
  const yesterdayRevenue = hist[hist.length - 2]?.revenue_usdc ?? 0;
  const revTrend: 'up' | 'down' | 'neutral' =
    yesterdayRevenue === 0 ? 'neutral' : todayRevenue > yesterdayRevenue ? 'up' : todayRevenue < yesterdayRevenue ? 'down' : 'neutral';
  const revTrendPct =
    yesterdayRevenue > 0 ? `${Math.abs(Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100))}%` : undefined;
  const revenueSparkline = hist.slice(-7).map((d) => d.revenue_usdc ?? 0);

  const ibanTotal = stats.by_type?.iban_validate?.total ?? 0;
  const ibanValid = stats.by_type?.iban_validate?.valid_count ?? 0;
  const successRate = ibanTotal > 0 ? ((ibanValid / ibanTotal) * 100).toFixed(1) : '—';

  // --- Clients (per-email activation payload)
  //
  // "Pilot" keeps its historical meaning here — an elevated free quota
  // (> 200/month) granted for an evaluation. The CRM has a SECOND, stricter
  // definition (lib/crm/build-contacts.ts isPilot: monthly_limit >= 5000);
  // both pre-date this page and the divergence is known, not a bug.
  const activationClients = (activation?.clients ?? []).filter((c) => !SEEDED_PILOT_RE.test(c.email));
  const pilotClients = activationClients.filter((c) => c.free_quota > 200);
  const activePilots = pilotClients.filter((c) => c.first_call_at !== null).length;
  const payingClients = activationClients.filter((c) => c.packs > 0);
  const toChase = activationClients.filter((c) => c.status === 'dormant' || c.status === 'silent');

  // --- Quality
  const ibanErrRate = errors?.error_rate?.iban_validate?.rate ?? 0;
  const ibanErrTrend = errors?.error_rate?.iban_validate?.trend ?? [];
  const bicMissRate = errors?.error_rate?.bic_lookup?.rate ?? 0;
  const bicMissTrend = errors?.error_rate?.bic_lookup?.trend ?? [];
  const ibanRows = errors?.top_invalid_ibans ?? [];
  const bicRows = errors?.top_missing_bics ?? [];

  // --- Top countries: summed from the period's geo trend; the all-time list
  // from /stats is only the fallback when patterns are unavailable. The old
  // card mixed a period-scoped page with an all-time ranking and admitted it
  // in its own tooltip.
  const geoTrend = patternsRes.data?.geo_trend ?? [];
  const byCountryPeriod = new Map<string, number>();
  for (const row of geoTrend) {
    for (const [k, v] of Object.entries(row)) {
      if (k === 'date' || typeof v !== 'number') continue;
      byCountryPeriod.set(k, (byCountryPeriod.get(k) ?? 0) + v);
    }
  }
  const countriesArePeriodScoped = byCountryPeriod.size > 0;
  const topCountries = countriesArePeriodScoped
    ? [...byCountryPeriod.entries()].map(([country, count]) => ({ country, count })).sort((a, z) => z.count - a.count).slice(0, 6)
    : (stats.top_countries ?? []).slice(0, 6);
  const maxCountry = topCountries[0]?.count ?? 1;

  const heatmapData = hourly?.heatmap ?? [];

  const card = 'rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 p-5';
  const sectionTitle = 'flex items-center gap-2 text-sm font-medium text-[var(--fg-2)]';

  return (
    <div className="flex flex-col gap-6">
      {/* 0. Live health + collection freshness witness */}
      <LiveHealthStrip lastWriteAt={stats.last_write_at} />

      {/* 0b. Monday auto-written digest (hidden until the first one lands) */}
      <WeeklyDigestCard digests={digestRes.data?.digests ?? []} />

      {/* 0c. The living tool: demand ledger, agent feedback, source freshness.
          Quiet and green on a calm day; names the register, the country or
          the report that needs a decision on a bad one. */}
      <LivingToolCard
        gaps={demandGapsRes.data}
        feedbackOpen={feedbackRes.data?.open ?? 0}
        reports={feedbackRes.data?.reports ?? []}
        sources={healthRes.data?.bic_sources ?? []}
      />

      {/* 1. KPI row — the four numbers that matter */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCardV2
          title={`Appels API (${t('stats.today')})`}
          value={fmt(todayCalls, locale)}
          trend={callsTrendPct ? { direction: callsTrend, label: t('stats.vsYesterday', { percent: callsTrendPct }) } : undefined}
          sparkline={callsSparkline}
          accentColor="#f59e0b"
          hint="Opérations servies du jour (validate + batch + bic_lookup), avec OU sans clé : les essais réussis du playground public comptent ici — y compris ceux d'un crawler qui soumet des IBAN bien formés. L'onglet Clients ne compte que les appels portés par une clé : un écart entre les deux est donc normal, pas une incohérence (constaté le 29/08 : 32 ici, 1 côté clients, les 31 autres = playground). Exclut les refus 4xx/5xx et les outils MCP, qui n'enregistrent pas d'opération."
        />
        <StatCardV2
          title={t('stats.totalRevenue')}
          value={`$${(stats.total_revenue_usdc_clean ?? stats.total_revenue_usdc ?? 0).toFixed(4)}`}
          trend={revTrendPct ? { direction: revTrend, label: t('stats.vsYesterday', { percent: revTrendPct }) } : undefined}
          sparkline={revenueSparkline}
          accentColor="#22c55e"
          hint="Revenu USDC x402 tenté, compté depuis le 18 avril 2026 — la dérive fantôme du premier déploiement (paiements vérifiés jamais réglés on-chain) est exclue du cumul. Source réglée on-chain : la carte Revenu plus bas."
        />
        <StatCardV2
          title={t('stats.successRate')}
          value={successRate !== '—' ? `${successRate}%` : '—'}
          trend={successRate !== '—' ? { direction: parseFloat(successRate) >= 95 ? 'up' : 'down', label: `${successRate}%` } : undefined}
          accentColor="#3b82f6"
          hint="% d'IBAN jugés valides parmi ceux soumis à /v1/iban/validate. Un taux bas = beaucoup d'IBAN mal formés en entrée."
        />
        <StatCardV2
          title="Payants / pilotes"
          value={`${payingClients.length} / ${pilotClients.length}`}
          trend={
            payingClients.length > 0
              ? {
                  direction: payingClients.some((c) => c.status === 'paying') ? 'up' : 'neutral',
                  label: `${payingClients.filter((c) => c.status === 'paying').length} actifs`,
                }
              : undefined
          }
          accentColor="#a855f7"
          hint={`Payants = clients ayant acheté au moins un pack de crédits (${payingClients.filter((c) => c.status === 'paying').length} encore actifs, ${payingClients.filter((c) => c.status === 'dormant').length} endormis). Pilotes = quota gratuit relevé > 200/mois, dont ${activePilots} ont déjà appelé. Détail dans la table Clients.`}
        />
      </div>

      {/* 2. Human activation funnel — the conversion picture (primacy) */}
      {activation && <ActivationFunnel funnel={activation.funnel} />}

      {/* 2b. HTTP conversion funnel — machine demand */}
      <div className={card}>
        <div className="mb-4 flex items-center gap-2">
          <p className={sectionTitle}>Funnel de conversion — {period} jours</p>
          <InfoDot>
            Seules les requêtes sur les endpoints facturables (IBAN / BIC / CH clearing) avec la bonne méthode HTTP. Le bruit (scanner, robots, discovery) est exclu, ainsi que les clés internes (tes tests, les audits Claude, le playground) — le funnel ne mesure que la demande réelle du marché.
            <br />
            <br />
            <strong>Différence avec « Requêtes HTTP » plus bas</strong> : ce graphe-ci = la DEMANDE (qui utilise le
            produit) ; l&apos;autre = l&apos;ATTENTION (tout ce qui touche le serveur, bruit compris). Quand l&apos;autre
            monte sans celui-ci, des machines regardent mais n&apos;utilisent pas.
            <br />
            <br />
            <strong className="text-[var(--ok)]">Paid success</strong> = l’agent a payé (x402) ou utilisé sa clé et reçu 2xx.
            <br />
            <strong className="text-amber-400">Paywall hit</strong> = agent intéressé mais sans auth → 402. C’est là que se joue la conversion.
            <br />
            <strong className="text-violet-400">Auth / quota</strong> = 401 (mauvaise clé) ou 429 (quota atteint).
            <br />
            <strong className="text-yellow-400">Bad input</strong> = 400 (body mal formé).
            <br />
            <strong className="text-red-400">Server error</strong> = 5xx, doit rester à zéro.
          </InfoDot>
        </div>
        {!funnelRes.ok ? (
          <FetchFailed name="Funnel métier" status={funnelRes.status} />
        ) : (
          <BusinessFunnelChart data={funnelRows} markers={chartMarkers} cohortByDate={cohortByDate} />
        )}
      </div>

      {/* 3. Contact base — the podium, the relationship figures, the campaigns */}
      {orphanRes.data?.orphans && (
        <OrphanMailPanel orphans={orphanRes.data.orphans} totalPending={orphanRes.data.pending} />
      )}
      {crm && <ContactBase crm={crm} locale={locale} />}

      {/* 4. Clients — per email, credits first */}
      {!activation ? (
        <div className={card}>
          {ADMIN_SECRET && activationRes.status !== 0 ? (
            <FetchFailed name="Vue clients (activation)" status={activationRes.status} />
          ) : (
            <div className="flex h-24 items-center justify-center text-sm text-[var(--fg-5)]">
              ADMIN_SECRET non configuré — vue clients indisponible.
            </div>
          )}
        </div>
      ) : (
        <>
          <ClientsTable clients={activation.clients} locale={locale} />
          <AcquisitionPanel sources={activation.sources} cohorts={activation.cohorts} locale={locale} />
        </>
      )}

      {/* 5. Revenue (live USDC wallet) */}
      <RevenueCard />

      {/* 6. Traffic — trend + geography */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={card}>
          <div className="mb-4 flex items-center gap-2">
            <p className={sectionTitle}>Requêtes HTTP — {period} jours</p>
            <InfoDot>
              <strong>Tout ce qui frappe à la porte du serveur</strong> : vraies validations, mais aussi robots,
              scanners, handshakes MCP, pages de découverte, 404. C&apos;est un thermomètre d&apos;ATTENTION, pas de
              business — un pic ici sans pic dans le « Funnel de conversion » (juste au-dessus) = du bruit machine,
              pas des clients. Exemple réel : le 12/08, 14 765 requêtes ici mais ~350 métier — 97 % de curiosité.
              <br />
              <br />
              <strong className="text-[var(--fg-2)]">Zone grise « Attendu »</strong> = la plage min-max des 8 dernières
              mêmes journées de semaine (un mercredi se compare aux 8 mercredis précédents). Une barre qui sort de la
              zone est vraiment inhabituelle ; dedans, c&apos;est une variation normale.
              <br />
              <strong className="text-violet-300">Traits pointillés violets</strong> = les événements (déploiements,
              notes) listés sous le graphe — pour relier « ça a bougé » à « voilà ce qu&apos;on a fait ce jour-là ».
            </InfoDot>
          </div>
          {!historyRes.ok ? (
            <FetchFailed name="Requêtes HTTP" status={historyRes.status} />
          ) : hist.length > 0 ? (
            <StackedBarChart
              data={hist}
              bars={[
                { key: 's2xx', color: '#3b82f6', label: '2xx' },
                { key: 's3xx', color: '#f59e0b', label: '3xx' },
                { key: 's4xx', color: '#eab308', label: '4xx' },
                { key: 's5xx', color: '#ef4444', label: '5xx' },
              ]}
              band={{ minKey: 'expected_min', maxKey: 'expected_max' }}
              markers={chartMarkers}
            />
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-[var(--fg-4)]">{t('chart.noHistoryData')}</div>
          )}
        </div>

        <div className={card}>
          <div className="mb-4 flex items-center gap-2">
            <p className={sectionTitle}>{countriesArePeriodScoped ? `Top pays — ${period} jours` : 'Top pays (cumulé)'}</p>
            <InfoDot>
              Déduit du code pays ISO de l’IBAN/BIC validé. « XX » = BIC test/internal.
              {countriesArePeriodScoped ? ' Filtré sur la période affichée.' : ' Cumulé depuis le début (patterns indisponibles).'}
            </InfoDot>
          </div>
          {topCountries.length > 0 ? (
            <div className="space-y-2.5">
              {topCountries.map((row, i) => {
                const pct = maxCountry > 0 ? (row.count / maxCountry) * 100 : 0;
                const label = t.has(`countries.${row.country}`) ? t(`countries.${row.country}` as Parameters<typeof t>[0]) : row.country;
                return (
                  <div key={row.country} className="flex items-center gap-3">
                    <span className="w-5 text-right font-mono text-xs text-[var(--fg-5)]">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center justify-between">
                        <span className="truncate text-sm text-[var(--fg-1)]">{label}</span>
                        <span className="ml-2 flex-shrink-0 font-mono text-xs text-amber-400">{fmt(row.count, locale)}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--ink-4)]">
                        <div className="h-full rounded-full bg-amber-500/40" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center text-sm text-[var(--fg-4)]">{t('chart.noCountryData')}</div>
          )}
        </div>
      </div>

      {/* 7. Quality — error rates + what's actually failing */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCardV2 title="Taux erreur IBAN" value={`${ibanErrRate.toFixed(2)}%`} sparkline={ibanErrTrend} accentColor="#ef4444" hint="% de /v1/iban/validate renvoyant invalide, sur la période." />
        <StatCardV2 title="Taux miss BIC" value={`${bicMissRate.toFixed(2)}%`} sparkline={bicMissTrend} accentColor="#eab308" hint="% de /v1/bic/:code sans correspondance, sur la période." />
        <StatCardV2 title="À relancer" value={String(toChase.length)} accentColor="#f59e0b" hint="Payants endormis (plus d'appel depuis 14 j) + inscrits jamais activés depuis ≥ 3 jours. Le détail est dans la bannière de la table Clients." />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ErrorTable
          title="Top IBAN invalides"
          columns={[
            { key: 'prefix', label: 'Préfixe', mono: true },
            { key: 'country', label: 'Pays' },
            { key: 'count', label: 'Nb', mono: true },
            { key: 'error_type', label: 'Type' },
          ]}
          rows={ibanRows}
          emptyMessage="Aucune erreur IBAN sur la période."
        />
        <ErrorTable
          title="Top BIC manquants"
          columns={[
            { key: 'bic', label: 'BIC', mono: true },
            { key: 'country', label: 'Pays' },
            { key: 'count', label: 'Nb', mono: true },
          ]}
          rows={bicRows}
          emptyMessage="Aucun BIC manquant sur la période."
        />
      </div>

      {/* 8. Channels + per-endpoint statuses (formerly dormant endpoints) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {!sourcesRes.ok ? (
          <FetchFailed name="Canaux d'accès" status={sourcesRes.status} />
        ) : (
          <ChannelsPanel rows={sourcesRes.data?.by_client_kind ?? []} periodDays={period} />
        )}
        <div className={card}>
          <div className="mb-4 flex items-center gap-2">
            <p className={sectionTitle}>Statuts par endpoint — {period} jours</p>
            <InfoDot>
              Chaque path avec sa répartition 2xx/3xx/4xx/5xx et sa latence. Survole une barre pour le détail par code
              HTTP avec son explication métier.
            </InfoDot>
          </div>
          {!statusByPathRes.ok ? (
            <FetchFailed name="Statuts par endpoint" status={statusByPathRes.status} />
          ) : (
            <StatusByPathTable rows={(statusByPathRes.data?.rows ?? []).slice(0, 12)} />
          )}
        </div>
      </div>

      {/* 9. Activity heatmap — when the traffic happens */}
      <Heatmap data={heatmapData} />

      {/* 10. Case study — the cohorts' footprint. Discreet, folded shut, last. */}
      <CohortStudyPanel data={cohortFootprintRes.data} />
    </div>
  );
}

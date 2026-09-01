import { getTranslations } from 'next-intl/server';
import { StackedBarChart } from '@/components/stacked-bar-chart';
import { BusinessFunnelChart, type BusinessFunnelDay } from '../business-funnel-chart';
import { AcquisitionPanel } from '../acquisition-panel';
import { ChannelsPanel, type ChannelRow } from '../channels-panel';
import { CohortStudyPanel, type CohortFootprint } from '../cohort-study-panel';
import { ErrorTable } from '../error-table';
import { Heatmap } from '../heatmap';
import { InfoDot } from '../info-dot';
import { StatusByPathTable, type StatusByPathRow } from '../status-by-path-table';
import { FunnelPanel } from '@/components/crm/funnel-panel';
import type { BuildInput } from '@/lib/crm/build-contacts';
import { BY_CAMPAIGN, BY_CONFIDENCE, BY_COUNTRY, BY_SEGMENT, funnelBy } from '@/lib/crm/funnel';
import { dedupeMarkers } from '@/lib/dashboard-overview';
import { FetchFailed, type Fetched } from './fetching';
import { snapshotOnce } from './one-clock';
import { OverviewSection, overviewCard } from './section';
import type { ActivationData, ErrorsResponse, HistoryEntry, HourlyResponse, StatsResponse } from './types';

/**
 * Section 5 — the 30-day detail, folded shut.
 *
 * Everything that is true, useful once a week and never urgent: the two
 * charts, the countries, the error tables, the channels, the per-endpoint
 * statuses, the hourly heatmap, the acquisition panel, the campaign funnel and
 * the cohort study. About 2 500 px leave the morning path without a single
 * figure being lost — one <details>, and the reader who wants them opens it.
 *
 * The heatmap stays here rather than moving to the Clients Bot tab: it belongs
 * on the machine-traffic page, but moving it would mean editing that page, and
 * folding it away already takes it out of the way.
 */
export async function DetailsSection({
  locale,
  period,
  nowIso,
  historyPromise,
  funnelPromise,
  eventsPromise,
  errorsPromise,
  hourlyPromise,
  statusByPathPromise,
  sourcesPromise,
  patternsPromise,
  statsPromise,
  activationPromise,
  cohortFootprintPromise,
  crmPromise,
}: {
  locale: string;
  period: number;
  /** The page's single instant: see one-clock.ts. */
  nowIso: string;
  historyPromise: Promise<Fetched<HistoryEntry[]>>;
  funnelPromise: Promise<Fetched<{ rows?: BusinessFunnelDay[] }>>;
  eventsPromise: Promise<Fetched<{ events: Array<{ created_at: string; kind: string; label: string }> }>>;
  errorsPromise: Promise<Fetched<ErrorsResponse>>;
  hourlyPromise: Promise<Fetched<HourlyResponse>>;
  statusByPathPromise: Promise<Fetched<{ rows: StatusByPathRow[] }>>;
  sourcesPromise: Promise<Fetched<{ by_client_kind: ChannelRow[] }>>;
  patternsPromise: Promise<Fetched<{ geo_trend: Array<Record<string, number | string>> }>>;
  statsPromise: Promise<Fetched<StatsResponse>>;
  activationPromise: Promise<Fetched<ActivationData>>;
  cohortFootprintPromise: Promise<Fetched<CohortFootprint>>;
  crmPromise: Promise<BuildInput | null>;
}) {
  const t = await getTranslations('dashboard');
  const o = await getTranslations('dashboard.overview');
  const [
    historyRes,
    funnelRes,
    eventsRes,
    errorsRes,
    hourlyRes,
    statusRes,
    sourcesRes,
    patternsRes,
    statsRes,
    activationRes,
    cohortRes,
    crm,
  ] = await Promise.all([
    historyPromise,
    funnelPromise,
    eventsPromise,
    errorsPromise,
    hourlyPromise,
    statusByPathPromise,
    sourcesPromise,
    patternsPromise,
    statsPromise,
    activationPromise,
    cohortFootprintPromise,
    crmPromise,
  ]);

  const fmt = (n: number) => n.toLocaleString(locale);
  const hist = historyRes.data ?? [];

  // ENS-08: deduplicated ONCE, then handed to both charts. The two of them
  // used to concatenate every raw marker and print a wall of near-identical
  // version lines twice on the same page.
  const markers = dedupeMarkers(
    (eventsRes.data?.events ?? []).map((e) => ({
      date: e.created_at.slice(0, 10),
      label: e.label,
      kind: e.kind,
    })),
  );

  const cohortByDate: Record<string, number> = Object.fromEntries(
    (cohortRes.data?.timeline ?? []).map((d) => [d.day, d.count]),
  );

  const byCountryPeriod = new Map<string, number>();
  for (const row of patternsRes.data?.geo_trend ?? []) {
    for (const [k, v] of Object.entries(row)) {
      if (k === 'date' || typeof v !== 'number') continue;
      byCountryPeriod.set(k, (byCountryPeriod.get(k) ?? 0) + v);
    }
  }
  const countriesArePeriodScoped = byCountryPeriod.size > 0;
  const topCountries = countriesArePeriodScoped
    ? [...byCountryPeriod.entries()]
        .map(([country, count]) => ({ country, count }))
        .sort((a, z) => z.count - a.count)
        .slice(0, 6)
    : (statsRes.data?.top_countries ?? []).slice(0, 6);
  const maxCountry = topCountries[0]?.count ?? 1;

  const errors = errorsRes.data;
  const snap = crm ? snapshotOnce(crm, nowIso) : null;
  const sectionTitle = 'flex items-center gap-2 text-sm font-medium text-[var(--fg-2)]';

  return (
    <OverviewSection step={5} title={o('details.title', { days: period })} lead={o('details.lead')}>
      <details className={overviewCard}>
        <summary className="cursor-pointer text-sm font-medium text-[var(--fg-2)]">
          {o('details.open')}
        </summary>

        <div className="mt-4 flex flex-col gap-4">
          <div className={overviewCard}>
            <div className="mb-4 flex items-center gap-2">
              <p className={sectionTitle}>{o('details.businessFunnel', { days: period })}</p>
              <InfoDot>
                Seules les requêtes sur les endpoints facturables (IBAN / BIC / CH clearing) avec la bonne méthode
                HTTP. Le bruit (scanner, robots, discovery) est exclu, ainsi que les clés internes — le funnel ne
                mesure que la demande réelle du marché.
                <br />
                <br />
                <strong>Différence avec « Requêtes HTTP »</strong> : ce graphe-ci = la DEMANDE (qui utilise le
                produit) ; l&apos;autre = l&apos;ATTENTION (tout ce qui touche le serveur, bruit compris).
                <br />
                <br />
                <strong className="text-[var(--ok)]">Paid success</strong> = l’agent a payé (x402) ou utilisé sa clé
                et reçu 2xx.
                <br />
                <strong className="text-amber-400">Paywall hit</strong> = agent intéressé mais sans auth → 402.
                <br />
                <strong className="text-violet-400">Auth / quota</strong> = 401 (mauvaise clé) ou 429 (quota atteint).
                <br />
                <strong className="text-yellow-400">Bad input</strong> = 400 (body mal formé).
                <br />
                <strong className="text-red-400">Server error</strong> = 5xx, doit rester à zéro.
              </InfoDot>
            </div>
            {!funnelRes.ok ? (
              <FetchFailed name={o('details.businessFunnel', { days: period })} status={funnelRes.status} />
            ) : (
              <BusinessFunnelChart
                data={funnelRes.data?.rows ?? []}
                markers={markers}
                cohortByDate={cohortByDate}
              />
            )}
          </div>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            <div className={overviewCard}>
              <div className="mb-4 flex items-center gap-2">
                <p className={sectionTitle}>{o('details.httpRequests', { days: period })}</p>
                <InfoDot>
                  <strong>Tout ce qui frappe à la porte du serveur</strong> : vraies validations, mais aussi robots,
                  scanners, handshakes MCP, pages de découverte, 404. C&apos;est un thermomètre d&apos;ATTENTION, pas
                  de business — un pic ici sans pic dans le funnel de conversion = du bruit machine.
                  <br />
                  <br />
                  <strong className="text-[var(--fg-2)]">Zone grise « Attendu »</strong> = la plage min-max des 8
                  dernières mêmes journées de semaine.
                  <br />
                  <strong className="text-violet-300">Traits pointillés violets</strong> = les événements listés sous
                  le graphe, dédupliqués depuis le 01/09/2026 : une version ne marque plus que le premier jour où
                  elle apparaît.
                </InfoDot>
              </div>
              {!historyRes.ok ? (
                <FetchFailed name={o('details.httpRequests', { days: period })} status={historyRes.status} />
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
                  markers={markers}
                />
              ) : (
                <div className="flex h-64 items-center justify-center text-sm text-[var(--fg-4)]">
                  {t('chart.noHistoryData')}
                </div>
              )}
            </div>

            <div className={overviewCard}>
              <div className="mb-4 flex items-center gap-2">
                <p className={sectionTitle}>
                  {countriesArePeriodScoped ? o('details.topCountries', { days: period }) : o('details.topCountriesAllTime')}
                </p>
                <InfoDot>
                  Déduit du code pays ISO de l’IBAN/BIC validé. « XX » = BIC test/internal.
                  {countriesArePeriodScoped
                    ? ' Filtré sur la période affichée.'
                    : ' Cumulé depuis le début (patterns indisponibles).'}
                </InfoDot>
              </div>
              {topCountries.length > 0 ? (
                <div className="space-y-2.5">
                  {topCountries.map((row, i) => {
                    const pct = maxCountry > 0 ? (row.count / maxCountry) * 100 : 0;
                    const label = t.has(`countries.${row.country}`)
                      ? t(`countries.${row.country}` as Parameters<typeof t>[0])
                      : row.country;
                    return (
                      <div key={row.country} className="flex items-center gap-3">
                        <span className="w-5 text-right font-mono text-xs text-[var(--fg-5)]">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="mb-0.5 flex items-center justify-between">
                            <span className="truncate text-sm text-[var(--fg-1)]">{label}</span>
                            <span className="ml-2 flex-shrink-0 font-mono text-xs text-amber-400">
                              {fmt(row.count)}
                            </span>
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
                <div className="flex h-48 items-center justify-center text-sm text-[var(--fg-4)]">
                  {t('chart.noCountryData')}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {/* ENS-20: the "Pays" column was XX on all ten rows — a whole
                column carrying no information — because country_code is NULL
                exactly when the validation failed. Dropped. */}
            <ErrorTable
              title={o('details.topInvalidIbans')}
              columns={[
                { key: 'prefix', label: 'Préfixe', mono: true },
                { key: 'count', label: 'Nb', mono: true },
                { key: 'error_type', label: 'Type' },
              ]}
              rows={errors?.top_invalid_ibans ?? []}
              emptyMessage={errorsRes.ok ? o('details.noIbanError') : o('details.errorsUnread')}
            />
            <ErrorTable
              title={o('details.topMissingBics')}
              columns={[
                { key: 'bic', label: 'BIC', mono: true },
                { key: 'country', label: 'Pays' },
                { key: 'count', label: 'Nb', mono: true },
              ]}
              rows={errors?.top_missing_bics ?? []}
              emptyMessage={errorsRes.ok ? o('details.noMissingBic') : o('details.errorsUnread')}
            />
          </div>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {!sourcesRes.ok ? (
              <FetchFailed name={o('details.channels')} status={sourcesRes.status} />
            ) : (
              <ChannelsPanel rows={sourcesRes.data?.by_client_kind ?? []} periodDays={period} />
            )}
            <div className={overviewCard}>
              <div className="mb-4 flex items-center gap-2">
                <p className={sectionTitle}>{o('details.statusByPath', { days: period })}</p>
                <InfoDot>
                  Chaque path avec sa répartition 2xx/3xx/4xx/5xx et sa latence. Survole une barre pour le détail par
                  code HTTP. Les endpoints massivement refusés sont aussi nommés en section 3.
                </InfoDot>
              </div>
              {!statusRes.ok ? (
                <FetchFailed name={o('details.statusByPath', { days: period })} status={statusRes.status} />
              ) : (
                <StatusByPathTable rows={(statusRes.data?.rows ?? []).slice(0, 12)} />
              )}
            </div>
          </div>

          {activationRes.data && (
            <AcquisitionPanel
              sources={activationRes.data.sources}
              cohorts={activationRes.data.cohorts}
              locale={locale}
            />
          )}

          {snap && (
            <FunnelPanel
              bySegment={funnelBy(snap.active, BY_SEGMENT)}
              byCampaign={funnelBy(snap.active, BY_CAMPAIGN)}
              byConfidence={funnelBy(snap.active, BY_CONFIDENCE)}
              byCountry={funnelBy(snap.active, BY_COUNTRY)}
            />
          )}

          <Heatmap data={hourlyRes.data?.heatmap ?? []} />

          <CohortStudyPanel data={cohortRes.data} />
        </div>
      </details>
    </OverviewSection>
  );
}

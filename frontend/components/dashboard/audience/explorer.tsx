'use client';

import { useRef, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  ArrowUpRight,
  ChartNoAxesCombined,
  Globe2,
  MousePointer2,
  Route,
  Search,
  Layers,
} from 'lucide-react';
import type { SearchConsole, SignupSources, WebEventsSummary } from '@/lib/dashboard-overview';
import { sliceToPeriod, summariseTrend, type TrafficTrendResult } from '@/lib/traffic-trend';
import {
  audienceDate,
  audienceTab,
  AUDIENCE_TABS,
  googleSummary,
  siteSummary,
  type AudienceFunnel,
  type AudienceTab,
} from '@/lib/dashboard/audience-model';
import { formatGrouped } from '@/lib/format-grouped';
import { TrafficChart } from './charts';
import { IndicatorCard, JourneyPanel } from './journey-panel';
import { GooglePanel } from './google-panel';
import { SitePanel } from './site-panel';
import { Metric, Panel, Unavailable, useActionLabel } from './primitives';
import styles from './audience.module.css';

const ICONS = {
  summary: ChartNoAxesCombined,
  site: MousePointer2,
  journey: Route,
  google: Search,
  details: Layers,
};

export function AudienceExplorer({
  trend,
  web,
  sources,
  google,
  funnel,
  nowIso,
  period,
  children,
}: {
  trend: TrafficTrendResult;
  web: WebEventsSummary | null;
  sources: SignupSources | null;
  google: SearchConsole | null;
  funnel: AudienceFunnel | null;
  nowIso: string;
  period: number;
  children: ReactNode;
}) {
  const t = useTranslations('dashboard.audience'),
    locale = useLocale();
  const actionLabel = useActionLabel();
  const params = useSearchParams(),
    pathname = usePathname(),
    tab = audienceTab(params.get('audience'));
  const nav = useRef<HTMLDivElement>(null);
  const days = trend.ok ? sliceToPeriod(trend.days, period, new Date(nowIso)) : null;
  const traffic = days && summariseTrend(days),
    site = web && siteSummary(web),
    g = google && googleSummary(google);
  const fmt = (v: number) => formatGrouped(v, locale),
    pct = (v: number) => `${formatGrouped(v * 100, locale, 1)} %`;
  const go = (next: AudienceTab, focus = false) => {
    const query = new URLSearchParams(params.toString());
    query.set('audience', next);
    window.history.pushState(null, '', `${pathname}?${query}`);
    if (focus) nav.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
  };
  const first = funnel?.indicators.first_result_24h;
  return (
    <div className={styles.audience} data-audience-version="20260916">
      <div className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>
            <Globe2 size={14} aria-hidden />
            {t('eyebrow')}
          </span>
          <p>{t('lead')}</p>
        </div>
        <div className={styles.periodBadge}>
          {t('days', { count: period })}
          <small>{t('separateWindows')}</small>
        </div>
      </div>
      <div
        className={styles.tabs}
        role="tablist"
        aria-label={t('navigation')}
        ref={nav}
        onKeyDown={(e) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault();
          const index = AUDIENCE_TABS.indexOf(tab);
          const next =
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? AUDIENCE_TABS.length - 1
                : (index + (e.key === 'ArrowRight' ? 1 : -1) + AUDIENCE_TABS.length) %
                  AUDIENCE_TABS.length;
          go(AUDIENCE_TABS[next], true);
        }}
      >
        {AUDIENCE_TABS.map((k) => {
          const Icon = ICONS[k];
          return (
            <button
              key={k}
              id={`audience-tab-${k}`}
              data-tab={k}
              role="tab"
              tabIndex={k === tab ? 0 : -1}
              aria-selected={k === tab}
              aria-controls="audience-panel"
              onClick={() => go(k)}
            >
              <Icon size={16} aria-hidden />
              {t(`tabs.${k}`)}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id="audience-panel"
        aria-labelledby={`audience-tab-${tab}`}
        tabIndex={0}
        className={styles.tabPanel}
      >
        {tab === 'summary' && (
          <div className={styles.stack}>
            <div className={styles.metrics}>
              <Metric
                label={t('requests')}
                value={traffic ? fmt(traffic.total) : '—'}
                note={t('calendarDays', { count: period })}
              />
              <Metric
                label={t('siteClicks')}
                value={site ? fmt(site.clicks) : '—'}
                note={web ? t('rollingDays', { count: web.days }) : t('unavailableShort')}
              />
              <Metric
                label={t('trialIdentities')}
                value={funnel ? fmt(funnel.lineages.admissible) : '—'}
                note={t('trialIdentityShort')}
                accent
              />
              <Metric
                label={t('googleClicks')}
                value={g ? fmt(g.clicks) : '—'}
                note={g ? t('completeWeeks', { count: g.weeks.length }) : t('unavailableShort')}
              />
            </div>
            <section className={styles.takeaways} aria-labelledby="audience-takeaways">
              <h2 id="audience-takeaways">{t('takeaways')}</h2>
              <div className={styles.threeColumns}>
                <button className={styles.insight} onClick={() => go('site', true)}>
                  <span>
                    {t('interest')}
                    <ArrowUpRight size={17} aria-hidden />
                  </span>
                  <strong>{site?.actions[0] ? actionLabel(site.actions[0].label) : '—'}</strong>
                  <p>
                    {site?.actions[0]
                      ? t('topAction', {
                          count: fmt(site.actions[0].value),
                          total: fmt(site.clicks),
                        })
                      : t(site ? 'empty' : 'unavailableShort')}
                  </p>
                </button>
                <button className={styles.insight} onClick={() => go('journey', true)}>
                  <span>
                    {t('firstSuccess')}
                    <ArrowUpRight size={17} aria-hidden />
                  </span>
                  <strong>{first?.value != null ? pct(first.value) : '—'}</strong>
                  <p>
                    {first
                      ? first.value === null
                        ? t('notMeasurable')
                        : t('sample', { n: fmt(first.numerator), d: fmt(first.denominator) })
                      : t('unavailableShort')}
                  </p>
                  {first && <small>{t('pending', { count: first.pending })}</small>}
                </button>
                <div
                  className={styles.insight}
                  data-warning={
                    (traffic && traffic.total > 0 && traffic.notFound / traffic.total >= 0.3) ||
                    undefined
                  }
                >
                  <span>{t('watchTraffic')}</span>
                  <strong>
                    {traffic && traffic.total > 0 ? pct(traffic.notFound / traffic.total) : '—'}
                  </strong>
                  <p>
                    {traffic
                      ? t('notFoundShare', { count: fmt(traffic.notFound) })
                      : t('unavailableShort')}
                  </p>
                </div>
              </div>
            </section>
            {days ? (
              <TrafficChart days={days} today={nowIso.slice(0, 10)} />
            ) : (
              <Panel title={t('trafficTitle')}>
                <Unavailable />
              </Panel>
            )}
            <Panel
              title={t('trialPreview')}
              note={t('maturityNote')}
              action={
                <button className={styles.textButton} onClick={() => go('journey', true)}>
                  {t('exploreJourney')} <ArrowUpRight size={15} aria-hidden />
                </button>
              }
            >
              {funnel ? (
                <div className={styles.threeColumns}>
                  {(
                    ['first_result_24h', 'return_week_2', 'attributable_purchase_30d'] as const
                  ).map((k) => (
                    <IndicatorCard key={k} name={k} indicator={funnel.indicators[k]} compact />
                  ))}
                </div>
              ) : (
                <Unavailable />
              )}
            </Panel>
            <Panel
              title={t('googlePreview')}
              note={t('googleNote')}
              action={
                <button className={styles.textButton} onClick={() => go('google', true)}>
                  {t('exploreGoogle')} <ArrowUpRight size={15} aria-hidden />
                </button>
              }
            >
              {g && google ? (
                <>
                  <div className={styles.threeColumns}>
                    <Metric
                      label={t('impressions')}
                      value={fmt(g.impressions)}
                      note={t('completeWeeks', { count: g.weeks.length })}
                    />
                    <Metric
                      label={t('ctr')}
                      value={g.ctr === null ? '—' : pct(g.ctr)}
                      note={t('ctrNote')}
                    />
                    <Metric
                      label={t('weeklyChange')}
                      value={g.delta === null ? '—' : `${g.delta > 0 ? '+' : ''}${pct(g.delta)}`}
                      note={t('completeWeekComparison')}
                    />
                  </div>
                  <p className={google.stale ? styles.notice : styles.caption}>
                    {t(google.stale ? 'googleStale' : 'googleFresh', {
                      date: audienceDate(google.fetched_at),
                    })}
                  </p>
                </>
              ) : (
                <Unavailable />
              )}
            </Panel>
            <p className={styles.caption}>{t('overallLimits')}</p>
          </div>
        )}
        {tab === 'site' && <SitePanel web={web} sources={sources} />}
        {tab === 'journey' && <JourneyPanel funnel={funnel} />}
        {tab === 'google' && <GooglePanel google={google} />}
        {tab === 'details' && (
          <div className={styles.stack}>
            <div className={styles.sectionIntro}>
              <h2>{t('detailsTitle')}</h2>
              <p>{t('detailsNote')}</p>
            </div>
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

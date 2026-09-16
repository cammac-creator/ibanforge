'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { SignupSources, WebEventsSummary } from '@/lib/dashboard-overview';
import { rank, siteSummary } from '@/lib/dashboard/audience-model';
import { formatGrouped } from '@/lib/format-grouped';
import { Metric, Panel, RankingList, Unavailable, useActionLabel } from './primitives';
import styles from './audience.module.css';

export function SitePanel({
  web,
  sources,
}: {
  web: WebEventsSummary | null;
  sources: SignupSources | null;
}) {
  const t = useTranslations('dashboard.audience'),
    locale = useLocale();
  const actionLabel = useActionLabel();
  const site = web && siteSummary(web);
  return (
    <div className={styles.stack}>
      <div className={styles.sectionIntro}>
        <h2>{t('siteTitle')}</h2>
        <p>{t('siteNote')}</p>
      </div>
      <div className={styles.twoColumns}>
        <Metric
          label={t('siteClicks')}
          value={site ? formatGrouped(site.clicks, locale) : '—'}
          note={web ? t('rollingDays', { count: web.days }) : t('unavailableShort')}
          accent
        />
        <Metric
          label={t('keysCreated')}
          value={sources ? formatGrouped(sources.total, locale) : '—'}
          note={sources ? t('keysNote', { count: sources.period_days }) : t('unavailableShort')}
        />
      </div>
      {site && web ? (
        <>
          <div className={styles.twoColumns}>
            <RankingList
              title={t('actions')}
              rows={site.actions.map((r) => ({ ...r, label: actionLabel(r.label) }))}
              unit={t('clicks')}
              note={t('actionsNote')}
            />
            <RankingList
              title={t('activePages')}
              rows={site.pages}
              unit={t('interactions')}
              note={t('pagesNote')}
            />
          </div>
          <div className={styles.twoColumns}>
            <RankingList
              title={t('languages')}
              rows={site.locales}
              unit={t('interactions')}
              note={t('languagesNote')}
            />
            <RankingList
              title={t('film')}
              rows={site.films}
              unit={t('events')}
              note={t('filmNote')}
            />
          </div>
        </>
      ) : (
        <Unavailable />
      )}
      {sources ? (
        <>
          <div className={styles.twoColumns}>
            <RankingList
              title={t('sources')}
              unit={t('keys')}
              note={t('sourcesNote')}
              rows={rank(sources.channels.map((r) => ({ label: r.channel, value: r.n })))}
            />
            <RankingList
              title={t('landingSources')}
              unit={t('keys')}
              note={t('landingSourcesNote')}
              rows={rank(sources.landings.map((r) => ({ label: r.path, value: r.n })))}
            />
          </div>
          <div className={styles.twoColumns}>
            <RankingList
              title={t('referrers')}
              unit={t('keys')}
              rows={rank(sources.referrers.map((r) => ({ label: r.host, value: r.n })))}
            />
            <RankingList
              title={t('campaigns')}
              unit={t('keys')}
              note={t('campaignsNote')}
              rows={rank(
                sources.campaigns.map((r) => ({
                  label: [r.utm_source, r.utm_medium, r.utm_campaign].filter(Boolean).join(' / '),
                  value: r.n,
                })),
              )}
            />
          </div>
        </>
      ) : (
        <Unavailable />
      )}
      <Panel title={t('limitsTitle')}>
        <p className={styles.bodyText}>{t('siteLimits')}</p>
      </Panel>
    </div>
  );
}

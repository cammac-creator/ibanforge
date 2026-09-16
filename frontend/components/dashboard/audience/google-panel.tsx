'use client';

import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { SearchConsole, SearchConsoleRow } from '@/lib/dashboard-overview';
import { audienceDate, googleSummary } from '@/lib/dashboard/audience-model';
import { formatGrouped } from '@/lib/format-grouped';
import { GoogleChart } from './charts';
import { Metric, Panel, Unavailable } from './primitives';
import styles from './audience.module.css';

function SearchTable({ rows, title }: { rows: SearchConsoleRow[]; title: string }) {
  const t = useTranslations('dashboard.audience'),
    locale = useLocale(),
    id = useId();
  const [search, setSearch] = useState(''),
    [expanded, setExpanded] = useState(false),
    [sort, setSort] = useState<'clicks' | 'impressions'>('clicks');
  const filtered = rows
    .filter((r) => r.key.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => b[sort] - a[sort]);
  const visible = search.trim() || expanded ? filtered : filtered.slice(0, 8);
  return (
    <Panel title={title} note={t('googleRowsNote')}>
      <div className={styles.tableTools}>
        <label htmlFor={id} className={styles.search}>
          <span className="sr-only">{t('searchIn', { title })}</span>
          <input
            id={id}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search')}
          />
        </label>
        <label className={styles.sortLabel}>
          {t('sortBy')}
          <select
            aria-label={t('sortBy')}
            value={sort}
            onChange={(e) => setSort(e.target.value as 'clicks' | 'impressions')}
          >
            <option value="clicks">{t('clicks')}</option>
            <option value="impressions">{t('impressions')}</option>
          </select>
        </label>
      </div>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={title}>
        <table className={styles.searchTable}>
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th>{title}</th>
              <th>{t('clicks')}</th>
              <th>{t('impressions')}</th>
              <th>CTR</th>
              <th>{t('position')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.key}>
                <th>{r.key}</th>
                <td>
                  <strong>{formatGrouped(r.clicks, locale)}</strong>
                </td>
                <td>{formatGrouped(r.impressions, locale)}</td>
                <td>
                  {r.impressions
                    ? `${formatGrouped((r.clicks / r.impressions) * 100, locale, 1)} %`
                    : '—'}
                </td>
                <td>{r.position === null ? '—' : formatGrouped(r.position, locale, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && <p className={styles.empty}>{t(search ? 'noResults' : 'empty')}</p>}
      {rows.length > 8 && !search.trim() && (
        <button
          className={styles.textButton}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? t('less') : t('all', { count: rows.length })}
        </button>
      )}
    </Panel>
  );
}

export function GooglePanel({ google }: { google: SearchConsole | null }) {
  const t = useTranslations('dashboard.audience'),
    locale = useLocale();
  if (!google) return <Unavailable />;
  const g = googleSummary(google),
    fmt = (v: number) => formatGrouped(v, locale);
  return (
    <div className={styles.stack}>
      <div className={styles.sectionIntro}>
        <h2>{t('googleTitle')}</h2>
        <p>
          {t('googleNote')} {t('googleThrough', { date: audienceDate(google.window_end) })}
        </p>
      </div>
      <p className={google.stale ? styles.notice : styles.caption}>
        {t(google.stale ? 'googleStale' : 'googleFresh', { date: audienceDate(google.fetched_at) })}
      </p>
      <div className={styles.threeColumns}>
        <Metric
          label={t('googleClicks')}
          value={fmt(g.clicks)}
          note={t('completeWeeks', { count: g.weeks.length })}
          accent
        />
        <Metric label={t('impressions')} value={fmt(g.impressions)} note={t('impressionsNote')} />
        <Metric
          label={t('ctr')}
          value={g.ctr === null ? '—' : `${formatGrouped(g.ctr * 100, locale, 1)} %`}
          note={t('ctrNote')}
        />
      </div>
      <Panel
        title={t('googleEvolution')}
        note={
          g.delta === null
            ? t('noComparison')
            : t('googleDelta', {
                value: `${g.delta > 0 ? '+' : ''}${formatGrouped(g.delta * 100, locale, 1)} %`,
              })
        }
      >
        <GoogleChart weeks={g.weeks} />
        <details className={styles.disclosure}>
          <summary>{t('weeklyData')}</summary>
          <div
            className={styles.tableScroll}
            tabIndex={0}
            role="region"
            aria-label={t('weeklyData')}
          >
            <table>
              <thead>
                <tr>
                  <th>{t('week')}</th>
                  <th>{t('clicks')}</th>
                  <th>{t('impressions')}</th>
                  <th>CTR</th>
                  <th>{t('position')}</th>
                </tr>
              </thead>
              <tbody>
                {g.weeks.map((w) => (
                  <tr key={w.start}>
                    <th>
                      {audienceDate(w.start)} → {audienceDate(w.end)}
                    </th>
                    <td>{fmt(w.clicks)}</td>
                    <td>{fmt(w.impressions)}</td>
                    <td>
                      {w.impressions
                        ? `${formatGrouped((w.clicks / w.impressions) * 100, locale, 1)} %`
                        : '—'}
                    </td>
                    <td>{w.position === null ? '—' : formatGrouped(w.position, locale, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Panel>
      <p className={styles.caption}>
        {t('topWindow', {
          from: audienceDate(google.top_window.start),
          to: audienceDate(google.top_window.end),
        })}
      </p>
      <SearchTable title={t('queries')} rows={google.queries} />
      <SearchTable title={t('googlePages')} rows={google.pages} />
      <Panel title={t('indexing')} note={t('indexingNote')}>
        <div className={styles.indexList}>
          {google.inspections.map((r) => (
            <div key={r.path}>
              <span className={styles.state} data-state={r.state}>
                {t(`indexState.${r.state}`)}
              </span>
              <strong>{r.path}</strong>
              <p>{r.coverage || r.error || '—'}</p>
              <small>{t('lastCrawl', { date: audienceDate(r.last_crawled) })}</small>
            </div>
          ))}
        </div>
        {!google.inspections.length && <p className={styles.empty}>{t('empty')}</p>}
        <details className={styles.disclosure}>
          <summary>{t('sitemaps')}</summary>
          <div className={styles.indexList}>
            {google.sitemaps.map((r) => (
              <div key={r.path}>
                <strong>{r.path}</strong>
                <p>
                  {t('sitemapCounts', {
                    submitted: fmt(r.submitted),
                    indexed: r.indexed === null ? '—' : fmt(r.indexed),
                    errors: fmt(r.errors),
                    warnings: fmt(r.warnings),
                  })}
                </p>
                <small>
                  {t('sitemapDates', {
                    submitted: audienceDate(r.last_submitted),
                    downloaded: audienceDate(r.last_downloaded),
                  })}{' '}
                  {r.is_pending ? t('sitemapPending') : ''}
                </small>
              </div>
            ))}
          </div>
          {!google.sitemaps.length && <p className={styles.empty}>{t('empty')}</p>}
        </details>
      </Panel>
    </div>
  );
}

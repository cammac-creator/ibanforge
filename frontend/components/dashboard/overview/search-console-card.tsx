import { getTranslations } from 'next-intl/server';
import type { IndexState, SearchConsole } from '@/lib/dashboard-overview';
import { FetchFailed, type Fetched } from './fetching';
import { overviewCard } from './section';

/**
 * What Google sends the site, every Monday.
 *
 * Search Console had been verified since August and never read: the first
 * reading, taken by hand on 06/09/2026, said three to five clicks a week — the
 * answer to "where do the signups come from" was "not from Google", and it
 * took two throwaway scripts to learn it. This card is that reading made
 * permanent (GET /v1/admin/search-console, refreshed every six hours).
 *
 * Four complete weeks rather than a rolling 28 days, because the question is
 * "did last week move" and a half-collected week always looks like a collapse.
 * Search Console lags two to three days, so the window stops at J-3 and the
 * card says so rather than letting the reader assume it is up to this morning.
 *
 * Three states with three different messages. "GSC_SA_JSON is not set here" is
 * a deployment fact and not an incident; "Google refused" still shows the last
 * reading, marked as old; a reader that never landed is the only one that gets
 * the red block. Collapsing those into one grey box is how an evening goes
 * looking for the wrong problem.
 */
export async function SearchConsoleCard({
  consolePromise,
  locale,
}: {
  consolePromise: Promise<Fetched<SearchConsole>>;
  locale: string;
}) {
  const t = await getTranslations('dashboard.overview');
  const res = await consolePromise;
  const data = res.data;

  const day = (value: string | null): string | null =>
    value ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null;
  const stamp = (value: string): string =>
    new Date(`${value.replace(' ', 'T')}Z`).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
  const num = (value: number | null, suffix = ''): string => (value === null ? '—' : `${value}${suffix}`);

  // Written out rather than built in a template literal: the key test
  // (frontend/lib/dashboard-overview.test.ts) enumerates the literals handed to
  // a translator, and a key assembled from a variable is one no regex can see.
  const stateLabel: Record<IndexState, string> = {
    indexed: t('searchConsole.state.indexed'),
    'not-indexed': t('searchConsole.state.notIndexed'),
    unknown: t('searchConsole.state.unknown'),
  };
  const stateColour: Record<IndexState, string> = {
    indexed: 'text-emerald-400',
    'not-indexed': 'text-amber-400',
    unknown: 'text-[var(--fg-5)]',
  };

  const rows = (list: SearchConsole['queries']) => (
    <ul className="flex flex-col gap-0.5">
      {list.map((r) => (
        <li key={r.key} className="flex items-baseline gap-2 text-[12px]">
          <span className="min-w-0 flex-1 truncate text-[var(--fg-2)]" title={r.key}>
            {r.key}
          </span>
          <span className="w-8 shrink-0 text-right font-mono tabular-nums text-[var(--fg-1)]">{r.clicks}</span>
          <span className="w-12 shrink-0 text-right font-mono tabular-nums text-[var(--fg-4)]">{r.impressions}</span>
          <span className="w-10 shrink-0 text-right font-mono tabular-nums text-[var(--fg-5)]">{num(r.position)}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className={overviewCard}>
      <p className="mb-1 text-sm font-medium text-[var(--fg-2)]">{t('searchConsole.title')}</p>
      <p className="mb-3 text-[12px] text-[var(--fg-5)]">{t('searchConsole.lead')}</p>

      {/* 503: the variable is absent from this environment. Every laptop is
          here, and it is not something to go and debug. */}
      {res.status === 503 ? (
        <p className="text-[12px] text-[var(--fg-5)]">{t('searchConsole.notConfigured')}</p>
      ) : !data ? (
        <FetchFailed name={t('searchConsole.title')} status={res.status} />
      ) : (
        <>
          {data.stale && (
            <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[12px] text-amber-300">
              {t('searchConsole.stale', { status: data.upstream_status ?? 0 })}
            </p>
          )}

          <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-[var(--fg-5)]">
            <span className="min-w-0 flex-1">{t('searchConsole.week')}</span>
            <span className="w-8 shrink-0 text-right">{t('searchConsole.clicks')}</span>
            <span className="w-12 shrink-0 text-right">{t('searchConsole.impressions')}</span>
            <span className="w-12 shrink-0 text-right">{t('searchConsole.ctr')}</span>
            <span className="w-10 shrink-0 text-right">{t('searchConsole.position')}</span>
          </div>
          <ul className="flex flex-col gap-1">
            {data.weeks.map((w) => (
              <li key={w.start} className="flex items-center gap-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-[var(--fg-1)]">
                  {day(w.start)} – {day(w.end)}
                </span>
                <span className="w-8 shrink-0 text-right font-mono tabular-nums text-[var(--fg-1)]">{w.clicks}</span>
                <span className="w-12 shrink-0 text-right font-mono tabular-nums text-[var(--fg-2)]">{w.impressions}</span>
                {/* Null, not zero: a week Google sent nothing for has no rate
                    and no rank, and "position 0" claims better than first. */}
                <span className="w-12 shrink-0 text-right font-mono tabular-nums text-[var(--fg-4)]">{num(w.ctr, ' %')}</span>
                <span className="w-10 shrink-0 text-right font-mono tabular-nums text-[var(--fg-4)]">{num(w.position)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-3 grid grid-cols-1 gap-3 border-t border-[var(--ink-4)]/60 pt-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-[var(--fg-5)]">{t('searchConsole.queries')}</p>
              {data.queries.length === 0 ? (
                <p className="text-[12px] text-[var(--fg-5)]">{t('searchConsole.noQueries')}</p>
              ) : (
                rows(data.queries)
              )}
            </div>
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-[var(--fg-5)]">{t('searchConsole.pages')}</p>
              {data.pages.length === 0 ? (
                <p className="text-[12px] text-[var(--fg-5)]">{t('searchConsole.noPages')}</p>
              ) : (
                rows(data.pages)
              )}
            </div>
          </div>

          <div className="mt-3 border-t border-[var(--ink-4)]/60 pt-3">
            <p className="mb-1 text-[11px] uppercase tracking-wide text-[var(--fg-5)]">{t('searchConsole.sitemap')}</p>
            {data.sitemaps.length === 0 ? (
              <p className="text-[12px] text-[var(--fg-5)]">{t('searchConsole.noSitemap')}</p>
            ) : (
              <ul className="flex flex-col gap-0.5 text-[12px] text-[var(--fg-3)]">
                {data.sitemaps.map((s) => (
                  <li key={s.path}>
                    {t('searchConsole.sitemapLine', {
                      submitted: s.submitted,
                      indexed: s.indexed,
                      date: day(s.last_downloaded) ?? t('searchConsole.never'),
                    })}
                    {s.errors > 0 || s.warnings > 0
                      ? ` · ${t('searchConsole.sitemapIssues', { errors: s.errors, warnings: s.warnings })}`
                      : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Eight fixed URLs, one per family. Inspection is quota'd at 2 000 a
              day, so the list stays short on purpose — enough to notice that a
              whole family has fallen out of the index. */}
          <div className="mt-3 border-t border-[var(--ink-4)]/60 pt-3">
            <p className="mb-1 text-[11px] uppercase tracking-wide text-[var(--fg-5)]">{t('searchConsole.witnesses')}</p>
            <ul className="flex flex-col gap-0.5">
              {data.inspections.map((i) => (
                <li key={i.path} className="flex items-baseline gap-2 text-[12px]">
                  <span className="min-w-0 flex-1 truncate font-mono text-[var(--fg-2)]" title={i.coverage ?? undefined}>
                    {i.path}
                  </span>
                  <span className={`shrink-0 ${stateColour[i.state]}`}>
                    {i.error ? t('searchConsole.inspectionFailed') : stateLabel[i.state]}
                  </span>
                  <span className="w-16 shrink-0 text-right text-[var(--fg-5)]">
                    {day(i.last_crawled) ?? '—'}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-3 text-[11px] text-[var(--fg-5)]">
            {t('searchConsole.read', { end: day(data.window_end) ?? data.window_end, at: stamp(data.fetched_at) })}
          </p>
        </>
      )}
    </div>
  );
}

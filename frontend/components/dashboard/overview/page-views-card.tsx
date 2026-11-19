import { getTranslations } from 'next-intl/server';
import type { WebEventsSummary } from '@/lib/dashboard-overview';
import { FetchFailed, type Fetched } from './fetching';
import { overviewCard } from './section';

/**
 * Page views of the public site, by page template, over 7 and 30 days.
 *
 * Read from the `page_views` key of `GET /v1/admin/web-events` (src/lib/page-views.ts in the
 * API): one page, one day, one number, filed under a template of a closed list (`/blz/:code`,
 * never a bank code). It counts VIEWS, not people: no cookie and no identifier, so a reader
 * who opens ten pages is ten views. The three pages that matter come first: the API page, the
 * prices, the home; then the others, busiest first.
 *
 * This table is read apart from the click log (`LandingDoorsCard`): the two never cross.
 */
const FIRST = ['/iban-validation-api', '/pricing', '/'];
/** How many of the other pages the card lists. */
const OTHERS = 12;

function totals(data: WebEventsSummary | null): Map<string, number> {
  return new Map((data?.page_views?.by_page ?? []).map((r) => [r.page, r.count]));
}

export async function PageViewsCard({
  weekPromise,
  monthPromise,
}: {
  weekPromise: Promise<Fetched<WebEventsSummary>>;
  monthPromise: Promise<Fetched<WebEventsSummary>>;
}) {
  const t = await getTranslations('dashboard.overview');
  const [week, month] = await Promise.all([weekPromise, monthPromise]);
  const w = totals(week.data);
  const m = totals(month.data);
  const others = [...m.entries()]
    .filter(([page]) => !FIRST.includes(page))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, OTHERS)
    .map(([page]) => page);
  const rows = [...FIRST, ...others].map((page) => ({ page, week: w.get(page) ?? 0, month: m.get(page) ?? 0 }));
  const max = Math.max(1, ...rows.map((r) => r.month));
  const totalWeek = week.data?.page_views?.total ?? 0;
  const totalMonth = month.data?.page_views?.total ?? 0;

  return (
    <div className={overviewCard}>
      <p className="mb-1 text-sm font-medium text-[var(--fg-2)]">{t('fresh.pageViews.title')}</p>
      <p className="mb-3 text-[12px] text-[var(--fg-5)]">{t('fresh.pageViews.lead')}</p>
      {!month.ok || !month.data ? (
        <FetchFailed name={t('fresh.pageViews.title')} status={month.status} />
      ) : !month.data.page_views || totalMonth === 0 ? (
        <p className="text-[12px] text-[var(--fg-5)]">{t('fresh.pageViews.empty')}</p>
      ) : (
        <>
          <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-[var(--fg-5)]">
            <span className="min-w-0 flex-1">{t('fresh.pageViews.page')}</span>
            <span className="w-12 shrink-0 text-right">{t('fresh.doors.col7')}</span>
            <span className="w-12 shrink-0 text-right">{t('fresh.doors.col30')}</span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {rows.map((r) => (
              <li key={r.page} className="flex items-center gap-2 text-[13px]">
                <span className="w-40 shrink-0 truncate font-mono text-[12px] text-[var(--fg-1)] sm:w-56" title={r.page}>
                  {r.page}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="block h-2 rounded-sm bg-[var(--amber-500)]/70"
                    style={{ width: `${r.month === 0 ? 0 : Math.max(4, Math.round((r.month / max) * 100))}%` }}
                    aria-hidden="true"
                  />
                </span>
                <span className={`w-12 shrink-0 text-right font-mono text-[12px] tabular-nums ${week.ok ? 'text-[var(--fg-2)]' : 'text-[var(--fg-5)]'}`}>
                  {week.ok ? r.week : '—'}
                </span>
                <span className="w-12 shrink-0 text-right font-mono text-[12px] tabular-nums text-[var(--fg-2)]">{r.month}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-[var(--fg-3)]">
            {t('fresh.pageViews.total', { week: week.ok ? totalWeek : 0, month: totalMonth })}
          </p>
          <p className="mt-1 text-[11px] text-[var(--fg-5)]">{t('fresh.pageViews.note')}</p>
        </>
      )}
    </div>
  );
}

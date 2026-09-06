import { getTranslations } from 'next-intl/server';
import type { WebEventsSummary } from '@/lib/dashboard-overview';
import { FetchFailed, type Fetched } from './fetching';
import { overviewCard } from './section';

/**
 * Which doors the landing page's visitors take.
 *
 * Audit n° 32 of 2026-09-05 put a beacon on every call to action of the home
 * page and two marks on the film; this card is where the counts are read.
 * The week says whether anything moved, the month says which door people
 * prefer. Both reads come from the same table (src/lib/web-events.ts in the
 * API): no cookie, no identifier, ninety days of retention.
 *
 * Nearly every line of the first day of measurement came from our own checks
 * in driven browsers; those and Lighthouse have been silent since 2026-09-06,
 * and the rows of that day were removed.
 */
const DOOR_ORDER = [
  'nav:key',
  'nav:status',
  'cta:try',
  'cta:key',
  'cta:audit-fold',
  'cta:rules',
  'cta:audit-deadline',
  'cta:audit',
  'cta:playground-film',
  'cta:pricing',
  'cta:key-final',
  'cta:docs',
  'cta:key-account',
  'cta:key-tool',
];

function counts(data: WebEventsSummary | null): Map<string, number> {
  return new Map((data?.by_name ?? []).map((r) => [r.name, r.count]));
}

export async function LandingDoorsCard({
  weekPromise,
  monthPromise,
  locale,
}: {
  weekPromise: Promise<Fetched<WebEventsSummary>>;
  monthPromise: Promise<Fetched<WebEventsSummary>>;
  locale: string;
}) {
  const t = await getTranslations('dashboard.overview');
  const [week, month] = await Promise.all([weekPromise, monthPromise]);
  const w = counts(week.data);
  const m = counts(month.data);
  // Every door the page declares, then whatever else the month has seen.
  const names = [...DOOR_ORDER, ...(month.data?.by_name ?? []).map((r) => r.name).filter((n) => !DOOR_ORDER.includes(n) && !n.startsWith('film:'))];
  const rows = names.map((name) => ({ name, week: w.get(name) ?? 0, month: m.get(name) ?? 0 }));
  const max = Math.max(1, ...rows.map((r) => r.month));
  const label = (name: string): string => {
    const key = name.replace(/[^a-z0-9]/g, '_');
    return t.has(`fresh.doors.names.${key}`) ? t(`fresh.doors.names.${key}`) : name;
  };
  const clicks = (data: WebEventsSummary | null) => (data?.by_name ?? []).filter((r) => !r.name.startsWith('film:')).reduce((n, r) => n + r.count, 0);
  const since = month.data?.since
    ? new Date(`${month.data.since.replace(' ', 'T')}Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long' })
    : null;
  const pages = (month.data?.by_page ?? []).slice(0, 4);
  const referrers = (month.data?.by_referrer ?? []).filter((r) => !r.referrer.endsWith('ibanforge.com')).slice(0, 4);

  return (
    <div className={overviewCard}>
      <p className="mb-1 text-sm font-medium text-[var(--fg-2)]">{t('fresh.doors.title')}</p>
      <p className="mb-3 text-[12px] text-[var(--fg-5)]">{t('fresh.doors.lead')}</p>
      {!month.ok || !month.data ? (
        <FetchFailed name={t('fresh.doors.title')} status={month.status} />
      ) : month.data.total === 0 ? (
        <p className="text-[12px] text-[var(--fg-5)]">{t('fresh.doors.empty')}</p>
      ) : (
        <>
          <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-[var(--fg-5)]">
            <span className="min-w-0 flex-1">{t('fresh.doors.door')}</span>
            <span className="w-10 shrink-0 text-right">{t('fresh.doors.col7')}</span>
            <span className="w-10 shrink-0 text-right">{t('fresh.doors.col30')}</span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {rows.map((r) => (
              <li key={r.name} className="flex items-center gap-2 text-[13px]">
                <span className="w-40 shrink-0 truncate text-[var(--fg-1)] sm:w-56" title={r.name}>
                  {label(r.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="block h-2 rounded-sm bg-[var(--amber-500)]/70"
                    style={{ width: `${r.month === 0 ? 0 : Math.max(4, Math.round((r.month / max) * 100))}%` }}
                    aria-hidden="true"
                  />
                </span>
                <span className={`w-10 shrink-0 text-right font-mono text-[12px] tabular-nums ${week.ok ? 'text-[var(--fg-2)]' : 'text-[var(--fg-5)]'}`}>
                  {week.ok ? r.week : '—'}
                </span>
                <span className="w-10 shrink-0 text-right font-mono text-[12px] tabular-nums text-[var(--fg-2)]">{r.month}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-[var(--fg-3)]">
            {t('fresh.doors.film', { start: m.get('film:start') ?? 0, end: m.get('film:end') ?? 0 })}
            {' · '}
            {t('fresh.doors.clicks', { week: week.ok ? clicks(week.data) : 0, month: clicks(month.data) })}
          </p>
          {pages.length > 0 && (
            <p className="mt-1 text-[11px] text-[var(--fg-5)]">
              {t('fresh.doors.pages')}: {pages.map((p) => `${p.page} (${p.count})`).join(' · ')}
            </p>
          )}
          {referrers.length > 0 && (
            <p className="mt-1 text-[11px] text-[var(--fg-5)]">
              {t('fresh.doors.referrers')}: {referrers.map((r) => `${r.referrer} (${r.count})`).join(' · ')}
            </p>
          )}
        </>
      )}
      {since && <p className="mt-1 text-[11px] text-[var(--fg-5)]">{t('fresh.doors.since', { date: since })}</p>}
    </div>
  );
}

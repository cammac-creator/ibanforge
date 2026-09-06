import { getTranslations } from 'next-intl/server';
import type { SignupSources, WebEventsSummary } from '@/lib/dashboard-overview';
import { trialFunnel, SERVER_EVENT_PAGE } from '@/lib/dashboard-overview';
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
  signupsWeekPromise,
  signupsMonthPromise,
  locale,
}: {
  weekPromise: Promise<Fetched<WebEventsSummary>>;
  monthPromise: Promise<Fetched<WebEventsSummary>>;
  /** Signup channels over the same two windows: the trial's conversion is a key, not a click. */
  signupsWeekPromise: Promise<Fetched<SignupSources>>;
  signupsMonthPromise: Promise<Fetched<SignupSources>>;
  locale: string;
}) {
  const t = await getTranslations('dashboard.overview');
  const [week, month, signupsWeek, signupsMonth] = await Promise.all([
    weekPromise,
    monthPromise,
    signupsWeekPromise,
    signupsMonthPromise,
  ]);
  const trialWeek = trialFunnel(week.data, signupsWeek.data);
  const trialMonth = trialFunnel(month.data, signupsMonth.data);
  const w = counts(week.data);
  const m = counts(month.data);
  // Every door the page declares, then whatever else the month has seen.
  // `api:` rows are written by the API, not clicked on the page: they are the
  // keyless trial (src/middleware/anonymous-trial.ts) and they get their own
  // group below. Left in this list they would show as unlabelled doors and, in
  // `clicks()`, inflate a figure that means "clicks on the home page".
  const names = [...DOOR_ORDER, ...(month.data?.by_name ?? []).map((r) => r.name).filter((n) => !DOOR_ORDER.includes(n) && !n.startsWith('film:') && !n.startsWith('api:'))];
  const rows = names.map((name) => ({ name, week: w.get(name) ?? 0, month: m.get(name) ?? 0 }));
  const max = Math.max(1, ...rows.map((r) => r.month));
  const label = (name: string): string => {
    const key = name.replace(/[^a-z0-9]/g, '_');
    return t.has(`fresh.doors.names.${key}`) ? t(`fresh.doors.names.${key}`) : name;
  };
  const clicks = (data: WebEventsSummary | null) => (data?.by_name ?? []).filter((r) => !r.name.startsWith('film:') && !r.name.startsWith('api:')).reduce((n, r) => n + r.count, 0);
  const since = month.data?.since
    ? new Date(`${month.data.since.replace(' ', 'T')}Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long' })
    : null;
  // Same exclusion on the by-page list: the server rows carry a sentinel path
  // that nobody navigated to, and `by_page` groups by path so no name filter
  // reaches it.
  const pages = (month.data?.by_page ?? []).filter((p) => p.page !== SERVER_EVENT_PAGE).slice(0, 4);
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

          {/* The API's own door, opened 06/09/2026: ten keyless validations a
              day per address. A row is an address-day, not a call, and the
              conversion is a key born with source=api-trial — the only figure
              here that is money rather than curiosity. */}
          <div className="mt-3 border-t border-[var(--border-1)] pt-3">
            <p className="mb-1 text-[12px] font-medium text-[var(--fg-2)]">{t('fresh.doors.trial.title')}</p>
            <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-[var(--fg-5)]">
              <span className="min-w-0 flex-1">{t('fresh.doors.trial.step')}</span>
              <span className="w-10 shrink-0 text-right">{t('fresh.doors.col7')}</span>
              <span className="w-10 shrink-0 text-right">{t('fresh.doors.col30')}</span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {/* Written out rather than looped over a key template: the parity
                  test (frontend/lib/dashboard-overview.test.ts) enumerates the
                  literals handed to a translator, and a key built in a template
                  literal is one no regex can see. */}
              {[
                { step: 'tried', label: t('fresh.doors.trial.tried'), w7: trialWeek.tried, m30: trialMonth.tried },
                { step: 'exhausted', label: t('fresh.doors.trial.exhausted'), w7: trialWeek.exhausted, m30: trialMonth.exhausted },
                { step: 'keys', label: t('fresh.doors.trial.keys'), w7: trialWeek.keys, m30: trialMonth.keys },
              ].map(({ step, label: stepLabel, w7, m30 }) => (
                <li key={step} className="flex items-center gap-2 text-[13px]">
                  <span className="w-40 shrink-0 truncate text-[var(--fg-1)] sm:w-56">{stepLabel}</span>
                  <span className="min-w-0 flex-1" />
                  <span className={`w-10 shrink-0 text-right font-mono text-[12px] tabular-nums ${week.ok ? 'text-[var(--fg-2)]' : 'text-[var(--fg-5)]'}`}>
                    {week.ok ? w7 : '—'}
                  </span>
                  <span className="w-10 shrink-0 text-right font-mono text-[12px] tabular-nums text-[var(--fg-2)]">{m30}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-[var(--fg-5)]">{t('fresh.doors.trial.note')}</p>
          </div>
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

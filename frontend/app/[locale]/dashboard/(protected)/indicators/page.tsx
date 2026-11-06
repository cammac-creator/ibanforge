import Link from 'next/link';
import { Suspense } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import { requireDashboardSession } from '@/lib/auth';
import { localePath } from '@/lib/locale-path';
import { BUSINESS_COHORTS, businessCohort, businessAccountsHref } from '@/lib/dashboard/business-accounts';
import { BusinessAccountsReading } from '@/components/dashboard/business-accounts-reading';
import { FreshnessBadge } from '@/components/crm/freshness-badge';
import { fetchJSON, notFetched } from '@/components/dashboard/overview/fetching';

export const dynamic = 'force-dynamic';

export default async function IndicatorAccountsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireDashboardSession();
  const [params, locale, t] = await Promise.all([searchParams, getLocale(), getTranslations('dashboard.businessAccounts')]);
  const cohort = businessCohort(params.cohort);
  const rawPage = params.page ?? '1';
  const validPage = typeof rawPage === 'string' && /^[1-9][0-9]{0,5}$/.test(rawPage);
  const nowIso = new Date().toISOString();
  const api = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  const secret = process.env.ADMIN_SECRET;
  const promise = cohort && validPage && secret
    ? fetchJSON<unknown>(`${api}/v1/admin/business-accounts?cohort=${cohort}&page=${rawPage}`, { 'X-Admin-Secret': secret })
    : Promise.resolve(notFetched<unknown>());
  return <div className="mx-auto max-w-6xl space-y-5" data-indicator-accounts-page>
    <Link prefetch={false} className="inline-flex min-h-11 items-center text-sm text-[var(--fg-3)] underline-offset-4 hover:underline" href={localePath(locale, '/dashboard')}>{t('back')}</Link>
    <header className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-4"><div>
        <p className="mb-1 text-xs uppercase tracking-wider text-[var(--fg-3)]">{t('eyebrow')}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--fg-1)] sm:text-3xl">{cohort ? t(`cohort.${cohort}`) : t('title')}</h1>
      </div><FreshnessBadge fetchedAtIso={nowIso} /></div>
    </header>
    <nav className="flex flex-wrap gap-2" aria-label={t('selection')}>
      {BUSINESS_COHORTS.map(item => <Link key={item} prefetch={false} aria-current={item === cohort ? 'page' : undefined}
        className={`inline-flex min-h-11 items-center rounded-xl border px-3 py-2 text-sm ${item === cohort ? 'border-[var(--amber-500)] bg-[var(--ink-4)] font-semibold text-[var(--fg-1)]' : 'border-[var(--ink-4)] text-[var(--fg-3)] hover:bg-[var(--ink-4)]'}`}
        href={businessAccountsHref(locale, item)}>{t(`cohort.${item}`)}</Link>)}
    </nav>
    {!cohort || !validPage ? <p role="status" className="rounded-xl border border-[var(--ink-4)] p-5 text-[var(--fg-2)]">{t('invalidSelection')}</p> :
      <Suspense key={`${cohort}:${rawPage}`} fallback={<p role="status" aria-busy="true" className="rounded-xl border border-[var(--ink-4)] p-5 text-[var(--fg-3)]">{t('loading')}</p>}>
        <BusinessAccountsReading promise={promise} cohort={cohort} locale={locale} nowIso={nowIso} />
      </Suspense>}
  </div>;
}

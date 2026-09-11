import { getTranslations } from 'next-intl/server';
import { Activity, CalendarDays, CircleCheck } from 'lucide-react';
import { formatGrouped } from '@/lib/format-grouped';
import { retainedServiceUsage, serviceUsageUtcDay } from '@/lib/dashboard/service-usage';
import { overviewCard } from './section';

/** Lecture serveur du bloc additif : pas de nouvel appel ni de suivi du navigateur. */
export async function ServiceUsageCard({ value, locale }: { value: unknown; locale: string }) {
  const t = await getTranslations({ locale, namespace: 'dashboard.overview' });
  const data = retainedServiceUsage(value);
  return (
    <section className={overviewCard} data-service-usage={data ? 'available' : 'unavailable'}>
      <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--fg-2)]">
        <Activity size={16} className="shrink-0 text-[var(--ok)]" aria-hidden="true" />{t('serviceUsage.title')}
      </h3>
      {!data ? <p className="mt-2 text-sm text-amber-300">{t('serviceUsage.unavailable')}</p> : <>
        <p className="mt-2 text-xs leading-relaxed text-[var(--fg-4)]">{t('serviceUsage.period', {
          days: data.period_days, from: serviceUsageUtcDay(data.window_start),
          to: serviceUsageUtcDay(data.observed_until), at: data.observed_until.slice(11, 16),
        })}</p>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {([
            ['active', data.active_accounts, Activity],
            ['first', data.first_observed_accounts, CircleCheck],
            ['returning', data.returning_accounts, CalendarDays],
          ] as const).map(([key, count, Icon]) => <div key={key} className="rounded-xl border border-[var(--ink-4)]/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-2xl font-semibold text-[var(--ok)]" data-service-count={key}>{formatGrouped(count, locale)}</p>
              <Icon size={20} className="shrink-0 text-[var(--fg-5)]" aria-hidden="true" />
            </div>
            <p className="mt-2 text-xs font-medium text-[var(--fg-2)]">{t(`serviceUsage.${key}`)}</p>
          </div>)}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-[var(--fg-4)]">{t('serviceUsage.subsets')}</p>
        {data.active_accounts === 0 ? <p className="mt-2 text-xs text-[var(--fg-4)]">{t('serviceUsage.empty')}</p> : null}
        <details className="mt-4 border-t border-[var(--ink-4)]/60 pt-3 text-xs">
          <summary className="cursor-pointer font-medium text-[var(--fg-3)]">{t('serviceUsage.method')}</summary>
          <ul className="mt-3 list-disc space-y-2 pl-4 leading-relaxed text-[var(--fg-4)]">
            {(['definition', 'accounts', 'retention', 'days', 'limits'] as const).map((key) => <li key={key}>{t(`serviceUsage.${key}`)}</li>)}
          </ul>
        </details>
      </>}
    </section>
  );
}

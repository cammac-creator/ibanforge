import { getTranslations } from 'next-intl/server';
import type { AuditStats } from '@/lib/dashboard-overview';
import { FetchFailed, type Fetched } from './fetching';
import { overviewCard } from './section';

/** The creditor-file audit as a funnel: files uploaded, paid, CHF. Sales come from a durable ledger. */
export async function AuditStatsCard({ statsPromise, locale }: { statsPromise: Promise<Fetched<AuditStats>>; locale: string }) {
  const t = await getTranslations('dashboard.overview');
  const res = await statsPromise;
  const data = res.data;
  const last = data?.last_sale_at ? new Date(`${data.last_sale_at.replace(' ', 'T')}Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long' }) : null;
  return (
    <div className={overviewCard}>
      <p className="mb-2 text-sm font-medium text-[var(--fg-2)]">{t('fresh.audit.title', { days: data?.period_days ?? 30 })}</p>
      {!res.ok || !data ? (
        <FetchFailed name={t('fresh.audit.title', { days: 30 })} status={res.status} />
      ) : data.uploads === 0 && data.sales === 0 ? (
        <p className="text-[12px] text-[var(--fg-5)]">{t('fresh.audit.empty')}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
          <div><dt className="text-[var(--fg-5)]">{t('fresh.audit.uploads')}</dt><dd className="font-mono text-lg">{data.uploads}</dd></div>
          <div><dt className="text-[var(--fg-5)]">{t('fresh.audit.sales')}</dt><dd className="font-mono text-lg">{data.sales}</dd></div>
          <div><dt className="text-[var(--fg-5)]">{t('fresh.audit.revenue')}</dt><dd className="font-mono text-lg">{data.revenue_chf}</dd></div>
          <div><dt className="text-[var(--fg-5)]">{t('fresh.audit.conversion')}</dt><dd className="font-mono text-lg">{data.conversion === null ? '–' : `${Math.round(data.conversion * 100)} %`}</dd></div>
          {last ? <div className="col-span-2 text-[12px] text-[var(--fg-5)]">{t('fresh.audit.lastSale')} : {last}</div> : null}
        </dl>
      )}
    </div>
  );
}

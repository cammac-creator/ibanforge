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
          {data.recent_uploads && data.recent_uploads.length > 0 ? (
            <div className="col-span-2 mt-1">
              <p className="text-[11px] text-[var(--fg-5)]">{t('fresh.audit.recent')}</p>
              <ul className="mt-0.5 flex flex-col gap-0.5 text-[11px] text-[var(--fg-4)]">
                {data.recent_uploads.slice(0, 6).map((u) => (
                  <li key={`${u.at}-${u.key_prefix ?? ''}`} className="font-mono">
                    {new Date(`${u.at.replace(' ', 'T')}Z`).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' })}
                    {' · '}
                    {u.rows === null ? t('fresh.audit.rowsUnknown') : t('fresh.audit.rows', { rows: u.rows })}
                    {' · '}
                    {u.internal ? t('fresh.audit.internal') : u.key_prefix ? t('fresh.audit.withKey', { key: u.key_prefix }) : t('fresh.audit.noKey')}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </dl>
      )}
    </div>
  );
}

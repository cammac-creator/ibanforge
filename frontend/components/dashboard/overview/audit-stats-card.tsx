import { getTranslations } from 'next-intl/server';
import { parseSqlUtc, type AuditStats } from '@/lib/dashboard-overview';
import { FetchFailed, type Fetched } from './fetching';
import { overviewCard } from './section';

/** Les montants connus à la commande restent distincts des prix catalogue et du bénéfice. */
export async function AuditStatsCard({ statsPromise, locale }: { statsPromise: Promise<Fetched<AuditStats>>; locale: string }) {
  const t = await getTranslations({ locale, namespace: 'dashboard.overview' });
  const res = await statsPromise;
  const data = res.data;
  const last = parseSqlUtc(data?.last_sale_at)?.toLocaleDateString(locale, { day: 'numeric', month: 'long', timeZone: 'Europe/Zurich' });
  const amounts = data?.revenue_basis === 'stripe_checkout' ? data.payment_amounts : undefined;
  const revenue = amounts && data?.revenue_chf != null
    ? new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(data.revenue_chf)
    : '–';
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
          <div><dt className="text-[var(--fg-5)]">{t('fresh.audit.revenue')}</dt><dd className="font-mono text-lg">{revenue}</dd></div>
          <div><dt className="text-[var(--fg-5)]">{t('fresh.audit.conversion')}</dt><dd className="font-mono text-lg">{data.conversion === null ? '–' : `${Math.round(data.conversion * 100)} %`}</dd></div>
          <div className="col-span-2 space-y-1 text-[12px] text-[var(--fg-5)]">
            <dt className="sr-only">{t('fresh.audit.scope')}</dt>
            <dd>{amounts ? t('fresh.audit.known', { known: amounts.chf, sales: data.sales }) : t('fresh.audit.unavailable')}</dd>
            {amounts && amounts.unknown > 0 ? <dd>{t('fresh.audit.unknown', { count: amounts.unknown })}</dd> : null}
            {amounts && amounts.other_currency > 0 ? <dd>{t('fresh.audit.otherCurrency', { count: amounts.other_currency })}</dd> : null}
            <dd>{t('fresh.audit.revenueNote')}</dd>
            <dd>{t('fresh.audit.ratioNote')}</dd>
          </div>
          {last ? <div className="col-span-2 text-[12px] text-[var(--fg-5)]">{t('fresh.audit.lastSale')} : {last}</div> : null}
          {data.recent_uploads && data.recent_uploads.length > 0 ? (
            <div className="col-span-2 mt-1">
              <p className="text-[11px] text-[var(--fg-5)]">{t('fresh.audit.recent')}</p>
              <ul className="mt-0.5 flex flex-col gap-0.5 text-[11px] text-[var(--fg-4)]">
                {data.recent_uploads.slice(0, 6).map((u) => (
                  <li key={`${u.at}-${u.key_prefix ?? ''}`} className="font-mono">
                    {parseSqlUtc(u.at)?.toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }) ?? '–'}
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

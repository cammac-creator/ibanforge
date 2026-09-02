import { getTranslations } from 'next-intl/server';
import type { SignupSources } from '@/lib/dashboard-overview';
import { FetchFailed, type Fetched } from './fetching';
import { overviewCard } from './section';

/**
 * Where the last 30 days' signups came from. Until 02/09/2026 the answer was
 * "nobody knows": the only attribution was a campaign tag that no external key
 * had ever carried. The card reads the new origin store and says, per channel,
 * how many keys it produced; a signup minted without a browser (curl, an SDK,
 * an agent) is a channel of its own rather than a hole in the count.
 */
export async function SignupSourcesCard({ sourcesPromise, locale }: { sourcesPromise: Promise<Fetched<SignupSources>>; locale: string }) {
  const t = await getTranslations('dashboard.overview');
  const res = await sourcesPromise;
  const label = (channel: string): string => {
    if (channel === 'direct') return t('fresh.sources.direct');
    if (channel === 'api') return t('fresh.sources.api');
    const i = channel.indexOf(':');
    return i === -1 ? channel : channel.slice(i + 1);
  };
  const kind = (channel: string): string => {
    if (channel.startsWith('utm:')) return t('fresh.sources.kindCampaign');
    if (channel.startsWith('src:')) return t('fresh.sources.kindTag');
    if (channel.startsWith('ref:')) return t('fresh.sources.kindReferrer');
    return '';
  };
  const data = res.data;
  const max = data ? Math.max(1, ...data.channels.map((c) => c.n)) : 1;
  const since = data?.since ? new Date(`${data.since}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long' }) : null;

  return (
    <div className={overviewCard}>
      <p className="mb-2 text-sm font-medium text-[var(--fg-2)]">{t('fresh.sources.title', { days: data?.period_days ?? 30 })}</p>
      {!res.ok || !data ? (
        <FetchFailed name={t('fresh.sources.title', { days: 30 })} status={res.status} />
      ) : data.total === 0 ? (
        <p className="text-[12px] text-[var(--fg-5)]">{t('fresh.sources.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {data.channels.slice(0, 8).map((c) => (
            <li key={c.channel} className="flex items-center gap-2 text-[13px]">
              <span className="w-28 shrink-0 truncate text-[var(--fg-1)] sm:w-44" title={c.channel}>
                {label(c.channel)}
              </span>
              <span className="hidden w-20 shrink-0 text-[11px] text-[var(--fg-5)] sm:inline">{kind(c.channel)}</span>
              <span className="min-w-0 flex-1">
                <span
                  className="block h-2 rounded-sm bg-[var(--amber-500)]/70"
                  style={{ width: `${Math.max(4, Math.round((c.n / max) * 100))}%` }}
                  aria-hidden="true"
                />
              </span>
              <span className="w-8 shrink-0 text-right font-mono text-[12px] tabular-nums text-[var(--fg-2)]">{c.n}</span>
            </li>
          ))}
        </ul>
      )}
      {data && data.landings.length > 0 && (
        <p className="mt-3 text-[11px] text-[var(--fg-5)]">
          {t('fresh.sources.landings')}: {data.landings.slice(0, 3).map((l) => `${l.path} (${l.n})`).join(' · ')}
        </p>
      )}
      {since && <p className="mt-1 text-[11px] text-[var(--fg-5)]">{t('fresh.sources.since', { date: since })}</p>}
    </div>
  );
}

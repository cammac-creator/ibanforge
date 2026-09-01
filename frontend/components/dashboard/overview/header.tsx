import { getTranslations } from 'next-intl/server';
import { FreshnessBadge } from '@/components/crm/freshness-badge';
import { LiveHealthStrip } from '../live-health-strip';
import { InfoDot } from '../info-dot';
import type { Fetched } from './fetching';
import type { StatsResponse } from './types';

/**
 * The one line above the five sections.
 *
 * Two things the overview did not have and every other tab did (ENS-17): the
 * instant the figures were read, and a button to read them again. The page is
 * served no-store but stays open for a whole working session, so without this
 * the operator cannot tell an hour-old screen from a fresh one.
 *
 * It also states, in plain words, what the 7/30/90 pill actually drives
 * (ENS-10): half the blocks below ignore it, and a period selector that
 * silently governs half a page is worse than none.
 */
export async function OverviewHeader({ period, readAtIso }: { period: number; readAtIso: string }) {
  const t = await getTranslations('dashboard.overview');
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h1 className="text-base font-semibold text-white">{t('title')}</h1>
      <p className="flex items-center gap-1.5 text-[12px] text-[var(--fg-4)]">
        {t('periodLead', { days: period })}
        <InfoDot>{t('periodNote')}</InfoDot>
      </p>
      <div className="ml-auto">
        <FreshnessBadge fetchedAtIso={readAtIso} />
      </div>
    </div>
  );
}

/**
 * Section 0 — is the service up, is the collection still writing.
 *
 * Its own async component so the strip streams in on its own: it is the one
 * block whose whole value is that it appears fast.
 */
export async function HealthStrip({ statsPromise }: { statsPromise: Promise<Fetched<StatsResponse>> }) {
  const statsRes = await statsPromise;
  return <LiveHealthStrip lastWriteAt={statsRes.data?.last_write_at} />;
}

/**
 * The red banner for a /stats that did not answer.
 *
 * It used to be a full-page early return, which is what forced the page to
 * await its heaviest upstream before painting anything at all (ENS-05). Now it
 * is one more streamed block: the sections that read /stats say so themselves,
 * and the ones that do not still render.
 */
export async function ApiDownBanner({ statsPromise }: { statsPromise: Promise<Fetched<StatsResponse>> }) {
  const statsRes = await statsPromise;
  if (statsRes.ok) return null;
  const t = await getTranslations('dashboard');
  const o = await getTranslations('dashboard.overview');
  return (
    <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4">
      <p className="text-sm font-medium text-red-300">{t('error.apiUnavailable')}</p>
      <p className="mt-1 text-xs text-[var(--fg-3)]">
        {t('error.apiUnavailableDescription')}{' '}
        {statsRes.status === 401 || statsRes.status === 403
          ? o('failed.token', { status: statsRes.status })
          : statsRes.status !== 0
            ? o('failed.http', { status: statsRes.status })
            : o('failed.unreachable')}
      </p>
    </div>
  );
}

import type { OverviewView } from '@/lib/dashboard/workspace';
import { getTranslations } from 'next-intl/server';
import { FreshnessBadge } from '@/components/crm/freshness-badge';
import { LiveHealthStrip } from '../live-health-strip';
import type { Fetched } from './fetching';
import type { LastWrite } from './types';

/** L’intitulé et la fraîcheur de la vue ouverte, avant ses actions. */
export async function OverviewHeader({
  readAtIso,
  view,
}: {
  readAtIso: string;
  view: OverviewView;
}) {
  const w = await getTranslations('dashboard.workspace');
  const p = await getTranslations('dashboard.pilot');
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
        <p className="mb-2 text-xs text-[var(--fg-4)]">IBANforge / {w('overview')}</p>
        <h1 className="font-semibold text-[var(--fg-1)]">{view === 'today' ? p('title') : w(view)}</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--fg-3)]">{view === 'today' ? p('intro') : w(`${view}Intro`)}</p>
      </div>
      <div className="sm:ml-auto">
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
export async function HealthStrip({
  statsPromise,
  readAtIso,
  compact = false,
}: {
  statsPromise: Promise<Fetched<LastWrite>>;
  readAtIso: string;
  compact?: boolean;
}) {
  const statsRes = await statsPromise;
  return (
    <LiveHealthStrip
      lastWriteAt={statsRes.data?.last_write_at}
      readAt={Date.parse(readAtIso)}
      compact={compact}
    />
  );
}

/**
 * The red banner for a /stats that did not answer.
 *
 * It used to be a full-page early return, which is what forced the page to
 * await its heaviest upstream before painting anything at all (ENS-05). Now it
 * is one more streamed block: the sections that read /stats say so themselves,
 * and the ones that do not still render.
 */
export async function ApiDownBanner({
  statsPromise,
}: {
  statsPromise: Promise<Fetched<LastWrite>>;
}) {
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

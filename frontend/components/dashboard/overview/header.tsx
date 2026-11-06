import { Suspense } from 'react';
import type { OverviewView } from '@/lib/dashboard/workspace';
import { getTranslations } from 'next-intl/server';
import { FreshnessBadge } from '@/components/crm/freshness-badge';
import { LiveHealthStrip, RecordedActivity } from '../live-health-strip';
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

/** La sonde est montable tout de suite ; seule l’activité attend les statistiques. */
export function HealthStrip({
  statsPromise,
  readAtIso,
  compact = false,
}: {
  statsPromise: Promise<Fetched<LastWrite>>;
  readAtIso: string;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <LiveHealthStrip compact={compact} />
      <Suspense fallback={null}>
        <StatisticsActivity statsPromise={statsPromise} readAtIso={readAtIso} compact={compact} />
      </Suspense>
    </div>
  );
}

export async function StatisticsActivity({ statsPromise, readAtIso, compact = false }: {
  statsPromise: Promise<Fetched<LastWrite>>;
  readAtIso: string;
  compact?: boolean;
}) {
  const res = await statsPromise;
  if (!res.ok) return null;
  return <RecordedActivity lastWriteAt={res.data?.last_write_at} readAt={Date.parse(readAtIso)} compact={compact} />;
}

/** Un échec de lecture des statistiques ne prouve pas que le service est en panne. */
export async function StatisticsReadNotice({
  statsPromise,
}: {
  statsPromise: Promise<Fetched<LastWrite>>;
}) {
  const statsRes = await statsPromise;
  if (statsRes.ok) return null;
  const t = await getTranslations('dashboard');
  return (
    <div role="status" data-statistics-notice className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <p className="text-sm font-medium text-[var(--fg-1)]">{t('error.statsUnavailable')}</p>
      <p className="mt-1 text-xs text-[var(--fg-3)]">
        {t('error.statsUnavailableDescription')}{' '}
        {statsRes.status === 401 || statsRes.status === 403
          ? t('error.statsDenied', { status: statsRes.status })
          : statsRes.status !== 0
            ? t('error.statsHttp', { status: statsRes.status })
            : t('error.statsTimeout')}
      </p>
    </div>
  );
}

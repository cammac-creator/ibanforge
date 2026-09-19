import type { ReactNode } from 'react';
import type { Fetched } from '../overview/fetching';
import type { TrafficTrendResult } from '@/lib/traffic-trend';
import {
  readAudienceFunnel,
  readDailyCallers,
  readAudienceGoogle,
  readAudienceSources,
  readAudienceWeb,
} from '@/lib/dashboard/audience-model';
import { AudienceExplorer } from './explorer';

/** Les sources sont indépendantes : une panne Google ne masque jamais les essais. */
export async function AudienceSection({
  trendPromise,
  activationPromise,
  webPromise,
  sourcesPromise,
  googlePromise,
  funnelPromise,
  nowIso,
  period,
  children,
}: {
  trendPromise: Promise<TrafficTrendResult>;
  activationPromise: Promise<Fetched<{ daily_callers?: unknown }>>;
  webPromise: Promise<Fetched<unknown>>;
  sourcesPromise: Promise<Fetched<unknown>>;
  googlePromise: Promise<Fetched<unknown>>;
  funnelPromise: Promise<Fetched<unknown>>;
  nowIso: string;
  period: number;
  children: ReactNode;
}) {
  const [trend, web, sources, google, funnel, activation] = await Promise.all([
    trendPromise,
    webPromise,
    sourcesPromise,
    googlePromise,
    funnelPromise,
    activationPromise,
  ]);
  return (
    <AudienceExplorer
      trend={trend}
      dailyCallers={activation.ok ? readDailyCallers(activation.data?.daily_callers) : null}
      web={web.ok ? readAudienceWeb(web.data) : null}
      sources={sources.ok ? readAudienceSources(sources.data) : null}
      google={readAudienceGoogle(google.data)}
      funnel={funnel.ok ? readAudienceFunnel(funnel.data) : null}
      nowIso={nowIso}
      period={period}
    >
      {children}
    </AudienceExplorer>
  );
}

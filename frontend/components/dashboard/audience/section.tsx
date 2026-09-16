import type { ReactNode } from 'react';
import type { Fetched } from '../overview/fetching';
import type { TrafficTrendResult } from '@/lib/traffic-trend';
import {
  readAudienceFunnel,
  readAudienceGoogle,
  readAudienceSources,
  readAudienceWeb,
} from '@/lib/dashboard/audience-model';
import { AudienceExplorer } from './explorer';

/** Les sources sont indépendantes : une panne Google ne masque jamais les essais. */
export async function AudienceSection({
  trendPromise,
  webPromise,
  sourcesPromise,
  googlePromise,
  funnelPromise,
  nowIso,
  period,
  children,
}: {
  trendPromise: Promise<TrafficTrendResult>;
  webPromise: Promise<Fetched<unknown>>;
  sourcesPromise: Promise<Fetched<unknown>>;
  googlePromise: Promise<Fetched<unknown>>;
  funnelPromise: Promise<Fetched<unknown>>;
  nowIso: string;
  period: number;
  children: ReactNode;
}) {
  const [trend, web, sources, google, funnel] = await Promise.all([
    trendPromise,
    webPromise,
    sourcesPromise,
    googlePromise,
    funnelPromise,
  ]);
  return (
    <AudienceExplorer
      trend={trend}
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

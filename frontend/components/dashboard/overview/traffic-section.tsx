import { getTranslations } from 'next-intl/server';
import { TrafficTrendCard } from '../traffic-trend-card';
import type { TrafficTrendResult } from '@/lib/traffic-trend';
import { OverviewSection } from './section';

/**
 * The traffic, day by day, as the second band of the overview.
 *
 * It lived at the head of the bot tab, where it answered « is there more of
 * them than last month » for robots only; the owner asked for it here, in
 * full, because the question is the whole API's. The trend runs on
 * STATS_TOKEN, unlike the CRM sections around it, so it is fetched on its
 * own and fails on its own: a missing token blanks this card and nothing
 * else.
 */
export async function TrafficSection({
  nowIso,
  trendPromise,
}: {
  nowIso: string;
  trendPromise: Promise<TrafficTrendResult>;
}) {
  const [t, trend] = await Promise.all([getTranslations('dashboard.overview'), trendPromise]);
  return (
    <OverviewSection step={2} title={t('traffic.title')} lead={t('traffic.lead')}>
      <TrafficTrendCard result={trend} nowIso={nowIso} />
    </OverviewSection>
  );
}

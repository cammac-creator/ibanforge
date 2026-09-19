import type { AudienceFunnel, AudienceIndicator, DailyCallers } from './audience-model';

/** Données entièrement inventées, réservées aux tests et à la recette visuelle. */
export function audienceFixture(): AudienceFunnel {
  const ratio = (n: number, d: number) => (d ? Math.round((n / d) * 10000) / 10000 : null);
  const indicator = (numerator: number, denominator: number, pending = 0): AudienceIndicator => ({
    numerator,
    denominator,
    pending,
    value: ratio(numerator, denominator),
    coverage: ratio(denominator, denominator + pending),
  });
  const share = (numerator: number, denominator: number) => ({
    numerator,
    denominator,
    value: ratio(numerator, denominator),
  });
  const indicators = {
    first_result_24h: indicator(12, 18, 6),
    return_week_2: indicator(3, 8, 4),
    attributable_purchase_30d: indicator(1, 4, 20),
  };
  return {
    observed_at: '2026-06-16 12:00:00',
    measurement_started_at: '2026-05-01 08:00:00',
    window: { from: '2026-03-19 00:00:00', to: '2026-06-16 12:00:00' },
    lineages: { created: 28, admissible: 24, pending: 6 },
    indicators: {
      ...indicators,
      unmarked_use_7d: indicator(4, 15, 9),
      paid_key_delivered: indicator(2, 2),
      paid_use_7d: indicator(0, 0, 1),
    },
    unknown_context_share: share(2, 12),
    paid_link_coverage: share(1, 2),
    by_birth_source: [{ name: 'web', lineages: 24, ...indicators }],
    by_first_client: [
      {
        name: 'browser',
        lineages: 12,
        first_result_24h: indicator(12, 12),
        return_week_2: indicator(3, 8, 4),
        attributable_purchase_30d: indicator(1, 4, 8),
      },
      {
        name: '(none)',
        lineages: 12,
        first_result_24h: indicator(0, 6, 6),
        return_week_2: indicator(0, 0),
        attributable_purchase_30d: indicator(0, 0, 12),
      },
    ],
    device: {
      window_days: { from: '2026-03-19', to: '2026-06-16' },
      counters: {
        opened: 0,
        approved: 0,
        delivered: 0,
        rate_limited: 0,
        approved_anonymous: 0,
        approved_email: 0,
        denied: 0,
        expired: 0,
      },
      by_door: [
        {
          source: 'mcp-device',
          opened: 0,
          delivered: 0,
          rate_limited: 0,
          approved_anonymous: 0,
          approved_email: 0,
          denied: 0,
          expired: 0,
        },
      ],
      chain: {
        approved_of_opened: share(0, 0),
        delivered_of_approved: share(0, 0),
        lineages_of_delivered: share(0, 0),
      },
      lineages: { created: 0, admissible: 0 },
      indicators: {
        first_result_24h: indicator(0, 0),
        return_week_2: indicator(0, 0),
        attributable_purchase_30d: indicator(0, 0),
      },
      mcp_remote: { sessions: 48, tool_calls: 136, key_requests: 9 },
    },
  };
}


export function dailyCallersFixture(period: 30 | 90 = 30): DailyCallers {
  const to = '2026-06-16';
  const start = Date.parse(to) - (period - 1) * 86_400_000;
  return {
    unit: 'account', period_days: period,
    window: { from: new Date(start).toISOString().slice(0, 10), to }, today_partial: true,
    days: Array.from({ length: period }, (_, index) => ({
      day: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
      accounts: index === period - 1 ? 2 : index % 5,
    })),
  };
}

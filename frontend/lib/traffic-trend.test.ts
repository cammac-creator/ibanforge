import { describe, expect, it } from 'vitest';
import {
  KEYLESS_KEYS,
  NATURE_KEYS,
  naturesTotal,
  parseTrafficTrend,
  sliceToPeriod,
  summariseTrend,
  type TrafficTrendDay,
} from './traffic-trend';

/**
 * Fixtures are invented on purpose — this repository is public. Never put a
 * real call count, address or company in here.
 */
function day(date: string, over: Partial<TrafficTrendDay> = {}): TrafficTrendDay {
  const base: TrafficTrendDay = {
    date,
    total: 0,
    with_key: 0,
    agent: 0,
    declared_bot: 0,
    browser: 0,
    anonymous_api: 0,
    internal: 0,
    not_found: 0,
    paywall: 0,
    server_error: 0,
    distinct_ips: 0,
  };
  const d = { ...base, ...over };
  // Unless a test is explicitly about a broken payload, the fixture honours the
  // route's invariant: the six exclusive natures add up to the day's total.
  return over.total === undefined ? { ...d, total: naturesTotal(d) } : d;
}

describe('NATURE_KEYS', () => {
  it('holds the six exclusive natures and none of the crossing series', () => {
    expect([...NATURE_KEYS].sort()).toEqual([
      'agent',
      'anonymous_api',
      'browser',
      'declared_bot',
      'internal',
      'with_key',
    ]);
    // A 404 was already counted as a browser or an agent; stacking it would
    // draw a bar taller than the day's traffic.
    for (const crossing of ['not_found', 'paywall', 'server_error']) {
      expect(NATURE_KEYS).not.toContain(crossing);
    }
  });

  it('excludes the keyed and internal natures from the keyless subset', () => {
    expect(KEYLESS_KEYS).not.toContain('with_key');
    expect(KEYLESS_KEYS).not.toContain('internal');
  });
});

describe('naturesTotal', () => {
  it('adds up to the day total the route reports', () => {
    const d = day('2026-08-29', {
      with_key: 900,
      agent: 300,
      declared_bot: 40,
      browser: 1_200,
      anonymous_api: 500,
      internal: 60,
    });
    expect(naturesTotal(d)).toBe(3_000);
    expect(d.total).toBe(3_000);
  });

  it('ignores the crossing series, which are already inside the natures', () => {
    const d = day('2026-08-29', { browser: 100, not_found: 90, paywall: 5, server_error: 2 });
    expect(naturesTotal(d)).toBe(100);
  });
});

describe('sliceToPeriod', () => {
  const now = new Date('2026-08-30T11:00:00Z');

  it('keeps today and the N-1 days before it', () => {
    const days = ['2026-08-23', '2026-08-24', '2026-08-29', '2026-08-30'].map((d) => day(d, { browser: 1 }));
    expect(sliceToPeriod(days, 7, now).map((d) => d.date)).toEqual([
      '2026-08-24',
      '2026-08-29',
      '2026-08-30',
    ]);
  });

  it('counts calendar days, not rows: a quiet stretch shortens the window', () => {
    // The route omits days with no traffic. Taking the last 7 rows here would
    // reach back to July and label it "7 jours".
    const days = [
      ...['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'].map((d) => day(d, { browser: 5 })),
      day('2026-08-30', { browser: 5 }),
    ];
    expect(sliceToPeriod(days, 7, now).map((d) => d.date)).toEqual(['2026-08-30']);
  });

  it('sorts by date, so an out-of-order payload cannot scramble the axis', () => {
    const days = [day('2026-08-30'), day('2026-08-28'), day('2026-08-29')];
    expect(sliceToPeriod(days, 30, now).map((d) => d.date)).toEqual([
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ]);
  });

  it('returns nothing rather than throwing on an empty series', () => {
    expect(sliceToPeriod([], 30, now)).toEqual([]);
  });
});

describe('summariseTrend', () => {
  const days = [
    day('2026-08-28', { with_key: 100, agent: 50, browser: 200, anonymous_api: 10, not_found: 5 }),
    day('2026-08-29', { with_key: 20, browser: 900, declared_bot: 30, internal: 40, not_found: 800, paywall: 12 }),
    day('2026-08-30', { with_key: 60, agent: 70, browser: 100, server_error: 3 }),
  ];

  it('sums each nature over the window', () => {
    const s = summariseTrend(days);
    expect(s.byNature.with_key).toBe(180);
    expect(s.byNature.browser).toBe(1_200);
    expect(s.byNature.internal).toBe(40);
    expect(s.total).toBe(1_580);
  });

  it('counts as keyless only what has no key, ours included nowhere', () => {
    const s = summariseTrend(days);
    // total − with_key(180) − internal(40)
    expect(s.keyless).toBe(1_360);
  });

  it('reports the busiest day and the 404 peak separately', () => {
    const s = summariseTrend(days);
    // The point of the whole card: the day a scanner declares itself a browser
    // is not necessarily the day traffic peaks, and only the 404s name it.
    expect(s.peak).toEqual({ date: '2026-08-29', total: 990 });
    expect(s.notFoundPeak).toEqual({ date: '2026-08-29', count: 800 });
  });

  it('keeps the earliest day when two are tied at the peak', () => {
    const tied = [day('2026-08-29', { browser: 10 }), day('2026-08-30', { browser: 10 })];
    expect(summariseTrend(tied).peak?.date).toBe('2026-08-29');
  });

  it('leaves the 404 peak empty when nothing 404ed', () => {
    expect(summariseTrend([day('2026-08-30', { browser: 10 })]).notFoundPeak).toBeNull();
  });

  it('counts the days whose natures do not add up instead of hiding the gap', () => {
    const broken = [day('2026-08-30', { browser: 10, total: 999 }), ...days];
    expect(summariseTrend(broken).mismatchDays).toBe(1);
    expect(summariseTrend(days).mismatchDays).toBe(0);
  });

  it('summarises an empty window to zeros, not to nulls the card must guard', () => {
    const s = summariseTrend([]);
    expect(s.total).toBe(0);
    expect(s.byNature.agent).toBe(0);
    expect(s.peak).toBeNull();
  });
});

describe('parseTrafficTrend', () => {
  it('reads the route payload', () => {
    const rows = parseTrafficTrend({
      period_days: 30,
      days: [{ date: '2026-08-29', total: 12, browser: 12, distinct_ips: 4 }],
    });
    expect(rows).toEqual([
      {
        date: '2026-08-29',
        total: 12,
        with_key: 0,
        agent: 0,
        declared_bot: 0,
        browser: 12,
        anonymous_api: 0,
        internal: 0,
        not_found: 0,
        paywall: 0,
        server_error: 0,
        distinct_ips: 4,
      },
    ]);
  });

  it('refuses anything that is not a days array, so the card can say so', () => {
    expect(parseTrafficTrend(null)).toBeNull();
    expect(parseTrafficTrend('boom')).toBeNull();
    expect(parseTrafficTrend({ error: 'unauthorized' })).toBeNull();
    expect(parseTrafficTrend({ days: 42 })).toBeNull();
  });

  it('accepts an empty series: no traffic is an answer, not a failure', () => {
    expect(parseTrafficTrend({ days: [] })).toEqual([]);
  });

  it('drops a row without a date rather than putting it on a nameless tick', () => {
    const rows = parseTrafficTrend({ days: [{ total: 5 }, null, { date: '', total: 5 }, { date: '2026-08-30' }] });
    expect(rows?.map((r) => r.date)).toEqual(['2026-08-30']);
  });

  it('zeroes a field the route renamed instead of drawing NaN', () => {
    const rows = parseTrafficTrend({ days: [{ date: '2026-08-30', browser: '12', not_found: null }] });
    expect(rows?.[0]?.browser).toBe(0);
    expect(rows?.[0]?.not_found).toBe(0);
  });

  it('keeps only the calendar day when the route sends a timestamp', () => {
    const rows = parseTrafficTrend({ days: [{ date: '2026-08-30T00:00:00Z', total: 1 }] });
    expect(rows?.[0]?.date).toBe('2026-08-30');
  });
});

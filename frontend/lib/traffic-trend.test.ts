import { describe, expect, it } from 'vitest';
import {
  KEYLESS_KEYS,
  NATURE_KEYS,
  type TrafficTrendDay,
  comparePeriods,
  deltaPct,
  fmtInt,
  isWeekend,
  movingAverage,
  naturesTotal,
  parseTrafficTrend,
  shortDay,
  sliceToPeriod,
  summariseTrend,
  trendEvents,
  trafficWindow,
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

  it('keeps today and the N-1 days before it, dropping what falls outside', () => {
    const days = ['2026-08-23', '2026-08-24', '2026-08-29', '2026-08-30'].map((d) =>
      day(d, { browser: 1 }),
    );
    const out = sliceToPeriod(days, 7, now);
    expect(out).toHaveLength(7);
    expect(out[0].date).toBe('2026-08-24');
    expect(out[out.length - 1].date).toBe('2026-08-30');
    // 08-23 is the eighth day back: outside the window, and gone.
    expect(out.some((d) => d.date === '2026-08-23')).toBe(false);
    expect(out.filter((d) => d.browser === 1).map((d) => d.date)).toEqual([
      '2026-08-24',
      '2026-08-29',
      '2026-08-30',
    ]);
  });

  it('draws one bar per calendar day, quiet days at zero', () => {
    // The load-bearing rule. recharts' X axis is categorical: it gives one
    // equal slot per row it receives, so a sparse series pushes two days ten
    // apart against each other and lets the 404 line slope across a stretch
    // nothing measured. Seven days asked for, seven rows out.
    const days = [
      day('2026-08-24', { browser: 5, not_found: 5 }),
      day('2026-08-30', { browser: 5 }),
    ];
    const out = sliceToPeriod(days, 7, now);
    expect(out.map((d) => d.date)).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ]);
    // The five filled days must be zero everywhere, not merely present: a
    // filler carrying a stale 404 count would be worse than the gap.
    for (const d of out.slice(1, 6)) {
      expect(naturesTotal(d)).toBe(0);
      expect(d.total).toBe(0);
      expect(d.not_found).toBe(0);
      expect(d.distinct_ips).toBe(0);
    }
  });

  it('counts calendar days, not rows: a quiet stretch shortens the window', () => {
    // The route omits days with no traffic. Taking the last 7 rows here would
    // reach back to July and label it "7 jours".
    const days = [
      ...['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'].map((d) =>
        day(d, { browser: 5 }),
      ),
      day('2026-08-30', { browser: 5 }),
    ];
    const out = sliceToPeriod(days, 7, now);
    expect(out).toHaveLength(7);
    expect(out.filter((d) => d.total > 0).map((d) => d.date)).toEqual(['2026-08-30']);
    expect(out.some((d) => d.date.startsWith('2026-07'))).toBe(false);
  });

  it('sorts by date, so an out-of-order payload cannot scramble the axis', () => {
    const days = [day('2026-08-30'), day('2026-08-28'), day('2026-08-29')];
    const out = sliceToPeriod(days, 30, now);
    const dates = out.map((d) => d.date);
    expect([...dates].sort()).toEqual(dates);
    expect(dates[dates.length - 1]).toBe('2026-08-30');
  });

  it('still draws the window when the series is empty', () => {
    // An empty payload is a quiet month, not a broken card: 30 bars at zero
    // say "nothing was served", where nothing at all says "we do not know".
    const out = sliceToPeriod([], 30, now);
    expect(out).toHaveLength(30);
    expect(out.every((d) => d.total === 0)).toBe(true);
    expect(out[out.length - 1].date).toBe('2026-08-30');
  });

  it('keeps a future-dated row rather than swallowing it', () => {
    // A row dated after today means the clocks disagree. Dropping it would
    // hide the anomaly; the card would rather show something odd than lie.
    const out = sliceToPeriod([day('2026-09-05', { browser: 3 })], 7, now);
    expect(out.some((d) => d.date === '2026-09-05')).toBe(true);
  });
});

describe('summariseTrend', () => {
  const days = [
    day('2026-08-28', { with_key: 100, agent: 50, browser: 200, anonymous_api: 10, not_found: 5 }),
    day('2026-08-29', {
      with_key: 20,
      browser: 900,
      declared_bot: 30,
      internal: 40,
      not_found: 800,
      paywall: 12,
    }),
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
  it('lit les compteurs complets sans inventer les champs manquants', () => {
    const d = day('2026-08-29', { browser: 12, distinct_ips: 4 });
    expect(parseTrafficTrend({ period_days: 30, days: [d] })).toEqual([d]);
  });
  it.each([null, 'erreur', { error: 'unauthorized' }, { days: 42 }, [], { days: [null] }, { days: [[]] }])('refuse une structure illisible : %j', (raw) => {
    expect(parseTrafficTrend(raw)).toBeNull();
  });
  it('accepte une série réellement vide', () => {
    expect(parseTrafficTrend({ days: [] })).toEqual([]);
  });
  it.each(['2026-02-30', '2026-13-01', 'date-inconnue', '', '2026-08-30T00:00:00Z'])('refuse la date non canonique %s', (date) => {
    expect(parseTrafficTrend({ days: [day(date)] })).toBeNull();
  });
  it.each(['total', ...NATURE_KEYS, 'not_found', 'paywall', 'server_error', 'distinct_ips'])('ne remplace pas %s absent par zéro', (key) => {
    const d: Record<string, unknown> = { ...day('2026-08-30', { browser: 12 }) };
    delete d[key];
    expect(parseTrafficTrend({ days: [d] })).toBeNull();
  });
  it.each([null, undefined, '12', -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('refuse un compteur invalide : %s', (browser) => {
    expect(parseTrafficTrend({ days: [{ ...day('2026-08-30'), browser }] })).toBeNull();
  });
  it('refuse un doublon de date plutôt que de perdre ou doubler une observation', () => {
    expect(parseTrafficTrend({ days: [day('2026-08-30'), day('2026-08-30')] })).toBeNull();
  });
  it('ne transforme pas une ligne illisible au milieu de la série en silence', () => {
    expect(parseTrafficTrend({ days: [day('2026-08-29'), null, day('2026-08-30')] })).toBeNull();
  });
  it('conserve un écart de répartition pour le diagnostic visible', () => {
    const d = day('2026-08-30', { total: 90, browser: 5 });
    expect(parseTrafficTrend({ days: [d] })).toEqual([d]);
    expect(summariseTrend([d]).mismatchDays).toBe(1);
  });
});

describe('trafficWindow', () => {
  it('garde les dates futures consultables sans les ajouter aux indicateurs de la période', () => {
    const future = day('2026-09-01', { browser: 900, not_found: 800 });
    const input = [future, day('2026-08-30', { browser: 4 }), day('2026-08-01', { browser: 70 })];
    const before = JSON.stringify(input);
    const w = trafficWindow(input, 7, new Date('2026-08-30T23:59:59Z'));
    expect(w.days).toHaveLength(7);
    expect(w.days.at(-1)?.date).toBe('2026-08-30');
    expect(summariseTrend(w.days).total).toBe(4);
    expect(summariseTrend(w.days).notFound).toBe(0);
    expect(w.future).toEqual([future]);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('compte une date dès qu’elle entre dans la période UTC de lecture', () => {
    const w = trafficWindow([day('2026-09-01', { browser: 9 })], 7, new Date('2026-09-01T00:00:00Z'));
    expect(w.future).toEqual([]);
    expect(summariseTrend(w.days).total).toBe(9);
  });
});

describe('the readings the premium card adds', () => {
  const day = (date: string, total: number, not_found = 0): TrafficTrendDay => ({
    date,
    total,
    with_key: total,
    agent: 0,
    declared_bot: 0,
    browser: 0,
    anonymous_api: 0,
    internal: 0,
    not_found,
    paywall: 0,
    server_error: 0,
    distinct_ips: 1,
  });

  it('formats integers the same way on both sides of hydration', () => {
    expect(fmtInt(254089)).toBe('254 089');
    expect(fmtInt(999)).toBe('999');
    expect(fmtInt(-1200)).toBe('-1 200');
    expect(shortDay('2026-09-04')).toBe('04.09');
    expect(isWeekend('2026-09-05')).toBe(true);
    expect(isWeekend('2026-09-04')).toBe(false);
  });

  it('averages over a trailing window, aligned on the input', () => {
    const days = [10, 20, 30, 40].map((t, i) => day(`2026-09-0${i + 1}`, t));
    expect(movingAverage(days, 2)).toEqual([10, 15, 25, 35]);
  });

  it('compares a window with the one before it only when the history reaches back', () => {
    const now = new Date('2026-09-10T12:00:00Z');
    const days: TrafficTrendDay[] = [];
    for (let i = 0; i < 20; i++) {
      const d = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      days.push(day(d, i < 10 ? 100 : 50));
    }
    const c = comparePeriods(days, 7, now);
    expect(c.previous).not.toBeNull();
    // The window before holds its own seven days (three at 100, four at 50)
    // and nothing of the current one — not those plus the 7 × 100 that follow.
    expect(c.previous?.length).toBe(7);
    expect(c.previous?.reduce((sum, d) => sum + d.total, 0)).toBe(3 * 100 + 4 * 50);
    expect(c.current.reduce((sum, d) => sum + d.total, 0)).toBe(7 * 100);
    expect(deltaPct(700, 350)).toBe(100);
    expect(deltaPct(10, 0)).toBeNull();
    expect(comparePeriods(days, 30, now).previous).toBeNull();
  });

  it('names a peak and a sweep, and never today', () => {
    const days = [
      day('2026-09-01', 100),
      day('2026-09-02', 110),
      day('2026-09-03', 90),
      day('2026-09-04', 400), // peak
      day('2026-09-05', 120, 80), // sweep: 80 of 120 are 404
      day('2026-09-06', 900), // today, partial
    ];
    const ev = trendEvents(days, '2026-09-06');
    expect(ev.map((e) => `${e.date}:${e.kind}`)).toEqual(['2026-09-05:sweep', '2026-09-04:peak']);
  });
});


describe('comparaisons du détail alignées sur la synthèse', () => {
  it.each([7, 30, 90])('une date future ne gonfle pas la fenêtre de %s jours ni sa variation', (period) => {
    const now = new Date('2026-11-06T12:00:00Z');
    const history = Array.from({ length: 180 }, (_, i) =>
      day(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10), { total: 2, with_key: 2 }),
    );
    const future = day('2026-11-07', { total: 9000, with_key: 9000 });
    const input = [...history, future];
    const before = structuredClone(input);
    const actual = comparePeriods(input, period, now);
    expect(actual.current).toHaveLength(period);
    expect(actual.current.at(-1)?.date).toBe('2026-11-06');
    expect(actual.previous).toHaveLength(period);
    const current = summariseTrend(actual.current), previous = summariseTrend(actual.previous!);
    expect(current.total).toBe(period * 2);
    expect(current.byNature.with_key).toBe(period * 2);
    expect(previous.total).toBe(period * 2);
    expect(deltaPct(current.total, previous.total)).toBe(0);
    expect(actual.current).toEqual(trafficWindow(input, period, now).days);
    expect(trafficWindow(input, period, now).future).toEqual([future]);
    expect(input).toEqual(before);
  });

  it('une date future seule ne crée pas de période précédente comparable', () => {
    const future = day('2026-11-07', { total: 9000, with_key: 9000 });
    const actual = comparePeriods([future], 7, new Date('2026-11-06T12:00:00Z'));
    expect(actual.previous).toBeNull();
    expect(actual.current).toHaveLength(7);
    expect(summariseTrend(actual.current).total).toBe(0);
  });
});

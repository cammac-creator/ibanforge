import { describe, expect, it } from 'vitest';
import {
  botLabel,
  buildBots,
  groupBots,
  sortBots,
  UNREADABLE_LABEL,
  type BotDossier,
  type BotProfileRow,
} from './bot-dossiers';

const NOW = new Date('2026-07-30T09:00:00Z');

const row = (over: Partial<BotProfileRow> = {}): BotProfileRow => ({
  user_agent: 'thing/1.0',
  client_kind: 'api',
  homepage: null,
  first_seen: '2026-06-01 09:00:00',
  last_seen: '2026-07-29 15:00:00',
  total: 100,
  ok: 100,
  paywall: 0,
  bad_input: 0,
  not_found: 0,
  server_error: 0,
  billable_ok: 0,
  avg_ms: 5,
  distinct_ips: 1,
  endpoints: [],
  not_found_paths: [],
  hours: Array(24).fill(0),
  days: [],
  ...over,
});

const build = (rows: Record<string, Partial<BotProfileRow>>) =>
  buildBots(
    Object.fromEntries(Object.entries(rows).map(([ua, o]) => [ua, row({ user_agent: ua, ...o })])),
    NOW,
  );

const verdictOf = (o: Partial<BotProfileRow>) => build({ 'x/1.0': o })[0].verdict;

describe('buildBots', () => {
  it('keeps the contact page a crawler advertises in its own user agent', () => {
    const [b] = build({ 'crawler/1.0': { homepage: 'https://flows.example.net/bots' } });
    expect(b.homepage).toBe('https://flows.example.net/bots');
  });

  it('counts the days since it last called', () => {
    const [b] = build({ 'crawler/1.0': { last_seen: '2026-07-27 09:00:00' } });
    expect(b.daysSinceLastCall).toBe(3);
  });

  it('fills the day axis so a burst reads as a burst', () => {
    const [b] = build({ 'crawler/1.0': { days: [{ day: '2026-07-30', count: 40 }] } });
    expect(b.days).toHaveLength(90);
    expect(b.days[89]).toEqual({ day: '2026-07-30', count: 40 });
  });
});

describe('the bot verdict', () => {
  it('flags a caller the paywall let through, without calling it a payment', () => {
    // A 2xx on a priced endpoint with no key is either an accepted x402
    // settlement or a call served free, and nothing in request_log tells the
    // two apart — so the verdict states the fact and stops there.
    expect(verdictOf({ billable_ok: 400, paywall: 3863, total: 4291, last_seen: '2026-06-13 09:00:00' })).toBe('servi');
  });

  it('calls it lost when most of what it asks for does not exist here', () => {
    // APIHub-HealthCheck, 3,468 requests and 3,468 404s: a directory looking
    // for a file we never published. That is a listing we could earn.
    expect(verdictOf({ total: 3468, ok: 0, not_found: 3468 })).toBe('perdu');
  });

  it('does not call it lost on a handful of misses', () => {
    expect(verdictOf({ total: 3000, ok: 2900, not_found: 100 })).not.toBe('perdu');
  });

  it('says it left once a fortnight has passed with nothing', () => {
    expect(verdictOf({ last_seen: '2026-07-01 09:00:00' })).toBe('parti');
  });

  it('calls it a probe when it keeps being refused and keeps coming back', () => {
    // axios/1.14.0: reads the x402 document, calls all five endpoints, never pays.
    expect(verdictOf({ total: 65573, ok: 10932, paywall: 32750, bad_input: 21834 })).toBe('sonde');
  });

  it('calls a declared crawler that is served properly a directory', () => {
    expect(verdictOf({ homepage: 'https://example.net/bots', client_kind: 'bot', total: 9095, ok: 9095 })).toBe(
      'annuaire',
    );
  });

  it('falls back to visitor for an anonymous caller that declares nothing', () => {
    expect(verdictOf({ client_kind: 'api', total: 30, ok: 30 })).toBe('visiteur');
  });

  it('ranks lost above gone, because what it wanted is the actionable half', () => {
    expect(verdictOf({ total: 1200, ok: 11, not_found: 1189, last_seen: '2026-07-01 09:00:00' })).toBe('perdu');
  });
});

describe('sortBots', () => {
  const list = build({
    'a/1.0': { total: 5, last_seen: '2026-07-29 10:00:00' },
    'b/1.0': { total: 500, last_seen: '2026-07-10 10:00:00' },
    'c/1.0': { total: 50, last_seen: null },
  });

  it('sorts by volume, busiest first', () => {
    expect(sortBots(list, 'requests').map((b) => b.userAgent)).toEqual(['b/1.0', 'c/1.0', 'a/1.0']);
  });

  it('sorts by freshness, most recent first, never-seen last', () => {
    expect(sortBots(list, 'freshness').map((b) => b.userAgent)).toEqual(['a/1.0', 'b/1.0', 'c/1.0']);
  });

  it('does not mutate the list it was handed', () => {
    const before = list.map((b) => b.userAgent);
    sortBots(list, 'requests');
    expect(list.map((b) => b.userAgent)).toEqual(before);
  });
});

describe('botLabel — an attacker-controlled string is not a name (TABS-05)', () => {
  it('refuses to print an injection probe as if it were an agent', () => {
    expect(botLabel('${@print(md5(1))}')).toBe(UNREADABLE_LABEL);
    expect(botLabel('-1')).toBe(UNREADABLE_LABEL);
    expect(botLabel("' OR 1=1--")).toBe(UNREADABLE_LABEL);
  });

  it('leaves an ordinary product name alone', () => {
    expect(botLabel('Python-urllib/3.11')).toBe('Python-urllib/3.11');
    expect(botLabel('curl/8.4.0')).toBe('curl/8.4.0');
  });
});

describe('groupBots — one line per caller, not per build (TABS-05, TABS-14)', () => {
  const NOW = new Date('2026-08-20T09:00:00Z');
  const bot = (ua: string, over: Partial<BotDossier> = {}): BotDossier => ({
    id: ua,
    userAgent: ua,
    label: botLabel(ua),
    homepage: null,
    clientKind: null,
    firstSeenAt: '2026-08-01T00:00:00.000Z',
    lastSeenAt: '2026-08-19T00:00:00.000Z',
    daysSinceLastCall: 1,
    requests: 10,
    ok: 10,
    paywall: 0,
    badInput: 0,
    notFound: 0,
    serverError: 0,
    billableOk: 0,
    avgMs: 20,
    distinctIps: 1,
    endpoints: [],
    notFoundPaths: [],
    hours: Array(24).fill(0),
    days: [],
    verdict: 'visiteur',
    ...over,
  });

  it('folds every generic browser into one line carrying the count', () => {
    const groups = groupBots(
      [
        bot('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'),
        bot('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'),
        bot('Mozilla/5.0 (compatible; Something/1.0)'),
        bot('SentinelOracle/0.1'),
      ],
      NOW,
    );
    const browsers = groups.find((g) => g.id === 'groupe:Navigateurs');
    expect(browsers?.label).toBe('Navigateurs (3)');
    expect(browsers?.requests).toBe(30);
    expect(browsers?.members).toHaveLength(3);
    // The real agent is untouched and gains no layer to click through.
    const agent = groups.find((g) => g.id === 'SentinelOracle/0.1');
    expect(agent?.members).toBeUndefined();
  });

  it('groups a product across its versions and keeps them as detail', () => {
    const groups = groupBots(
      [
        bot('Python-urllib/3.11', { requests: 100, notFound: 90 }),
        bot('Python-urllib/3.9', { requests: 50, notFound: 45 }),
      ],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Python-urllib');
    expect(groups[0].requests).toBe(150);
    expect(groups[0].members?.map((m) => m.label)).toEqual(['Python-urllib/3.11', 'Python-urllib/3.9']);
    // The verdict is decided on the merged totals: mostly 404s is 'perdu'.
    expect(groups[0].verdict).toBe('perdu');
  });

  it('does not let an old build age into « parti » beside its successor', () => {
    // The defect TABS-14 names: upgrading minted a new dossier and left the old
    // one to be reported as a departure.
    const groups = groupBots(
      [
        bot('curl/8.4.0', { lastSeenAt: '2026-08-19T00:00:00.000Z', daysSinceLastCall: 1 }),
        bot('curl/7.1.0', { lastSeenAt: '2026-06-01T00:00:00.000Z', daysSinceLastCall: 80, verdict: 'parti' }),
      ],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].verdict).not.toBe('parti');
    expect(groups[0].daysSinceLastCall).toBe(1);
  });

  it('weights the latency by traffic rather than averaging builds flat', () => {
    const groups = groupBots(
      [bot('curl/8.4.0', { requests: 900, avgMs: 10 }), bot('curl/7.1.0', { requests: 100, avgMs: 110 })],
      NOW,
    );
    expect(groups[0].avgMs).toBe(20);
  });
});

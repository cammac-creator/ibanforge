import type { SearchConsole, SignupSources, WebEventsSummary } from '@/lib/dashboard-overview';

export const AUDIENCE_TABS = ['summary', 'site', 'journey', 'google', 'details'] as const;
export type AudienceTab = (typeof AUDIENCE_TABS)[number];
export function audienceTab(value: unknown): AudienceTab {
  return typeof value === 'string' && AUDIENCE_TABS.includes(value as AudienceTab)
    ? (value as AudienceTab)
    : 'summary';
}

/** La route funnel compte depuis `since`, et non depuis aujourd'hui moins `days`. */
export function audienceSince(period: number, nowIso: string): string {
  const days = [7, 30, 90].includes(period) ? period : 30;
  return new Date(Date.parse(nowIso) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
}

export interface AudienceIndicator {
  numerator: number;
  denominator: number;
  pending: number;
  coverage: number | null;
  value: number | null;
}
export interface AudienceShare {
  numerator: number;
  denominator: number;
  value: number | null;
}
export const INDICATORS = [
  'first_result_24h',
  'unmarked_use_7d',
  'return_week_2',
  'attributable_purchase_30d',
  'paid_key_delivered',
  'paid_use_7d',
] as const;
export type IndicatorKey = (typeof INDICATORS)[number];
export const TRIAL_INDICATORS = [
  'first_result_24h',
  'return_week_2',
  'attributable_purchase_30d',
] as const;
export interface AudienceBucket {
  name: string;
  lineages: number;
  first_result_24h: AudienceIndicator;
  return_week_2: AudienceIndicator;
  attributable_purchase_30d: AudienceIndicator;
}
export const DEVICE_COUNTERS = [
  'opened',
  'approved',
  'delivered',
  'rate_limited',
  'approved_anonymous',
  'approved_email',
  'denied',
  'expired',
] as const;
export interface AudienceFunnel {
  observed_at: string;
  measurement_started_at: string | null;
  window: { from: string; to: string };
  lineages: { created: number; admissible: number; pending: number };
  indicators: Record<IndicatorKey, AudienceIndicator>;
  unknown_context_share: AudienceShare;
  paid_link_coverage: AudienceShare;
  by_birth_source: AudienceBucket[];
  by_first_client: AudienceBucket[];
  device: {
    window_days: { from: string; to: string };
    counters: Record<(typeof DEVICE_COUNTERS)[number], number>;
    by_door: Array<
      { source: string } & Omit<Record<(typeof DEVICE_COUNTERS)[number], number>, 'approved'>
    >;
    chain: Record<
      'approved_of_opened' | 'delivered_of_approved' | 'lineages_of_delivered',
      AudienceShare
    >;
    lineages: { created: number; admissible: number };
    indicators: Record<(typeof TRIAL_INDICATORS)[number], AudienceIndicator>;
    mcp_remote: { sessions: number; tool_calls: number; key_requests: number };
  };
}

const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);
const count = (x: unknown): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const str = (x: unknown): x is string => typeof x === 'string';
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const date = (x: unknown): x is string =>
  str(x) && /^\d{4}-\d{2}-\d{2}/.test(x) && Number.isFinite(Date.parse(x.slice(0, 10)));
const counts = (x: unknown, keys: readonly string[]): boolean =>
  object(x) && keys.every((k) => count(x[k]));
const rows = (x: unknown, valid: (r: Record<string, unknown>) => boolean): boolean =>
  Array.isArray(x) && x.every((r) => object(r) && valid(r));
const share = (x: unknown): boolean =>
  object(x) &&
  count(x.numerator) &&
  count(x.denominator) &&
  (x.denominator === 0
    ? x.value === null
    : finite(x.value) && Math.abs(x.value - x.numerator / x.denominator) <= 0.00011);
const indicator = (x: unknown): boolean =>
  object(x) &&
  share(x) &&
  count(x.pending) &&
  count(x.denominator) &&
  count(x.numerator) &&
  x.numerator <= x.denominator &&
  (x.denominator + x.pending === 0
    ? x.coverage === null
    : finite(x.coverage) &&
      Math.abs(x.coverage - x.denominator / (x.denominator + x.pending)) <= 0.00011);
const indicators = (x: unknown, keys: readonly string[]): boolean =>
  object(x) && keys.every((k) => indicator(x[k]));
const windowDates = (x: unknown): boolean =>
  object(x) && date(x.from) && date(x.to) && x.from <= x.to;
const bucket = (r: Record<string, unknown>): boolean =>
  str(r.name) && count(r.lineages) && indicators(r, TRIAL_INDICATORS);

/** Une réponse partielle ne devient jamais une population de zéro essais. */
export function readAudienceFunnel(raw: unknown): AudienceFunnel | null {
  if (
    !object(raw) ||
    !date(raw.observed_at) ||
    !(raw.measurement_started_at === null || date(raw.measurement_started_at)) ||
    !windowDates(raw.window) ||
    !counts(raw.lineages, ['created', 'admissible', 'pending']) ||
    !indicators(raw.indicators, INDICATORS) ||
    !share(raw.unknown_context_share) ||
    !share(raw.paid_link_coverage) ||
    !rows(raw.by_birth_source, bucket) ||
    !rows(raw.by_first_client, bucket)
  )
    return null;
  const d = raw.device;
  if (
    !object(d) ||
    !windowDates(d.window_days) ||
    !counts(d.counters, DEVICE_COUNTERS) ||
    !rows(
      d.by_door,
      (r) =>
        str(r.source) &&
        counts(
          r,
          DEVICE_COUNTERS.filter((k) => k !== 'approved'),
        ),
    ) ||
    !object(d.chain) ||
    !['approved_of_opened', 'delivered_of_approved', 'lineages_of_delivered'].every((k) =>
      share(d.chain && (d.chain as Record<string, unknown>)[k]),
    ) ||
    !counts(d.lineages, ['created', 'admissible']) ||
    !indicators(d.indicators, TRIAL_INDICATORS) ||
    !counts(d.mcp_remote, ['sessions', 'tool_calls', 'key_requests'])
  )
    return null;
  return raw as unknown as AudienceFunnel;
}

export function readAudienceWeb(raw: unknown): WebEventsSummary | null {
  if (
    !object(raw) ||
    !count(raw.days) ||
    !count(raw.total) ||
    !(raw.since === null || date(raw.since)) ||
    !rows(raw.by_name, (r) => str(r.name) && count(r.count)) ||
    !rows(raw.by_page, (r) => str(r.page) && str(r.locale) && count(r.count)) ||
    !rows(raw.by_referrer, (r) => str(r.referrer) && count(r.count)) ||
    !rows(raw.by_day, (r) => date(r.day) && count(r.count))
  )
    return null;
  return raw as unknown as WebEventsSummary;
}

export function readAudienceSources(raw: unknown): SignupSources | null {
  if (
    !object(raw) ||
    !count(raw.period_days) ||
    !count(raw.total) ||
    !(raw.since === null || date(raw.since)) ||
    !rows(raw.channels, (r) => str(r.channel) && count(r.n)) ||
    !rows(raw.landings, (r) => str(r.path) && count(r.n)) ||
    !rows(raw.referrers, (r) => str(r.host) && count(r.n)) ||
    !rows(
      raw.campaigns,
      (r) =>
        str(r.utm_source) &&
        (r.utm_medium === null || str(r.utm_medium)) &&
        (r.utm_campaign === null || str(r.utm_campaign)) &&
        count(r.n),
    )
  )
    return null;
  return raw as unknown as SignupSources;
}

export function readAudienceGoogle(raw: unknown): SearchConsole | null {
  const metrics = (r: Record<string, unknown>) =>
    count(r.clicks) && count(r.impressions) && (r.position === null || finite(r.position));
  if (
    !object(raw) ||
    !str(raw.site) ||
    !date(raw.window_end) ||
    !date(raw.fetched_at) ||
    typeof raw.stale !== 'boolean' ||
    !windowDates(
      raw.top_window && object(raw.top_window)
        ? { from: raw.top_window.start, to: raw.top_window.end }
        : null,
    ) ||
    !rows(
      raw.weeks,
      (r) => date(r.start) && date(r.end) && metrics(r) && (r.ctr === null || finite(r.ctr)),
    ) ||
    !rows(raw.queries, (r) => str(r.key) && metrics(r)) ||
    !rows(raw.pages, (r) => str(r.key) && metrics(r)) ||
    !rows(
      raw.sitemaps,
      (r) =>
        str(r.path) &&
        count(r.submitted) &&
        (r.indexed === null || count(r.indexed)) &&
        count(r.errors) &&
        count(r.warnings) &&
        typeof r.is_pending === 'boolean' &&
        (r.last_submitted === null || str(r.last_submitted)) &&
        (r.last_downloaded === null || str(r.last_downloaded)),
    ) ||
    !rows(
      raw.inspections,
      (r) =>
        str(r.path) &&
        ['indexed', 'not-indexed', 'unknown'].includes(String(r.state)) &&
        (r.coverage === null || str(r.coverage)) &&
        (r.last_crawled === null || str(r.last_crawled)) &&
        (r.error === null || str(r.error)),
    )
  )
    return null;
  return raw as unknown as SearchConsole;
}

export type Ranking = { label: string; value: number };
export function rank(rows: Ranking[]): Ranking[] {
  const grouped = new Map<string, number>();
  for (const r of rows) grouped.set(r.label, (grouped.get(r.label) ?? 0) + r.value);
  return [...grouped]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || (a.label < b.label ? -1 : 1));
}
/** Les événements serveur /api et les lectures de film ne sont pas des clics sur le site. */
export function siteSummary(web: WebEventsSummary) {
  const actions = rank(
    web.by_name
      .filter((r) => /^(nav|cta):/.test(r.name))
      .map((r) => ({ label: r.name, value: r.count })),
  );
  const pages = web.by_page.filter((r) => r.page !== '/api');
  return {
    clicks: actions.reduce((sum, r) => sum + r.value, 0),
    actions,
    pages: rank(pages.map((r) => ({ label: r.page, value: r.count }))),
    locales: rank(pages.map((r) => ({ label: r.locale, value: r.count }))),
    films: rank(
      web.by_name
        .filter((r) => r.name.startsWith('film:'))
        .map((r) => ({ label: r.name, value: r.count })),
    ),
  };
}
export function googleSummary(google: SearchConsole) {
  const weeks = [...google.weeks].sort((a, b) => (a.start < b.start ? -1 : 1));
  const clicks = weeks.reduce((sum, r) => sum + r.clicks, 0);
  const impressions = weeks.reduce((sum, r) => sum + r.impressions, 0);
  const latest = weeks.at(-1),
    previous = weeks.at(-2);
  const consecutive =
    latest && previous && Date.parse(latest.start) - Date.parse(previous.end) === 86_400_000;
  return {
    weeks,
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : null,
    delta:
      consecutive && previous.clicks > 0
        ? (latest.clicks - previous.clicks) / previous.clicks
        : null,
  };
}

export function audienceDate(value: string | null): string {
  return value ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}` : '—';
}

export interface DailyCallers {
  unit: 'account';
  period_days: 30 | 90;
  window: { from: string; to: string };
  today_partial: true;
  days: Array<{ day: string; accounts: number }>;
}

/** Refuse une série incomplète, dupliquée ou incohérente au lieu d'inventer des zéros. */
export function readDailyCallers(raw: unknown): DailyCallers | null {
  const dayKey = (value: unknown): value is string => typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (!object(raw) || raw.unit !== 'account' || ![30, 90].includes(Number(raw.period_days)) ||
      typeof raw.period_days !== 'number' || raw.today_partial !== true || !object(raw.window) ||
      !dayKey(raw.window.from) || !dayKey(raw.window.to) || !Array.isArray(raw.days) ||
      raw.days.length !== raw.period_days) return null;
  const from = Date.parse(raw.window.from);
  if (Date.parse(raw.window.to) !== from + (raw.period_days - 1) * 86_400_000) return null;
  if (!raw.days.every((day, index) => object(day) && dayKey(day.day) && count(day.accounts) &&
    day.day === new Date(from + index * 86_400_000).toISOString().slice(0, 10))) return null;
  return raw as unknown as DailyCallers;
}

export function dailyCallerSeries(reading: DailyCallers | null, period: number, today: string) {
  if (!reading || reading.window.to !== today) return null;
  const floor = Date.parse(today) - (period - 1) * 86_400_000;
  return reading.days.filter((day) => Date.parse(day.day) >= floor).map((day, index, days) => {
    const completed = days.slice(Math.max(0, index - 6), index + 1).filter((d) => d.day < today);
    return { ...day, average: day.day === today || !completed.length ? null
      : completed.reduce((sum, d) => sum + d.accounts, 0) / completed.length };
  });
}

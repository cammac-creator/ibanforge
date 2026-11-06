import type { SearchConsole } from '@/lib/dashboard-overview';
import { toZurich } from '@/lib/crm/zurich';

const DAY = 86_400_000;
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);
const text = (x: unknown): x is string => typeof x === 'string';
const count = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
const positive = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/** Date du calendrier Google : pas de conversion vers le fuseau du navigateur. */
function day(x: unknown): x is string {
  if (!text(x) || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const ms = Date.parse(`${x}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === x;
}
function stamp(x: unknown): x is string {
  if (!text(x) || !day(x.slice(0, 10))) return false;
  if (x.length === 10) return true;
  if (
    !/^\d{4}-\d{2}-\d{2}[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.test(
      x,
    )
  )
    return false;
  return Number.isFinite(
    Date.parse(/[Zz]|[+-]\d{2}:\d{2}$/.test(x) ? x.replace(' ', 'T') : `${x.replace(' ', 'T')}Z`),
  );
}
const optionalText = (x: unknown) => x === null || text(x);
const optionalStamp = (x: unknown) => x === null || stamp(x);
function rows(x: unknown, key: string, valid: (r: Record<string, unknown>) => boolean): boolean {
  if (!Array.isArray(x)) return false;
  const seen = new Set<unknown>();
  return x.every((r) => {
    if (!object(r) || !valid(r) || seen.has(r[key])) return false;
    seen.add(r[key]);
    return true;
  });
}
const metrics = (r: Record<string, unknown>) =>
  count(r.clicks) && count(r.impressions) && (r.position === null || positive(r.position));

/**
 * Même lecture pour la synthèse et le détail : une réponse incomplète n'est pas
 * un zéro. Les anciennes valeurs `indexed` sont ignorées, cache compris : Google
 * déprécie ce champ (developers.google.com/webmaster-tools/v1/sitemaps).
 */
export function readSearchConsoleSnapshot(raw: unknown): SearchConsole | null {
  if (
    !object(raw) ||
    !text(raw.site) ||
    !raw.site.trim() ||
    !day(raw.window_end) ||
    !stamp(raw.fetched_at) ||
    raw.fetched_at.length === 10 ||
    raw.window_end > raw.fetched_at.slice(0, 10) ||
    typeof raw.stale !== 'boolean' ||
    (raw.refreshing !== undefined && typeof raw.refreshing !== 'boolean') ||
    !object(raw.top_window) ||
    !day(raw.top_window.start) ||
    !day(raw.top_window.end) ||
    raw.top_window.start > raw.top_window.end ||
    raw.top_window.end > raw.window_end ||
    !Array.isArray(raw.weeks) ||
    !raw.weeks.length
  )
    return null;

  const end = raw.window_end;
  if (
    !rows(
      raw.weeks,
      'start',
      (r) =>
        day(r.start) &&
        day(r.end) &&
        new Date(`${r.start}T00:00:00Z`).getUTCDay() === 1 &&
        Date.parse(r.end) - Date.parse(r.start) === 6 * DAY &&
        r.end <= end &&
        metrics(r) &&
        (r.ctr === null || positive(r.ctr)),
    ) ||
    !rows(raw.queries, 'key', (r) => text(r.key) && metrics(r)) ||
    !rows(raw.pages, 'key', (r) => text(r.key) && metrics(r)) ||
    !rows(
      raw.sitemaps,
      'path',
      (r) =>
        text(r.path) &&
        count(r.submitted) &&
        count(r.errors) &&
        count(r.warnings) &&
        typeof r.is_pending === 'boolean' &&
        optionalStamp(r.last_submitted) &&
        optionalStamp(r.last_downloaded),
    ) ||
    !rows(
      raw.inspections,
      'path',
      (r) =>
        text(r.path) &&
        ['indexed', 'not-indexed', 'unknown'].includes(String(r.state)) &&
        optionalText(r.coverage) &&
        optionalText(r.error) &&
        optionalStamp(r.last_crawled),
    )
  )
    return null;

  const data = raw as unknown as SearchConsole;
  if (
    !count(data.weeks.reduce((n, w) => n + w.clicks, 0)) ||
    !count(data.weeks.reduce((n, w) => n + w.impressions, 0))
  )
    return null;
  // Une position nulle n'est pas une place meilleure que la première.
  const position = (r: { position: number | null; impressions: number }) =>
    r.impressions > 0 && r.position !== null && r.position >= 1 ? r.position : null;
  return {
    ...data,
    weeks: data.weeks.map((w) => ({
      ...w,
      position: position(w),
      ctr: w.impressions > 0 ? Math.round((w.clicks / w.impressions) * 1000) / 10 : null,
    })),
    queries: data.queries.map((r) => ({ ...r, position: position(r) })),
    pages: data.pages.map((r) => ({ ...r, position: position(r) })),
    sitemaps: data.sitemaps.map((r) => ({ ...r, indexed: null })),
  };
}

export function googleReadAt(value: string): string {
  if (!stamp(value) || value.length === 10) return '—';
  const iso = /[Zz]|[+-]\d{2}:\d{2}$/.test(value)
    ? value.replace(' ', 'T')
    : `${value.replace(' ', 'T')}Z`;
  const swiss = toZurich(new Date(iso).toISOString());
  return `${swiss.slice(8, 10)}.${swiss.slice(5, 7)}.${swiss.slice(0, 4)} · ${swiss.slice(11, 16)}`;
}

export type GoogleInspectionFilter = 'all' | 'indexed' | 'not-indexed' | 'unknown' | 'unavailable';
export function inspectionState(
  row: SearchConsole['inspections'][number],
): Exclude<GoogleInspectionFilter, 'all'> {
  return row.error ? 'unavailable' : row.state;
}

export interface ActivityPoint { key: string; label: string; count: number; bad: number; partial: boolean }
export type DayActivity = Array<{ day: string; count: number; bad?: number }>;
const DAY = 86_400_000, HOUR = 3_600_000;
const isoDay = (n: number) => new Date(n).toISOString().slice(0, 10);
const dayLabel = (key: string) => key.split('-').reverse().join('.');

export function dailyActivity(days: DayActivity, span: number, at: string): ActivityPoint[] {
  const end = Date.parse(at.slice(0, 10));
  const known = new Map(days.map(d => [d.day, d]));
  return Array.from({ length: span }, (_, i) => {
    const key = isoDay(end - (span - i - 1) * DAY), d = known.get(key);
    return { key, label: dayLabel(key), count: d?.count ?? 0, bad: d?.bad ?? 0, partial: i === span - 1 };
  });
}

/** Une semaine tronquée par la période choisie reste signalée comme partielle. */
export function weeklyActivity(days: DayActivity, at: string): ActivityPoint[] {
  if (!days.length) return [];
  const monday = (day: string) => { const t = Date.parse(day); return t - ((new Date(t).getUTCDay() + 6) % 7) * DAY; };
  const last = monday(at.slice(0, 10));
  const firstDay = days.map(d => d.day).sort()[0];
  const first = Math.max(monday(firstDay), last - 12 * 7 * DAY);
  const totals = new Map<string, { count: number; bad: number }>();
  for (const d of days) {
    const key = isoDay(monday(d.day)), row = totals.get(key) ?? { count: 0, bad: 0 };
    row.count += d.count; row.bad += d.bad ?? 0; totals.set(key, row);
  }
  const out: ActivityPoint[] = [];
  for (let t = first; t <= last; t += 7 * DAY) {
    const key = isoDay(t), row = totals.get(key);
    out.push({ key, label: `semaine du ${dayLabel(key)}`, count: row?.count ?? 0, bad: row?.bad ?? 0, partial: key < firstDay || t === last });
  }
  return out;
}

export function monthlyActivity(months: Array<{ month: string; count: number }>, at: string): ActivityPoint[] {
  const now = new Date(at), sums = new Map<string, number>();
  for (const m of months) sums.set(m.month, (sums.get(m.month) ?? 0) + m.count);
  return Array.from({ length: 12 }, (_, i) => {
    const key = isoDay(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1)).slice(0, 7);
    return { key, label: key, count: sums.get(key) ?? 0, bad: 0, partial: i === 11 };
  });
}

export interface HourActivity { start: string; end: string; rows: Array<{ hour: string; count: number; bad: number }> }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function decodeHours(raw: unknown, email: string): HourActivity | null {
  if (!object(raw) || raw.email !== email.toLowerCase() || raw.timezone !== 'UTC' || typeof raw.generated_at !== 'string' || typeof raw.window_start !== 'string' || !Array.isArray(raw.hours)) return null;
  const end = Date.parse(raw.generated_at), start = Date.parse(raw.window_start);
  if (!Number.isFinite(end) || end - start !== DAY) return null;
  const first = Math.floor(start / HOUR) * HOUR, last = Math.floor(end / HOUR) * HOUR;
  const seen = new Set<string>();
  for (const row of raw.hours) {
    if (!object(row) || typeof row.hour !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(row.hour) || !count(row.count) || !count(row.bad) || row.bad > row.count) return null;
    const t = Date.parse(row.hour + 'Z');
    if (!Number.isFinite(t) || t < first || t > last || new Date(t).toISOString().slice(0, 16) !== row.hour || seen.has(row.hour)) return null;
    seen.add(row.hour);
  }
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), rows: raw.hours as HourActivity['rows'] };
}

export function hourlyActivity(data: HourActivity): ActivityPoint[] {
  const start = Date.parse(data.start), end = Date.parse(data.end), known = new Map(data.rows.map(h => [h.hour, h]));
  const out: ActivityPoint[] = [];
  for (let t = Math.floor(start / HOUR) * HOUR; t <= end; t += HOUR) {
    const key = new Date(t).toISOString().slice(0, 16), row = known.get(key);
    out.push({ key, label: `${dayLabel(key.slice(0, 10))} · ${key.slice(11)} UTC`, count: row?.count ?? 0, bad: row?.bad ?? 0, partial: t < start || t + HOUR > end });
  }
  return out;
}

/** Agrégats conservés : opérations par jour de semaine et heure UTC, sans identité. */
export const HOURLY_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export function readHourlyActivity(value: unknown, period: number) {
  if (!object(value) || value.source !== 'hourly_stats' || value.unit !== 'operations' || value.timezone !== 'UTC' ||
      !integer(value.period_days) || value.period_days < 1 || value.period_days > 90 || value.period_days !== period ||
      !date(value.window_start) || !date(value.window_end) ||
      Date.parse(value.window_end) - Date.parse(value.window_start) !== (period - 1) * 86400_000 ||
      !Array.isArray(value.heatmap) || value.heatmap.length > 168) return null;
  const grid: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const seen = new Set<string>();
  let total = 0;
  for (const row of value.heatmap) {
    if (!object(row) || !integer(row.day) || row.day > 6 || !integer(row.hour) || row.hour > 23 || !integer(row.total)) return null;
    const key = `${row.day}:${row.hour}`;
    if (seen.has(key)) return null;
    seen.add(key);
    grid[row.day][row.hour] = row.total;
    total += row.total;
    if (!Number.isSafeInteger(total)) return null;
  }
  const byDay = grid.map((hours) => hours.reduce((sum, n) => sum + n, 0));
  let peak: { day: number; hour: number; count: number } | null = null;
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++)
    if (grid[d][h] > (peak?.count ?? 0)) peak = { day: d, hour: h, count: grid[d][h] };
  return { grid, byDay, total, peak, start: value.window_start, end: value.window_end };
}
export function hourlyDate(value: string) { return `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}`; }
export function hourRange(hour: number) { return `${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00`; }

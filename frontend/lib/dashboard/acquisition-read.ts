export interface AcquisitionSourceRow { source: string; signups: number; called: number; paying: number }
export interface AcquisitionCohortRow { week_start: string; signups: number; called_pct: number; paid_pct: number; partial?: boolean }
export interface ActivationFunnelData {
  period_days: number; signed_up: number; first_call: number; hit_limit: number; purchased: number;
  median_hours_signup_to_first_call: number | null; median_hours_first_call_to_purchase: number | null;
  median_n_signup_to_first_call?: number; median_n_first_call_to_purchase?: number;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const percent = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;

/** Les états sont indépendants, mais tous sont une part de la même population conservée. */
export function readActivationFunnel(value: unknown): ActivationFunnelData | null {
  if (!object(value) || ![30, 90].includes(value.period_days as number) || !count(value.signed_up)) return null;
  for (const key of ['first_call', 'hit_limit', 'purchased']) {
    if (!count(value[key]) || value[key] > value.signed_up) return null;
  }
  return value as unknown as ActivationFunnelData;
}

export function readAcquisitionSources(value: unknown): AcquisitionSourceRow[] | null {
  if (!Array.isArray(value)) return null;
  const names = new Set<string>();
  for (const row of value) {
    if (!object(row) || typeof row.source !== 'string' || !row.source.trim() || names.has(row.source) ||
      !count(row.signups) || !count(row.called) || !count(row.paying) || row.called > row.signups || row.paying > row.signups) return null;
    names.add(row.source);
  }
  return [...value].sort((a, b) => b.signups - a.signups) as AcquisitionSourceRow[];
}

/** L’instant partagé par la page détermine la semaine incomplète, sans seconde horloge. */
export function readAcquisitionCohorts(value: unknown, nowIso: string): AcquisitionCohortRow[] | null {
  const now = new Date(nowIso);
  if (!Array.isArray(value) || !Number.isFinite(now.getTime())) return null;
  now.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  const monday = now.toISOString().slice(0, 10), seen = new Set<string>();
  for (const row of value) {
    if (!object(row) || typeof row.week_start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.week_start)) return null;
    const d = new Date(`${row.week_start}T00:00:00Z`);
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== row.week_start || d.getUTCDay() !== 1 ||
      row.week_start > monday || seen.has(row.week_start) || !count(row.signups) || !percent(row.called_pct) || !percent(row.paid_pct) ||
      (row.signups === 0 && (row.called_pct !== 0 || row.paid_pct !== 0)) ||
      (row.partial !== undefined && (typeof row.partial !== 'boolean' || row.partial !== (row.week_start === monday)))) return null;
    seen.add(row.week_start);
  }
  return value.map(row => ({ ...row, partial: row.week_start === monday })).sort((a, b) => a.week_start.localeCompare(b.week_start));
}

/** Une médiane invalide ou sans observation reste inconnue, même si les compteurs sont connus. */
export function observedDelay(hours: unknown, sample: unknown): { hours: number; sample: number | null } | null {
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0 ||
    (sample !== undefined && (!count(sample) || sample === 0))) return null;
  return { hours, sample: sample === undefined ? null : sample as number };
}

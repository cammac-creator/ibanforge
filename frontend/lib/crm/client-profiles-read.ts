import type { ClientProfileRow } from './client-dossiers';

export interface ProfilesPayload {
  readable: boolean;
  generatedAt: string | null;
  windowStart: string | null;
  profiles: Record<string, ClientProfileRow>;
  monthsByKey: Record<string, Array<{ month: string; count: number }>>;
  quotaWarnedByKey: Record<string, string[]>;
}

export function unreadableProfiles(): ProfilesPayload {
  return { readable: false, generatedAt: null, windowStart: null, profiles: {}, monthsByKey: {}, quotaWarnedByKey: {} };
}

type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const stamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v) && Number.isFinite(Date.parse(v));
const day = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const month = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const namedCounts = (v: unknown, key: string): boolean => Array.isArray(v) && v.every(r => object(r) && typeof r[key] === 'string' && count(r.count));

function profile(v: unknown, prefix: string, start: string, end: string): v is ClientProfileRow {
  if (!object(v) || v.key_prefix !== prefix) return false;
  if (!['total', 'ok', 'paywall', 'bad_input', 'auth_or_quota', 'server_error', 'avg_ms', 'p95_ms', 'distinct_ips'].every(k => count(v[k]))) return false;
  if (!['first_seen', 'last_seen', 'last_success_at', 'last_refusal_at'].every(k => v[k] === null || stamp(v[k]))) return false;
  if (!Array.isArray(v.hours) || v.hours.length !== 24 || !v.hours.every(count)) return false;
  if (!Array.isArray(v.days) || !v.days.every(r => object(r) && day(r.day) && r.day >= start && r.day <= end && count(r.count) && (r.bad === undefined || (count(r.bad) && r.bad <= r.count)))) return false;
  if (new Set(v.days.map(r => (r as Obj).day)).size !== v.days.length) return false;
  if (v.days.reduce((s, r) => s + (r as { count: number }).count, 0) !== v.total) return false;
  return [['endpoints', 'path'], ['countries', 'code'], ['user_agents', 'ua'], ['client_kinds', 'kind'], ['reject_reasons', 'reason']].every(([key, label]) => namedCounts(v[key], label));
}

/** Un HTTP 200 ne suffit pas : un vrai vide possède lui aussi son contrat de période. */
export function decodeClientProfiles(raw: unknown, expectedDays: number): ProfilesPayload {
  const unavailable = unreadableProfiles();
  if (!object(raw) || raw.period_days !== expectedDays || raw.timezone !== 'UTC') return unavailable;
  if (!stamp(raw.generated_at) || !stamp(raw.window_start) || raw.window_end !== raw.generated_at) return unavailable;
  const end = new Date(raw.generated_at).toISOString();
  const start = new Date(raw.window_start).toISOString();
  const expectedStart = new Date(Date.parse(end.slice(0, 10)) - (expectedDays - 1) * 86_400_000).toISOString();
  if (start !== expectedStart || !object(raw.profiles) || !object(raw.months_by_key) || !object(raw.quota_warned_by_key)) return unavailable;
  if (!Object.entries(raw.profiles).every(([key, row]) => profile(row, key, start.slice(0, 10), end.slice(0, 10)))) return unavailable;
  if (!Object.values(raw.months_by_key).every(rows => Array.isArray(rows) && rows.every(r => object(r) && month(r.month) && count(r.count)))) return unavailable;
  if (!Object.values(raw.quota_warned_by_key).every(rows => Array.isArray(rows) && rows.every(month))) return unavailable;
  return {
    readable: true, generatedAt: end, windowStart: start,
    profiles: raw.profiles as Record<string, ClientProfileRow>,
    monthsByKey: raw.months_by_key as ProfilesPayload['monthsByKey'],
    quotaWarnedByKey: raw.quota_warned_by_key as ProfilesPayload['quotaWarnedByKey'],
  };
}

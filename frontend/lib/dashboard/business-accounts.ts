import { localePath } from '@/lib/locale-path';
import { readViewTimestamp } from './view-freshness';

export const BUSINESS_COHORTS = ['active_today', 'active_week', 'new_accounts', 'new_buyers'] as const;
export type BusinessCohort = (typeof BUSINESS_COHORTS)[number];
export interface BusinessAccount {
  email: string;
  created_at: string;
  first_purchase_at: string | null;
  active_days: number;
  last_active_day: string | null;
}
export interface BusinessAccounts {
  version: 1; generated_at: string; timezone: 'UTC'; basis: 'retained_accounts_and_purchases';
  cohort: BusinessCohort; window: { start: string; end: string };
  total: number; page: number; page_size: number; pages: number; rows: BusinessAccount[];
}
const DAY = 86_400_000;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const stamp = (value: unknown) => typeof value === 'string' ? readViewTimestamp(value) : null;
const day = (value: unknown): number | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value)) return null;
  const parsed = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
};

export function businessCohort(value: unknown): BusinessCohort | null {
  return typeof value === 'string' && BUSINESS_COHORTS.includes(value as BusinessCohort) ? value as BusinessCohort : null;
}
export function businessAccountsHref(locale: string, cohort: BusinessCohort, page = 1): string {
  return `${localePath(locale, '/dashboard/indicators')}?cohort=${cohort}${page > 1 ? `&page=${page}` : ''}`;
}

/** Une liste partielle, d’une autre période ou d’une autre population reste indisponible. */
export function readBusinessAccounts(value: unknown, expected: BusinessCohort, nowIso: string): BusinessAccounts | null {
  if (!object(value) || value.version !== 1 || value.timezone !== 'UTC' ||
      value.basis !== 'retained_accounts_and_purchases' || value.cohort !== expected) return null;
  const generated = stamp(value.generated_at), now = stamp(nowIso);
  if (!generated || !now || generated.epoch > now.epoch + 60_000) return null;
  const today = day(generated.iso.slice(0, 10))!;
  const start = expected === 'active_today' ? today : expected === 'active_week' ? today - 6 * DAY
    : today - ((new Date(today).getUTCDay() + 6) % 7) * DAY;
  if (!object(value.window) || day(value.window.start) !== start || day(value.window.end) !== today) return null;
  if (!count(value.total) || value.page_size !== 50 || !count(value.page) || value.page < 1 ||
      value.pages !== Math.max(1, Math.ceil(value.total / 50)) || value.page > (value.pages as number)) return null;
  if (!Array.isArray(value.rows) || value.rows.length !== Math.min(50, value.total - (value.page - 1) * 50)) return null;
  const emails = new Set<string>(), rows: BusinessAccount[] = [];
  for (const row of value.rows) {
    if (!object(row) || typeof row.email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(row.email) ||
        row.email.length > 320 || row.email !== row.email.trim().toLowerCase() || emails.has(row.email)) return null;
    const created = stamp(row.created_at), purchased = row.first_purchase_at === null ? null : stamp(row.first_purchase_at);
    if (!created || created.epoch > generated.epoch || (row.first_purchase_at !== null && !purchased) ||
        (purchased && purchased.epoch > generated.epoch)) return null;
    if (!count(row.active_days) || row.active_days > (today - start) / DAY + 1) return null;
    const last = day(row.last_active_day);
    if (row.active_days === 0 ? row.last_active_day !== null : last === null || last < start || last > today) return null;
    if ((expected === 'active_today' || expected === 'active_week') && row.active_days === 0) return null;
    if (expected === 'new_accounts' && created.epoch < start) return null;
    if (expected === 'new_buyers' && (!purchased || purchased.epoch < start)) return null;
    emails.add(row.email);
    rows.push({ email: row.email, created_at: created.iso, first_purchase_at: purchased?.iso ?? null,
      active_days: row.active_days, last_active_day: row.last_active_day as string | null });
  }
  return { version: 1, generated_at: generated.iso, timezone: 'UTC', basis: 'retained_accounts_and_purchases',
    cohort: expected, window: { start: value.window.start as string, end: value.window.end as string },
    total: value.total, page: value.page, page_size: 50, pages: value.pages as number, rows };
}

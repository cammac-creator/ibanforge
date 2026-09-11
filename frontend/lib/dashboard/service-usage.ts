/** Comptes rattachables dans les traces conservées, sans attribution aux visites. */
export interface ServiceUsageSnapshot {
  version: 1;
  period_days: 30 | 90;
  window_start: string;
  observed_until: string;
  unit: 'account';
  observation_basis: 'retained_request_log';
  active_accounts: number;
  returning_accounts: number;
  first_observed_accounts: number;
}

/** Une ancienne API ou une lecture incohérente ne deviennent jamais trois zéros. */
export function retainedServiceUsage(value: unknown): ServiceUsageSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as ServiceUsageSnapshot;
  if (data.version !== 1 || data.unit !== 'account'
    || data.observation_basis !== 'retained_request_log'
    || (data.period_days !== 30 && data.period_days !== 90)) return null;
  const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  for (const value of [data.window_start, data.observed_until]) {
    if (typeof value !== 'string' || !utc.test(value) || !Number.isFinite(Date.parse(value))
      || new Date(value).toISOString() !== value) return null;
  }
  const start = new Date(data.observed_until);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - data.period_days + 1);
  if (start.toISOString() !== data.window_start) return null;
  const counts = [data.active_accounts, data.returning_accounts, data.first_observed_accounts];
  if (counts.some((n) => !Number.isSafeInteger(n) || n < 0)
    || data.returning_accounts > data.active_accounts
    || data.first_observed_accounts > data.active_accounts) return null;
  return data;
}

/** Les bornes de cette mesure restent en UTC, comme les jours qu’elle compte. */
export function serviceUsageUtcDay(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

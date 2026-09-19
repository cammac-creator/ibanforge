import { getStatsDB } from './db.js';
import { isInternalEmail } from './internal-accounts.js';

export interface DailyCallers {
  unit: 'account';
  period_days: 30 | 90;
  window: { from: string; to: string };
  today_partial: true;
  days: Array<{ day: string; accounts: number }>;
}

/** Comptes attribuables ayant appelé, quel que soit le statut ou le chemin. */
export function getDailyCallers(days = 30, now = new Date()): DailyCallers {
  const period = days === 90 ? 90 : 30;
  const until = now.toISOString();
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - period + 1);
  const from = start.toISOString();
  const db = getStatsDB();
  const owners = db
    .prepare('SELECT key_prefix, email, tier, issued_by_us FROM api_keys')
    .all() as Array<{ key_prefix: string; email: string; tier: string; issued_by_us: number }>;
  const byPrefix = new Map<string, { accounts: Set<string>; excluded: boolean }>();
  for (const key of owners) {
    const account = key.email.trim().toLowerCase();
    const entry = byPrefix.get(key.key_prefix) ?? { accounts: new Set<string>(), excluded: false };
    entry.accounts.add(account);
    entry.excluded ||=
      key.tier === 'anonymous' ||
      key.issued_by_us === 1 ||
      !account.includes('@') ||
      isInternalEmail(account) ||
      /-pilot@/i.test(account);
    byPrefix.set(key.key_prefix, entry);
  }

  const observed = new Map<string, Set<string>>();
  const rows = db
    .prepare(
      `SELECT DISTINCT key_prefix, date(created_at) AS day
    FROM request_log WHERE key_prefix IS NOT NULL
    AND julianday(created_at) >= julianday(?) AND julianday(created_at) <= julianday(?)`,
    )
    .all(from, until) as Array<{ key_prefix: string; day: string }>;
  for (const row of rows) {
    const owner = byPrefix.get(row.key_prefix);
    // L'ambiguïté se décide avant de retenir un compte externe.
    if (!owner || owner.excluded || owner.accounts.size !== 1) continue;
    const account = owner.accounts.values().next().value;
    if (!account) continue;
    const accounts = observed.get(row.day) ?? new Set<string>();
    accounts.add(account);
    observed.set(row.day, accounts);
  }
  return {
    unit: 'account',
    period_days: period,
    window: { from: from.slice(0, 10), to: until.slice(0, 10) },
    today_partial: true,
    days: Array.from({ length: period }, (_, index) => {
      const day = new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10);
      return { day, accounts: observed.get(day)?.size ?? 0 };
    }),
  };
}

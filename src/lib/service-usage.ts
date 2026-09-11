import { getStatsDB } from './db.js';
import { isInternalEmail } from './internal-accounts.js';
import { buildBillableFilter } from './stats.js';

/** Observations conservées, sans identité retournée ni attribution à une vente. */
export interface ServiceUsage {
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

interface KeyOwner {
  key_prefix: string;
  email: string;
}

interface ObservedPrefix {
  key_prefix: string;
  first_observed_at: string;
  days_in_window: string | null;
}

// Ces valeurs peuvent appartenir à plusieurs acheteurs sans adresse rattachée.
const GENERIC_ACCOUNTS = new Set(['credits-buyer', 'stripe-buyer', 'oem-subscriber']);

/**
 * Une réponse métier 2xx, pas un verdict IBAN positif ni une preuve de paiement.
 * Les purges peuvent retirer la première utilisation : le minimum reste donc
 * une première observation dans les traces encore conservées.
 */
export function getServiceUsage(days = 30, now = new Date()): ServiceUsage {
  const periodDays = days === 90 ? 90 : 30;
  const observedUntil = now.toISOString();
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (periodDays - 1));
  const windowStart = start.toISOString();
  const db = getStatsDB();

  // Toutes les clés conservées, y compris inactives après une rotation.
  const owners = db.prepare('SELECT key_prefix, email FROM api_keys').all() as KeyOwner[];
  const accountsByPrefix = new Map<string, Set<string>>();
  for (const owner of owners) {
    const account = owner.email.trim().toLowerCase();
    const accounts = accountsByPrefix.get(owner.key_prefix) ?? new Set<string>();
    accounts.add(account);
    accountsByPrefix.set(owner.key_prefix, accounts);
  }
  const eligible = new Map<string, string>();
  for (const [prefix, accounts] of accountsByPrefix) {
    // Décider l'ambiguïté avant les exclusions évite d'attribuer une clé
    // partagée entre un compte interne et un compte externe à ce dernier.
    if (accounts.size !== 1) continue;
    const account = accounts.values().next().value;
    if (!account || GENERIC_ACCOUNTS.has(account) || isInternalEmail(account)) continue;
    eligible.set(prefix, account);
  }

  const result: ServiceUsage = {
    version: 1,
    period_days: periodDays,
    window_start: windowStart,
    observed_until: observedUntil,
    unit: 'account',
    observation_basis: 'retained_request_log',
    active_accounts: 0,
    returning_accounts: 0,
    first_observed_accounts: 0,
  };
  if (eligible.size === 0) return result;

  const filter = buildBillableFilter();
  const rows = db
    .prepare(
      `SELECT key_prefix,
              MIN(strftime('%Y-%m-%dT%H:%M:%fZ', created_at)) AS first_observed_at,
              GROUP_CONCAT(DISTINCT CASE
                WHEN julianday(created_at) >= julianday(?) THEN date(created_at)
              END) AS days_in_window
         FROM request_log
        WHERE key_prefix IS NOT NULL
          AND status >= 200 AND status < 300
          AND (${filter.sql})
          AND path NOT LIKE '%\\%7B%' ESCAPE '\\'
          AND path NOT LIKE '%{%'
          AND julianday(created_at) <= julianday(?)
        GROUP BY key_prefix`,
    )
    .all(windowStart, ...filter.params, observedUntil) as ObservedPrefix[];

  const accounts = new Map<string, { first: string; days: Set<string> }>();
  for (const row of rows) {
    const account = eligible.get(row.key_prefix);
    if (!account) continue;
    const previous = accounts.get(account) ?? {
      first: row.first_observed_at,
      days: new Set<string>(),
    };
    if (row.first_observed_at < previous.first) previous.first = row.first_observed_at;
    for (const day of row.days_in_window?.split(',') ?? []) previous.days.add(day);
    accounts.set(account, previous);
  }
  for (const account of accounts.values()) {
    if (account.days.size > 0) result.active_accounts++;
    if (account.days.size >= 2) result.returning_accounts++;
    if (account.first >= windowStart) result.first_observed_accounts++;
  }
  return result;
}

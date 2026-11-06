import { getStatsDB } from './db.js';
import { isInternalEmail } from './internal-accounts.js';
import { buildBillableFilter } from './stats.js';

export interface BusinessDay {
  date: string;
  active_accounts: number;
  new_accounts: number;
  new_buyers: number;
}

/** Agrégats de pilotage uniquement : aucune identité ne sort de ce module. */
export interface BusinessPulse {
  version: 1;
  generated_at: string;
  timezone: 'UTC';
  basis: 'retained_accounts_and_purchases';
  days: BusinessDay[];
  weeks: Array<{
    start: string;
    end: string;
    partial: boolean;
    new_accounts: number;
    new_buyers: number;
  }>;
  totals: {
    known_accounts: number;
    buyer_accounts: number;
    active_7d: number;
    active_30d: number;
    returning_7d: number;
  };
}

const DAY = 86_400_000;
const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** SQLite, ISO et décalages horaires partagent le même repère. */
function instant(value: string | null): number | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?$/.test(value)
    ? value.replace(' ', 'T') + 'Z'
    : value;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Source : clés, achats et traces conservés. Or : séries anonymes du dashboard.
 * Un compte = une adresse normalisée, toutes ses clés réunies. Une utilisation
 * = au moins une réponse métier 2xx, jamais un passage sur une page ni un robot
 * qui explore la documentation. Des comptes distincts ne prouvent pas autant
 * de personnes ou d'entreprises ; l'interface garde cette réserve visible.
 */
export function getBusinessPulse(now = new Date()): BusinessPulse {
  const nowMs = now.getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const windowStart = today - 89 * DAY;
  const monday = today - ((now.getUTCDay() + 6) % 7) * DAY;
  const db = getStatsDB();
  const keys = db
    .prepare(
      `SELECT key_prefix, email, created_at, COALESCE(lineage_hash, key_hash) AS lineage
       FROM api_keys`,
    )
    .all() as Array<{ key_prefix: string; email: string; created_at: string; lineage: string }>;
  const owners = new Map<string, Set<string>>();
  const lineages = new Map<string, Set<string>>();
  const births = new Map<string, number>();
  const external = (email: string) => email.includes('@') && !isInternalEmail(email);
  for (const key of keys) {
    const email = key.email.trim().toLowerCase();
    for (const [map, id] of [
      [owners, key.key_prefix],
      [lineages, key.lineage],
    ] as const) {
      const set = map.get(id) ?? new Set<string>();
      set.add(email);
      map.set(id, set);
    }
    const created = instant(key.created_at);
    if (external(email) && created !== null && created <= nowMs) {
      births.set(email, Math.min(created, births.get(email) ?? Infinity));
    }
  }
  const owner = (map: Map<string, Set<string>>, id: string) => {
    const set = map.get(id);
    if (set?.size !== 1) return null;
    const email = set.values().next().value;
    return email && external(email) && births.has(email) ? email : null;
  };
  const days = Array.from({ length: 90 }, (_, i): BusinessDay => ({
    date: dateOf(windowStart + i * DAY),
    active_accounts: 0,
    new_accounts: 0,
    new_buyers: 0,
  }));
  const dayMap = new Map(days.map((day) => [day.date, day]));
  for (const birth of births.values()) {
    const day = dayMap.get(dateOf(birth));
    if (day) day.new_accounts++;
  }

  // La borne textuelle utilise l'index de date ; un jour de marge couvre les
  // décalages ISO. Les bornes exactes restent appliquées par julianday.
  const filter = buildBillableFilter();
  const activity = db
    .prepare(
      `SELECT key_prefix, date(created_at) AS day FROM request_log
      WHERE created_at >= ? AND julianday(created_at) >= julianday(?)
        AND julianday(created_at) <= julianday(?)
        AND key_prefix IS NOT NULL AND status >= 200 AND status < 300
        AND (${filter.sql})
        AND path NOT LIKE '%\\%7B%' ESCAPE '\\' AND path NOT LIKE '%{%'
      GROUP BY key_prefix, date(created_at)`,
    )
    .all(
      dateOf(windowStart - DAY),
      new Date(windowStart).toISOString(),
      now.toISOString(),
      ...filter.params,
    ) as Array<{ key_prefix: string; day: string }>;
  const activeByDay = new Map<string, Set<string>>();
  const activeByAccount = new Map<string, Set<string>>();
  for (const row of activity) {
    const account = owner(owners, row.key_prefix);
    if (!account || !dayMap.has(row.day)) continue;
    const daily = activeByDay.get(row.day) ?? new Set<string>();
    daily.add(account);
    activeByDay.set(row.day, daily);
    const dates = activeByAccount.get(account) ?? new Set<string>();
    dates.add(row.day);
    activeByAccount.set(account, dates);
  }
  for (const day of days) day.active_accounts = activeByDay.get(day.date)?.size ?? 0;

  // Une recharge et une rotation ne recréent jamais un acheteur. Un achat
  // remboursé reste un achat historique : sa date ne doit pas glisser vers
  // celle d'un achat ultérieur. Les sommes ne sont pas additionnées ici.
  const purchases = db
    .prepare(
      `SELECT lineage_hash, COALESCE(settled_at, created_at) AS purchased_at
       FROM key_purchases
      WHERE outcome IN ('credited', 'minted', 'minted_fallback', 'reinstated', 'attached', 'refunded', 'disputed')
        AND kind IN ('pack', 'subscription')
        AND COALESCE(issued_by_us, 0) = 0
        AND (amount_minor IS NULL OR amount_minor > 0)
        AND (quoted_amount_usd IS NULL OR quoted_amount_usd > 0)`,
    )
    .all() as Array<{ lineage_hash: string; purchased_at: string }>;
  const firstPurchases = new Map<string, number>();
  for (const row of purchases) {
    const account = owner(lineages, row.lineage_hash);
    const paidAt = instant(row.purchased_at);
    if (!account || paidAt === null || paidAt > nowMs) continue;
    firstPurchases.set(account, Math.min(paidAt, firstPurchases.get(account) ?? Infinity));
  }
  for (const first of firstPurchases.values()) {
    const day = dayMap.get(dateOf(first));
    if (day) day.new_buyers++;
  }
  const totals: BusinessPulse['totals'] = {
    known_accounts: births.size,
    buyer_accounts: firstPurchases.size,
    active_7d: 0,
    active_30d: 0,
    returning_7d: 0,
  };
  const seven = dateOf(today - 6 * DAY);
  const thirty = dateOf(today - 29 * DAY);
  for (const dates of activeByAccount.values()) {
    const weekDays = [...dates].filter((date) => date >= seven).length;
    if (weekDays > 0) totals.active_7d++;
    if (weekDays > 1) totals.returning_7d++;
    if ([...dates].some((date) => date >= thirty)) totals.active_30d++;
  }
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const start = dateOf(monday - (7 - i) * 7 * DAY);
    const end = dateOf(monday - (7 - i) * 7 * DAY + 6 * DAY);
    const rows = days.filter((day) => day.date >= start && day.date <= end);
    return {
      start,
      end,
      partial: i === 7,
      new_accounts: rows.reduce((n, day) => n + day.new_accounts, 0),
      new_buyers: rows.reduce((n, day) => n + day.new_buyers, 0),
    };
  });
  return {
    version: 1,
    generated_at: now.toISOString(),
    timezone: 'UTC',
    basis: 'retained_accounts_and_purchases',
    days,
    weeks,
    totals,
  };
}

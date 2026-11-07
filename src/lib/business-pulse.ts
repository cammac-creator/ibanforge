import { getStatsDB } from './db.js';
import { isInternalEmail } from './internal-accounts.js';
import { buildBillableFilter } from './stats.js';

export interface BusinessDay {
  date: string;
  active_accounts: number;
  new_accounts: number;
  new_buyers: number;
}

/** Réponse agrégée du pilotage : aucune identité ne sort de getBusinessPulse. */
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
function businessSnapshot(now: Date) {
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
  const pulse: BusinessPulse = {
    version: 1,
    generated_at: now.toISOString(),
    timezone: 'UTC',
    basis: 'retained_accounts_and_purchases',
    days,
    weeks,
    totals,
  };
  return { pulse, births, firstPurchases, activeByAccount, today, monday };
}

/** Le contrat agrégé reste inchangé et ne contient aucun courriel. */
export function getBusinessPulse(now = new Date()): BusinessPulse {
  return businessSnapshot(now).pulse;
}

export const BUSINESS_COHORTS = [
  'active_today',
  'active_week',
  'new_accounts',
  'new_buyers',
] as const;
export type BusinessCohort = (typeof BUSINESS_COHORTS)[number];
const ACCOUNTS_PAGE_SIZE = 50;

export interface BusinessAccountRow {
  email: string;
  created_at: string;
  first_purchase_at: string | null;
  active_days: number;
  last_active_day: string | null;
}

export interface BusinessAccounts {
  version: 1;
  generated_at: string;
  timezone: 'UTC';
  basis: 'retained_accounts_and_purchases';
  cohort: BusinessCohort;
  window: { start: string; end: string };
  total: number;
  page: number;
  page_size: number;
  pages: number;
  rows: BusinessAccountRow[];
}

/** Détail réservé à l’administration : mêmes faits et exclusions que les compteurs. */
export function getBusinessAccounts(
  cohort: BusinessCohort,
  requestedPage = 1,
  now = new Date(),
): BusinessAccounts {
  const { pulse, births, firstPurchases, activeByAccount, today, monday } = businessSnapshot(now);
  const start =
    cohort === 'active_today' ? today : cohort === 'active_week' ? today - 6 * DAY : monday;
  const startDay = dateOf(start);
  const rows: BusinessAccountRow[] = [];
  for (const [email, birth] of births) {
    const days = [...(activeByAccount.get(email) ?? [])].filter((day) => day >= startDay).sort();
    const purchased = firstPurchases.get(email);
    const matches =
      cohort === 'new_accounts'
        ? birth >= start
        : cohort === 'new_buyers'
          ? purchased !== undefined && purchased >= start
          : days.length > 0;
    if (!matches) continue;
    rows.push({
      email,
      created_at: new Date(birth).toISOString(),
      first_purchase_at: purchased === undefined ? null : new Date(purchased).toISOString(),
      active_days: days.length,
      last_active_day: days.at(-1) ?? null,
    });
  }
  const order = (row: BusinessAccountRow) =>
    cohort === 'new_accounts'
      ? row.created_at
      : cohort === 'new_buyers'
        ? row.first_purchase_at!
        : row.last_active_day!;
  rows.sort((a, b) =>
    order(a) === order(b)
      ? a.email < b.email
        ? -1
        : a.email > b.email
          ? 1
          : 0
      : order(a) > order(b)
        ? -1
        : 1,
  );
  const pages = Math.max(1, Math.ceil(rows.length / ACCOUNTS_PAGE_SIZE));
  const page = Math.min(
    pages,
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
  );
  return {
    version: 1,
    generated_at: pulse.generated_at,
    timezone: 'UTC',
    basis: pulse.basis,
    cohort,
    window: { start: startDay, end: dateOf(today) },
    total: rows.length,
    page,
    page_size: ACCOUNTS_PAGE_SIZE,
    pages,
    rows: rows.slice((page - 1) * ACCOUNTS_PAGE_SIZE, page * ACCOUNTS_PAGE_SIZE),
  };
}

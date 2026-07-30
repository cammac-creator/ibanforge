import { enrichEmail } from '@/lib/company-enrichment';
import { INTERNAL_RE, type KeyRow } from './build-contacts';

/**
 * One rung of the podium. Lives here rather than beside the card that draws it
 * because the calculation is the thing worth pinning down: the card only reads
 * what this produces.
 */
export interface TopUserToday {
  email: string;
  company: string | null;
  sector: string | null;
  category: 'PAYANT' | 'PILOTE' | 'GRATUIT';
  count: number;
  /** Whether the count is today's attributed requests or the month's fallback. */
  period: 'today' | 'month';
}

/** How an address is labelled when its keys disagree: paid beats pilot beats free. */
function categoryOf(row: KeyRow): TopUserToday['category'] {
  if (row.credits_total != null) return 'PAYANT';
  if ((row.monthly_limit ?? 0) >= 5000) return 'PILOTE';
  return 'GRATUIT';
}

const CAT_RANK = { PAYANT: 0, PILOTE: 1, GRATUIT: 2 } as const;

/**
 * The top-3 podium: requests attributed per client address, all of its keys
 * combined, internal accounts excluded, on the same UTC day convention as
 * request_log. On a quiet day it backfills with this month's most active
 * clients (api_usage `used`), which is where free-tier usage lives from before
 * per-key daily attribution existed, so the podium always shows real users.
 *
 * Everything it needs is already in the payload the page fetches; nothing was
 * added to the fetch for it.
 */
export function topUsers(
  keys: KeyRow[],
  activityByKey: Record<string, { days: Array<{ day: string; count: number }> }>,
  todayUtc: string,
): TopUserToday[] {
  const collect = (
    map: Map<string, TopUserToday>,
    row: KeyRow,
    count: number,
    period: TopUserToday['period'],
  ) => {
    const category = categoryOf(row);
    const prev = map.get(row.email.toLowerCase());
    if (prev) {
      prev.count += count;
      if (CAT_RANK[category] < CAT_RANK[prev.category]) prev.category = category;
    } else {
      const enriched = enrichEmail(row.email);
      map.set(row.email.toLowerCase(), {
        email: row.email,
        company: enriched.company,
        sector: enriched.sector,
        category,
        count,
        period,
      });
    }
  };

  const todayByEmail = new Map<string, TopUserToday>();
  for (const row of keys) {
    if (INTERNAL_RE.test(row.email)) continue;
    const count = activityByKey[row.key_prefix]?.days.find((d) => d.day === todayUtc)?.count ?? 0;
    if (count > 0) collect(todayByEmail, row, count, 'today');
  }
  const top = [...todayByEmail.values()].sort((a, b) => b.count - a.count).slice(0, 3);

  if (top.length < 3) {
    const monthByEmail = new Map<string, TopUserToday>();
    for (const row of keys) {
      if (INTERNAL_RE.test(row.email)) continue;
      if (todayByEmail.has(row.email.toLowerCase())) continue;
      if (row.used > 0) collect(monthByEmail, row, row.used, 'month');
    }
    const monthly = [...monthByEmail.values()].sort((a, b) => b.count - a.count);
    top.push(...monthly.slice(0, 3 - top.length));
  }
  return top;
}

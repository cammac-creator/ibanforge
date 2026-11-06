/** Projection du contrat agrégé ; aucune dépendance au serveur de l’API. */
export interface BusinessDay {
  date: string;
  active_accounts: number;
  new_accounts: number;
  new_buyers: number;
}
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
const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const dayMs = (s: unknown) =>
  typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s) ? Date.parse(s + 'T00:00:00Z') : NaN;

/** Une API ancienne, une réponse partielle ou incohérente n’est jamais un zéro. */
export function readBusinessPulse(value: unknown): BusinessPulse | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as BusinessPulse;
  if (
    p.version !== 1 ||
    p.timezone !== 'UTC' ||
    p.basis !== 'retained_accounts_and_purchases' ||
    typeof p.generated_at !== 'string' ||
    !Number.isFinite(Date.parse(p.generated_at)) ||
    new Date(p.generated_at).toISOString() !== p.generated_at
  )
    return null;
  if (
    !Array.isArray(p.days) ||
    p.days.length !== 90 ||
    !Array.isArray(p.weeks) ||
    p.weeks.length !== 8 ||
    !p.totals
  )
    return null;
  const end = dayMs(p.generated_at.slice(0, 10));
  for (const [i, d] of p.days.entries()) {
    if (
      !d ||
      dayMs(d.date) !== end - (89 - i) * 86400000 ||
      ![d.active_accounts, d.new_accounts, d.new_buyers].every(count)
    )
      return null;
  }
  const t = p.totals;
  if (
    ![t.known_accounts, t.buyer_accounts, t.active_7d, t.active_30d, t.returning_7d].every(count) ||
    t.returning_7d > t.active_7d ||
    t.active_7d > t.active_30d ||
    t.active_30d > t.known_accounts ||
    t.buyer_accounts > t.known_accounts
  )
    return null;
  if (p.days.some((d) => d.active_accounts > t.known_accounts)) return null;
  if (
    p.days.reduce((n, d) => n + d.new_accounts, 0) > t.known_accounts ||
    p.days.reduce((n, d) => n + d.new_buyers, 0) > t.buyer_accounts
  )
    return null;
  for (const size of [7, 30] as const) {
    const rows = p.days.slice(-size);
    const total = size === 7 ? t.active_7d : t.active_30d;
    if (
      total < Math.max(...rows.map((d) => d.active_accounts)) ||
      total > rows.reduce((n, d) => n + d.active_accounts, 0)
    )
      return null;
  }
  const monday = end - ((new Date(end).getUTCDay() + 6) % 7) * 86400000;
  for (const [i, w] of p.weeks.entries()) {
    if (
      !w ||
      dayMs(w.start) !== monday - (7 - i) * 7 * 86400000 ||
      dayMs(w.end) !== dayMs(w.start) + 6 * 86400000 ||
      w.partial !== (i === 7) ||
      ![w.new_accounts, w.new_buyers].every(count)
    )
      return null;
    const rows = p.days.filter((d) => d.date >= w.start && d.date <= w.end);
    if (
      w.new_accounts !== rows.reduce((n, d) => n + d.new_accounts, 0) ||
      w.new_buyers !== rows.reduce((n, d) => n + d.new_buyers, 0)
    )
      return null;
  }
  return p;
}

/** Les jours en cours sont exclus de toute comparaison de journées complètes. */
export function completeWeekChange(
  pulse: BusinessPulse,
  metric: 'new_accounts' | 'new_buyers',
): number {
  return pulse.weeks[6][metric] - pulse.weeks[5][metric];
}

export function shortDay(day: string, locale: string): string {
  return locale.startsWith('en')
    ? `${day.slice(5, 7)}/${day.slice(8, 10)}`
    : `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

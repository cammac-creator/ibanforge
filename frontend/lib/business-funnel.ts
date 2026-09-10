import { formatDay } from '@/lib/crm/format';

/** Les noms des cinq compteurs restent ceux du contrat de l’API. */
export interface BusinessFunnelDay {
  date: string;
  success: number;
  paywall: number;
  auth_or_quota: number;
  bad_input: number;
  server_error: number;
}

export type BusinessFunnelRow = BusinessFunnelDay & {
  total: number;
  successShare: number;
  cohort_units: number;
  cohort_scaled: number;
  cohort_gap: number;
};

/** Les cohortes sont des repères : elles n’entrent ni dans le total ni dans le pourcentage. */
export function businessFunnelRows(
  data: BusinessFunnelDay[],
  cohortByDate: Record<string, number> = {},
): BusinessFunnelRow[] {
  const cohortValues = Object.values(cohortByDate).filter((n) => n > 0);
  const maxCohort = cohortValues.length ? Math.max(...cohortValues) : 0;
  const base = data.map((d) => {
    const total = d.success + d.paywall + d.auth_or_quota + d.bad_input + d.server_error;
    return { ...d, total, successShare: total > 0 ? (d.success / total) * 100 : 0 };
  });
  const maxTotal = Math.max(1, ...base.map((r) => r.total));
  return base.map((r) => {
    const units = cohortByDate[r.date] ?? 0;
    return {
      ...r,
      cohort_units: units,
      // Même échelle réduite et même espace que le repère historique.
      cohort_scaled: units > 0 && maxCohort > 0 ? Math.max(maxTotal * 0.03, (units / maxCohort) * maxTotal * 0.18) : 0,
      cohort_gap: units > 0 ? maxTotal * 0.05 : 0,
    };
  });
}

/** La page fournit son jour UTC commun au serveur et au navigateur. */
export function isCurrentUtcDay(date: unknown, todayUtc: string): boolean {
  return typeof date === 'string' && date === todayUtc;
}

/** Dates courtes par travail sur les chaînes, identiques dans Node et WebKit. */
export function formatRequestDay(date: string, locale: string): string {
  const day = formatDay(date) ?? date;
  if (!/^\d{2}\/\d{2}$/.test(day)) return day;
  if (locale.toLowerCase().startsWith('en')) return `${day.slice(3)}/${day.slice(0, 2)}`;
  if (locale.toLowerCase().startsWith('de')) return day.replace('/', '.');
  return day;
}

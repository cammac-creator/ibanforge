export const OVERVIEW_VIEWS = ['today', 'revenue', 'growth', 'service'] as const;
export type OverviewView = (typeof OVERVIEW_VIEWS)[number];

/** Un lien ancien ou incomplet ouvre toujours le travail du jour. */
export function overviewView(value: unknown): OverviewView {
  return typeof value === 'string' && OVERVIEW_VIEWS.includes(value as OverviewView)
    ? (value as OverviewView)
    : 'today';
}

export function overviewHref(
  pathname: string, view: OverviewView, period: number, audience?: string,
): string {
  const days = [7, 30, 90].includes(period) ? period : 30;
  const tab = view === 'growth' && audience && AUDIENCE_TABS.includes(audience as AudienceTab)
    ? `&audience=${audience}` : '';
  return `${pathname}?view=${view}&period=${days}${tab}`;
}
import { AUDIENCE_TABS, type AudienceTab } from './audience-model';

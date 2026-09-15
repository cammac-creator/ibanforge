export const OVERVIEW_VIEWS = ['today', 'revenue', 'growth', 'service'] as const;
export type OverviewView = (typeof OVERVIEW_VIEWS)[number];

/** Un lien ancien ou incomplet ouvre toujours le travail du jour. */
export function overviewView(value: unknown): OverviewView {
  return typeof value === 'string' && OVERVIEW_VIEWS.includes(value as OverviewView)
    ? (value as OverviewView)
    : 'today';
}

export function overviewHref(pathname: string, view: OverviewView, period: number): string {
  const days = [7, 30, 90].includes(period) ? period : 30;
  return `${pathname}?view=${view}&period=${days}`;
}

import { AUDIENCE_TABS, type AudienceTab } from './audience-model';

export const OVERVIEW_VIEWS = ['today', 'revenue', 'growth', 'service'] as const;
export type OverviewView = (typeof OVERVIEW_VIEWS)[number];

/** Un lien ancien ou incomplet ouvre toujours le travail du jour. */
export function overviewView(value: unknown): OverviewView {
  return typeof value === 'string' && OVERVIEW_VIEWS.includes(value as OverviewView)
    ? (value as OverviewView)
    : 'today';
}

export function overviewHref(
  pathname: string,
  view: OverviewView,
  period: number,
  audience?: string,
): string {
  const days = [7, 30, 90].includes(period) ? period : 30;
  const tab =
    view === 'growth' && audience && AUDIENCE_TABS.includes(audience as AudienceTab)
      ? `&audience=${audience}`
      : '';
  return `${pathname}?view=${view}&period=${days}${tab}`;
}

/** Les vues de pilotage sont des destinations, au même titre que le courrier. */
export const WORKSPACE_DESTINATIONS = [
  { key: 'today', path: '/dashboard', view: 'today' },
  { key: 'clients', path: '/dashboard/clients' },
  { key: 'contacts', path: '/dashboard/contacts' },
  { key: 'mail', path: '/dashboard/courrier' },
  { key: 'growth', path: '/dashboard', view: 'growth' },
  { key: 'revenue', path: '/dashboard', view: 'revenue' },
  { key: 'service', path: '/dashboard', view: 'service' },
  { key: 'bots', path: '/dashboard/clients-bot' },
  { key: 'forums', path: '/dashboard/forums' },
  { key: 'doors', path: '/dashboard/portes' },
  { key: 'bulletin', path: '/dashboard/bulletin' },
] as const;
export type WorkspaceDestination = (typeof WORKSPACE_DESTINATIONS)[number];

export function workspaceCurrent(pathname: string, view: unknown): WorkspaceDestination['key'] {
  const path = pathname.replace(/^\/(fr|en|de)(?=\/)/, '').replace(/\/$/, '');
  if (path === '/dashboard') return overviewView(view);
  return (
    WORKSPACE_DESTINATIONS.find(
      (item) => !('view' in item) && (path === item.path || path.startsWith(`${item.path}/`)),
    )?.key ?? 'today'
  );
}

export function workspaceHref(
  item: WorkspaceDestination,
  period: number,
  audience?: string,
): string {
  return 'view' in item ? overviewHref(item.path, item.view, period, audience) : item.path;
}

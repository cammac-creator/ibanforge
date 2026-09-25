import { requireDashboardSession } from '@/lib/auth';
import { ForumsApp } from '@/components/crm/forums-app';

/**
 * Forums tab: the community radar's output (scored threads worth answering,
 * marketplace presence) and the operator's working surface: French summary,
 * draft in the correspondent's language, copy button, statuses and planning.
 * The session is checked here first (requireDashboardSession), as on every
 * protected page, and again by the /api/crm proxies the data flows through,
 * so this page stays a plain client-side shell.
 */
export default async function ForumsPage() {
  await requireDashboardSession();
  return <ForumsApp />;
}

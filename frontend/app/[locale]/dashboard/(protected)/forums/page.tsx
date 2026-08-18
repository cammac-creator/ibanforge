import { ForumsApp } from '@/components/crm/forums-app';

/**
 * Forums tab: the community radar's output (scored threads worth answering,
 * marketplace presence) and the operator's working surface: French summary,
 * draft in the correspondent's language, copy button, statuses and planning.
 * Auth lives in the (protected) layout; data flows through /api/crm proxies,
 * so this page stays a plain client-side shell.
 */
export default function ForumsPage() {
  return <ForumsApp />;
}

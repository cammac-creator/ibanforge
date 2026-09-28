import { getLocale } from 'next-intl/server';
import { BulletinView } from '@/components/dashboard/bulletin-view';
import {
  FetchFailed,
  fetchJSON,
  notFetched,
  type Fetched,
} from '@/components/dashboard/overview/fetching';
import { requireDashboardSession } from '@/lib/auth';
import { readBulletin } from '@/lib/dashboard/bulletin';

export const dynamic = 'force-dynamic';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

/** The only week value passed on to the API: an ISO label, nothing else. */
const WEEK_LABEL = /^\d{4}-W\d{2}$/;

/**
 * The Monday bulletin (Claude-Alain's approval of 28.09.2026, step A1): one read,
 * `GET /v1/admin/bulletin`, server side, with the admin secret; the browser never
 * sees the secret. `?week=AAAA-Wss` opens a past week; without it, the last
 * complete week.
 *
 * 🚨 The dashboard's common guard opens the page, before the read: Next renders the
 * layout and the page in parallel, and without it every anonymous visit would make
 * the API compute the whole bulletin with the admin secret before being redirected
 * (review of 25.09.2026, D1; `lib/dashboard/session-guard.test.ts` requires it of
 * every page).
 */
export default async function BulletinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireDashboardSession();
  const locale = await getLocale();
  const { week } = await searchParams;
  const asked = typeof week === 'string' && WEEK_LABEL.test(week) ? week : null;
  const url = `${API_URL}/v1/admin/bulletin${asked ? `?week=${asked}` : ''}`;
  const read: Fetched<unknown> = ADMIN_SECRET
    ? await fetchJSON<unknown>(url, { 'X-Admin-Secret': ADMIN_SECRET })
    : notFetched<unknown>();
  const data = read.ok ? readBulletin(read.data) : null;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-[var(--fg-1)]">Bulletin du lundi</h1>
        <p className="mt-0.5 text-sm text-[var(--fg-4)]">
          Une semaine, du lundi au dimanche en heure suisse : les chiffres, ce qui a bougé et ce
          qu’on cherche sans trouver, lus là où ils sont déjà mesurés.
          {data ? ` Lu le ${data.observed_at_zurich}, heure suisse.` : ''}
        </p>
      </header>
      {data ? (
        <BulletinView data={data} locale={locale} />
      ) : read.ok ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-center">
          <p className="text-sm font-medium text-red-300">Bulletin du lundi indisponible</p>
          <p className="mt-1 text-xs text-[var(--fg-4)]">
            L’API a répondu dans une forme que cette page ne connaît pas (une autre version) :
            rien n’est affiché plutôt que des chiffres faux.
          </p>
        </div>
      ) : (
        <FetchFailed name="Bulletin du lundi" status={read.status} />
      )}
    </div>
  );
}

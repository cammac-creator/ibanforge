import { DoorsBoard } from '@/components/dashboard/doors-board';
import {
  FetchFailed,
  fetchJSON,
  notFetched,
  type Fetched,
} from '@/components/dashboard/overview/fetching';
import type { DoorsPayload } from '@/lib/dashboard/doors-board';

export const dynamic = 'force-dynamic';

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

/**
 * Le tableau des portes du lundi (plan d'audit du 22.09.2026, semaine 2) : une
 * seule lecture, `GET /v1/admin/doors`, celle dont le résumé Telegram du lundi
 * tire ses quatre nombres. Dix semaines : la fenêtre de mesure de la règle de
 * décision en compte dix.
 */
export default async function DoorsPage() {
  const read: Fetched<DoorsPayload> = ADMIN_SECRET
    ? await fetchJSON<DoorsPayload>(`${API_URL}/v1/admin/doors?weeks=10`, {
        'X-Admin-Secret': ADMIN_SECRET,
      })
    : notFetched<DoorsPayload>();

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-[var(--fg-1)]">Tableau des portes</h1>
        <p className="mt-0.5 text-sm text-[var(--fg-4)]">
          Par porte d’entrée et par semaine, du lundi au dimanche en heure suisse : les clés
          externes créées, leur premier appel réussi, les relances et ce qu’elles ont donné, le
          premier paiement. Des nombres de clés, jamais de requêtes.
          {read.data ? ` Lu le ${read.data.observed_at_zurich}, heure suisse.` : ''}
        </p>
      </header>
      {read.ok && read.data ? (
        <DoorsBoard data={read.data} />
      ) : (
        <FetchFailed name="Tableau des portes" status={read.status} />
      )}
    </div>
  );
}

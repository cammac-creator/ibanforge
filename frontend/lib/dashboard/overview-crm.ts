import { fetchCrmData, type ActivationClientRow } from '@/lib/crm/build-contacts';
import type { Fetched } from '@/components/dashboard/overview/fetching';
import { withReadDeadline } from './read-deadline';

/** Le consommateur peut cesser d’attendre sans annuler la lecture des autres sections. */
function waitForActivation(read: Promise<ActivationClientRow[] | null>, signal: AbortSignal): Promise<ActivationClientRow[] | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise(resolve => {
    const finish = (rows: ActivationClientRow[] | null) => { signal.removeEventListener('abort', abort); resolve(rows); };
    const abort = () => finish(null);
    signal.addEventListener('abort', abort, { once: true });
    void read.then(finish);
  });
}

/** Une interruption ne devient pas une synthèse de contacts partiellement vide. */
export async function fetchOverviewCrm(lightMessages: boolean, activation?: Promise<Fetched<ActivationClientRow[]>>) {
  // Le rejet est pris en charge dès l’entrée, même si les autres lectures échouent avant lui.
  const shared = activation?.then(result => result.ok && Array.isArray(result.data) ? result.data : null, () => null);
  try {
    return await withReadDeadline(async (signal) => {
      const data = await fetchCrmData({ lightMessages, signal, ...(shared ? { skip: ['activation'] as const } : {}) });
      if (!data || signal.aborted) return null;
      if (!shared) return data;
      const rows = await waitForActivation(shared, signal);
      if (signal.aborted) return null;
      return rows ? { ...data, activation: rows } : data;
    });
  } catch {
    return null;
  }
}

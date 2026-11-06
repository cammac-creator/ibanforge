import { fetchCrmData } from '@/lib/crm/build-contacts';
import { withReadDeadline } from './read-deadline';

/** Une interruption ne devient pas une synthèse de contacts partiellement vide. */
export async function fetchOverviewCrm(lightMessages: boolean) {
  try {
    return await withReadDeadline(async (signal) => {
      const data = await fetchCrmData({ lightMessages, signal });
      return signal.aborted ? null : data;
    });
  } catch {
    return null;
  }
}

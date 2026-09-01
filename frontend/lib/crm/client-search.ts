import { stateOfDossier, type ClientDossier, type Nuance } from './client-dossiers';
import { fold } from './mail-rows';
import type { BusinessStatus } from './types';

/**
 * What the État header can be narrowed to: the six words the API owns, the four
 * precisions the window adds, plus the two shelves that are not states at all.
 */
export type ClientFilter = BusinessStatus | Nuance | 'all' | 'used';

/** The words the API owns, for telling a state filter from a precision one. */
const STATE_KEYS = new Set<BusinessStatus>(['new', 'active', 'at-limit', 'paying', 'dormant', 'silent']);

/**
 * Does this dossier belong under the active État filter.
 *
 * A DERIVED state never matches a state filter. That is what makes "Endormis"
 * name the same people here as on Contacts: Contacts can only see the addresses
 * the activation table serves, so selecting one it does not know would put the
 * page back to two counts for one word. The precisions match on every row,
 * derived or not, because nothing else computes them.
 */
export function inClientFilter(d: ClientDossier, filter: ClientFilter): boolean {
  if (filter === 'used') return d.requests > 0;
  if (filter === 'all') return true;
  const st = stateOfDossier(d);
  if (STATE_KEYS.has(filter as BusinessStatus)) return !st.derived && st.status === filter;
  return st.nuance === filter;
}

/** Folded on both sides, like the Contacts search: "societe" finds Société. */
export function matchesClientQuery(d: ClientDossier, folded: string): boolean {
  if (!folded) return true;
  return (
    fold(d.email).includes(folded) ||
    fold(d.company ?? '').includes(folded) ||
    d.countries.some((c) => c.code.toLowerCase() === folded) ||
    d.keys.some((k) => k.prefix.toLowerCase().includes(folded))
  );
}

export interface ClientSearchResult {
  rows: ClientDossier[];
  /** True when the lens had to step outside the État filter to find anything. */
  widened: boolean;
}

/**
 * The lens searches every dossier, and widens the État filter by itself when
 * nothing inside it matched (audit finding TABS-04, 2026-09-01).
 *
 * The default view is "ont appelé" and most addresses have never called, so
 * typing the name of a silent signup answered "aucun client ne correspond"
 * while the dossier sat one filter away, with nothing on screen saying a filter
 * was on. The ⌘K deep link already knew to widen; the lens did not.
 *
 * Widening only on an EMPTY narrow result, rather than always searching the
 * whole base, is the part worth stating: a search that does find something
 * inside the active filter keeps the filter meaningful, and the operator is
 * never quietly shown rows that contradict the header he is reading. When it
 * does widen, it says so, so the surprise is announced rather than silent.
 */
export function searchDossiers(
  dossiers: ClientDossier[],
  filter: ClientFilter,
  query: string,
): ClientSearchResult {
  const q = fold(query.trim());
  const inFilter = dossiers.filter((d) => inClientFilter(d, filter));
  if (!q) return { rows: inFilter, widened: false };
  const found = inFilter.filter((d) => matchesClientQuery(d, q));
  if (found.length > 0) return { rows: found, widened: false };
  const everywhere = dossiers.filter((d) => matchesClientQuery(d, q));
  return { rows: everywhere, widened: everywhere.length > 0 };
}

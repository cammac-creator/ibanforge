/** Catégories fermées des informations d'arrivée déjà enregistrées, sans nouvelle collecte. */
export const ENTRY_REFERRERS = [
  'search',
  'developer_platform',
  'external',
  'internal',
  'unknown',
] as const;
export const ENTRY_PAGES = [
  'bank_lookup',
  'tool',
  'docs',
  'blog',
  'vendors',
  'audit',
  'pricing',
  'other',
  'unknown',
] as const;

const SEARCH_HOSTS = new Set([
  'google.com',
  'google.ch',
  'google.fr',
  'google.de',
  'google.at',
  'google.co.uk',
  'bing.com',
  'duckduckgo.com',
  'search.brave.com',
  'ecosia.org',
]);

export function entryReferrerCategory(raw: unknown): (typeof ENTRY_REFERRERS)[number] {
  if (typeof raw !== 'string' || !raw.trim()) return 'unknown';
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
  // Les valeurs anciennes ou mal formées ne deviennent pas une provenance connue.
  if (!/^[a-z0-9][a-z0-9.-]{0,79}$/.test(host)) return 'unknown';
  if (host === 'ibanforge.com' || host.endsWith('.ibanforge.com')) return 'internal';
  if (SEARCH_HOSTS.has(host)) return 'search';
  if (host === 'github.com' || host === 'stackoverflow.com') return 'developer_platform';
  return 'external';
}

export function entryPageCategory(raw: unknown): (typeof ENTRY_PAGES)[number] {
  if (typeof raw !== 'string' || !/^\/[A-Za-z0-9._~\-/%]{0,119}$/.test(raw)) return 'unknown';
  const path = raw.replace(/^\/(?:fr|en|de)(?=\/|$)/, '') || '/';
  const first = path.split('/')[1];
  if (['blz', 'iid', 'be', 'at', 'sk', 'sm', 'it', 'iban', 'iban-welche-bank'].includes(first))
    return 'bank_lookup';
  if (['tools', 'playground', 'sheets'].includes(first)) return 'tool';
  if (['docs', 'blog', 'vendors', 'audit', 'pricing'].includes(first))
    return first as 'docs' | 'blog' | 'vendors' | 'audit' | 'pricing';
  return 'other';
}

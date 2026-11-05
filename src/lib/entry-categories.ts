/** Catégories fermées des informations d'arrivée déjà enregistrées, sans nouvelle collecte. */
export const ENTRY_REFERRERS = [
  'search',
  'ai_assistant',
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

/** Les assistants IA nommés : liste fermée, une ligne par IA sur la carte du bulletin. */
export const AI_ASSISTANTS = ['chatgpt', 'perplexity', 'gemini', 'copilot', 'claude'] as const;
export type AiAssistant = (typeof AI_ASSISTANTS)[number];

/**
 * Correspondance exacte, sous-domaine compris : `chatgpt.com.alpha.example.net` reste un
 * autre site. Les services ne publient pas ce qu'ils envoient (ni référent, ni étiquette) ;
 * un hôte ne s'ajoute ici que s'il est constaté, jamais parce qu'il est plausible.
 */
const AI_ASSISTANT_HOSTS: ReadonlyMap<string, AiAssistant> = new Map([
  ['chatgpt.com', 'chatgpt'],
  ['chat.openai.com', 'chatgpt'],
  ['perplexity.ai', 'perplexity'],
  ['gemini.google.com', 'gemini'],
  ['copilot.microsoft.com', 'copilot'],
  ['claude.ai', 'claude'],
]);

/** ChatGPT marque souvent ses liens ainsi : la seule étiquette de campagne lue comme une IA. */
const AI_ASSISTANT_UTM_SOURCES: ReadonlyMap<string, AiAssistant> = new Map([
  ['chatgpt.com', 'chatgpt'],
]);

/** Un hôte réduit à sa forme comparable, ou null quand la valeur n'en est pas un. */
function comparableHost(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
  // Les valeurs anciennes ou mal formées ne deviennent pas une provenance connue.
  return /^[a-z0-9][a-z0-9.-]{0,79}$/.test(host) ? host : null;
}

/**
 * L'IA d'une arrivée, à partir des deux champs déjà enregistrés, ou null. Le référent
 * d'abord : il dit d'où vient le clic, l'étiquette ne fait que le déclarer. Un référent qui
 * nomme un autre site n'est donc pas repris par l'étiquette : `utm_source` ne répond que
 * quand le référent est absent. Rien de présent ne veut dire inconnu, jamais une IA.
 */
export function aiAssistantOf(referrer: unknown, utmSource: unknown): AiAssistant | null {
  const host = comparableHost(referrer);
  if (host) return AI_ASSISTANT_HOSTS.get(host) ?? null;
  const utm = typeof utmSource === 'string' ? utmSource.trim().toLowerCase() : '';
  return AI_ASSISTANT_UTM_SOURCES.get(utm) ?? null;
}

export function entryReferrerCategory(raw: unknown): (typeof ENTRY_REFERRERS)[number] {
  const host = comparableHost(raw);
  if (!host) return 'unknown';
  if (host === 'ibanforge.com' || host.endsWith('.ibanforge.com')) return 'internal';
  if (SEARCH_HOSTS.has(host)) return 'search';
  if (AI_ASSISTANT_HOSTS.has(host)) return 'ai_assistant';
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

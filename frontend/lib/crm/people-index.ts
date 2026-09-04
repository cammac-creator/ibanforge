import type { PersonRow } from './orphan-suggest';

/**
 * The CRM's people index and alias map, fetched once per browser session.
 *
 * Module-level caches: one fetch per browser session, shared by every control
 * that needs them. They survive soft navigations, so a person added to the CRM
 * mid-session only appears after a hard reload — accepted, because suggestions
 * and warnings are advisory and degrade to free typing. A failed fetch nulls
 * the slot so the next control (or this one, reopened) retries instead of
 * caching the miss.
 *
 * Shared rather than duplicated: two surfaces now ask the same question of the
 * same index — the orphan queue, which asks "is this sender already somebody",
 * and the correspondent form, which asks "is this address already claimed by a
 * commercial file". Two copies of this cache would mean two fetches and, worse,
 * two chances for the retry-on-failure behaviour above to be dropped by one of
 * them.
 *
 * A plain module with no 'use client' directive, same as buckets.ts and for the
 * same reason: nothing here is a component, and a directive would make these
 * client references. The fetches only ever run from a click or an effect, so
 * importing this module server side costs nothing.
 */
let indexPromise: Promise<PersonRow[]> | null = null;
let aliasesPromise: Promise<Map<string, string>> | null = null;

export function loadIndex(): Promise<PersonRow[]> {
  indexPromise ??= fetch('/api/crm/search-index')
    .then(async (r) => {
      if (!r.ok) throw new Error(`index HTTP ${r.status}`);
      const data = (await r.json()) as { rows?: PersonRow[] };
      return data.rows ?? [];
    })
    .catch((e: unknown) => {
      indexPromise = null;
      throw e instanceof Error ? e : new Error('index');
    });
  return indexPromise;
}

export function loadAliases(): Promise<Map<string, string>> {
  aliasesPromise ??= fetch('/api/crm/email-aliases')
    .then(async (r) => {
      if (!r.ok) throw new Error(`aliases HTTP ${r.status}`);
      const data = (await r.json()) as { aliases?: Array<{ alias: string; canonical: string }> };
      return new Map((data.aliases ?? []).map((a) => [a.alias, a.canonical]));
    })
    .catch((e: unknown) => {
      aliasesPromise = null;
      throw e instanceof Error ? e : new Error('aliases');
    });
  return aliasesPromise;
}

/**
 * Forget the alias map, so the next reader fetches it again.
 *
 * Called after an alias is written or removed: the map is cached for the
 * session, and without this a second orphan from the address just attached
 * would still read "no alias" and the double-identity warning would stay
 * silent — the one time it has something to say.
 */
export function invalidateAliases(): void {
  aliasesPromise = null;
}

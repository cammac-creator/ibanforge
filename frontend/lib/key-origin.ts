/**
 * The door a key was taken through, when no campaign tag says anything better.
 *
 * ## Why a default at all
 *
 * `lib/arrival.ts` captures the `?src=` our own outbound links carry. A visitor
 * who simply typed the address carries none, so the dialog sent no `source` and
 * the key was stored with an empty origin. That is how almost every key ever
 * issued ended up unattributable: not a bug in the capture, an absent default.
 *
 * An origin cannot be recovered afterwards — nothing else on the row says which
 * page the visitor was on. So when there is no tag, the dialog sends the page
 * it was opened from, which is always true and always available.
 *
 * ## Why the path and not the referrer
 *
 * The referrer of a key request is our own site on every internal navigation,
 * and `arrival.ts` drops own hosts on purpose. The path of the page the visitor
 * is looking at when they press the button is the one fact nothing else
 * carries: it separates "took a key while reading the prices" from "took a key
 * while reading the docs", which is the comparison the doors exist for.
 *
 * 🚨 The names below must exist in `src/lib/key-origins.ts`, which is the
 * vocabulary of record — `key-origin.test.ts` reads that file and fails if one
 * drifts. A name this site invents alone would be stored, counted, and belong
 * to no door.
 */

/** A door the API knows. Kept in step with `KEY_ORIGIN_DOORS` by the test beside this file. */
export type SiteDoor =
  | 'site-home'
  | 'site-pricing'
  | 'site-register'
  | 'site-docs'
  | 'site-dashboard'
  | 'site-api-page'
  | 'site-signup';

/**
 * The public bank-code pages, index included: where most of the search traffic
 * lands (29/09/2026). A key taken there — from the call to action under the
 * API's answer or from the header's button — gets a door of its own, so the
 * board can say whether these pages bring keys at all.
 *
 * 🚨 /at, /be and /sm are NOT listed, on purpose: those registers may be served
 * but not redistributed, their pages carry nothing beyond what they already
 * show, and the Austrian page runs its own measurement pilot since 15/09/2026,
 * whose series must not change door under it.
 */
const REGISTER_PREFIXES = ['/blz', '/iid', '/it', '/sk'] as const;

/**
 * The locale prefixes the router writes. Only these are stripped: English lives
 * at the root, so `/it/03069` is the English page of an Italian code and not an
 * Italian locale — a generic two-letter pattern swallowed the country segment.
 */
const LOCALE_PREFIX = /^\/(?:en|fr|de)(?=\/|$)/;

/**
 * The door for a page path, locale prefix included or not.
 *
 * Ordered from the most specific: `/fr/docs/api-keys` is documentation, not a
 * generic signup. Anything unmatched falls to `site-signup`, which is the
 * honest answer for the landing page, the blog and everything else — the page
 * itself still travels separately in `attribution.landing`.
 */
export function doorForPath(pathname: string): SiteDoor {
  // Strip the locale segment so /de/pricing and /pricing are one door.
  const path = pathname.replace(LOCALE_PREFIX, '') || '/';
  // The home has its own door since 27/09/2026, to measure what its redesign changes.
  if (path === '/') return 'site-home';
  if (path === '/pricing' || path.startsWith('/pricing/')) return 'site-pricing';
  if (REGISTER_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return 'site-register';
  if (path === '/docs' || path.startsWith('/docs/')) return 'site-docs';
  if (path.startsWith('/dashboard') || path.startsWith('/account')) return 'site-dashboard';
  // The page written for developers who search for an IBAN validation API
  // (29/09/2026): its own door, to tell whether that page brings keys at all.
  if (path === '/iban-validation-api' || path.startsWith('/iban-validation-api/')) return 'site-api-page';
  return 'site-signup';
}

/**
 * What to send as `source`: the campaign tag when the visit carries one, the
 * door otherwise. Never empty — an empty origin is the state this module ends.
 */
export function originForSignup(src: string | null | undefined, pathname: string): string {
  return src && src.trim() !== '' ? src : doorForPath(pathname);
}

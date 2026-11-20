/**
 * The closed list of page templates and the function that files a path under one. Pure: no
 * state, no environment, no server code, so the browser can import it too (the click beacon
 * sends a template instead of the raw path) and the visit counter (`page-views.ts`, which
 * re-exports all of this) uses the very same function. The list is the API's `PAGE_TEMPLATES`
 * (src/lib/page-views.ts); `src/lib/page-views.test.ts` reads THIS file to hold the two equal,
 * and `page-views.test.ts` here compares it with the routes on disk.
 */

export const PAGE_TEMPLATES = [
  '/',
  '/account',
  '/agents',
  '/alternatives',
  '/alternatives/:vendor',
  '/at',
  '/at/:code',
  '/audit',
  '/audit/done',
  '/be',
  '/be/:code',
  '/blog',
  '/blog/:slug',
  '/blz',
  '/blz/:code',
  '/changelog',
  '/clearing-calendar/:year',
  '/compare',
  '/device',
  '/docs',
  '/docs/:slug',
  '/iban',
  '/iban/:cc',
  '/iban-api-deutschland',
  '/iban-validation-api',
  '/iban-welche-bank',
  '/iid',
  '/iid/:iid',
  '/it',
  '/it/:code',
  '/legal',
  '/legal/:slug',
  '/openapi',
  '/playground',
  '/pricing',
  '/sheets',
  '/sk',
  '/sk/:code',
  '/sm',
  '/sm/:code',
  '/sources',
  '/status',
  '/tools',
  '/tools/qr-bill',
  '/tools/test-iban',
  '/trust',
  '/vendors',
] as const;

export const OTHER_PAGE = 'autre';
export const LOCALES = ['en', 'fr', 'de'] as const;

/** A pathname as `location.pathname` writes it: no query, no fragment, short. */
export const PATHNAME = /^\/[A-Za-z0-9._~\-/%]{0,119}$/;
const SEGMENT = /^[^/]+$/;

/**
 * The template of a path, or `autre`. The locale prefix (`/fr`, `/de`; English has none) is
 * dropped first. A path that is not a plain pathname (a query, a fragment, odd characters) is
 * `autre`, whatever follows.
 */
export function pageTemplate(path: string): string {
  if (!PATHNAME.test(path)) return OTHER_PAGE;
  const parts = path.split('/').slice(1);
  if (parts.length > 0 && (LOCALES as readonly string[]).includes(parts[0]!)) parts.shift();
  // a trailing slash names the same page
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  if (parts.some((p) => p === '')) return OTHER_PAGE;
  for (const template of PAGE_TEMPLATES) {
    const want = template === '/' ? [] : template.split('/').slice(1);
    if (want.length !== parts.length) continue;
    if (want.every((w, i) => (w.startsWith(':') ? SEGMENT.test(parts[i]!) : w === parts[i]))) {
      return template;
    }
  }
  return OTHER_PAGE;
}

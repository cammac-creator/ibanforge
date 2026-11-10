/**
 * The key the site sends to the API's `/v1/admin/*` routes, in the
 * `X-Admin-Secret` header. The ONE place the site reads it (audit of
 * 10/11/2026, WEB-02#1, lot C08).
 *
 * `SITE_ADMIN_TOKEN` is the site's own key: the API opens with it exactly the
 * routes this site calls (`SCOPED_ADMIN_KEYS.SITE_ADMIN_TOKEN` in
 * `src/lib/admin-auth.ts`, held against this code by
 * `src/lib/admin-auth.site.test.ts`), and nothing else: no key creation, no key
 * import, no account revocation, no backup. A leak from the site's process no
 * longer opens the whole administration.
 *
 * While it is not set, the full `ADMIN_SECRET` is sent instead, so that putting
 * this code online changes nothing before the new variable exists on both
 * sides. That fallback is transitional: once the dashboard is proven to work
 * with `SITE_ADMIN_TOKEN` alone, `ADMIN_SECRET` leaves the site's environment.
 *
 * Read at each call, never captured here: the callers that keep a module
 * constant keep the timing they always had. A key made of spaces counts as
 * absent. An empty string means "not configured", which every caller already
 * turns into its 503 or its "not fetched" state.
 *
 * Server side only: neither variable is `NEXT_PUBLIC_`, so a browser bundle
 * would read nothing.
 */
export function siteAdminKey(): string {
  const scoped = process.env.SITE_ADMIN_TOKEN;
  if (scoped && scoped.trim() !== '') return scoped;
  return process.env.ADMIN_SECRET || '';
}

/**
 * FRT-09 (audit 2026-09-01): docs, blog posts and legal texts are all read by
 * joining a URL segment into a filesystem path, with `dynamicParams = true` and
 * no generateStaticParams. `..%2f..%2f..%2fREADME` therefore arrives here as a
 * slug. It is refused today by the Vercel edge, which is the platform guarding
 * and not the code: behind a plain `next start` on nginx that guard is gone.
 *
 * Every real slug in content/ is a lowercase kebab filename, so a shape
 * allowlist closes the door in the code, where it belongs, and costs nothing.
 * It lives in its own module so the three loaders share one definition instead
 * of three copies free to drift apart.
 */
export const SLUG_PATTERN = /^[a-z0-9-]+$/;

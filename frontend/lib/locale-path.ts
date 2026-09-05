import { routing } from "@/i18n/routing"

/**
 * The path of a page in a locale, the way the router serves it.
 *
 * English is the default locale and, since 2026-09-05 (audit n° 28), it
 * lives at the root: `/docs`, not `/en/docs`. French and German keep their
 * prefix. Every link the site builds goes through here so that no internal
 * link points at a URL that only answers with a redirect, and `lib/seo.ts`
 * derives the canonical and hreflang URLs from the same rule.
 */
export function localePath(locale: string, path: string = "/"): string {
  const trimmed = path.trim()
  const rest = trimmed === "" || trimmed === "/" ? "" : trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  if (locale === routing.defaultLocale) return rest || "/"
  return `/${locale}${rest}`
}

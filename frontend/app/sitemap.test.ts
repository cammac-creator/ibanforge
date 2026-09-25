import { describe, expect, it } from "vitest";
import sitemap from "./sitemap";
import { routing } from "@/i18n/routing";
import { SITE_URL, urlFor } from "@/lib/seo";

/**
 * The sitemap lists the URL a page is served at, never one that redirects.
 *
 * Search Console does not index a sitemap URL that answers with a redirect. On
 * 2026-09-25 the sitemap still listed the German and French homes as `/de/`
 * and `/fr/` (both 308 towards `/de` and `/fr`), and Search Console called both
 * homes "unknown to Google". Every URL must be the one its page declares as
 * canonical, which `urlFor` writes.
 */
describe("sitemap", () => {
  const urls = sitemap().map((entry) => entry.url);

  it("lists each home at its canonical URL", () => {
    for (const locale of routing.locales) {
      expect(urls).toContain(urlFor(locale, "/"));
    }
  });

  it("never lists a URL with a trailing slash, the root aside", () => {
    const slashed = urls.filter((url) => url.endsWith("/") && url !== `${SITE_URL}/`);
    expect(slashed).toEqual([]);
  });

  it("never lists the same URL twice", () => {
    const seen = new Set<string>();
    const doubled = urls.filter((url) => (seen.has(url) ? true : (seen.add(url), false)));
    expect(doubled).toEqual([]);
  });
});

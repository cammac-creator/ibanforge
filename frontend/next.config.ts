import type { NextConfig } from "next";
import path from "path";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * Security headers (audit FRT-02 and OPS-14, 2026-09-01).
 *
 * api.ibanforge.com served the full set; ibanforge.com served nothing but a
 * bare HSTS. That left /account — the page where a customer pastes a live API
 * key — and the whole dashboard framable by any third party, i.e. clickjackable
 * on surfaces that send real mail and raise quota limits.
 *
 * The CSP ships as Content-Security-Policy-Report-Only on purpose. The site has
 * thirteen `dangerouslySetInnerHTML` sites (all module constants) and an inline
 * `<script>` in the root layout, plus shiki-injected styles: a blocking policy
 * would break the page for visitors before anyone noticed. Report-only first,
 * read the reports, then promote to blocking.
 *
 * HSTS carries `includeSubDomains` but deliberately NOT `preload`: preload is a
 * one-way door (removal from the browser list takes months) and it would commit
 * every future ibanforge.com subdomain to HTTPS-only before we know what they
 * are. OPS-14 asked for both; only the reversible half is taken here.
 */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self' https://api.ibanforge.com",
  "frame-ancestors 'none'",
  // Without a destination the reports went nowhere and the "read them, then
  // block" step could never happen (audit 2026-09-05, n° 31). Both spellings:
  // report-uri for every browser today, report-to for the Reporting API.
  "report-uri /api/csp-report",
  "report-to csp-endpoint",
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
  { key: "Reporting-Endpoints", value: 'csp-endpoint="/api/csp-report"' },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // `x-powered-by: Next.js` announced the stack to every visitor for free.
  poweredByHeader: false,
  // Lighthouse flagged the three.js chunk without a map (2026-09-05, n° 33);
  // the code is public anyway, a production error should be readable.
  productionBrowserSourceMaps: true,
  // The share card reads its font and mark from assets/ at render time.
  outputFileTracingIncludes: { "/[locale]/og": ["./assets/**/*"] },
  async headers() {
    /*
     * `/(.*)` and not the more common `/:path*`: checked against Next's own
     * matcher (getPathMatch with strict: true, which is what the server uses),
     * `/:path*` matches `/en` and `/robots.txt` but NOT the bare `/`. That is
     * the one path a header set called "for every route" must not miss.
     */
    return [
      { source: "/(.*)", headers: SECURITY_HEADERS },
      /*
       * 2026-09-05 (evening check, decision 3A): the brand images carry a
       * content hash in their name, so they can be cached like the scripts.
       * A file that changes changes its name; nothing stale can survive.
       */
      { source: "/brand/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
  async redirects() {
    return [
      // RFC 9727 puts the API catalogue at the organisation's domain; APIs.io
      // and API Evangelist look for apis.json at the root of the same host.
      // Both live on the API host (2026-09-06): point the crawlers there.
      { source: "/.well-known/api-catalog", destination: "https://api.ibanforge.com/.well-known/api-catalog", permanent: true },
      { source: "/apis.json", destination: "https://api.ibanforge.com/apis.json", permanent: true },
      /*
       * 2026-09-05 (audit n° 29): www.ibanforge.com served the whole site a
       * second time (200, canonical pointing at the apex) instead of sending
       * the visitor to the one host. A permanent redirect, every path.
       */
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.ibanforge.com" }],
        destination: "https://ibanforge.com/:path*",
        permanent: true,
      },
      /*
       * 2026-09-05 (audit n° 28): English moved from /en/* to the root. Every
       * old URL answers a permanent redirect to its new address, in that
       * order: the bare /en first, then everything beneath it.
       */
      // the share card moved from the file convention to /og (2026-09-05)
      { source: "/opengraph-image", destination: "/og", permanent: true },
      { source: "/:locale(fr|de)/opengraph-image", destination: "/:locale/og", permanent: true },
      { source: "/en", destination: "/", permanent: true },
      { source: "/en/:path*", destination: "/:path*", permanent: true },
      /*
       * BIZ-15 (2026-09-01): /docs/quickstart answers 404 since the 25/08
       * landing rewrite dropped the quickstart section. Inbound links and the
       * name itself meant "the docs index", so send them there rather than
       * leave a dead page. The locale segment is constrained to the three real
       * locales, otherwise `/anything/docs/quickstart` would match too.
       */
      { source: "/:locale(en|fr|de)/docs/quickstart", destination: "/:locale/docs", permanent: true },
      { source: "/docs/quickstart", destination: "/docs", permanent: true },
      /*
       * 2026-09-02: the /live village is paused (operator decision: the idea
       * stays, the execution was judged too rough to be live). The code is
       * kept whole at git tag `village-pause-2026-09-02`. Links already out
       * there (menu, landing, sitemap, OG image shared since 01/09) land on the
       * playground, which shows the same pipeline as a real response.
       * Temporary on purpose: the page may come back in another form.
       */
      { source: "/:locale(en|fr|de)/live", destination: "/:locale/playground", permanent: false },
      { source: "/live", destination: "/playground", permanent: false },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");
export default withNextIntl(nextConfig);

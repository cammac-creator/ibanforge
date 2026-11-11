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
 * HSTS carries `includeSubDomains` but deliberately NOT `preload`: preload is a
 * one-way door (removal from the browser list takes months) and it would commit
 * every future ibanforge.com subdomain to HTTPS-only before we know what they
 * are. OPS-14 asked for both; only the reversible half is taken here.
 */

/**
 * The content security policy, ENFORCED since 2026-11-11 (audit WEB-03).
 *
 * It shipped as Report-Only on 2026-09-01 and stayed there ten weeks: an
 * injected script could run and send what it read to any host. Before the
 * switch, every main page was opened under this exact policy, in Chromium and
 * WebKit, against a local build (home, /openapi with a Test Request,
 * /playground, /account, /device, /dashboard login, /audit, /pricing, blog,
 * docs, /fr/famille, the register and tool pages): the only sources it refused
 * were the Google Fonts of /fr/famille (now served by the site) and Scalar's
 * relay (now off, see app/[locale]/openapi/scalar-network.ts).
 *
 * What it still allows, and why:
 *  - script-src and style-src 'unsafe-inline': Next's own bootstrap scripts,
 *    the theme script of the root layout, the JSON-LD blocks and shiki's
 *    styles are inline. Removing it needs a nonce per request, so dynamic
 *    rendering; planned for the dashboard alone (WEB-03#2), not here.
 *  - img-src https: kept as it was in the report-only policy. No page opened
 *    in the check loaded an outside image; narrowing it is a later step.
 *  - connect-src: the site itself and the API, by its public address and by
 *    the one baked into the client bundle at build time (NEXT_PUBLIC_API_URL,
 *    https://api.ibanforge.com in the image; a local API in the dashboard
 *    recipe). Nothing else: an open relay here would void the whole policy.
 *
 * One report per view of /openapi is expected and harmless: zod, inside
 * Scalar, probes `Function("")` to know whether it may compile its parsers,
 * and falls back when the policy refuses.
 *
 * Under `next dev` the same policy stays Report-Only: React evaluates code for
 * its error overlay and hot reload opens a local socket, and a policy must
 * never break the development machine.
 */
const DEFAULT_API_ORIGIN = "https://api.ibanforge.com";

/**
 * A host name made of letters, digits, dots and hyphens, labels never empty.
 *
 * The URL parser accepts far more in a host: `https://*` parses, and so do a
 * host carrying `;` or `,`. Copied into connect-src, the first would be a
 * wildcard source (any host) and the second would end the directive and write
 * another one. Anything outside this shape is dropped, and the policy keeps the
 * site and the API's public address alone.
 */
const PLAIN_HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

function browserApiOrigins(raw: string | undefined): string[] {
  const origins = [DEFAULT_API_ORIGIN];
  try {
    const url = new URL(raw ?? "");
    const plain =
      (url.protocol === "https:" || url.protocol === "http:") &&
      PLAIN_HOSTNAME.test(url.hostname) &&
      /^[0-9]*$/.test(url.port);
    if (plain && !origins.includes(url.origin)) origins.push(url.origin);
  } catch {
    // Unset or not a URL: the public address alone. It is also the fallback of
    // every client component that calls the API when the variable is missing
    // (lib/content-security-policy.test.ts holds them to it); the live health
    // strip of the dashboard aimed at another host until 2026-11-11.
  }
  return origins;
}

function contentSecurityPolicy(apiOrigins: string[]): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    `connect-src 'self' ${apiOrigins.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Without a destination the reports went nowhere (audit 2026-09-05,
    // n° 31). Both spellings: report-uri for every browser today, report-to
    // for the Reporting API.
    "report-uri /api/csp-report",
    "report-to csp-endpoint",
  ].join("; ");
}

function securityHeaders(env: NodeJS.ProcessEnv): { key: string; value: string }[] {
  const policy = contentSecurityPolicy(browserApiOrigins(env.NEXT_PUBLIC_API_URL));
  return [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    {
      key: env.NODE_ENV === "development" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
      value: policy,
    },
    { key: "Reporting-Endpoints", value: 'csp-endpoint="/api/csp-report"' },
  ];
}

const nextConfig: NextConfig = {
  /*
   * Standalone output for the container image of the self-hosted site
   * (frontend/Dockerfile sets NEXT_OUTPUT=standalone). Left unset everywhere
   * else, so CI's `next build` and `next dev` are unchanged.
   */
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  /*
   * Self-hosted image only: keep the page cache in memory, never on the
   * container's disk.
   *
   * Next's file-system cache writes every page it renders or revalidates to
   * .next/server/route-cache and never evicts anything: on the VPS that meant
   * every register code page, in each of the three languages, plus a second
   * copy of every page already pre-rendered into the image (build pages are
   * "promoted" into route-cache on first read). Several gigabytes on a disk
   * shared with other sites, wiped only when the container is recreated.
   *
   * With isrFlushToDisk off, build pages are read straight from the image and
   * on-demand pages live in the default in-memory LRU (cacheMaxMemorySize,
   * left at its default on purpose: the container has a tight memory cap). A
   * page evicted from memory is simply rendered again. Side effects, accepted:
   * the data cache (fetch with `revalidate`) shares that memory and has no disk
   * copy either, so a cached API answer is asked again after a restart or once
   * it has left memory; optimized images (next/image) lose their disk cache too
   * and are recomputed when the browser does not already hold them.
   *
   * CI's `next build` and `next dev` do not set NEXT_OUTPUT and are
   * unchanged.
   */
  ...(process.env.NEXT_OUTPUT === "standalone" ? { experimental: { isrFlushToDisk: false } } : {}),
  turbopack: {
    root: path.resolve(__dirname),
  },
  // `x-powered-by: Next.js` announced the stack to every visitor for free.
  poweredByHeader: false,
  // Lighthouse flagged a chunk without a map (2026-09-05, n° 33: the three.js
  // film, removed with three itself on 2026-11-11); the code is public anyway,
  // a production error should be readable.
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
    /*
     * The self-hosted image names its commit (GIT_SHA, set by
     * frontend/Dockerfile): "which version is online" is answered by
     * `curl -sI https://ibanforge.com/ | grep -i x-site-version`, the proof the
     * delivery chain and the integrator read. Absent where GIT_SHA is unset
     * or not a commit (next dev).
     */
    const version = process.env.GIT_SHA && /^[0-9a-f]{7,40}$/.test(process.env.GIT_SHA)
      ? [{ key: "X-Site-Version", value: process.env.GIT_SHA.slice(0, 12) }]
      : [];
    return [
      { source: "/(.*)", headers: [...securityHeaders(process.env), ...version] },
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
       * 2026-09-09: agent-discovery scanners (ABC-Protocol-Agent-Discovery,
       * and others without a name) ask the site for the agent manifests that
       * live on the API host, and each miss ran the not-found page in a
       * function. A permanent redirect answers at the edge and lands them on
       * the real file. Only the three the API actually serves are listed.
       */
      { source: "/.well-known/agent.json", destination: "https://api.ibanforge.com/.well-known/agent.json", permanent: true },
      { source: "/.well-known/agent-card.json", destination: "https://api.ibanforge.com/.well-known/agent-card.json", permanent: true },
      { source: "/.well-known/x402.json", destination: "https://api.ibanforge.com/.well-known/x402.json", permanent: true },
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
      // Les trois adresses que devinent un moteur ou un partenaire répondaient 404
      // après la détection de langue (audit du 16/09/2026, M1) : elles mènent aux
      // vraies pages, avant le préfixe de langue comme après.
      { source: "/terms", destination: "/legal/terms", permanent: true },
      { source: "/privacy", destination: "/legal/privacy", permanent: true },
      { source: "/imprint", destination: "/legal/imprint", permanent: true },
      { source: "/:locale(fr|de)/terms", destination: "/:locale/legal/terms", permanent: true },
      { source: "/:locale(fr|de)/privacy", destination: "/:locale/legal/privacy", permanent: true },
      { source: "/:locale(fr|de)/imprint", destination: "/:locale/legal/imprint", permanent: true },
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

import { MetadataRoute } from "next";

/**
 * ⚠️ Every disallowed path must carry its locale prefix.
 *
 * Audit 2026-09-01 (WEB-10): `/dashboard/` matched nothing. The operator
 * dashboard is served from `app/[locale]/dashboard`, so its real URLs are
 * `/en/dashboard`, `/fr/dashboard` and `/de/dashboard` — and the header links
 * to it from all 57 public pages, which is precisely how a crawler finds it.
 * The bare rule looked like a protection and was one only against a crawler
 * that guessed the URL rather than followed the link.
 *
 * `/api/` covers the Next route handlers (`/api/crm/*`, `/api/playground`,
 * `/api/dashboard`), none of which is a page and none of which belongs in an
 * index.
 */
const PRIVATE_PATHS = [
  "/dashboard/",
  "/en/dashboard/",
  "/fr/dashboard/",
  "/de/dashboard/",
  "/api/",
];

/**
 * Crawlers shut out on 2026-09-09. Vercel's request log for one hour that
 * morning (05:32-06:28 UTC, 3 791 requests) was 69 % `meta-externalagent`
 * (Meta's AI-training crawler, re-fetching the same 134 pages about ten
 * times an hour) and 18 % `AwarioBot` (a brand-monitoring tool walking the
 * register pages). Together they drove the Hobby team to 100 % of its
 * function invocations and Active CPU. Neither brings a visitor or a
 * search ranking. The Vercel WAF denies them as well; this file is the
 * polite version they are supposed to read first.
 */
const SHUT_OUT = ["meta-externalagent", "AwarioBot"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      ...SHUT_OUT.map((userAgent) => ({ userAgent, disallow: "/" })),
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: "GPTBot", allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: "ClaudeBot", allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: "ChatGPT-User", allow: "/", disallow: PRIVATE_PATHS },
    ],
    sitemap: "https://ibanforge.com/sitemap.xml",
  };
}

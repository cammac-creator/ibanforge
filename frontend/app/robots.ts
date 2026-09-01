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
 * `/api/` covers the Next route handlers (`/api/crm/*`, `/api/ops`,
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

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: "GPTBot", allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: "ClaudeBot", allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: "ChatGPT-User", allow: "/", disallow: PRIVATE_PATHS },
    ],
    sitemap: "https://ibanforge.com/sitemap.xml",
  };
}

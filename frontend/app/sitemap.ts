import { MetadataRoute } from "next";
import { getAllDocs } from "@/lib/mdx";
import { getAllPosts } from "@/lib/blog";
import { routing } from "@/i18n/routing";

const BASE_URL = "https://ibanforge.com";

/**
 * ⚠️ No `lastModified` on anything whose modification date we do not know.
 *
 * Audit 2026-09-01 (WEB-21): every static entry carried `lastModified: new
 * Date()`, so each build republished the whole catalogue as "modified today".
 * A `lastmod` that moves on every deployment carries no information and is
 * discarded, which costs us the signal on the pages where it IS true. Blog
 * posts keep theirs: their date comes from the frontmatter and is a fact. Docs
 * and static pages have no date to state, so they state none.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of routing.locales) {
    const prefix = `${BASE_URL}/${locale}`;

    // Static pages
    entries.push(
      { url: prefix, changeFrequency: "weekly", priority: 1 },
      { url: `${prefix}/agents`, changeFrequency: "monthly", priority: 0.95 },
      { url: `${prefix}/vendors`, changeFrequency: "monthly", priority: 0.85 },
      { url: `${prefix}/audit`, changeFrequency: "monthly", priority: 0.85 },
      { url: `${prefix}/sources`, changeFrequency: "monthly", priority: 0.75 },
      { url: `${prefix}/compare`, changeFrequency: "monthly", priority: 0.8 },
      { url: `${prefix}/tools/test-iban`, changeFrequency: "monthly", priority: 0.8 },
      { url: `${prefix}/tools/qr-bill`, changeFrequency: "monthly", priority: 0.8 },
      { url: `${prefix}/playground`, changeFrequency: "monthly", priority: 0.9 },
      { url: `${prefix}/docs`, changeFrequency: "weekly", priority: 0.8 },
      { url: `${prefix}/pricing`, changeFrequency: "monthly", priority: 0.7 },
      { url: `${prefix}/openapi`, changeFrequency: "monthly", priority: 0.7 },
      { url: `${prefix}/blog`, changeFrequency: "weekly", priority: 0.6 },
      // The trust pages, listed here from `/changelog` down. Written, true,
      // linked from the footer and carrying no noindex — they were missing from
      // this hand-kept list until 2026-08, so a crawler starting from the
      // sitemap rather than from the links never saw them. Low priority on
      // purpose: they answer "can I buy from these people", read once by
      // someone already deciding, not pages we compete on.
      { url: `${prefix}/changelog`, changeFrequency: "weekly", priority: 0.5 },
      { url: `${prefix}/status`, changeFrequency: "daily", priority: 0.5 },
      { url: `${prefix}/legal`, changeFrequency: "yearly", priority: 0.3 },
      { url: `${prefix}/legal/terms`, changeFrequency: "yearly", priority: 0.4 },
      { url: `${prefix}/legal/privacy`, changeFrequency: "yearly", priority: 0.4 },
      { url: `${prefix}/legal/dpa`, changeFrequency: "yearly", priority: 0.4 },
      { url: `${prefix}/legal/imprint`, changeFrequency: "yearly", priority: 0.4 },
      { url: `${prefix}/legal/sla`, changeFrequency: "yearly", priority: 0.4 },
      // 🚫 `/account` is deliberately NOT here. It answers 200 and is linked
      // from the footer, but its own generateMetadata sets
      // `robots: { index: false }` — a credential form has no business
      // competing with the docs in a result page. Submitting a noindex URL in
      // a sitemap is reported as an error by Search Console, so listing it
      // would trade one defect for another (WEB-11, audit 2026-09-01).
    );

    // Doc pages
    for (const doc of getAllDocs(locale)) {
      if (doc.slug !== "index") {
        entries.push({
          url: `${prefix}/docs/${doc.slug}`,
          changeFrequency: "weekly",
          priority: 0.7,
        });
      }
    }

    // Blog posts — the only entries with a modification date we can state.
    for (const post of getAllPosts(locale)) {
      entries.push({
        url: `${prefix}/blog/${post.slug}`,
        lastModified: new Date(post.date),
        changeFrequency: "monthly",
        priority: 0.5,
      });
    }
  }

  return entries;
}

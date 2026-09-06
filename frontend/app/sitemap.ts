import { MetadataRoute } from "next";
import { atBlzFile, beBankFile, chIidFile, deBlzFile, skBankFile, smBankFile } from "@/lib/registers";
import { allCountryCodes } from "@/lib/countries";
import { getAllDocs } from "@/lib/mdx";
import { getAllPosts } from "@/lib/blog";
import { routing } from "@/i18n/routing";
import { localePath } from "@/lib/locale-path";

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

  // Register pages: the head-office batch first (the codes a reader is most
  // likely to look up, pre-rendered at build), then every other code of each
  // register at a lower priority. Until 2026-09-06 only the first batch was
  // listed, "until it showed its worth"; with one signup a fortnight from
  // search and nothing else to measure it against, the whole long tail is the
  // experiment now. Every code already had a page, rendered on demand.
  const listRegister = (codes: string[], batch1: string[], path: (code: string) => string, locales: string[]) => {
    const first = new Set(batch1);
    for (const code of codes) {
      for (const locale of locales) {
        entries.push({
          url: `${BASE_URL}${localePath(locale, path(code))}`,
          changeFrequency: "monthly",
          priority: first.has(code) ? 0.5 : 0.4,
        });
      }
    }
  };
  const de = deBlzFile();
  listRegister(Object.keys(de.entries), de.batch1, (c) => `/blz/${c}`, ["de"]);
  const ch = chIidFile();
  listRegister(Object.keys(ch.entries), ch.batch1, (c) => `/iid/${c}`, ["de", "fr"]);
  // Austria reads German; Belgium reads French and, for its payments teams, English.
  const at = atBlzFile();
  listRegister(Object.keys(at.entries), at.batch1, (c) => `/at/${c}`, ["de"]);
  const be = beBankFile();
  // A Belgian page is the bank's page: only the canonical code of each block is listed.
  listRegister(
    Object.keys(be.entries).filter((c) => be.entries[c].register.canonical === c),
    be.batch1,
    (c) => `/be/${c}`,
    ["fr", "en"],
  );
  // Slovakia in English only. Slovak is not one of this site's three locales,
  // and the edition of the directory we actually read and cite is the English
  // one the NBS publishes — so listing these under de or fr would offer a
  // crawler a translation of a page nobody asked for. All 38 codes are in the
  // first batch: the register is small enough to have no tail.
  const sk = skBankFile();
  listRegister(Object.keys(sk.entries), sk.batch1, (c) => `/sk/${c}`, ["en"]);
  // San Marino in English and Italian? No — Italian is not a site locale, and
  // the BCSM page we read and cite is the English edition. Four pages, one
  // language, like Slovakia.
  const sm = smBankFile();
  listRegister(Object.keys(sm.entries), sm.batch1, (c) => `/sm/${c}`, ["en"]);

  // One page per IBAN country, in the three languages (2026-09-06).
  for (const cc of allCountryCodes()) {
    for (const locale of routing.locales) {
      entries.push({ url: `${BASE_URL}${localePath(locale, `/iban/${cc.toLowerCase()}`)}`, changeFrequency: "monthly", priority: 0.6 });
    }
  }

  for (const locale of routing.locales) {
    // English at the root since 2026-09-05 (audit n° 28): `${BASE_URL}/` and `${BASE_URL}/docs`.
    const prefix = `${BASE_URL}${locale === routing.defaultLocale ? "" : `/${locale}`}`;

    // Static pages
    entries.push(
      { url: `${prefix}/`, changeFrequency: "weekly", priority: 1 },
      { url: `${prefix}/agents`, changeFrequency: "monthly", priority: 0.95 },
      { url: `${prefix}/vendors`, changeFrequency: "monthly", priority: 0.85 },
      { url: `${prefix}/audit`, changeFrequency: "monthly", priority: 0.85 },
      { url: `${prefix}/sources`, changeFrequency: "monthly", priority: 0.75 },
      { url: `${prefix}/compare`, changeFrequency: "monthly", priority: 0.8 },
      { url: `${prefix}/tools/test-iban`, changeFrequency: "monthly", priority: 0.8 },
      { url: `${prefix}/tools/qr-bill`, changeFrequency: "monthly", priority: 0.8 },
      { url: `${prefix}/sheets`, changeFrequency: "monthly", priority: 0.8 },
      { url: `${prefix}/iban`, changeFrequency: "monthly", priority: 0.7 },
      { url: `${prefix}/blz`, changeFrequency: "monthly", priority: 0.7 },
      { url: `${prefix}/iid`, changeFrequency: "monthly", priority: 0.7 },
      { url: `${prefix}/at`, changeFrequency: "monthly", priority: 0.7 },
      { url: `${prefix}/be`, changeFrequency: "monthly", priority: 0.7 },
      { url: `${prefix}/sk`, changeFrequency: "monthly", priority: 0.7 },
      { url: `${prefix}/sm`, changeFrequency: "monthly", priority: 0.7 },
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

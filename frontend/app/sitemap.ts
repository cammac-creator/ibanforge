import { MetadataRoute } from "next";
import { getAllDocs } from "@/lib/mdx";
import { getAllPosts } from "@/lib/blog";
import { routing } from "@/i18n/routing";

const BASE_URL = "https://ibanforge.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of routing.locales) {
    const prefix = `${BASE_URL}/${locale}`;

    // Static pages
    entries.push(
      { url: prefix, lastModified: now, changeFrequency: "weekly", priority: 1 },
      { url: `${prefix}/playground`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
      { url: `${prefix}/docs`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
      { url: `${prefix}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
      { url: `${prefix}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
      { url: `${prefix}/compare`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    );

    // Doc pages
    for (const doc of getAllDocs(locale)) {
      if (doc.slug !== "index") {
        entries.push({
          url: `${prefix}/docs/${doc.slug}`,
          lastModified: now,
          changeFrequency: "weekly",
          priority: 0.7,
        });
      }
    }

    // Blog posts
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

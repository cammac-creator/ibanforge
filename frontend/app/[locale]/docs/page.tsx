import { MDXRemote } from "next-mdx-remote/rsc";
import { getDoc, mdxOptions, mdxComponents } from "@/lib/mdx";

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { alternatesFor } from "@/lib/seo";

// Title and description are still static (not per-locale) — out of scope for
// this pass (audit 2026-09-01, WEB-01/WEB-02: `alternates` only). Converted
// from `export const metadata` to `generateMetadata` because a segment's
// `alternates` REPLACES its parent's rather than merging into it, so the
// canonical + hreflang set can only be added here, alongside a `params` read.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  // from the catalogue since 2026-09-05: the snippet was English in every language
  const t = await getTranslations({ locale, namespace: "docs" });
  return {
    title: t("metadata.title"),
    description: t("metadata.description"),
    alternates: alternatesFor(locale, "/docs"),
  };
}

export default async function DocsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { content } = getDoc("index", locale);

  return <MDXRemote source={content} options={mdxOptions} components={mdxComponents} />;
}

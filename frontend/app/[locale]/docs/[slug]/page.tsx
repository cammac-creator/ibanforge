import { MDXRemote } from "next-mdx-remote/rsc";
import { getTranslations } from "next-intl/server";
import { getDoc, mdxOptions, mdxComponents } from "@/lib/mdx";
import { GetKeyButton } from "@/components/api-key-dialog";
import { notFound } from "next/navigation";

export const dynamicParams = true;

/**
 * Doc pages that end on an action rather than on more reading. The "API Keys"
 * page is first in the sidebar and, until 2026-08-20, its only exit was a
 * `curl`: a reader who evaluates from a browser reached the end of the
 * documentation funnel without ever meeting the two-click form that issues the
 * very key the page is about.
 */
const KEY_CTA_SLUGS = new Set(["api-keys"]);

function tryGetDoc(slug: string, locale: string) {
  try {
    return getDoc(slug, locale);
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const doc = tryGetDoc(slug, locale);
  if (!doc) return { title: "Not Found | IBANforge Docs" };
  const url = `https://ibanforge.com/${locale}/docs/${slug}`;
  return {
    title: `${doc.meta.title} | IBANforge Docs`,
    description: doc.meta.description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title: doc.meta.title,
      description: doc.meta.description,
      url,
    },
  };
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const doc = tryGetDoc(slug, locale);
  if (!doc) notFound();
  const t = await getTranslations({ locale, namespace: "docs" });
  const url = `https://ibanforge.com/${locale}/docs/${slug}`;

  // TechArticle + BreadcrumbList, built from the frontmatter every doc already
  // has — never a per-slug special case. The sibling sidebar carries a "never
  // again" comment about hard-coded slug lists; the same rule applies here.
  // FAQPage is deliberately absent: Google dropped the FAQ rich result on
  // 2026-05-07 and it was removed from the blog for that reason.
  const techArticleLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: doc.meta.title,
    description: doc.meta.description,
    inLanguage: locale,
    isPartOf: { "@type": "WebSite", name: "IBANforge", url: "https://ibanforge.com" },
    author: { "@type": "Organization", name: "IBANforge", url: "https://ibanforge.com" },
    publisher: { "@type": "Organization", name: "IBANforge", url: "https://ibanforge.com" },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `https://ibanforge.com/${locale}` },
      { "@type": "ListItem", position: 2, name: "Docs", item: `https://ibanforge.com/${locale}/docs` },
      { "@type": "ListItem", position: 3, name: doc.meta.title, item: url },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(techArticleLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <MDXRemote source={doc.content} options={mdxOptions} components={mdxComponents} />
      {KEY_CTA_SLUGS.has(slug) && (
        <div className="not-prose mt-10 flex flex-col items-start gap-3 rounded-xl border border-[var(--ink-4)] bg-[var(--ink-2)] p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{t("keyCta.prompt")}</p>
          <GetKeyButton variant="amber" className="shrink-0 px-6">
            {t("keyCta.button")}
          </GetKeyButton>
        </div>
      )}
    </>
  );
}

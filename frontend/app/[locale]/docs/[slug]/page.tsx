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
  return {
    title: `${doc.meta.title} | IBANforge Docs`,
    description: doc.meta.description,
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
  return (
    <>
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

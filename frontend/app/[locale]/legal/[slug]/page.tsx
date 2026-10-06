import { MDXRemote } from "next-mdx-remote/rsc";
import { getLegalDoc } from "@/lib/legal";
import { mdxOptions, mdxComponents } from "@/lib/mdx";
import { alternatesFor } from "@/lib/seo";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { localePath } from "@/lib/locale-path";

// Fully dynamic, exactly like docs/[slug]: under this project's next-intl
// setup the locale comes from the request, so any static/ISR rendering of a
// dynamic segment trips DYNAMIC_SERVER_USAGE.
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const doc = getLegalDoc(slug, locale);
  // No "| IBANforge" suffix in either branch: the locale layout's title
  // template already appends it (WEB-20, audit 2026-09-01).
  if (!doc) return { title: "Not Found" };
  // The English text prevails. Since 2026-09-05 the snippet a French or
  // German searcher reads is in their language; since 2026-10-06 the German
  // documents are courtesy translations, and the catalogue title says which.
  const t = await getTranslations({ locale, namespace: "legal" });
  const key = `docs.${slug}`;
  return {
    title: t.has(`${key}.title`) ? t(`${key}.title`) : doc.meta.title,
    description: t.has(`${key}.description`) ? t(`${key}.description`) : doc.meta.description,
    alternates: alternatesFor(locale, `/legal/${slug}`),
  };
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const doc = getLegalDoc(slug, locale);
  if (!doc) notFound();
  const t = await getTranslations({ locale, namespace: "legal" });
  const translated = doc.meta.translated;
  // A page still served in English under /fr or /de says so to the browser
  // and to screen readers, instead of inheriting the locale's `lang`.
  const servedInEnglish = locale !== "en" && !translated;

  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-10">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <Link
          href={localePath(locale, '/legal')}
          className="text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        >
          ← {t("index.title")}
        </Link>
        {servedInEnglish && (
          <p className="text-xs text-muted-foreground border border-border rounded-md px-3 py-1.5">
            {t("englishOnly")}
          </p>
        )}
      </div>
      {translated && (
        <p className="mb-8 text-sm text-muted-foreground border border-amber-500/40 bg-amber-500/5 rounded-md px-4 py-3 leading-relaxed">
          {t("translation.notice")}{" "}
          <Link
            href={localePath("en", `/legal/${slug}`)}
            hrefLang="en"
            className="text-primary underline underline-offset-4 hover:text-foreground transition-colors"
          >
            {t("translation.englishLink")}
          </Link>
        </p>
      )}
      <div
        lang={servedInEnglish ? "en" : undefined}
        className="prose prose-invert prose-amber max-w-none prose-headings:font-heading prose-headings:tracking-tight prose-h1:text-3xl prose-h2:text-xl prose-h2:mt-10 prose-h2:mb-4 prose-h3:text-lg prose-p:text-muted-foreground prose-p:leading-relaxed prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-code:text-primary prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none prose-pre:bg-card prose-pre:border prose-pre:border-border prose-pre:rounded-lg prose-strong:text-foreground prose-table:text-sm prose-th:text-left prose-th:text-muted-foreground prose-th:font-semibold prose-th:border-b prose-th:border-border prose-th:pb-2 prose-td:border-b prose-td:border-border prose-td:py-2 prose-li:text-muted-foreground"
      >
        <MDXRemote source={doc.content} options={mdxOptions} components={mdxComponents} />
      </div>
    </article>
  );
}

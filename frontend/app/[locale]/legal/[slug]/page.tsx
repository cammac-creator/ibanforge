import { MDXRemote } from "next-mdx-remote/rsc";
import { getLegalDoc, LEGAL_SLUGS } from "@/lib/legal";
import { mdxOptions, mdxComponents } from "@/lib/mdx";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import Link from "next/link";

export const dynamicParams = false;

export function generateStaticParams() {
  return LEGAL_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug } = await params;
  const doc = getLegalDoc(slug);
  if (!doc) return { title: "Not Found | IBANforge" };
  return {
    title: `${doc.meta.title} | IBANforge`,
    description: doc.meta.description,
  };
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const doc = getLegalDoc(slug);
  if (!doc) notFound();
  const t = await getTranslations("legal");

  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-10">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <Link
          href={`/${locale}/legal`}
          className="text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        >
          ← {t("index.title")}
        </Link>
        {locale !== "en" && (
          <p className="text-xs text-muted-foreground border border-border rounded-md px-3 py-1.5">
            {t("englishOnly")}
          </p>
        )}
      </div>
      <div className="prose prose-invert prose-amber max-w-none prose-headings:font-heading prose-headings:tracking-tight prose-h1:text-3xl prose-h2:text-xl prose-h2:mt-10 prose-h2:mb-4 prose-h3:text-lg prose-p:text-muted-foreground prose-p:leading-relaxed prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-code:text-primary prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none prose-pre:bg-card prose-pre:border prose-pre:border-border prose-pre:rounded-lg prose-strong:text-foreground prose-table:text-sm prose-th:text-left prose-th:text-muted-foreground prose-th:font-semibold prose-th:border-b prose-th:border-border prose-th:pb-2 prose-td:border-b prose-td:border-border prose-td:py-2 prose-li:text-muted-foreground">
        <MDXRemote source={doc.content} options={mdxOptions} components={mdxComponents} />
      </div>
    </article>
  );
}

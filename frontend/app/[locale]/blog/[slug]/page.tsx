import { MDXRemote } from "next-mdx-remote/rsc";
import { getTranslations } from "next-intl/server";
import { getPost } from "@/lib/blog";
import { mdxOptions, mdxComponents } from "@/lib/mdx";
import { alternatesFor, ogImageFor } from "@/lib/seo";
import { notFound } from "next/navigation";
import Link from "next/link";

export const dynamicParams = true;

function tryGetPost(slug: string, locale: string) {
  try {
    return getPost(slug, locale);
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
  const post = tryGetPost(slug, locale);
  if (!post) return { title: { absolute: "Not Found — IBANforge Blog" } };
  const url = `https://ibanforge.com/${locale}/blog/${slug}`;
  return {
    // `absolute` opts out of the layout's "%s | IBANforge" template, so the
    // brand appears exactly once here already (WEB-20 does not bite on this
    // page).
    title: { absolute: `${post.meta.title} — IBANforge Blog` },
    description: post.meta.description,
    // Canonical AND hreflang, inseparably: `{ canonical: url }` alone replaced
    // the layout's `alternates` object and left every article without a
    // `languages` block (WEB-02, audit 2026-09-01).
    alternates: alternatesFor(locale, `/blog/${slug}`),
    openGraph: {
      type: "article",
      title: post.meta.title,
      description: post.meta.description,
      url,
      publishedTime: post.meta.date,
      // Without this the object below replaced `opengraph-image.tsx` and the
      // articles, the pages most often shared, had no share card (WEB-12).
      images: [ogImageFor(locale)],
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const t = await getTranslations('blog');

  const post = tryGetPost(slug, locale);
  if (!post) notFound();

  const { meta, content } = post;
  const url = `https://ibanforge.com/${locale}/blog/${slug}`;

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: meta.title,
    description: meta.description,
    datePublished: meta.date,
    dateModified: meta.date,
    inLanguage: locale,
    author: { "@type": "Organization", name: "IBANforge", url: "https://ibanforge.com" },
    publisher: { "@type": "Organization", name: "IBANforge", url: "https://ibanforge.com" },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };

  // FAQPage JSON-LD removed 2026-08: Google dropped the FAQ rich result on
  // 2026-05-07 and no other consumer was identified. The frontmatter faq stays
  // available for content use; BlogPosting above is what still gets consumed.

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }}
      />
      <div className="mb-10">
        <Link
          href={`/${locale}/blog`}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors mb-8 inline-block"
        >
          {t('backToBlog')}
        </Link>
        <h1 className="text-4xl font-heading font-bold tracking-tight text-foreground mt-6 mb-4">
          {meta.title}
        </h1>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <time dateTime={meta.date}>
            {new Date(meta.date).toLocaleDateString(locale, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </time>
          <span>·</span>
          <span>{meta.readingTime}</span>
        </div>
      </div>

      <article className="prose prose-invert prose-amber max-w-none prose-headings:font-heading prose-headings:tracking-tight prose-h1:text-3xl prose-h2:text-xl prose-h2:mt-10 prose-h2:mb-4 prose-h3:text-lg prose-p:text-muted-foreground prose-p:leading-relaxed prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-code:text-primary prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none prose-pre:bg-card prose-pre:border prose-pre:border-border prose-pre:rounded-lg prose-strong:text-foreground prose-li:text-muted-foreground">
        <MDXRemote source={content} options={mdxOptions} components={mdxComponents} />
      </article>
    </div>
  );
}

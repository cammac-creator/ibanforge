import { MDXRemote } from "next-mdx-remote/rsc";
import { getDoc, mdxOptions, mdxComponents } from "@/lib/mdx";
import { notFound } from "next/navigation";

export const dynamicParams = true;

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
  return <MDXRemote source={doc.content} options={mdxOptions} components={mdxComponents} />;
}

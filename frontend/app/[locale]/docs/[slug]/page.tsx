import { MDXRemote } from "next-mdx-remote/rsc";
import { getDoc, getAllDocs } from "@/lib/mdx";
import { notFound } from "next/navigation";

export function generateStaticParams() {
  return getAllDocs('en')
    .filter((doc) => doc.slug !== "index")
    .map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  try {
    const { meta } = getDoc(slug, locale);
    return {
      title: `${meta.title} | IBANforge Docs`,
      description: meta.description,
    };
  } catch {
    return { title: "Not Found | IBANforge Docs" };
  }
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;

  try {
    const { content } = getDoc(slug, locale);
    return <MDXRemote source={content} />;
  } catch {
    notFound();
  }
}

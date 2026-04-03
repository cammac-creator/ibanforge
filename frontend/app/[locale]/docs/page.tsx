import { MDXRemote } from "next-mdx-remote/rsc";
import { getDoc } from "@/lib/mdx";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "API documentation for IBANforge — IBAN validation, BIC/SWIFT lookup, and x402 micropayments.",
};

export default async function DocsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { content } = getDoc("index", locale);

  return <MDXRemote source={content} />;
}

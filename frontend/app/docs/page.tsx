import { MDXRemote } from "next-mdx-remote/rsc";
import { getDoc } from "@/lib/mdx";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "API documentation for IBANforge — IBAN validation, BIC/SWIFT lookup, and x402 micropayments.",
};

export default function DocsPage() {
  const { content } = getDoc("index");

  return <MDXRemote source={content} />;
}

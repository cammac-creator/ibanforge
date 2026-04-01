import { MDXRemote } from "next-mdx-remote/rsc";
import { getDoc } from "@/lib/mdx";

export const metadata = {
  title: "Documentation | IBANforge",
  description:
    "API documentation for IBANforge — IBAN validation, BIC/SWIFT lookup, and x402 micropayments.",
};

export default function DocsPage() {
  const { content } = getDoc("index");

  return <MDXRemote source={content} />;
}

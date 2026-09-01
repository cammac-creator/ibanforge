import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { alternatesFor } from "@/lib/seo";

/**
 * Metadata only. `page.tsx` here is a client component, and a `"use client"`
 * module cannot export metadata at all, so this layout is the only place the
 * playground can declare its own.
 *
 * Two things changed on 2026-09-01. It now declares a canonical: without one it
 * inherited the locale layout's, which named the HOME as the canonical version
 * of the playground in all three languages (WEB-01). And the title and
 * description come from the message catalogue instead of a hardcoded English
 * `export const metadata`, which served English copy to the French and German
 * pages of a page that is otherwise fully translated.
 *
 * The layout renders its children untouched.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "playground" });
  return {
    title: t("metaTitle"),
    description: t("subtitle"),
    alternates: alternatesFor(locale, "/playground"),
  };
}

export default function PlaygroundLayout({ children }: { children: ReactNode }) {
  return children;
}

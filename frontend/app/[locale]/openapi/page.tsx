import { getTranslations } from "next-intl/server";
import { alternatesFor } from "@/lib/seo";
import { ApiReferenceClient } from "./client";

/**
 * The interactive OpenAPI reference.
 *
 * Audit 2026-09-01. Two things were wrong with the shell around the Scalar
 * widget, both invisible from a browser and both plain in the served HTML:
 *
 * - the title read "OpenAPI Reference — IBANforge" and the locale layout's
 *   template appended "| IBANforge" to it, so the brand was announced twice
 *   (WEB-20), and the metadata was hardcoded English on the French and German
 *   pages;
 * - the page had NO `h1` at all in any of the three languages (WEB-19). Scalar
 *   builds its own headings after hydration, so the document a crawler reads
 *   was headless. The `h1` below is `sr-only`: it names the page in the served
 *   HTML without putting a second title above a widget that already carries
 *   one.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "openapi" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: alternatesFor(locale, "/openapi"),
  };
}

export default async function OpenApiPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "openapi" });
  return (
    <div className="min-h-screen bg-background">
      <h1 className="sr-only">{t("title")}</h1>
      <ApiReferenceClient />
    </div>
  );
}

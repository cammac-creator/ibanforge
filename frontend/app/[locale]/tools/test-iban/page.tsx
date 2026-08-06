import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { TestIbanClient } from "@/components/test-iban-client";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "testIban" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

export default async function TestIbanPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("testIban");

  const curl = `curl "https://api.ibanforge.com/v1/test-iban?country=DE&count=5"`;

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-10">
      <header className="flex flex-col gap-4">
        <Badge variant="outline" className="w-fit">
          {t("eyebrow")}
        </Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground leading-relaxed max-w-prose">{t("intro")}</p>
        <Link
          href={`/${locale}/blog/2026-08-06-example-ibans-unallocated-bank-codes`}
          className="text-sm font-medium text-primary hover:underline w-fit"
        >
          {t("articleLink")} →
        </Link>
      </header>

      <TestIbanClient />

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{t("devTitle")}</h2>
        <p className="text-muted-foreground text-sm">{t("devIntro")}</p>
        <pre className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm overflow-x-auto">
          <code>{curl}</code>
        </pre>
      </section>

      <p className="text-xs text-muted-foreground border-t border-border pt-4">{t("disclaimer")}</p>
    </div>
  );
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { AuditClient } from "@/components/audit-client";
import { alternatesFor } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "audit" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternatesFor(locale, "/audit"),
    openGraph: {
      title: t("metaTitle"),
      description: t("ogDescription"),
      url: `https://ibanforge.com/${locale}/audit`,
      type: "website",
    },
    twitter: { card: "summary_large_image", title: t("metaTitle"), description: t("ogDescription") },
  };
}

export default async function AuditPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("audit");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: t("metaTitle"),
    description: t("ogDescription"),
    brand: { "@type": "Brand", name: "IBANforge" },
    url: `https://ibanforge.com/${locale}/audit`,
    offers: [
      { "@type": "Offer", price: "149", priceCurrency: "CHF", description: t("prices.standard"), availability: "https://schema.org/InStock", url: `https://ibanforge.com/${locale}/audit` },
      { "@type": "Offer", price: "349", priceCurrency: "CHF", description: t("prices.large"), availability: "https://schema.org/InStock", url: `https://ibanforge.com/${locale}/audit` },
    ],
  };

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <header className="flex flex-col gap-4">
        <Badge variant="outline" className="w-fit">
          {t("eyebrow")}
        </Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground leading-relaxed max-w-prose">{t("intro")}</p>
      </header>

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border p-5 flex flex-col gap-3">
          <h2 className="font-semibold">{t("promise.title")}</h2>
          <ul className="text-sm text-muted-foreground leading-relaxed list-disc pl-5 flex flex-col gap-1">
            <li>{t("promise.item1")}</li>
            <li>{t("promise.item2")}</li>
            <li>{t("promise.item3")}</li>
            <li>{t("promise.item4")}</li>
            <li>{t("promise.item5")}</li>
          </ul>
        </div>
        <div className="rounded-lg border p-5 flex flex-col gap-3">
          <h2 className="font-semibold">{t("prices.title")}</h2>
          <p className="text-2xl font-semibold tracking-tight">
            149 CHF <span className="text-sm font-normal text-muted-foreground">{t("prices.standard")}</span>
          </p>
          <p className="text-2xl font-semibold tracking-tight">
            349 CHF <span className="text-sm font-normal text-muted-foreground">{t("prices.large")}</span>
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">{t("prices.note")}</p>
        </div>
      </section>

      <section className="rounded-lg border border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20 p-5 flex flex-col gap-2">
        <h2 className="font-semibold">{t("deadline.title")}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("deadline.text")}</p>
      </section>

      <AuditClient locale={locale} />

      <section className="flex flex-col gap-2 text-sm text-muted-foreground leading-relaxed">
        <h2 className="font-semibold text-foreground">{t("privacy.title")}</h2>
        <p>{t("privacy.text")}</p>
        <p>{t("privacy.support")}</p>
      </section>
    </div>
  );
}

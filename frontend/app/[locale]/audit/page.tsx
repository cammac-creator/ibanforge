import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { AuditClient } from "@/components/audit-client";
import { ClientMessages } from "@/components/client-messages"
import { AuditWorkbookPreview } from "@/components/audit-workbook-preview";
import { Upload, Eye, Download } from "lucide-react";
import { alternatesFor, urlFor } from "@/lib/seo";

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
      url: urlFor(locale, '/audit'),
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
    url: urlFor(locale, '/audit'),
    offers: [
      { "@type": "Offer", price: "149", priceCurrency: "CHF", description: t("prices.standard"), availability: "https://schema.org/InStock", url: urlFor(locale, '/audit') },
      { "@type": "Offer", price: "349", priceCurrency: "CHF", description: t("prices.large"), availability: "https://schema.org/InStock", url: urlFor(locale, '/audit') },
    ],
  };

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [1, 2, 3, 4, 5].map((n) => ({
      "@type": "Question",
      name: t(`faq.q${n}`),
      acceptedAnswer: { "@type": "Answer", text: t(`faq.a${n}`) },
    })),
  };

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <header className="flex flex-col gap-4">
        <Badge variant="outline" className="w-fit">
          {t("eyebrow")}
        </Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground leading-relaxed max-w-prose">{t("intro")}</p>
      </header>

      <section aria-label={t("steps.title")} className="grid gap-4 sm:grid-cols-3">
        {[
          { Icon: Upload, title: t("steps.s1t"), text: t("steps.s1") },
          { Icon: Eye, title: t("steps.s2t"), text: t("steps.s2") },
          { Icon: Download, title: t("steps.s3t"), text: t("steps.s3") },
        ].map(({ Icon, title, text }, i) => (
          <div key={title} className="rounded-lg border p-4 flex gap-3">
            <div className="flex-none h-9 w-9 rounded-full bg-amber-500/15 text-amber-500 flex items-center justify-center">
              <Icon className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <p className="text-xs font-mono text-muted-foreground">0{i + 1}</p>
              <p className="font-medium">{title}</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{text}</p>
            </div>
          </div>
        ))}
      </section>

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

      <ClientMessages ns={["audit"]}><AuditClient locale={locale} /></ClientMessages>

      <AuditWorkbookPreview locale={locale} />

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">{t("faq.title")}</h2>
        {[1, 2, 3, 4, 5].map((n) => (
          <details key={n} className="rounded-lg border p-4 group">
            <summary className="cursor-pointer font-medium list-none flex justify-between gap-4">
              {t(`faq.q${n}`)}
              <span className="text-muted-foreground group-open:rotate-45 transition-transform" aria-hidden>+</span>
            </summary>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{t(`faq.a${n}`)}</p>
          </details>
        ))}
      </section>

      <section className="flex flex-col gap-2 text-sm text-muted-foreground leading-relaxed">
        <h2 className="font-semibold text-foreground">{t("privacy.title")}</h2>
        <p>{t("privacy.text")}</p>
        <p>{t("privacy.support")}</p>
      </section>
    </div>
  );
}

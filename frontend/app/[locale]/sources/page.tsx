import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, FileCheck2, Landmark, Ruler, ScrollText } from "lucide-react";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "sources" });
  return {
    title: t("meta.title"),
    description: t("meta.description"),
  };
}

const PRINCIPLES = ["0", "1", "2"] as const;
const LICENCES = ["0", "1", "2", "3"] as const;
const HONEST = ["0", "1", "2", "3"] as const;

/**
 * The permissions page shows only what is settled: a written permission, a
 * public licence honoured in the response, a register named and dated. What is
 * still being clarified with a publisher stays OFF this page until it lands —
 * the page must never run ahead of the people it credits.
 */
export default async function SourcesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("sources");

  return (
    <div className="flex flex-col">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center text-center px-4 pt-24 pb-16 sm:pt-28 gap-6 max-w-3xl mx-auto">
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1
          className="text-4xl sm:text-5xl font-bold tracking-tight font-mono"
          style={{ lineHeight: 1.1, letterSpacing: "-0.03em" }}
        >
          {t("hero.title")}
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground" style={{ lineHeight: 1.65 }}>
          {t("hero.description")}
        </p>
      </section>

      {/* ── The three habits ──────────────────────────────────────────────── */}
      <section className="px-4 pb-16 max-w-5xl mx-auto w-full">
        <h2 className="text-xl font-semibold tracking-tight mb-5 text-center">{t("principle.title")}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {PRINCIPLES.map((i) => (
            <div key={i} className="rounded-xl border border-border p-5" style={{ background: "var(--ink-1)" }}>
              <Ruler className="h-5 w-5 text-amber-500 mb-3" aria-hidden />
              <p className="text-sm font-medium text-foreground">{t(`principle.items.${i}.title`)}</p>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{t(`principle.items.${i}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Written permission ────────────────────────────────────────────── */}
      <section className="px-4 pb-16 max-w-5xl mx-auto w-full">
        <div className="flex items-baseline gap-3 mb-1.5">
          <Landmark className="h-5 w-5 translate-y-0.5 text-amber-500" aria-hidden />
          <h2 className="text-xl font-semibold tracking-tight">{t("written.title")}</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-5">{t("written.sub")}</p>
        <div className="rounded-xl border border-amber-500/40 p-5" style={{ background: "var(--ink-1)" }}>
          <p className="text-sm font-medium text-foreground">{t("written.boe.name")}</p>
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{t("written.boe.body")}</p>
        </div>
      </section>

      {/* ── Public licences ───────────────────────────────────────────────── */}
      <section className="px-4 pb-16 max-w-5xl mx-auto w-full">
        <div className="flex items-baseline gap-3 mb-1.5">
          <ScrollText className="h-5 w-5 translate-y-0.5 text-amber-500" aria-hidden />
          <h2 className="text-xl font-semibold tracking-tight">{t("licences.title")}</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-5">{t("licences.sub")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {LICENCES.map((i) => (
            <div key={i} className="rounded-xl border border-border p-5" style={{ background: "var(--ink-1)" }}>
              <p className="text-sm font-medium text-foreground">{t(`licences.items.${i}.name`)}</p>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{t(`licences.items.${i}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── National registers ────────────────────────────────────────────── */}
      <section className="px-4 pb-16 max-w-5xl mx-auto w-full">
        <div className="flex items-baseline gap-3 mb-1.5">
          <FileCheck2 className="h-5 w-5 translate-y-0.5 text-amber-500" aria-hidden />
          <h2 className="text-xl font-semibold tracking-tight">{t("registers.title")}</h2>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">{t("registers.body")}</p>
        <Link
          href={`/${locale}/docs/data-sources`}
          className="mt-3 inline-flex items-center gap-1.5 text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4 transition-colors"
        >
          {t("registers.link")}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </section>

      {/* ── What we do not claim ──────────────────────────────────────────── */}
      <section className="px-4 pb-20 max-w-5xl mx-auto w-full">
        <div className="rounded-xl border border-border p-6" style={{ background: "var(--ink-1)" }}>
          <h2 className="text-lg font-semibold tracking-tight mb-3">{t("honest.title")}</h2>
          <ul className="space-y-2.5">
            {HONEST.map((i) => (
              <li key={i} className="flex gap-2.5 text-sm text-muted-foreground leading-relaxed">
                <span className="text-amber-500 select-none" aria-hidden>
                  —
                </span>
                <span>{t(`honest.items.${i}`)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-6 flex flex-col sm:flex-row gap-x-8 gap-y-2">
          <Link
            href={`/${locale}/docs/data-sources`}
            className="text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4 transition-colors"
          >
            {t("cta.docs")}
          </Link>
          <Link
            href={`/${locale}/changelog`}
            className="text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4 transition-colors"
          >
            {t("cta.changelog")}
          </Link>
        </div>
      </section>
    </div>
  );
}

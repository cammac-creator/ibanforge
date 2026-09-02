import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, CalendarClock, FileCheck2, Landmark, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { alternatesFor } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "vendors" });
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    alternates: alternatesFor(locale, "/vendors"),
  };
}

const ARG_ICONS = [Landmark, ShieldCheck, FileCheck2] as const;

export default async function VendorsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("vendors");

  // Card links mirror the three arguments: Swiss clearing docs, compliance
  // docs, legal/DPA. Kept in code (not i18n) — they're routes, not copy.
  const ARG_LINKS = [
    `/${locale}/docs/ch-clearing`,
    `/${locale}/docs/compliance`,
    `/${locale}/legal/dpa`,
  ] as const;

  const STEPS = [0, 1, 2] as const;

  return (
    <div className="flex flex-col">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center text-center px-4 py-28 sm:py-32 gap-7 max-w-3xl mx-auto">
        <span className="eyebrow">{t("eyebrow")}</span>

        <h1
          className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight font-mono"
          style={{ lineHeight: 1.08, letterSpacing: "-0.035em" }}
        >
          {t("hero.title")}
        </h1>

        <p className="max-w-2xl text-lg text-muted-foreground" style={{ lineHeight: 1.65 }}>
          {t("hero.description")}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mt-2">
          <Button
            size="lg"
            variant="amber"
            className="px-6"
            render={<a href="mailto:support@ibanforge.com?subject=OEM%20licensing" />}
          >
            {t("hero.cta.contact")}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="px-6"
            render={<Link href={`/${locale}/docs`} />}
          >
            {t("hero.cta.docs")}
          </Button>
        </div>
      </section>

      {/* ── Structured-address deadline band ────────────────────────────── */}
      <section className="px-4 pb-8 max-w-4xl mx-auto w-full">
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-7 sm:p-8 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge
              variant="outline"
              className="text-amber-500 border-amber-500/40 bg-amber-500/10 font-mono text-xs inline-flex items-center gap-1.5"
            >
              <CalendarClock className="size-3.5" aria-hidden />
              {t("deadline.badge")}
            </Badge>
            <h2 className="text-lg sm:text-xl font-semibold tracking-tight font-mono text-amber-500">
              {t("deadline.title")}
            </h2>
          </div>
          <p className="text-sm text-muted-foreground" style={{ lineHeight: 1.7 }}>
            {t("deadline.body")}
          </p>
          <p className="text-sm text-foreground/90" style={{ lineHeight: 1.7 }}>
            {t("deadline.what")}
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <figure className="m-0 min-w-0">
              <figcaption className="font-mono text-[11px] uppercase tracking-caps text-muted-foreground mb-1.5">
                {t("deadline.refused")}
              </figcaption>
              <pre
                className="text-[11.5px] leading-relaxed rounded-lg border p-3 overflow-x-auto whitespace-pre"
                style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}
              >{`curl -X POST https://api.ibanforge.com/v1/address/check \\
  -H "Content-Type: application/json" \\
  -d '{"scheme":"sps","address":{"ctry":"ch",
       "adr_line":["Bahnhofstrasse 45","8001 Zurich"]}}'

{ "conforms": false,
  "findings": [ { "rule": "twn_nm_required", "verdict": "fail" },
                { "rule": "ctry_iso3166",    "verdict": "fail" } ] }`}</pre>
            </figure>
            <figure className="m-0 min-w-0">
              <figcaption className="font-mono text-[11px] uppercase tracking-caps text-muted-foreground mb-1.5">
                {t("deadline.accepted")}
              </figcaption>
              <pre
                className="text-[11.5px] leading-relaxed rounded-lg border p-3 overflow-x-auto whitespace-pre"
                style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}
              >{`curl -X POST https://api.ibanforge.com/v1/address/check \\
  -H "Content-Type: application/json" \\
  -d '{"scheme":"sps","address":{"strt_nm":"Bahnhofstrasse",
       "bldg_nb":"45","pst_cd":"8001","twn_nm":"Zurich","ctry":"CH"}}'

{ "conforms": true, "findings": [ ... all "pass" ... ] }`}</pre>
            </figure>
          </div>
          <p className="text-sm font-medium text-foreground border-t pt-4" style={{ borderColor: "rgba(245, 158, 11, 0.15)" }}>
            {t("deadline.note")}
          </p>
          <p className="text-xs text-muted-foreground" style={{ lineHeight: 1.7 }}>
            <span className="font-semibold text-foreground/80">{t("vop.title")}.</span> {t("vop.body")}
          </p>
        </div>
      </section>

      {/* ── Where it sits — 3-step flow ───────────────────────────────────── */}
      <section className="px-4 py-24 max-w-5xl mx-auto w-full">
        <h2
          className="text-2xl sm:text-3xl font-semibold tracking-tight mb-14 text-center"
          style={{ letterSpacing: "-0.02em" }}
        >
          {t("flow.heading")}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] gap-4 items-stretch">
          {STEPS.map((i) => (
            <div key={i} className="contents">
              {i > 0 && (
                <div className="hidden md:flex items-center justify-center text-amber-500/70">
                  <ArrowRight className="size-5" aria-hidden />
                </div>
              )}
              <div
                className="rounded-xl border p-6 flex flex-col gap-3"
                style={{ borderColor: i === 1 ? "rgba(245, 158, 11, 0.4)" : "var(--ink-4)", background: i === 1 ? "rgba(245, 158, 11, 0.05)" : "var(--ink-1)" }}
              >
                <span className="font-mono text-xs text-amber-500">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="font-semibold text-foreground">{t(`flow.steps.${i}.title`)}</h3>
                <p className="text-sm text-muted-foreground" style={{ lineHeight: 1.65 }}>
                  {t(`flow.steps.${i}.body`)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Three arguments ───────────────────────────────────────────────── */}
      <section className="px-4 pb-24 max-w-6xl mx-auto w-full">
        <h2
          className="text-2xl sm:text-3xl font-semibold tracking-tight mb-14 text-center"
          style={{ letterSpacing: "-0.02em" }}
        >
          {t("args.heading")}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {ARG_LINKS.map((href, i) => {
            const Icon = ARG_ICONS[i];
            return (
              <div
                key={href}
                className="rounded-xl border p-7 flex flex-col gap-3"
                style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}
              >
                <Icon className="size-5 text-amber-500" aria-hidden />
                <h3 className="font-semibold text-foreground">{t(`args.items.${i}.title`)}</h3>
                <p className="text-sm text-muted-foreground flex-1" style={{ lineHeight: 1.65 }}>
                  {t(`args.items.${i}.body`)}
                </p>
                <Link
                  href={href}
                  className="text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4 transition-colors w-fit"
                >
                  {t(`args.items.${i}.link`)} →
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── OEM contact ───────────────────────────────────────────────────── */}
      <section className="border-t px-4 py-24 w-full" style={{ borderColor: "var(--hairline)" }}>
        <div className="max-w-3xl mx-auto flex flex-col items-center text-center gap-5">
          <span className="eyebrow">{t("oem.eyebrow")}</span>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight" style={{ letterSpacing: "-0.02em" }}>
            {t("oem.title")}
          </h2>
          <p className="text-3xl sm:text-4xl font-semibold tracking-tight font-mono text-amber-500">
            {t("oem.price")}
          </p>
          <p className="text-sm text-foreground/90 max-w-xl text-balance" style={{ lineHeight: 1.7 }}>
            {t("oem.priceDetail")}
          </p>
          <p className="text-sm text-muted-foreground max-w-xl text-balance" style={{ lineHeight: 1.7 }}>
            {t("oem.body")}
          </p>
          <Button
            size="lg"
            variant="amber"
            className="px-8 font-mono"
            render={<a href="mailto:support@ibanforge.com?subject=OEM%20licensing" />}
          >
            {t("oem.cta")}
          </Button>
          <p className="text-xs text-muted-foreground/70">{t("oem.hint")}</p>
          <Link
            href={`/${locale}/legal/sla`}
            className="text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4 transition-colors"
          >
            {t("oem.slaLink")} →
          </Link>
        </div>
      </section>
    </div>
  );
}

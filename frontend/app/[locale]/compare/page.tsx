import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Check, Scale, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GetKeyButton } from "@/components/api-key-dialog";
import { alternatesFor } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "compare" });
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    alternates: alternatesFor(locale, "/compare"),
  };
}

// Row keys of the comparison table — content lives in i18n (compare.table.rows.*).
const ROWS = [
  "pricing",
  "example",
  "freeTier",
  "bankData",
  "swiss",
  "compliance",
  "agents",
  "signup",
  "trust",
] as const;

const COLS = ["ibanforge", "abstract", "ibancom", "ibanapi", "libs"] as const;
const OTHERS = [0, 1, 2, 3, 4] as const;

export default async function ComparePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("compare");

  return (
    <div className="flex flex-col">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center text-center px-4 pt-28 pb-12 sm:pt-32 gap-7 max-w-3xl mx-auto">
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1 className="text-5xl sm:text-6xl md:text-7xl display-forge">
          {t("hero.title")}
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground" style={{ lineHeight: 1.65 }}>
          {t("hero.description")}
        </p>
      </section>

      {/* ── Disclosure ────────────────────────────────────────────────────── */}
      <section className="px-4 pb-12 max-w-3xl mx-auto w-full">
        <div
          className="rounded-xl border px-5 py-4 flex gap-3 items-start"
          style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}
        >
          <Scale className="size-4 shrink-0 mt-0.5 text-amber-500" aria-hidden />
          <p className="text-sm text-muted-foreground" style={{ lineHeight: 1.65 }}>
            {t("disclosure")}
          </p>
        </div>
      </section>

      {/* ── Comparison table ──────────────────────────────────────────────── */}
      <section className="px-4 pb-20 max-w-6xl mx-auto w-full">
        <h2
          className="text-2xl sm:text-3xl font-semibold tracking-tight mb-10 text-center"
          style={{ letterSpacing: "-0.02em" }}
        >
          {t("table.heading")}
        </h2>

        <div
          className="rounded-xl border overflow-x-auto"
          style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}
        >
          <table className="w-full text-sm" style={{ minWidth: "1120px" }}>
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--ink-4)", background: "var(--ink-2)" }}>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs w-[16%]">
                  {t("table.cols.feature")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-mono font-semibold text-amber-500 w-[23%]">
                  {t("table.cols.ibanforge")}
                </th>
                {(["abstract", "ibancom", "ibanapi", "libs"] as const).map((c) => (
                  <th key={c} className="px-4 py-3 text-left text-xs font-mono font-semibold text-foreground w-[15%]">
                    {t(`table.cols.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => (
                <tr
                  key={row}
                  className={i < ROWS.length - 1 ? "border-b" : ""}
                  style={{ borderColor: "var(--hairline)" }}
                >
                  <td className="px-4 py-4 align-top text-xs font-medium text-foreground">
                    {t(`table.rows.${row}.label`)}
                  </td>
                  {COLS.map((col) => (
                    <td
                      key={col}
                      className="px-4 py-4 align-top text-xs text-muted-foreground"
                      style={{
                        lineHeight: 1.6,
                        ...(col === "ibanforge"
                          ? { background: "rgba(245, 158, 11, 0.04)", color: "var(--foreground)" }
                          : {}),
                      }}
                    >
                      {t(`table.rows.${row}.${col}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground/70 mt-4" style={{ lineHeight: 1.6 }}>
          {t("footnote")}{" "}
          <a
            href="https://www.iban.com/pricing"
            rel="nofollow noopener"
            className="underline underline-offset-2 hover:text-muted-foreground"
          >
            iban.com/pricing
          </a>{" "}
          ·{" "}
          <a
            href="https://ibanapi.com/prices"
            rel="nofollow noopener"
            className="underline underline-offset-2 hover:text-muted-foreground"
          >
            ibanapi.com/prices
          </a>{" "}
          ·{" "}
          <a
            href="https://www.abstractapi.com/api/iban-validation"
            rel="nofollow noopener"
            className="underline underline-offset-2 hover:text-muted-foreground"
          >
            abstractapi.com
          </a>
        </p>
      </section>

      {/* ── Where we lose ─────────────────────────────────────────────────── */}
      <section className="px-4 pb-20 max-w-4xl mx-auto w-full">
        <h2
          className="text-2xl sm:text-3xl font-semibold tracking-tight mb-10 text-center"
          style={{ letterSpacing: "-0.02em" }}
        >
          {t("honest.heading")}
        </h2>
        <ul className="flex flex-col gap-4">
          {[0, 1].map((i) => (
            <li
              key={i}
              className="rounded-xl border p-5 flex gap-3 items-start"
              style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}
            >
              <Scale className="size-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground" style={{ lineHeight: 1.65 }}>
                {t(`honest.items.${i}`)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Also on the market ────────────────────────────────────────────── */}
      <section className="px-4 pb-20 max-w-5xl mx-auto w-full">
        <h2
          className="text-2xl sm:text-3xl font-semibold tracking-tight mb-10 text-center"
          style={{ letterSpacing: "-0.02em" }}
        >
          {t("others.heading")}
        </h2>
        <div
          className="rounded-xl border overflow-x-auto"
          style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}
        >
          <table className="w-full text-sm" style={{ minWidth: "760px" }}>
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--ink-4)", background: "var(--ink-2)" }}>
                {(["vendor", "sells", "price", "free"] as const).map((c) => (
                  <th key={c} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                    {t(`others.cols.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {OTHERS.map((i) => (
                <tr key={i} className={i < OTHERS.length - 1 ? "border-b" : ""} style={{ borderColor: "var(--hairline)" }}>
                  <td className="px-4 py-4 align-top text-xs font-mono font-semibold text-foreground">{t(`others.rows.${i}.vendor`)}</td>
                  <td className="px-4 py-4 align-top text-xs text-muted-foreground" style={{ lineHeight: 1.6 }}>{t(`others.rows.${i}.sells`)}</td>
                  <td className="px-4 py-4 align-top text-xs text-muted-foreground" style={{ lineHeight: 1.6 }}>{t(`others.rows.${i}.price`)}</td>
                  <td className="px-4 py-4 align-top text-xs text-muted-foreground" style={{ lineHeight: 1.6 }}>{t(`others.rows.${i}.free`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground/70 mt-4" style={{ lineHeight: 1.6 }}>
          {t("footnoteExtra")}{" "}
          <a href="https://www.iban.de/preise.html" rel="nofollow noopener" className="underline underline-offset-2 hover:text-muted-foreground">iban.de</a>{" "}·{" "}
          <a href="https://www.iban-test.eu/" rel="nofollow noopener" className="underline underline-offset-2 hover:text-muted-foreground">iban-test.eu</a>{" "}·{" "}
          <a href="https://www.bankdataapi.com/" rel="nofollow noopener" className="underline underline-offset-2 hover:text-muted-foreground">bankdataapi.com</a>{" "}·{" "}
          <a href="https://api-ninjas.com/pricing" rel="nofollow noopener" className="underline underline-offset-2 hover:text-muted-foreground">api-ninjas.com</a>{" "}·{" "}
          <a href="https://openiban.com/" rel="nofollow noopener" className="underline underline-offset-2 hover:text-muted-foreground">openiban.com</a>
        </p>
      </section>

      {/* ── When NOT to pick us ───────────────────────────────────────────── */}
      <section className="px-4 pb-20 max-w-4xl mx-auto w-full">
        <h2
          className="text-2xl sm:text-3xl font-semibold tracking-tight mb-10 text-center"
          style={{ letterSpacing: "-0.02em" }}
        >
          {t("notFor.heading")}
        </h2>
        <ul className="flex flex-col gap-4">
          {[0, 1, 2, 3].map((i) => (
            <li
              key={i}
              className="rounded-xl border p-5 flex gap-3 items-start"
              style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}
            >
              <X className="size-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground" style={{ lineHeight: 1.65 }}>
                {t(`notFor.items.${i}`)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Where we win ──────────────────────────────────────────────────── */}
      <section className="px-4 pb-20 max-w-4xl mx-auto w-full">
        <h2
          className="text-2xl sm:text-3xl font-semibold tracking-tight mb-10 text-center"
          style={{ letterSpacing: "-0.02em" }}
        >
          {t("forWho.heading")}
        </h2>
        <ul className="flex flex-col gap-4">
          {[0, 1, 2, 3].map((i) => (
            <li
              key={i}
              className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-5 flex gap-3 items-start"
            >
              <Check className="size-4 shrink-0 mt-0.5 text-amber-500" aria-hidden />
              <p className="text-sm text-foreground/90" style={{ lineHeight: 1.65 }}>
                {t(`forWho.items.${i}`)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <section
        className="border-t flex flex-col items-center text-center px-4 py-24 gap-5"
        style={{ borderColor: "var(--hairline)" }}
      >
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight" style={{ letterSpacing: "-0.02em" }}>
          {t("cta.heading")}
        </h2>
        <p className="text-sm text-muted-foreground max-w-md" style={{ lineHeight: 1.65 }}>
          {t("cta.description")}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 mt-1">
          <GetKeyButton variant="amber" className="px-6">
            {t("cta.getKey")}
          </GetKeyButton>
          <Button size="lg" variant="outline" className="px-6" render={<Link href={`/${locale}/playground`} />}>
            {t("cta.playground")}
          </Button>
        </div>
      </section>
    </div>
  );
}

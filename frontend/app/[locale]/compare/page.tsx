import type { Metadata } from "next"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "Compare IBAN Validation APIs",
  description:
    "Compare IBANforge with iban.com, IBANAPI, and AbstractAPI. Pricing, features, AI agent support, and self-hosting options.",
}

const FEATURE_COUNT = 15
const DIFFERENTIATOR_COUNT = 3

function Cell({ value, highlight }: { value: string; highlight?: boolean }) {
  const isYes = value === "Yes"
  const isNo = value === "No"
  return (
    <td
      className={
        "px-4 py-3 text-sm text-center " +
        (highlight
          ? isYes
            ? "text-amber-400 font-semibold"
            : isNo
              ? "text-zinc-600"
              : "text-zinc-300 font-medium"
          : isNo
            ? "text-zinc-600"
            : "text-zinc-400")
      }
    >
      {value}
    </td>
  )
}

const compareJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "IBANforge vs Alternatives — IBAN Validation API Comparison",
  description:
    "Compare IBANforge with iban.com, IBANAPI, and AbstractAPI on pricing, features, and AI agent support.",
  url: "https://ibanforge.com/compare",
}

export default async function ComparePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = useTranslations('compare');

  const FEATURES = Array.from({ length: FEATURE_COUNT }, (_, i) => ({
    label: t(`features.${i}.label`),
    ibanforge: t(`features.${i}.ibanforge`),
    ibancom: t(`features.${i}.ibancom`),
    ibanapi: t(`features.${i}.ibanapi`),
    abstract: t(`features.${i}.abstract`),
  }))

  const DIFFERENTIATORS = Array.from({ length: DIFFERENTIATOR_COUNT }, (_, i) => ({
    title: t(`differentiators.${i}.title`),
    body: t(`differentiators.${i}.body`),
  }))

  return (
    <div className="flex flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(compareJsonLd) }}
      />

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center justify-center text-center px-4 py-24 gap-5">
        <Badge
          variant="outline"
          className="text-amber-500 border-amber-500/40 bg-amber-500/5 px-3 py-1 text-xs tracking-widest uppercase"
        >
          {t('badge')}
        </Badge>

        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight font-mono">
          {t('hero.title.prefix')} <span className="text-amber-500">{t('hero.title.highlight')}</span>
        </h1>

        <p className="max-w-xl text-lg text-muted-foreground leading-relaxed">
          {t('hero.description')}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mt-2">
          <Button
            size="lg"
            className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold px-6"
            render={<Link href={`/${locale}/playground`} />}
          >
            {t('hero.cta.tryFree')}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="px-6"
            render={<Link href={`/${locale}/pricing`} />}
          >
            {t('hero.cta.seePricing')}
          </Button>
        </div>
      </section>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <section className="px-4 pb-20 max-w-5xl mx-auto w-full">
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-border bg-zinc-900/50">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('table.header.feature')}
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-amber-500">
                  {t('table.header.ibanforge')}
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('table.header.ibancom')}
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('table.header.ibanapi')}
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('table.header.abstractapi')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {FEATURES.map((row) => (
                <tr key={row.label} className="hover:bg-zinc-900/30 transition-colors">
                  <td className="px-4 py-3 text-sm text-muted-foreground font-medium">
                    {row.label}
                  </td>
                  <Cell value={row.ibanforge} highlight />
                  <Cell value={row.ibancom} />
                  <Cell value={row.ibanapi} />
                  <Cell value={row.abstract} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs text-muted-foreground text-center">
          {t('disclaimer')}
        </p>
      </section>

      {/* ── Differentiators ───────────────────────────────────────────────── */}
      <section className="px-4 py-16 max-w-5xl mx-auto w-full border-t border-border">
        <h2 className="text-2xl font-semibold tracking-tight mb-10 text-center">
          {t('differentiators.heading')}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {DIFFERENTIATORS.map((card) => (
            <div
              key={card.title}
              className="rounded-xl border border-border bg-zinc-900/50 p-6 flex flex-col gap-3"
            >
              <h3 className="font-semibold text-amber-500 text-sm">{card.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center text-center px-4 py-24 gap-6 border-t border-border">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
          {t('cta.heading')}
        </h2>
        <p className="text-muted-foreground max-w-md">
          {t('cta.description')}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 mt-2">
          <Button
            size="lg"
            className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold px-8"
            render={<Link href={`/${locale}/playground`} />}
          >
            {t('cta.openPlayground')}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="px-8"
            render={<Link href={`/${locale}/docs`} />}
          >
            {t('cta.readDocs')}
          </Button>
        </div>
      </section>
    </div>
  )
}

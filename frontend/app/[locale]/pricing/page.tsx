import type { Metadata } from "next"
import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CostCalculator } from "./calculator"
import { Faq } from "./faq"
import { GetKeyButton } from "@/components/api-key-dialog"

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Three ways to pay, zero dead-ends: pay-per-call with x402 (no signup), a free key (200 req/month), or prepaid credit packs. Fractions of a cent per request.",
}

const ENDPOINT_COUNT = 5

// Live Stripe Payment Links for the prepaid credit packs (card checkout).
const CREDIT_PACKS = [
  { bundle: "1k", price: "$5", credits: "1 000", url: "https://buy.stripe.com/3cI00c18lauh1i8bqO8so00" },
  { bundle: "5k", price: "$20", credits: "5 000", url: "https://buy.stripe.com/aFafZa6sF45TaSI9iG8so01" },
  { bundle: "25k", price: "$80", credits: "25 000", url: "https://buy.stripe.com/14A7sE9ERbyld0QcuS8so02" },
] as const

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations('pricing');

  const ENDPOINTS = Array.from({ length: ENDPOINT_COUNT }, (_, i) => ({
    method: t(`endpoints.${i}.method`),
    path: t(`endpoints.${i}.path`),
    cost: t(`endpoints.${i}.cost`),
    costLabel: t(`endpoints.${i}.costLabel`),
    description: t(`endpoints.${i}.description`),
  }))

  const X402_ITEMS = [
    { icon: "💳", text: t('x402.items.0') },
    { icon: "⚡", text: t('x402.items.1') },
    { icon: "🔗", text: t('x402.items.2') },
    { icon: "🆓", text: t('x402.items.3') },
  ]

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": Array.from({ length: 4 }, (_, i) => ({
      "@type": "Question",
      "name": t(`faq.${i}.question`),
      "acceptedAnswer": {
        "@type": "Answer",
        "text": t(`faq.${i}.answer`),
      },
    })),
  }

  return (
    <div className="flex flex-col">
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
          <GetKeyButton className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold px-6">
            {t('rails.key.cta')}
          </GetKeyButton>
          <Button
            size="lg"
            variant="outline"
            className="px-6"
            render={<Link href={`/${locale}/playground`} />}
          >
            {t('hero.cta.tryFree')}
          </Button>
        </div>
      </section>

      {/* ── Three payment rails ───────────────────────────────────────────── */}
      <section className="px-4 pt-4 pb-12 max-w-5xl mx-auto w-full">
        <h2 className="text-2xl font-semibold tracking-tight mb-2 text-center">
          {t('rails.heading')}
        </h2>
        <p className="text-center text-muted-foreground mb-10 text-sm">
          {t('rails.subtitle')}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* x402 */}
          <div className="rounded-xl border border-border bg-zinc-900/50 p-6 flex flex-col gap-3">
            <span className="font-mono text-xs uppercase tracking-widest text-amber-500">
              {t('rails.x402.tag')}
            </span>
            <h3 className="text-lg font-semibold">{t('rails.x402.title')}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">{t('rails.x402.body')}</p>
            <Link
              href={`/${locale}/docs/x402`}
              className="text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4 transition-colors w-fit"
            >
              {t('rails.x402.cta')}
            </Link>
          </div>
          {/* Free key — highlighted */}
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-6 flex flex-col gap-3">
            <span className="font-mono text-xs uppercase tracking-widest text-amber-500">
              {t('rails.key.tag')}
            </span>
            <h3 className="text-lg font-semibold">{t('rails.key.title')}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">{t('rails.key.body')}</p>
            <GetKeyButton
              size="sm"
              className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold w-fit px-4"
            >
              {t('rails.key.cta')}
            </GetKeyButton>
          </div>
          {/* Credit packs — buyable via Stripe (live card checkout) */}
          <div className="rounded-xl border border-border bg-zinc-900/50 p-6 flex flex-col gap-3">
            <span className="font-mono text-xs uppercase tracking-widest text-amber-500">
              {t('rails.packs.tag')}
            </span>
            <h3 className="text-lg font-semibold">{t('rails.packs.title')}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">{t('rails.packs.body')}</p>
            <div className="grid grid-cols-3 gap-2 pt-1">
              {CREDIT_PACKS.map((p) => (
                <a
                  key={p.bundle}
                  href={p.url}
                  className="flex flex-col items-center gap-0.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2 py-2.5 text-center transition-colors hover:border-amber-500/60 hover:bg-amber-500/10"
                >
                  <span className="font-mono text-base font-bold text-amber-500">{p.price}</span>
                  <span className="text-[11px] text-muted-foreground">{p.credits}</span>
                </a>
              ))}
            </div>
            <p className="text-xs text-muted-foreground/70 leading-relaxed border-t border-border pt-3">
              {t('rails.packs.note')}
            </p>
          </div>
        </div>
      </section>

      {/* ── Pricing table ─────────────────────────────────────────────────── */}
      <section className="px-4 py-16 max-w-5xl mx-auto w-full">
        <h2 className="text-2xl font-semibold tracking-tight mb-2 text-center">
          {t('table.heading')}
        </h2>
        <p className="text-center text-muted-foreground mb-10 text-sm">
          {t('table.subtitle')}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ENDPOINTS.map((ep) => (
            <div
              key={ep.path}
              className="rounded-xl border border-border bg-zinc-900/50 p-6 flex flex-col gap-4"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">
                  {ep.method}
                </span>
                <span className="font-mono text-xs text-muted-foreground truncate">
                  {ep.path}
                </span>
              </div>

              <div>
                <p className="text-4xl font-bold font-mono text-amber-500">
                  {ep.cost}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{ep.costLabel}</p>
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed border-t border-border pt-3">
                {ep.description}
              </p>
            </div>
          ))}
        </div>

        {/* Free endpoints note */}
        <div className="mt-6 rounded-xl border border-border bg-zinc-900/30 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">{t('free.title')}</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t.rich('free.description', {
                demo: (chunks) => (
                  <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                    {chunks}
                  </code>
                ),
                health: (chunks) => (
                  <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                    {chunks}
                  </code>
                ),
              })}
            </p>
          </div>
          <Link
            href={`/${locale}/playground`}
            className="shrink-0 text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4 transition-colors"
          >
            {t('free.playgroundLink')}
          </Link>
        </div>
      </section>

      {/* ── Cost calculator ───────────────────────────────────────────────── */}
      <section className="px-4 py-16 max-w-3xl mx-auto w-full">
        <h2 className="text-2xl font-semibold tracking-tight mb-2 text-center">
          {t('calculator.heading')}
        </h2>
        <p className="text-center text-muted-foreground mb-10 text-sm">
          {t('calculator.subtitle')}
        </p>

        <CostCalculator />
      </section>

      {/* ── x402 explainer ────────────────────────────────────────────────── */}
      <section className="px-4 py-16 max-w-5xl mx-auto w-full">
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-8 flex flex-col gap-8 sm:flex-row sm:gap-12">
          <div className="flex flex-col gap-4 flex-1">
            <Badge
              variant="outline"
              className="w-fit text-amber-500 border-amber-500/40 bg-amber-500/10 font-mono text-xs"
            >
              {t('x402.badge')}
            </Badge>
            <h2 className="text-2xl font-semibold tracking-tight">
              {t('x402.heading')}
            </h2>
            <ul className="flex flex-col gap-3">
              {X402_ITEMS.map((item) => (
                <li key={item.text} className="flex gap-3 text-sm text-muted-foreground leading-relaxed">
                  <span className="text-base shrink-0">{item.icon}</span>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
            <Link
              href={`/${locale}/docs/x402`}
              className="text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4 transition-colors w-fit mt-1"
            >
              {t('x402.docsLink')}
            </Link>
          </div>

          {/* Code snippet */}
          <div className="flex-1">
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium">
              {t('x402.codeExample.title')}
            </p>
            <div className="rounded-lg bg-zinc-950 border border-border p-4 font-mono text-xs leading-relaxed overflow-x-auto">
              <p className="text-zinc-500">{t('x402.codeExample.install')}</p>
              <p className="text-zinc-300">npm install x402-fetch</p>
              <p className="mt-3 text-zinc-500">{t('x402.codeExample.call')}</p>
              <p className="text-amber-400">{"import"}{" "}<span className="text-zinc-300">{"{ wrapFetch }"}</span>{" "}<span className="text-amber-400">from</span>{" "}<span className="text-green-400">{'"x402-fetch"'}</span></p>
              <p className="text-zinc-500 mt-1">{t('x402.codeExample.comment')}</p>
              <p className="text-zinc-300">{"const"} fetch = wrapFetch()</p>
              <p className="mt-2 text-zinc-300">{"const"} res = <span className="text-amber-400">await</span> fetch(</p>
              <p className="text-green-400 pl-4">{'"https://api.ibanforge.com/v1/iban/validate"'}</p>
              <p className="text-zinc-300 pl-2">{")"}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────────── */}
      <section className="px-4 py-16 max-w-3xl mx-auto w-full">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
        <h2 className="text-2xl font-semibold tracking-tight mb-10 text-center">
          {t('faq.heading')}
        </h2>

        <Faq />
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

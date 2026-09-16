import type { Metadata } from "next"
import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { CreditCard, FlaskConical, Link2, Wallet, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CostCalculator } from "./calculator"
import { Faq } from "./faq"
import { ClientMessages } from "@/components/client-messages"
import { GetKeyButton } from "@/components/api-key-dialog"
import { alternatesFor } from "@/lib/seo"
import { localePath } from "@/lib/locale-path"

// Title and description come from the catalogue since 2026-09-05 (evening
// check): French and German searchers used to read an English snippet for a
// page we declare French or German. `generateMetadata` and not a static
// `metadata`: a segment's `alternates` REPLACES its parent's, so the
// canonical + hreflang set can only be added here, alongside a `params` read.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "pricing" })
  return {
    title: t("metadata.title"),
    description: t("metadata.description"),
    alternates: alternatesFor(locale, "/pricing"),
  }
}

const ENDPOINT_COUNT = 5

// Live Stripe Payment Links for the prepaid credit packs (card checkout).
const CREDIT_PACKS = [
  { bundle: "1k", price: "$4", credits: "1 000", url: "https://buy.stripe.com/bJe3coeZb31P6CsamK8so05" },
  { bundle: "5k", price: "$20", credits: "5 000", url: "https://buy.stripe.com/aFafZa6sF45TaSI9iG8so01" },
  { bundle: "25k", price: "$80", credits: "25 000", url: "https://buy.stripe.com/14A7sE9ERbyld0QcuS8so02" },
] as const

// Pro subscription (02/09/2026): the flat monthly tier, a public Payment Link
// whose metadata.plan = 'pro' is what the API webhook keys on. Price and
// allowance are restated in src/lib/payment-links.ts and src/lib/api-keys.ts.
const PRO_PAYMENT_LINK = "https://buy.stripe.com/aFacMYaIVeKx1i87ay8so04"

// Stripe customer portal (16/09/2026): the Pro subscriber manages their card,
// invoices and cancellation there; the key stays valid until the paid period ends.
const PRO_PORTAL_LINK = "https://billing.stripe.com/p/login/3cI00c18lauh1i8bqO8so00"

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
    { Icon: Wallet, text: t('x402.items.0') },
    { Icon: Zap, text: t('x402.items.1') },
    { Icon: Link2, text: t('x402.items.2') },
    { Icon: FlaskConical, text: t('x402.items.3') },
  ]

  // FAQPage JSON-LD removed 2026-08: Google dropped the FAQ rich result on
  // 2026-05-07. The visible FAQ section below is what humans and crawlers read.

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

        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight font-mono max-w-full">
          {t('hero.title.prefix')} <span className="text-amber-500">{t('hero.title.highlight')}</span>
        </h1>

        <p className="max-w-xl text-lg text-muted-foreground leading-relaxed">
          {t('hero.description')}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mt-2">
          <GetKeyButton variant="amber" className="px-6">
            {t('rails.key.cta')}
          </GetKeyButton>
          <Button
            size="lg"
            variant="outline"
            className="px-6"
            nativeButton={false}
            render={<Link href={localePath(locale, '/playground')} />}
          >
            {t('hero.cta.tryFree')}
          </Button>
        </div>
      </section>

      <section aria-labelledby="pricing-uses" className="px-4 pb-12 max-w-5xl mx-auto w-full">
        <h2 id="pricing-uses" className="text-xl font-semibold mb-5">{t("uses.heading")}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {(["occasional", "regular", "agent"] as const).map((use, i) => (
            <a key={use} href={["#packs", "#pro", "#x402"][i]} className="rounded-xl border border-border p-5 hover:border-amber-500/60 focus-visible:outline-2 focus-visible:outline-amber-500">
              <span className="font-mono text-xs text-amber-500">0{i + 1}</span>
              <h3 className="font-semibold mt-3">{t(`uses.${use}.title`)}</h3>
              <p className="text-sm text-muted-foreground mt-2">{t(`uses.${use}.body`)}</p>
              <span className="block text-sm text-amber-500 mt-4">{t(`uses.${use}.cta`)} →</span>
            </a>
          ))}
        </div>
        <a href="#estimate" className="inline-block mt-5 text-sm underline underline-offset-4">{t("uses.estimate")}</a>
      </section>

      {/* ── Three payment rails ───────────────────────────────────────────── */}
      <section className="px-4 pt-4 pb-12 max-w-5xl mx-auto w-full">
        <h2 className="text-2xl font-semibold tracking-tight mb-2 text-center">
          {t('rails.heading')}
        </h2>
        <p className="text-center text-muted-foreground mb-10 text-sm">
          {t('rails.subtitle')}
        </p>
        {/* Order mirrors the real 402 hierarchy: free key → prepaid packs → x402. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 1. Free key — highlighted */}
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-6 flex flex-col gap-3">
            <span className="font-mono text-xs uppercase tracking-widest text-amber-500">
              {t('rails.key.tag')}
            </span>
            <h3 className="text-lg font-semibold">{t('rails.key.title')}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">{t('rails.key.body')}</p>
            <GetKeyButton
              size="sm"
              variant="amber"
              className="w-fit px-4"
            >
              {t('rails.key.cta')}
            </GetKeyButton>
          </div>
          {/* 2. Credit packs — buyable via Stripe (live card checkout) */}
          <div id="packs" className="card-surface scroll-mt-28 rounded-xl border p-6 flex flex-col gap-3">
            <span className="font-mono text-xs uppercase tracking-widest text-amber-500">
              {t('rails.packs.tag')}
            </span>
            <h3 className="text-lg font-semibold">{t('rails.packs.title')}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">{t('rails.packs.body')}</p>
            <p className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <CreditCard className="size-4 text-amber-500" aria-hidden />
              {t('rails.packs.cardLabel')}
            </p>
            <div className="flex flex-wrap gap-2">
              {CREDIT_PACKS.map((p) => (
                <a
                  key={p.bundle}
                  href={p.url}
                  className="flex flex-1 basis-20 flex-col items-center gap-0.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2 py-2.5 text-center transition-colors hover:border-amber-500/60 hover:bg-amber-500/10"
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
          {/* 3. x402 */}
          <div className="card-surface rounded-xl border p-6 flex flex-col gap-3">
            <span className="font-mono text-xs uppercase tracking-widest text-amber-500">
              {t('rails.x402.tag')}
            </span>
            <h3 className="text-lg font-semibold">{t('rails.x402.title')}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">{t('rails.x402.body')}</p>
            <Link
              href={localePath(locale, '/docs/x402')}
              className="text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4 transition-colors w-fit"
            >
              {t('rails.x402.cta')}
            </Link>
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          {t.rich('rails.termsNotice', {
            terms: (chunks) => (
              <Link href={localePath(locale, '/legal/terms')} className="underline underline-offset-2 hover:text-foreground">
                {chunks}
              </Link>
            ),
          })}
        </p>
        {/* Licence condition (ECB, Banco de España): buyers must be told, before
            they pay, that the underlying data is free at its official source.
            Framed as what it truly is — you pay for the product, not the data. */}
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {t.rich('rails.dataNotice', {
            sources: (chunks) => (
              <Link href={localePath(locale, '/docs/data-sources')} className="underline underline-offset-2 hover:text-foreground">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </section>

      {/* ── Pro: the flat monthly plan (02/09/2026). Sits right under the three
          rails because it answers the question the packs raise: what if I would
          rather budget one number a month? ── */}
      <section id="pro" className="scroll-mt-28 px-4 pb-16 max-w-5xl mx-auto w-full">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 md:p-8 flex flex-col md:flex-row md:items-center gap-6">
          <div className="flex-1 flex flex-col gap-2">
            <span className="font-mono text-xs uppercase tracking-widest text-amber-500">
              {t('pro.label')}
            </span>
            <h2 className="text-xl font-semibold tracking-tight text-balance">{t('pro.title')}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">{t('pro.text')}</p>
            <p className="text-xs text-muted-foreground/70 leading-relaxed">{t('pro.note')}</p>
          </div>
          <div className="flex flex-col items-start md:items-end gap-3 shrink-0">
            <p className="font-mono text-3xl font-bold text-amber-500 tabular-nums">
              {t('pro.price')}
              <span className="text-sm font-normal text-muted-foreground"> {t('pro.per')}</span>
            </p>
            <Button
              size="sm"
              variant="amber"
              className="px-5"
              nativeButton={false}
              render={<a href={PRO_PAYMENT_LINK} rel="noopener" />}
            >
              {t('pro.cta')}
            </Button>
            <a
              href={PRO_PORTAL_LINK}
              rel="noopener"
              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              {t('pro.portal')}
            </a>
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
              className="card-surface rounded-xl border p-6 flex flex-col gap-4"
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
        <div
          className="mt-6 rounded-xl border border-border px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between"
          style={{ background: "var(--ink-1)" }}
        >
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
                refs: (chunks) => (
                  <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                    {chunks}
                  </code>
                ),
                addr: (chunks) => (
                  <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                    {chunks}
                  </code>
                ),
              })}
            </p>
          </div>
          <Link
            href={localePath(locale, '/playground')}
            className="shrink-0 text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4 transition-colors"
          >
            {t('free.playgroundLink')}
          </Link>
        </div>
      </section>

      {/* ── Cost calculator ───────────────────────────────────────────────── */}
      <section id="estimate" className="scroll-mt-28 px-4 py-16 max-w-3xl mx-auto w-full">
        <h2 className="text-2xl font-semibold tracking-tight mb-2 text-center">
          {t('calculator.heading')}
        </h2>
        <p className="text-center text-muted-foreground mb-10 text-sm">
          {t('calculator.subtitle')}
        </p>

        <ClientMessages ns={["pricing"]}><CostCalculator /></ClientMessages>
      </section>

      {/* Paiement pour les clients HTTP configurés. */}
      <section id="x402" className="px-4 py-16 max-w-5xl mx-auto w-full">
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
                  <item.Icon className="size-4 shrink-0 mt-0.5 text-amber-500/90" aria-hidden />
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
            <Link
              href={localePath(locale, '/docs/x402')}
              className="text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4 transition-colors w-fit mt-1"
            >
              {t('x402.docsLink')}
            </Link>
          </div>

          <div className="flex-1 rounded-lg border border-border p-5 self-start">
            <p className="text-sm text-muted-foreground leading-relaxed">{t("x402.setup")}</p>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────────── */}
      <section className="px-4 py-16 max-w-3xl mx-auto w-full">
        <h2 className="text-2xl font-semibold tracking-tight mb-10 text-center">
          {t('faq.heading')}
        </h2>

        <ClientMessages ns={["pricing"]}><Faq /></ClientMessages>
      </section>

      {/* ── Creditor file audit: the one-off, priced, non-developer door (02/09/2026) ── */}
      <section
        className="border-t px-4 py-14 w-full"
        style={{ borderColor: 'var(--hairline)' }}
      >
        <div className="max-w-3xl mx-auto flex flex-col items-center text-center gap-3">
          <span className="eyebrow">{t('audit.label')}</span>
          <p className="text-sm text-[var(--fg-2)] leading-relaxed max-w-xl text-balance">
            {t('audit.text')}
          </p>
          <Link
            href={localePath(locale, '/audit')}
            className="font-mono text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4 transition-colors"
          >
            {t('audit.cta')}
          </Link>
        </div>
      </section>

      {/* ── Editor / OEM — contact only, no priced offer (t21 not live yet) ── */}
      <section
        className="border-t px-4 py-14 w-full"
        style={{ borderColor: 'var(--hairline)' }}
      >
        <div className="max-w-3xl mx-auto flex flex-col items-center text-center gap-3">
          <span className="eyebrow">{t('oem.label')}</span>
          <p className="text-sm text-[var(--fg-2)] leading-relaxed max-w-xl text-balance">
            {t('oem.text')}
          </p>
          <Link
            href={localePath(locale, '/vendors')}
            className="font-mono text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4 transition-colors"
          >
            {t('oem.cta')}
          </Link>
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
            variant="amber"
            size="lg"
            className="px-8"
            nativeButton={false}
            render={<Link href={localePath(locale, '/playground')} />}
          >
            {t('cta.openPlayground')}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="px-8"
            nativeButton={false}
            render={<Link href={localePath(locale, '/docs')} />}
          >
            {t('cta.readDocs')}
          </Button>
        </div>
      </section>
    </div>
  )
}

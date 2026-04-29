import type { Metadata } from "next"
import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { CodeBlock } from "@/components/code-block"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EndpointRow } from "@/components/ui/endpoint-row"

export const metadata: Metadata = {
  title: "IBANforge — IBAN Validation & BIC/SWIFT Lookup API",
  description:
    "IBAN validation, BIC/SWIFT lookup, SEPA compliance, issuer classification, and risk indicators for developers and AI agents. Pay per request with USDC via x402.",
  openGraph: {
    title: "IBANforge",
    description: "IBAN validation & BIC/SWIFT lookup API with compliance data for AI agents",
    url: "https://ibanforge.com",
  },
};

const CURL_EXAMPLE = `curl -X POST https://api.ibanforge.com/v1/iban/validate \\
  -H "Content-Type: application/json" \\
  -d '{"iban": "CH93 0076 2011 6238 5295 7"}'`

const FEATURE_COUNT = 6
const ENDPOINT_COUNT = 5

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations('home');

  const FEATURES = Array.from({ length: FEATURE_COUNT }, (_, i) => ({
    badge: t(`features.${i}.badge`),
    title: t(`features.${i}.title`),
    description: t(`features.${i}.description`),
  }))

  const ENDPOINTS = Array.from({ length: ENDPOINT_COUNT }, (_, i) => ({
    method: t(`endpoints.${i}.method`),
    path: t(`endpoints.${i}.path`),
    cost: t(`endpoints.${i}.cost`),
    description: t(`endpoints.${i}.description`),
  }))

  return (
    <div className="flex flex-col">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center justify-center text-center px-4 py-28 sm:py-32 gap-7 max-w-3xl mx-auto">
        <span className="eyebrow inline-flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse-live" style={{ backgroundColor: 'var(--live)', boxShadow: '0 0 0 3px rgba(34, 197, 94, 0.18)' }} />
          {t('badge')}
        </span>

        <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight font-mono text-foreground" style={{ lineHeight: 1.05, letterSpacing: '-0.035em' }}>
          {t('hero.title.prefix')}<span className="text-amber-500">{t('hero.title.highlight')}</span>
        </h1>

        <p className="max-w-2xl text-lg text-muted-foreground" style={{ lineHeight: 1.65 }}>
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
            render={<Link href={`/${locale}/docs`} />}
          >
            {t('hero.cta.readDocs')}
          </Button>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section className="px-4 py-24 max-w-6xl mx-auto w-full">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-14 text-center" style={{ letterSpacing: '-0.02em' }}>
          {t('features.heading')}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6 lg:gap-8">
          {FEATURES.map((feature) => (
            <div
              key={feature.badge}
              className="rounded-xl border p-7 flex flex-col gap-3 transition-colors"
              style={{ borderColor: 'var(--ink-4)', background: 'var(--ink-1)' }}
            >
              <Badge
                variant="outline"
                className="w-fit text-amber-500 border-amber-500/40 bg-amber-500/5 font-mono text-xs"
              >
                {feature.badge}
              </Badge>
              <h3 className="font-semibold text-foreground">{feature.title}</h3>
              <p className="text-sm text-muted-foreground" style={{ lineHeight: 1.65 }}>
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Endpoints (vertical stack instead of dense table) ─────────────── */}
      <section className="px-4 py-24 max-w-3xl mx-auto w-full">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3 text-center" style={{ letterSpacing: '-0.02em' }}>
          {t('endpoints.heading')}
        </h2>
        <p className="text-center text-muted-foreground mb-12 text-sm">
          {t('endpoints.subtitle')}
        </p>

        <div className="flex flex-col gap-3">
          {ENDPOINTS.map((endpoint) => (
            <div
              key={endpoint.path}
              className="rounded-lg border px-5 py-4 transition-colors"
              style={{ borderColor: 'var(--ink-4)', background: 'var(--ink-1)' }}
            >
              <EndpointRow
                method={endpoint.method as 'GET' | 'POST' | 'PUT' | 'DELETE'}
                path={endpoint.path}
                price={endpoint.cost}
              />
              <p className="text-xs text-muted-foreground mt-2 ml-[68px]">
                {endpoint.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Quick start ───────────────────────────────────────────────────── */}
      <section className="px-4 py-24 max-w-3xl mx-auto w-full">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3 text-center" style={{ letterSpacing: '-0.02em' }}>
          {t('quickStart.heading')}
        </h2>
        <p className="text-center text-muted-foreground mb-10 text-sm">
          {t('quickStart.subtitle')}
        </p>

        <CodeBlock code={CURL_EXAMPLE} language="bash" />
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────────────── */}
      <section
        className="flex flex-col items-center text-center px-4 py-32 gap-6 border-t"
        style={{ borderColor: 'var(--ink-4)', background: 'var(--ink-0)' }}
      >
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight" style={{ letterSpacing: '-0.02em' }}>
          {t('cta.heading')}
        </h2>
        <p className="text-muted-foreground max-w-md" style={{ lineHeight: 1.65 }}>
          {t('cta.description')}
        </p>
        <Button
          size="lg"
          className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold px-8 mt-2"
          render={<Link href={`/${locale}/docs`} />}
        >
          {t('cta.button')}
        </Button>
      </section>
    </div>
  )
}

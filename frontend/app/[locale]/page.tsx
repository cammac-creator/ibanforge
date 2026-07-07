import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { CodeBlock } from "@/components/code-block"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EndpointRow } from "@/components/ui/endpoint-row"
import { GetKeyButton } from "@/components/api-key-dialog"
import { Reveal } from "@/components/reveal"
import { HeroDemo } from "@/components/hero-demo"
import { StatsBar } from "@/components/stats-bar"
import { JsonViewer } from "@/components/json-viewer"
import { DEFAULT_RESULT } from "@/app/[locale]/playground/examples"
import {
  getLandingStats,
  P50_PROCESSING_MS,
  SUPPORTED_COUNTRIES,
} from "@/lib/landing-stats"

// Metadata is generated per-locale by app/[locale]/layout.tsx — do NOT define
// a static `metadata` here, it would override the locale-aware version with
// the EN default. Sub-pages (pricing, agents, etc.) can still set their own.

// Quickstart shows the REAL request → response pair. The response below the
// curl is the live-captured /v1/iban/validate payload for the UBS example
// (same data as the hero panel — single source in playground/examples.ts).
const CURL_EXAMPLE = `curl -X POST 'https://api.ibanforge.com/v1/iban/validate' \\
  -H 'Authorization: Bearer ifk_YOUR_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '{ "iban": "CH1000230000000012345" }'`

const FEATURE_COUNT = 6
const ENDPOINT_COUNT = 5

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations('home');
  const liveStats = await getLandingStats();

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

  const STATS = [
    { value: liveStats.bicEntries, label: t('stats.bic') },
    { value: SUPPORTED_COUNTRIES, label: t('stats.countries') },
    { value: liveStats.chClearingEntries, label: t('stats.clearing') },
    { value: P50_PROCESSING_MS, label: t('stats.latency'), decimals: 1, suffix: 'ms' },
  ]

  return (
    <div className="flex flex-col">
      {/* ── Hero: promise + live-looking proof, side by side ─────────────── */}
      <section className="px-4 py-20 sm:py-24 max-w-6xl mx-auto w-full">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] gap-12 xl:gap-16 items-center">
          <div className="flex flex-col items-start gap-7">
            <span className="eyebrow inline-flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse-live" style={{ backgroundColor: 'var(--live)', boxShadow: '0 0 0 3px rgba(34, 197, 94, 0.18)' }} />
              {t('badge')}
            </span>

            <h1 className="text-4xl sm:text-5xl xl:text-[3.4rem] font-bold tracking-tight font-mono text-foreground" style={{ lineHeight: 1.1, letterSpacing: '-0.03em' }}>
              {t.rich('hero.title', {
                accent: (chunks) => <span className="text-amber-500">{chunks}</span>,
              })}
            </h1>

            <p className="max-w-xl text-lg text-muted-foreground" style={{ lineHeight: 1.65 }}>
              {t('hero.description')}
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mt-1">
              <GetKeyButton variant="amber" className="px-6">
                {t('hero.cta.getKey')}
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
          </div>

          <Reveal delay={100}>
            <HeroDemo locale={locale} />
          </Reveal>
        </div>
      </section>

      {/* ── Sourced stats, counting up on scroll ──────────────────────────── */}
      <section
        className="py-12 sm:py-14 border-y"
        style={{ borderColor: 'var(--hairline)' }}
      >
        <StatsBar stats={STATS} locale={locale} />
      </section>

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section className="px-4 py-24 max-w-6xl mx-auto w-full">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-14 text-center" style={{ letterSpacing: '-0.02em' }}>
          {t('features.heading')}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6 lg:gap-8">
          {FEATURES.map((feature, i) => (
            <Reveal
              key={feature.badge}
              delay={i * 60}
              className="card-surface rounded-xl border p-7 flex flex-col gap-3"
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
            </Reveal>
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
              className="card-surface rounded-lg border px-5 py-4"
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

      {/* ── Quick start: the request AND the exact response ───────────────── */}
      <section className="px-4 py-24 max-w-3xl mx-auto w-full">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3 text-center" style={{ letterSpacing: '-0.02em' }}>
          {t('quickStart.heading')}
        </h2>
        <p className="text-center text-muted-foreground mb-10 text-sm">
          {t('quickStart.subtitle')}
        </p>

        <CodeBlock code={CURL_EXAMPLE} language="bash" />

        <Reveal delay={80} className="mt-3">
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/60">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--ok)' }} />
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                200 OK · application/json
              </span>
            </div>
            <div className="max-h-[420px] overflow-auto bg-[var(--ink-0)] px-4 py-3">
              <JsonViewer data={DEFAULT_RESULT.iban} />
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── Trust band: sources, sanctions lists, Swiss provenance ────────── */}
      <section
        className="border-t px-4 py-16 w-full"
        style={{ borderColor: 'var(--hairline)' }}
      >
        <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-10 text-center">
          <div className="flex flex-col items-center gap-3">
            <span className="eyebrow">{t('trust.dataLabel')}</span>
            <p className="font-mono text-[0.8125rem] tracking-caps text-[var(--fg-2)] leading-loose text-balance">
              {/* nbsp inside names and before each dot: lines only break after a separator */}
              {t('trust.dataValue')
                .split(' · ')
                .map((source) => source.replace(/ /g, ' '))
                .join(' · ')}
            </p>
            <span className="text-xs text-[var(--fg-4)]">{t('trust.dataNote')}</span>
          </div>
          <div className="flex flex-col items-center gap-3">
            <span className="eyebrow">{t('trust.sanctionsLabel')}</span>
            <p className="font-mono text-[0.8125rem] tracking-caps text-[var(--fg-2)] leading-loose">
              {t('trust.sanctionsValue')}
            </p>
            <span className="text-xs text-[var(--fg-4)]">{t('trust.sanctionsNote')}</span>
          </div>
          <div className="flex flex-col items-center gap-3">
            <span className="eyebrow">{t('trust.madeLabel')}</span>
            <p className="inline-flex items-center gap-2.5 font-mono text-[0.8125rem] tracking-caps text-[var(--fg-2)] leading-loose">
              <span className="inline-block w-2 h-2" style={{ backgroundColor: 'var(--swiss-500)' }} />
              Made in Switzerland
            </p>
            <span className="text-xs text-[var(--fg-4)]">{t('trust.madeNote')}</span>
          </div>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────────────── */}
      <section
        className="flex flex-col items-center text-center px-4 py-32 gap-6 border-t"
        style={{ borderColor: 'var(--ink-4)', background: 'var(--ink-0)' }}
      >
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight" style={{ letterSpacing: '-0.02em' }}>
          {t('cta.heading')}
        </h2>
        <p className="text-muted-foreground max-w-lg" style={{ lineHeight: 1.65 }}>
          {t('cta.description')}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 mt-2">
          <GetKeyButton variant="amber" className="px-8">
            {t('cta.getKeyButton')}
          </GetKeyButton>
          <Button
            size="lg"
            variant="outline"
            className="px-8"
            render={<Link href={`/${locale}/docs`} />}
          >
            {t('cta.button')}
          </Button>
        </div>
      </section>
    </div>
  )
}

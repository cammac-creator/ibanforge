import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowRight, Calculator, Check, Scale, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { fillTemplate } from "@/lib/iban-bank-finder"
import { localePath } from "@/lib/locale-path"
import { routing } from "@/i18n/routing"
import {
  alternativesCopy,
  alternativesJsonLd,
  jsonLdScript,
  vendorMetadata,
  vendorPath,
} from "../page-data"
import { VENDORS, VENDOR_SLUGS, isVendorSlug } from "../vendors"

/**
 * One provider next to IBANforge (29/09/2026): what it does well, what we do
 * differently, both price lists with the day the provider's were read, a
 * calculation at equal scope, and when the other is the better choice. The
 * copy and its rules live in ../copy.ts; the sources in ../vendors.ts.
 */
export const dynamicParams = false

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => VENDOR_SLUGS.map((vendor) => ({ locale, vendor })))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; vendor: string }>
}): Promise<Metadata> {
  const { locale, vendor } = await params
  if (!isVendorSlug(vendor)) return { title: "Not Found" }
  return vendorMetadata(locale, vendor)
}

export default async function AlternativePage({ params }: { params: Promise<{ locale: string; vendor: string }> }) {
  const { locale, vendor } = await params
  if (!isVendorSlug(vendor)) notFound()
  const copy = alternativesCopy(locale)
  const v = copy.vendors[vendor]
  const info = VENDORS[vendor]
  const withName = (s: string) => fillTemplate(s, { name: info.name })
  const others = VENDOR_SLUGS.filter((s) => s !== vendor)

  return (
    <div className="flex flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(alternativesJsonLd(locale, vendor)) }}
      />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center text-center px-4 pt-20 pb-10 sm:pt-24 gap-5 max-w-3xl mx-auto">
        <Badge
          variant="outline"
          className="text-amber-500 border-amber-500/40 bg-amber-500/5 px-3 py-1 text-xs tracking-widest uppercase"
        >
          {copy.eyebrow}
        </Badge>
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-balance">{v.h1}</h1>
        <p className="text-base sm:text-lg text-muted-foreground leading-relaxed text-pretty">{v.lead}</p>
      </section>

      {/* ── Disclosure ───────────────────────────────────────────────────── */}
      <section className="px-4 pb-12 max-w-3xl mx-auto w-full">
        <div
          className="rounded-xl border px-5 py-4 flex gap-3 items-start"
          style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}
        >
          <Scale className="size-4 shrink-0 mt-0.5 text-amber-500" aria-hidden />
          <p className="text-sm text-muted-foreground leading-relaxed">{withName(copy.disclosure)}</p>
        </div>
      </section>

      {/* ── Side by side ─────────────────────────────────────────────────── */}
      <section aria-label={copy.eyebrow} className="px-4 pb-14 max-w-5xl mx-auto w-full">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card-surface rounded-xl border p-5 sm:p-6 flex flex-col gap-4">
            <h2 className="text-xl font-semibold tracking-tight">{withName(copy.labels.strengths)}</h2>
            <ul className="flex flex-col gap-3">
              {v.strengths.map((s) => (
                <li key={s} className="flex gap-3 text-sm text-muted-foreground leading-relaxed">
                  <Check className="size-4 shrink-0 mt-0.5 text-emerald-500" aria-hidden />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
            {v.note && <p className="text-xs text-muted-foreground/80 leading-relaxed border-t border-border pt-3">{v.note}</p>}
          </div>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 sm:p-6 flex flex-col gap-4">
            <h2 className="text-xl font-semibold tracking-tight">{copy.ours.heading}</h2>
            <ul className="flex flex-col gap-3">
              {copy.ours.items.map((s) => (
                <li key={s} className="flex gap-3 text-sm text-foreground/90 leading-relaxed">
                  <Check className="size-4 shrink-0 mt-0.5 text-amber-500" aria-hidden />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Prices ───────────────────────────────────────────────────────── */}
      <section aria-labelledby="alt-prices" className="px-4 pb-14 max-w-5xl mx-auto w-full">
        <h2 id="alt-prices" className="sr-only">
          {withName(copy.labels.theirPrices)} · {copy.ours.pricesHeading}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card-surface rounded-xl border p-5 sm:p-6 flex flex-col gap-3">
            <h3 className="text-lg font-semibold">{withName(copy.labels.theirPrices)}</h3>
            <p className="text-xs text-muted-foreground">{copy.labels.readOn}</p>
            <ul className="flex flex-col gap-2.5">
              {v.prices.map((p) => (
                <li key={p} className="flex gap-3 text-sm text-muted-foreground leading-relaxed">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card-surface rounded-xl border p-5 sm:p-6 flex flex-col gap-3">
            <h3 className="text-lg font-semibold">{copy.ours.pricesHeading}</h3>
            <p className="text-xs text-muted-foreground">{copy.labels.ourPricesNote}</p>
            <ul className="flex flex-col gap-2.5">
              {[...copy.ours.free, ...copy.ours.paid].map((p) => (
                <li key={p} className="flex gap-3 text-sm text-muted-foreground leading-relaxed">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <Link
              href={localePath(locale, "/pricing")}
              className="inline-flex w-fit items-center gap-1.5 mt-1 text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4"
            >
              {copy.labels.allPrices}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-border p-5 flex gap-3 items-start" style={{ background: "var(--ink-1)" }}>
          <Calculator className="size-4 shrink-0 mt-0.5 text-amber-500" aria-hidden />
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">{copy.labels.calculation}. </span>
            {v.calculation}
          </p>
        </div>
      </section>

      {/* ── When the other is better, and what we do not do ──────────────── */}
      <section className="px-4 pb-14 max-w-5xl mx-auto w-full">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card-surface rounded-xl border p-5 sm:p-6 flex flex-col gap-4">
            <h2 className="text-xl font-semibold tracking-tight">{withName(copy.labels.betterFor)}</h2>
            <ul className="flex flex-col gap-3">
              {v.betterFor.map((s) => (
                <li key={s} className="flex gap-3 text-sm text-muted-foreground leading-relaxed">
                  <Scale className="size-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card-surface rounded-xl border p-5 sm:p-6 flex flex-col gap-4">
            <h2 className="text-xl font-semibold tracking-tight">{copy.ours.limitsHeading}</h2>
            <ul className="flex flex-col gap-3">
              {copy.ours.limits.map((s) => (
                <li key={s} className="flex gap-3 text-sm text-muted-foreground leading-relaxed">
                  <X className="size-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Go further ───────────────────────────────────────────────────── */}
      <section aria-labelledby="alt-next" className="px-4 pb-14 max-w-5xl mx-auto w-full">
        <h2 id="alt-next" className="text-2xl font-semibold tracking-tight mb-6">
          {copy.labels.next}
        </h2>
        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { href: "/compare", title: copy.labels.compare, body: copy.labels.compareBody },
            { href: "/iban-validation-api", title: copy.labels.api, body: copy.labels.apiBody },
            { href: "/playground", title: copy.labels.sandbox, body: copy.labels.sandboxBody },
          ].map((link) => (
            <li key={link.href}>
              <Link
                href={localePath(locale, link.href)}
                className="card-surface flex h-full flex-col gap-1.5 rounded-xl border p-4 hover:border-amber-500/60 focus-visible:outline-2 focus-visible:outline-amber-500"
              >
                <span className="font-mono text-sm font-semibold text-foreground">{link.title}</span>
                <span className="text-xs text-muted-foreground leading-relaxed">{link.body}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {others.map((slug) => (
            <Link
              key={slug}
              href={localePath(locale, vendorPath(slug))}
              className="text-amber-500 hover:text-amber-400 underline underline-offset-4"
            >
              {copy.vendors[slug].h1}
            </Link>
          ))}
        </p>
      </section>

      {/* ── Sources ──────────────────────────────────────────────────────── */}
      <section className="px-4 pb-20 max-w-5xl mx-auto w-full">
        <p className="text-xs text-muted-foreground/80 leading-relaxed">
          {copy.labels.sources}:{" "}
          {info.sources.map((s, i) => (
            <span key={s.url}>
              {i > 0 && " · "}
              <a href={s.url} rel="nofollow noopener" className="underline underline-offset-2 hover:text-muted-foreground">
                {s.label}
              </a>
            </span>
          ))}
        </p>
      </section>
    </div>
  )
}

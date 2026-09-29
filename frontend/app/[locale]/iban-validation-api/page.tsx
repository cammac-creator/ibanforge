import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Ban, Hash, KeyRound, Landmark, LayoutGrid, Send, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CodeBlock } from "@/components/code-block"
import { GetKeyButton } from "@/components/api-key-dialog"
import { localePath } from "@/lib/locale-path"
import { FirstCallSnippets } from "./snippets"
import {
  apiPageCopy,
  apiPageJsonLd,
  apiPageMetadata,
  firstCallSnippets,
  formatDay,
  jsonLdScript,
  sampleAnswer,
  unallocatedExample,
} from "./page-data"

/**
 * The IBAN validation API, on one page, in the language of the search.
 *
 * Written 29/09/2026 for the reader the site was not reaching: a developer or
 * a software team searching for an API ("IBAN validation API", "IBAN prüfen
 * per API", "API de validation IBAN"). One route for the three languages; the
 * titles carry each language's query, since the router has no localised
 * pathnames (i18n/routing.ts) and adding them would reroute the whole site.
 *
 * The key button is the site's usual dialog, untouched: the dialog sends the
 * page's path, and lib/key-origin.ts maps `/iban-validation-api` to the door
 * `site-api-page`, so keys taken here are counted apart on the door board.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  return apiPageMetadata(locale)
}

const CHECK_ICONS = [Hash, LayoutGrid, KeyRound, Landmark, Send, ShieldCheck] as const

function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href)
}

export default async function IbanValidationApiPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const copy = apiPageCopy(locale)
  const snippets = firstCallSnippets()
  const answer = sampleAnswer()
  const unallocated = unallocatedExample()
  const href = (path: string) => (isExternal(path) ? path : localePath(locale, path))

  return (
    <div className="flex flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(apiPageJsonLd(locale)) }} />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center justify-center text-center px-4 pt-20 pb-14 sm:py-24 gap-5">
        <Badge
          variant="outline"
          className="text-amber-500 border-amber-500/40 bg-amber-500/5 px-3 py-1 text-xs tracking-widest uppercase"
        >
          {copy.hero.eyebrow}
        </Badge>
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight font-mono max-w-full text-balance">
          {copy.hero.h1}
        </h1>
        <p className="max-w-2xl text-base sm:text-lg text-muted-foreground leading-relaxed text-pretty">
          {copy.hero.lead}
        </p>
        <ul className="flex flex-wrap justify-center gap-2 max-w-2xl">
          {copy.hero.facts.map((fact) => (
            <li
              key={fact}
              className="rounded-full border border-border px-3 py-1 text-xs sm:text-sm text-[var(--fg-2)] font-mono"
            >
              {fact}
            </li>
          ))}
        </ul>
        <div className="flex flex-col sm:flex-row gap-3 mt-2 w-full sm:w-auto">
          <GetKeyButton variant="amber" className="px-6" evt="cta:key-api-page">
            {copy.hero.ctaKey}
          </GetKeyButton>
          <Button
            size="lg"
            variant="outline"
            className="px-6"
            nativeButton={false}
            render={<Link href={localePath(locale, "/playground")} data-evt="cta:try-api-page" />}
          >
            {copy.hero.ctaSandbox}
          </Button>
        </div>
        <Link
          href={localePath(locale, "/docs")}
          className="text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4"
        >
          {copy.hero.ctaDocs}
        </Link>
      </section>

      {/* ── What one call checks ─────────────────────────────────────────── */}
      <section aria-labelledby="api-checks" className="px-4 pb-14 max-w-5xl mx-auto w-full">
        <h2 id="api-checks" className="text-2xl font-semibold tracking-tight mb-2">
          {copy.checks.heading}
        </h2>
        <p className="text-muted-foreground text-sm sm:text-base leading-relaxed mb-8 max-w-3xl">
          {copy.checks.intro}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {copy.checks.items.map((item, i) => {
            const Icon = CHECK_ICONS[i] ?? Hash
            return (
              <div key={item.title} className="card-surface rounded-xl border p-5 sm:p-6 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10">
                    <Icon className="size-4 text-amber-500" aria-hidden />
                  </span>
                  <h3 className="font-semibold">{item.title}</h3>
                </div>
                <p className="font-mono text-xs text-amber-500/90 break-words">{item.field}</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.body}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── What it does not tell you ────────────────────────────────────── */}
      <section aria-labelledby="api-limits" className="px-4 pb-16 max-w-5xl mx-auto w-full">
        <div className="rounded-xl border border-border p-5 sm:p-8" style={{ background: "var(--ink-1)" }}>
          <h2 id="api-limits" className="text-xl font-semibold tracking-tight mb-5">
            {copy.notDo.heading}
          </h2>
          <ul className="flex flex-col gap-4">
            {copy.notDo.items.map((item) => (
              <li key={item} className="flex gap-3 text-sm text-muted-foreground leading-relaxed">
                <Ban className="size-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <Link
            href={localePath(locale, "/sources")}
            className="inline-flex items-center gap-1.5 mt-6 text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4"
          >
            {copy.notDo.sources}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </section>

      {/* ── The first call ───────────────────────────────────────────────── */}
      <section aria-labelledby="api-first-call" className="px-4 pb-16 max-w-3xl mx-auto w-full">
        <h2 id="api-first-call" className="text-2xl font-semibold tracking-tight mb-2">
          {copy.firstCall.heading}
        </h2>
        <p className="text-muted-foreground text-sm sm:text-base leading-relaxed mb-3">{copy.firstCall.intro}</p>
        <p className="text-sm text-[var(--fg-2)] leading-relaxed mb-6 border-l-2 border-amber-500/60 pl-3">
          {copy.firstCall.trial}
        </p>
        <FirstCallSnippets snippets={snippets} label={copy.firstCall.tabsLabel} />

        <h3 className="text-lg font-semibold mt-10 mb-2">{copy.firstCall.answerHeading}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          {copy.firstCall.answerCaption.replace("{date}", formatDay(answer.capturedAt, locale))}
        </p>
        <CodeBlock code={answer.json} language="json" />
        <p className="text-sm text-muted-foreground leading-relaxed mt-4">{copy.firstCall.withKey}</p>
      </section>

      {/* ── Why mod-97 is not enough ─────────────────────────────────────── */}
      {unallocated && (
        <section aria-labelledby="api-mod97" className="px-4 pb-16 max-w-3xl mx-auto w-full">
          <h2 id="api-mod97" className="text-2xl font-semibold tracking-tight mb-2">
            {copy.mod97.heading}
          </h2>
          <p className="text-muted-foreground text-sm sm:text-base leading-relaxed mb-4">{copy.mod97.body}</p>
          <CodeBlock code={unallocated.json} language="json" />
          <p className="text-xs text-muted-foreground mt-3">
            {copy.mod97.caption.replace("{date}", formatDay(unallocated.exportedAt, locale))}
          </p>
        </section>
      )}

      {/* ── The free doors, then the paid ones ───────────────────────────── */}
      <section aria-labelledby="api-doors" className="px-4 pb-16 max-w-5xl mx-auto w-full">
        <h2 id="api-doors" className="text-2xl font-semibold tracking-tight mb-2">
          {copy.doors.heading}
        </h2>
        <p className="text-muted-foreground text-sm sm:text-base leading-relaxed mb-8">{copy.doors.intro}</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[copy.doors.trial, copy.doors.anonymous, copy.doors.claimed].map((door, i) => (
            <div
              key={door.title}
              className={
                i === 1
                  ? "rounded-xl border border-amber-500/40 bg-amber-500/5 p-6 flex flex-col gap-3"
                  : "card-surface rounded-xl border p-6 flex flex-col gap-3"
              }
            >
              <span className="font-mono text-xs uppercase tracking-widest text-amber-500">{door.tag}</span>
              <h3 className="text-lg font-semibold">{door.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed flex-1">{door.body}</p>
              {i === 1 && (
                <GetKeyButton size="sm" variant="amber" className="w-fit px-4" evt="cta:key-api-page-card">
                  {copy.doors.keyCta}
                </GetKeyButton>
              )}
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-border p-5 sm:p-6">
          <h3 className="font-semibold mb-4">{copy.doors.paidHeading}</h3>
          <ul className="flex flex-col gap-3">
            {copy.doors.paid.map((line) => (
              <li key={line} className="flex gap-3 text-sm text-muted-foreground leading-relaxed">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <Link
            href={localePath(locale, "/pricing")}
            className="inline-flex items-center gap-1.5 mt-5 text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4"
          >
            {copy.doors.pricingLink}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </section>

      {/* ── Everything around the API ────────────────────────────────────── */}
      <section aria-labelledby="api-tools" className="px-4 pb-16 max-w-5xl mx-auto w-full">
        <h2 id="api-tools" className="text-2xl font-semibold tracking-tight mb-6">
          {copy.tools.heading}
        </h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {copy.tools.links.map((link) => {
            const external = isExternal(link.href)
            return (
              <li key={link.href}>
                <Link
                  href={href(link.href)}
                  target={external ? "_blank" : undefined}
                  rel={external ? "noopener noreferrer" : undefined}
                  className="card-surface flex h-full flex-col gap-1.5 rounded-xl border p-4 hover:border-amber-500/60 focus-visible:outline-2 focus-visible:outline-amber-500"
                >
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {link.title}
                    {external ? " ↗" : ""}
                  </span>
                  <span className="text-xs text-muted-foreground leading-relaxed">{link.body}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>

      {/* ── Closing ──────────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center text-center px-4 py-20 gap-5 border-t border-border">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-balance">{copy.closing.heading}</h2>
        <p className="text-muted-foreground max-w-md">{copy.closing.body}</p>
        <div className="flex flex-col sm:flex-row gap-3 mt-2 w-full sm:w-auto">
          <Button
            variant="amber"
            size="lg"
            className="px-8"
            nativeButton={false}
            render={<Link href={localePath(locale, "/playground")} />}
          >
            {copy.hero.ctaSandbox}
          </Button>
          <GetKeyButton size="lg" variant="outline" className="px-8" evt="cta:key-api-page-end">
            {copy.hero.ctaKey}
          </GetKeyButton>
        </div>
      </section>
    </div>
  )
}


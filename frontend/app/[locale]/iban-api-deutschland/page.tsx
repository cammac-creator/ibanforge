import type { Metadata } from "next"
import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { ArrowRight, Check, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatDayWords } from "@/lib/date-words"
import { fillTemplate } from "@/lib/iban-bank-finder"
import { localePath } from "@/lib/locale-path"
import { alternativesCopy, vendorPath } from "../alternatives/page-data"
import { VENDORS, VENDOR_SLUGS, type VendorSlug } from "../alternatives/vendors"
import { CODE_ARTICLE_PATH, WELCHE_BANK_PATH } from "../iban-welche-bank/page-data"
import {
  allocatedExample,
  AUTHORITIES_READ_ON,
  BUNDESBANK_SCHEDULE_URL,
  curlExample,
  germanApiCopy,
  germanApiJsonLd,
  germanApiMetadata,
  jsonLdScript,
  notAllocatedExample,
  REGULATION_READ_ON,
} from "./page-data"

/**
 * "Welche API prüft deutsche IBANs und nennt Bank und BIC?" (05/11/2026).
 *
 * Read by a developer in Germany choosing an API, who expects an answer framed
 * for Germany and Europe, with German examples. The direct answer sits in the first screen, before any <h2>, in the HTML the
 * server sends. Germany and Europe frame the page; Switzerland is one register
 * among others in its last section. The comparison reuses the dated words of the
 * "alternative" pages and of /compare, so that a price has one home.
 */

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  return germanApiMetadata(locale)
}

/** The column of /compare each provider of the "alternative" pages reads. */
const COMPARE_COLUMN: Record<VendorSlug, "ibanapi" | "ibancom" | "abstract"> = {
  ibanapi: "ibanapi",
  "iban-com": "ibancom",
  abstractapi: "abstract",
}

const linkClass = "text-amber-500 hover:text-amber-400 underline underline-offset-4"

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="rounded-lg border border-border bg-muted p-3 sm:p-4 text-xs leading-relaxed overflow-x-auto">
      <code>{JSON.stringify(value, null, 2)}</code>
    </pre>
  )
}

export default async function GermanApiPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const copy = germanApiCopy(locale)
  const others = alternativesCopy(locale)
  const t = await getTranslations("compare")
  const allocated = allocatedExample()
  const missing = notAllocatedExample()
  const readDay = {
    authorities: formatDayWords(AUTHORITIES_READ_ON, locale),
    regulation: formatDayWords(REGULATION_READ_ON, locale),
  }

  return (
    <div className="flex flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(germanApiJsonLd(locale)) }} />

      {/* ── The question and its answer, before any <h2> ─────────────────── */}
      <section className="flex flex-col gap-5 px-4 pt-20 pb-12 sm:pt-24 max-w-3xl mx-auto w-full">
        <Badge
          variant="outline"
          className="w-fit text-amber-500 border-amber-500/40 bg-amber-500/5 px-3 py-1 text-xs tracking-widest uppercase"
        >
          {copy.hero.eyebrow}
        </Badge>
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-balance">{copy.hero.h1}</h1>
        <p className="text-base sm:text-lg text-foreground/90 leading-relaxed text-pretty">{copy.hero.answer}</p>
        <p className="text-sm sm:text-base text-muted-foreground leading-relaxed text-pretty">{copy.hero.limit}</p>
        <p className="text-sm text-muted-foreground leading-relaxed text-pretty">{copy.hero.interest}</p>
        <div className="flex flex-col sm:flex-row flex-wrap gap-x-6 gap-y-3 pt-1">
          <Link
            href={localePath(locale, "/playground")}
            data-evt="cta:german-api-sandbox"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-500 hover:text-amber-400 underline underline-offset-4"
          >
            {copy.hero.tryIt}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
          <a href="#vergleich" className="inline-flex items-center gap-1.5 text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4">
            {copy.hero.compare}
            <ArrowRight className="size-3.5" aria-hidden />
          </a>
        </div>
      </section>

      {/* ── What an API has to do ────────────────────────────────────────── */}
      <section aria-labelledby="de-need" className="px-4 pb-16 max-w-4xl mx-auto w-full">
        <h2 id="de-need" className="text-2xl font-semibold tracking-tight mb-2">
          {copy.need.heading}
        </h2>
        <p className="text-muted-foreground text-sm sm:text-base leading-relaxed mb-6">{copy.need.intro}</p>
        <ul className="flex flex-col gap-3">
          {copy.need.rows.map((row) => (
            <li key={row.field} className="card-surface rounded-xl border p-4 grid grid-cols-1 sm:grid-cols-[1fr_1.3fr_0.9fr] gap-2 sm:gap-4">
              <span className="text-sm font-medium text-foreground">{row.check}</span>
              <span className="text-sm text-muted-foreground leading-relaxed">
                <span className="sr-only">{copy.need.cols.source}: </span>
                {row.source}
              </span>
              <code className="text-xs text-amber-500 break-words">
                <span className="sr-only">{copy.need.cols.field}: </span>
                {row.field}
              </code>
            </li>
          ))}
        </ul>
      </section>

      {/* ── What we read at the Bundesbank ───────────────────────────────── */}
      <section aria-labelledby="de-bundesbank" className="px-4 pb-16 max-w-4xl mx-auto w-full">
        <h2 id="de-bundesbank" className="text-2xl font-semibold tracking-tight mb-6">
          {copy.bundesbank.heading}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {copy.bundesbank.items.map((item) => (
            <div key={item.title} className="card-surface rounded-xl border p-5 flex flex-col gap-2">
              <h3 className="text-base font-semibold text-foreground">{item.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-4">
          {copy.bundesbank.credit}{" "}
          <a href={BUNDESBANK_SCHEDULE_URL} rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
            {copy.bundesbank.scheduleLink}
          </a>
          {", "}
          {fillTemplate(copy.bundesbank.scheduleRead, { date: readDay.authorities })}
        </p>
      </section>

      {/* ── Two answers ──────────────────────────────────────────────────── */}
      <section aria-labelledby="de-examples" className="px-4 pb-16 max-w-4xl mx-auto w-full">
        <h2 id="de-examples" className="text-2xl font-semibold tracking-tight mb-2">
          {copy.examples.heading}
        </h2>
        <p className="text-muted-foreground text-sm sm:text-base leading-relaxed mb-6">{copy.examples.intro}</p>
        <div className="flex flex-col gap-8 min-w-0">
          {allocated && (
            <div className="flex flex-col gap-3 min-w-0">
              <h3 className="text-base font-semibold text-foreground">{copy.examples.allocatedTitle}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{copy.examples.allocatedNote}</p>
              <p className="text-xs text-muted-foreground">{copy.examples.extract}</p>
              <JsonBlock value={allocated} />
            </div>
          )}
          {missing && (
            <div className="flex flex-col gap-3 min-w-0">
              <h3 className="text-base font-semibold text-foreground">{copy.examples.missingTitle}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{copy.examples.missingNote}</p>
              <p className="text-xs text-muted-foreground">{copy.examples.extract}</p>
              <JsonBlock value={missing} />
            </div>
          )}
        </div>
        <h3 className="text-base font-semibold text-foreground mt-8 mb-3">{copy.examples.curlTitle}</h3>
        <pre className="rounded-lg border border-border bg-muted p-3 sm:p-4 text-xs leading-relaxed overflow-x-auto">
          <code>{curlExample()}</code>
        </pre>
        <p className="text-sm text-muted-foreground leading-relaxed mt-3">
          {copy.examples.curlNote}{" "}
          <Link href={localePath(locale, "/pricing")} className={linkClass}>
            {copy.examples.keyLink}
          </Link>
        </p>
      </section>

      {/* ── Verification of Payee ────────────────────────────────────────── */}
      <section aria-labelledby="de-vop" className="px-4 pb-16 max-w-4xl mx-auto w-full">
        <h2 id="de-vop" className="text-2xl font-semibold tracking-tight mb-6">
          {copy.vop.heading}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[copy.vop.what, copy.vop.duty].map((block) => (
            <div key={block.title} className="card-surface rounded-xl border p-5 flex flex-col gap-2">
              <h3 className="text-base font-semibold text-foreground">{block.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{block.body}</p>
            </div>
          ))}
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-5 flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Check className="size-4 shrink-0 text-amber-500" aria-hidden />
              {copy.vop.says.title}
            </h3>
            <p className="text-sm text-foreground/90 leading-relaxed">{copy.vop.says.body}</p>
          </div>
          <div className="card-surface rounded-xl border p-5 flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <X className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {copy.vop.not.title}
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{copy.vop.not.body}</p>
          </div>
        </div>
        <p className="text-sm mt-5">
          <Link href={localePath(locale, "/docs/vop")} className={linkClass}>
            {copy.vop.docsLink}
          </Link>
        </p>
        <h3 className="text-sm font-medium text-foreground mt-5 mb-2">{copy.vop.sourcesTitle}</h3>
        <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          {copy.vop.sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground break-words">
                {source.label}
              </a>
              {", "}
              {fillTemplate(copy.vop.readOn, { date: readDay[source.read] })}
            </li>
          ))}
        </ul>
      </section>

      {/* ── The comparison ───────────────────────────────────────────────── */}
      <section id="vergleich" aria-labelledby="de-compare" className="px-4 pb-16 max-w-4xl mx-auto w-full scroll-mt-24">
        <h2 id="de-compare" className="text-2xl font-semibold tracking-tight mb-2">
          {copy.comparison.heading}
        </h2>
        <p className="text-muted-foreground text-sm sm:text-base leading-relaxed mb-6">{copy.comparison.interest}</p>
        <div className="flex flex-col gap-4">
          <article className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-5 flex flex-col gap-3">
            <h3 className="font-mono text-base font-semibold text-foreground">IBANforge</h3>
            <dl className="flex flex-col gap-3 text-sm leading-relaxed">
              <div>
                <dt className="font-medium text-foreground">{copy.comparison.bankCode}</dt>
                <dd className="text-muted-foreground">{t("table.rows.bankCode.ibanforge")}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">{copy.comparison.ourPrices}</dt>
                <dd className="text-muted-foreground">{t("table.rows.pricing.ibanforge")}</dd>
              </div>
            </dl>
            <Link href={localePath(locale, "/pricing")} className={`text-sm ${linkClass}`}>
              {copy.comparison.ourLink}
            </Link>
          </article>

          {VENDOR_SLUGS.map((slug) => {
            const vendor = others.vendors[slug]
            const name = VENDORS[slug].name
            return (
              <article key={slug} className="card-surface rounded-xl border p-5 flex flex-col gap-3">
                <h3 className="font-mono text-base font-semibold text-foreground">{name}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{vendor.summary}</p>
                <dl className="flex flex-col gap-3 text-sm leading-relaxed">
                  <div>
                    <dt className="font-medium text-foreground">{copy.comparison.bankCode}</dt>
                    <dd className="text-muted-foreground">{t(`table.rows.bankCode.${COMPARE_COLUMN[slug]}`)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-foreground">{copy.comparison.prices}</dt>
                    <dd className="text-muted-foreground">{vendor.calculation}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-foreground">{fillTemplate(others.labels.betterFor, { name })}</dt>
                    <dd>
                      <ul className="list-disc pl-5 text-muted-foreground flex flex-col gap-1">
                        {vendor.betterFor.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                </dl>
                {vendor.note && <p className="text-xs text-muted-foreground leading-relaxed">{vendor.note}</p>}
                <Link href={localePath(locale, vendorPath(slug))} className={`text-sm ${linkClass}`}>
                  {fillTemplate(copy.comparison.vendorLink, { name })}
                </Link>
              </article>
            )
          })}

          <article className="card-surface rounded-xl border p-5 flex flex-col gap-3">
            <h3 className="text-base font-semibold text-foreground">{copy.comparison.libsName}</h3>
            <dl className="flex flex-col gap-3 text-sm leading-relaxed">
              <div>
                <dt className="font-medium text-foreground">{copy.comparison.bankCode}</dt>
                <dd className="text-muted-foreground">{t("table.rows.bankCode.libs")}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">{copy.comparison.libsBetter}</dt>
                <dd className="text-muted-foreground">{t("notFor.items.0")}</dd>
              </div>
            </dl>
          </article>
        </div>
        <p className="text-sm mt-5">
          <Link href={localePath(locale, "/compare")} className={linkClass}>
            {copy.comparison.tableLink}
          </Link>
        </p>
      </section>

      {/* ── Europe ───────────────────────────────────────────────────────── */}
      <section aria-labelledby="de-europe" className="px-4 pb-16 max-w-3xl mx-auto w-full">
        <h2 id="de-europe" className="text-2xl font-semibold tracking-tight mb-4">
          {copy.europe.heading}
        </h2>
        <div className="flex flex-col gap-3 text-sm sm:text-base text-muted-foreground leading-relaxed">
          <p>{copy.europe.full}</p>
          <p>{copy.europe.elsewhere}</p>
        </div>
        <p className="text-sm mt-4">
          <Link href={localePath(locale, "/iban")} className={linkClass}>
            {copy.europe.link}
          </Link>
        </p>
      </section>

      {/* ── Read on ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="de-next" className="px-4 pb-20 max-w-3xl mx-auto w-full">
        <h2 id="de-next" className="text-xl font-semibold tracking-tight mb-3">
          {copy.next.heading}
        </h2>
        <ul className="flex flex-col gap-2 text-sm">
          {(
            [
              [WELCHE_BANK_PATH, copy.next.finder],
              ["/blz", copy.next.register],
              ["/docs/blz-check", copy.next.docs],
              [CODE_ARTICLE_PATH, copy.next.article],
              ["/alternatives", copy.next.alternatives],
            ] as const
          ).map(([path, label]) => (
            <li key={path}>
              <Link href={localePath(locale, path)} className={linkClass}>
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

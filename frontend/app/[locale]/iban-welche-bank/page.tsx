import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Check, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatDayWords, formatMonthWords } from "@/lib/date-words"
import { FINDER_LAYOUT, fillTemplate } from "@/lib/iban-bank-finder"
import { localePath } from "@/lib/locale-path"
import { IbanBankFinder } from "./finder"
import {
  CODE_ARTICLE_PATH,
  finderRegisters,
  jsonLdScript,
  registerEditions,
  welcheBankCopy,
  welcheBankJsonLd,
  welcheBankMetadata,
} from "./page-data"

/**
 * "Welche Bank gehört zu dieser IBAN?" in three languages (29/09/2026).
 *
 * The site already appears in searches such as "DE55 welche Bank" and "IBAN
 * welche Bank Österreich": people holding an IBAN who want the bank behind it,
 * and who often read the two digits after DE as the bank. This page answers
 * that question in plain words and reads the bank code of an IBAN in the
 * browser (./finder.tsx), then links to the code's own page. No API call, no
 * key, nothing sent; the developer who wants the same answer from software is
 * pointed to the API page.
 */

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  return welcheBankMetadata(locale)
}

/** The specimen IBAN, cut into its four parts. */
const SPECIMEN = [
  { key: "country", text: "DE" },
  { key: "check", text: "89" },
  { key: "bank", text: "3704 0044" },
  { key: "account", text: "0532 0130 00" },
] as const

export default async function WelcheBankPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const copy = welcheBankCopy(locale)
  const editions = registerEditions()
  const words = { de: formatMonthWords(editions.de, locale), ch: formatDayWords(editions.ch, locale) }
  const home = localePath(locale, "/")
  const base = home === "/" ? "" : home

  return (
    <div className="flex flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(welcheBankJsonLd(locale)) }} />

      {/* ── Hero and the box ─────────────────────────────────────────────── */}
      <section className="flex flex-col items-center text-center px-4 pt-20 pb-8 sm:pt-24 gap-5">
        <Badge
          variant="outline"
          className="text-amber-500 border-amber-500/40 bg-amber-500/5 px-3 py-1 text-xs tracking-widest uppercase"
        >
          {copy.hero.eyebrow}
        </Badge>
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight max-w-4xl text-balance">{copy.hero.h1}</h1>
        <p className="max-w-2xl text-base sm:text-lg text-muted-foreground leading-relaxed text-pretty">{copy.hero.lead}</p>
      </section>

      <section aria-label={copy.finder.label} className="px-4 pb-16 max-w-2xl mx-auto w-full">
        <IbanBankFinder copy={copy.finder} registers={finderRegisters()} editions={words} base={base} />
      </section>

      {/* ── Anatomy of a German IBAN ─────────────────────────────────────── */}
      <section aria-labelledby="wb-anatomy" className="px-4 pb-16 max-w-4xl mx-auto w-full">
        <h2 id="wb-anatomy" className="text-2xl font-semibold tracking-tight mb-2">
          {copy.anatomy.heading}
        </h2>
        <p className="text-muted-foreground text-sm sm:text-base leading-relaxed mb-6">{copy.anatomy.intro}</p>
        <ol className="grid grid-cols-2 sm:grid-cols-[0.8fr_1fr_1.3fr_1.5fr] gap-3">
          {SPECIMEN.map((part) => {
            const label = copy.anatomy.parts[part.key]
            const bank = part.key === "bank"
            return (
              <li
                key={part.key}
                className={
                  bank
                    ? "rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 flex flex-col gap-2"
                    : "card-surface rounded-xl border p-4 flex flex-col gap-2"
                }
              >
                <span
                  className={
                    bank
                      ? "font-mono text-lg lg:text-2xl font-semibold tracking-wider whitespace-nowrap text-amber-500"
                      : "font-mono text-lg lg:text-2xl font-semibold tracking-wider whitespace-nowrap text-foreground"
                  }
                >
                  {part.text}
                </span>
                <span className="text-sm font-medium text-foreground">{label.label}</span>
                <span className="text-xs text-muted-foreground leading-relaxed">{label.note}</span>
              </li>
            )
          })}
        </ol>
      </section>

      {/* ── The DE55 trap ────────────────────────────────────────────────── */}
      <section aria-labelledby="wb-trap" className="px-4 pb-16 max-w-3xl mx-auto w-full">
        <h2 id="wb-trap" className="text-2xl font-semibold tracking-tight mb-4">
          {copy.trap.heading}
        </h2>
        <div className="flex flex-col gap-4">
          {copy.trap.paragraphs.map((p) => (
            <p key={p} className="text-sm sm:text-base text-muted-foreground leading-relaxed">
              {p}
            </p>
          ))}
        </div>
      </section>

      {/* ── Four countries ───────────────────────────────────────────────── */}
      <section aria-labelledby="wb-countries" className="px-4 pb-16 max-w-4xl mx-auto w-full">
        <h2 id="wb-countries" className="text-2xl font-semibold tracking-tight mb-2">
          {copy.countries.heading}
        </h2>
        <p className="text-muted-foreground text-sm sm:text-base leading-relaxed mb-6">{copy.countries.intro}</p>
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}>
          <table className="w-full text-sm" style={{ minWidth: "560px" }}>
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--ink-4)", background: "var(--ink-2)" }}>
                {(["country", "length", "position", "code", "register"] as const).map((c) => (
                  <th key={c} scope="col" className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                    {copy.countries.cols[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {copy.countries.rows.map((row, i) => {
                const layout = FINDER_LAYOUT[row.cc]
                return (
                  <tr
                    key={row.cc}
                    className={i < copy.countries.rows.length - 1 ? "border-b" : ""}
                    style={{ borderColor: "var(--hairline)" }}
                  >
                    <th scope="row" className="px-4 py-3 text-left font-medium text-foreground whitespace-nowrap">
                      <span className="font-mono text-amber-500 mr-2">{row.cc}</span>
                      {row.country}
                    </th>
                    <td className="px-4 py-3 font-mono text-muted-foreground">{layout.length}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {fillTemplate(copy.countries.positions, {
                        from: layout.codeStart + 1,
                        to: layout.codeStart + layout.codeLength,
                      })}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.code}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.register}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── What the code tells, and what it does not ────────────────────── */}
      <section aria-labelledby="wb-tells" className="px-4 pb-16 max-w-4xl mx-auto w-full">
        <h2 id="wb-tells" className="text-2xl font-semibold tracking-tight mb-6">
          {copy.tells.heading}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ul className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-5 flex flex-col gap-3">
            {copy.tells.yes.map((item) => (
              <li key={item} className="flex gap-3 text-sm text-foreground/90 leading-relaxed">
                <Check className="size-4 shrink-0 mt-0.5 text-amber-500" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <ul className="card-surface rounded-xl border p-5 flex flex-col gap-3">
            {copy.tells.no.map((item) => (
              <li key={item} className="flex gap-3 text-sm text-muted-foreground leading-relaxed">
                <X className="size-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── From software ────────────────────────────────────────────────── */}
      <section aria-labelledby="wb-dev" className="px-4 pb-16 max-w-3xl mx-auto w-full">
        <div className="rounded-xl border border-border p-5 sm:p-8" style={{ background: "var(--ink-1)" }}>
          <h2 id="wb-dev" className="text-xl font-semibold tracking-tight mb-3">
            {copy.developers.heading}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-5">{copy.developers.body}</p>
          <div className="flex flex-col sm:flex-row flex-wrap gap-x-6 gap-y-3">
            <Link
              href={localePath(locale, "/iban-validation-api")}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-500 hover:text-amber-400 underline underline-offset-4"
            >
              {copy.developers.api}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
            <Link
              href={localePath(locale, "/playground")}
              className="inline-flex items-center gap-1.5 text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4"
            >
              {copy.developers.sandbox}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
            <Link
              href={localePath(locale, CODE_ARTICLE_PATH)}
              className="inline-flex items-center gap-1.5 text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4"
            >
              {copy.developers.article}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Sources ──────────────────────────────────────────────────────── */}
      <section className="px-4 pb-20 max-w-3xl mx-auto w-full">
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          <li>{fillTemplate(copy.sources.de, { asOf: words.de })}</li>
          <li>{fillTemplate(copy.sources.ch, { asOf: words.ch })}</li>
          <li>{copy.sources.at}</li>
        </ul>
      </section>
    </div>
  )
}

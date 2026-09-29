import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { localePath } from "@/lib/locale-path"
import { alternativesCopy, alternativesJsonLd, indexMetadata, jsonLdScript, vendorPath } from "./page-data"
import { VENDORS, VENDOR_SLUGS } from "./vendors"

/**
 * The index of the "alternative" pages (29/09/2026): one card per provider.
 * People search a provider's name followed by "alternative"; each card leads to
 * the page that answers that search. The full table stays on /compare.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  return indexMetadata(locale)
}

export default async function AlternativesIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const copy = alternativesCopy(locale)

  return (
    <div className="flex flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(alternativesJsonLd(locale, null)) }} />

      <section className="flex flex-col items-center text-center px-4 pt-20 pb-12 sm:pt-24 gap-5 max-w-3xl mx-auto">
        <Badge
          variant="outline"
          className="text-amber-500 border-amber-500/40 bg-amber-500/5 px-3 py-1 text-xs tracking-widest uppercase"
        >
          {copy.eyebrow}
        </Badge>
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-balance">{copy.index.h1}</h1>
        <p className="text-base sm:text-lg text-muted-foreground leading-relaxed text-pretty">{copy.index.lead}</p>
      </section>

      <section className="px-4 pb-12 max-w-5xl mx-auto w-full">
        <ul className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {VENDOR_SLUGS.map((slug) => (
            <li key={slug}>
              <Link
                href={localePath(locale, vendorPath(slug))}
                className="card-surface flex h-full flex-col gap-3 rounded-xl border p-5 sm:p-6 hover:border-amber-500/60 focus-visible:outline-2 focus-visible:outline-amber-500"
              >
                <span className="font-mono text-lg font-semibold text-foreground">{VENDORS[slug].name}</span>
                <span className="text-base font-medium text-foreground">{copy.vendors[slug].h1}</span>
                <span className="text-sm text-muted-foreground leading-relaxed flex-1">{copy.vendors[slug].summary}</span>
                <span className="inline-flex items-center gap-1.5 text-sm text-amber-500">
                  {copy.index.cardCta}
                  <ArrowRight className="size-3.5" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="px-4 pb-20 max-w-5xl mx-auto w-full">
        <p className="text-sm text-muted-foreground">
          {copy.index.compareLine}{" "}
          <Link href={localePath(locale, "/compare")} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">
            {copy.labels.compare}
          </Link>
        </p>
      </section>
    </div>
  )
}

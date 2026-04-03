import type { Metadata } from "next"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "Compare IBAN Validation APIs",
  description:
    "Compare IBANforge with iban.com, IBANAPI, and AbstractAPI. Pricing, features, AI agent support, and self-hosting options.",
}

const FEATURES = [
  { label: "Price per call", ibanforge: "$0.005", ibancom: "$0.047+", ibanapi: "$0.023+", abstract: "$0.002" },
  { label: "BIC lookup included", ibanforge: "Yes", ibancom: "Separate", ibanapi: "No", abstract: "No" },
  { label: "SEPA compliance data", ibanforge: "Yes", ibancom: "Partial", ibanapi: "No", abstract: "No" },
  { label: "Issuer classification", ibanforge: "Yes", ibancom: "No", ibanapi: "No", abstract: "No" },
  { label: "vIBAN detection", ibanforge: "Yes", ibancom: "No", ibanapi: "No", abstract: "No" },
  { label: "Risk indicators", ibanforge: "Yes", ibancom: "No", ibanapi: "No", abstract: "No" },
  { label: "AI agent support (MCP)", ibanforge: "Yes", ibancom: "No", ibanapi: "No", abstract: "No" },
  { label: "x402 micropayments", ibanforge: "Yes", ibancom: "No", ibanapi: "No", abstract: "No" },
  { label: "No API key required", ibanforge: "Yes", ibancom: "No", ibanapi: "No", abstract: "No" },
  { label: "Free playground", ibanforge: "Yes", ibancom: "No", ibanapi: "Limited", abstract: "No" },
  { label: "Countries supported", ibanforge: "75+", ibancom: "95+", ibanapi: "80+", abstract: "70+" },
  { label: "LEI / GLEIF data", ibanforge: "Yes", ibancom: "No", ibanapi: "No", abstract: "No" },
  { label: "Batch validation", ibanforge: "Yes (100/call)", ibancom: "No", ibanapi: "Yes", abstract: "No" },
  { label: "Self-hostable", ibanforge: "Yes (MIT)", ibancom: "No", ibanapi: "No", abstract: "No" },
  { label: "Open source", ibanforge: "Yes", ibancom: "No", ibanapi: "No", abstract: "No" },
]

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

export default function ComparePage() {
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
          Comparison
        </Badge>

        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight font-mono">
          IBANforge vs <span className="text-amber-500">alternatives</span>
        </h1>

        <p className="max-w-xl text-lg text-muted-foreground leading-relaxed">
          How IBANforge compares to other IBAN validation APIs — on pricing,
          features, and AI-native capabilities.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mt-2">
          <Button
            size="lg"
            className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold px-6"
            render={<Link href="/playground" />}
          >
            Try IBANforge free
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="px-6"
            render={<Link href="/pricing" />}
          >
            See pricing →
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
                  Feature
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-amber-500">
                  IBANforge
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  iban.com
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  IBANAPI
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  AbstractAPI
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
          Pricing as of April 2026 — may have changed. Always verify on each
          provider&apos;s website before making a decision.
        </p>
      </section>

      {/* ── Differentiators ───────────────────────────────────────────────── */}
      <section className="px-4 py-16 max-w-5xl mx-auto w-full border-t border-border">
        <h2 className="text-2xl font-semibold tracking-tight mb-10 text-center">
          What makes IBANforge different
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            {
              title: "No API key, no subscription",
              body: "x402 micropayments mean you pay per call in USDC — no credit card, no account, no monthly bill. Start using the API in minutes.",
            },
            {
              title: "Built for AI agents",
              body: "Native MCP (Model Context Protocol) server lets Claude, GPT-4, and other LLM agents call validate_iban and lookup_bic as structured tools — no prompt engineering needed.",
            },
            {
              title: "Open source (MIT)",
              body: "The full source is on GitHub. Audit the code, self-host for free, or contribute improvements. No vendor lock-in.",
            },
          ].map((card) => (
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
          Ready to try?
        </h2>
        <p className="text-muted-foreground max-w-md">
          No account, no credit card. Open the playground and validate your
          first IBAN in under a minute.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 mt-2">
          <Button
            size="lg"
            className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold px-8"
            render={<Link href="/playground" />}
          >
            Open playground
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="px-8"
            render={<Link href="/docs" />}
          >
            Read the docs
          </Button>
        </div>
      </section>
    </div>
  )
}

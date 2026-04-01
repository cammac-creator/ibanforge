import type { Metadata } from "next"
import Link from "next/link"
import { CodeBlock } from "@/components/code-block"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export const metadata: Metadata = {
  title: "IBANforge — IBAN Validation & BIC/SWIFT Lookup API",
  description:
    "IBAN validation and BIC/SWIFT lookup API for developers and AI agents. Pay per call with x402 micropayments. MCP integration for autonomous agents.",
  openGraph: {
    title: "IBANforge",
    description: "IBAN validation & BIC/SWIFT lookup API",
    url: "https://ibanforge.com",
  },
};

const CURL_EXAMPLE = `curl -X POST https://api.ibanforge.com/v1/iban/validate \\
  -H "Content-Type: application/json" \\
  -d '{"iban": "CH93 0076 2011 6238 5295 7"}'`

const FEATURES = [
  {
    badge: "75+ Countries",
    title: "IBAN Validation",
    description:
      "Full IBAN validation with BBAN structure parsing. Supports 75+ countries with mod97 checksum verification and detailed field breakdown.",
  },
  {
    badge: "39,000+ BIC Entries",
    title: "BIC/SWIFT Lookup",
    description:
      "Complete BIC/SWIFT database sourced from GLEIF, enriched with LEI (Legal Entity Identifier) data for financial institution identification.",
  },
  {
    badge: "MCP Integration",
    title: "AI Agent Ready",
    description:
      "Native Model Context Protocol support. AI agents can validate IBANs and look up BIC codes directly — no custom tooling required.",
  },
  {
    badge: "x402 Micropayments",
    title: "Pay Per Call",
    description:
      "No API key, no subscription. Pay per call with USDC via the x402 protocol. Fractions of a cent per request, billed on-chain.",
  },
]

const ENDPOINTS = [
  {
    method: "POST",
    path: "/v1/iban/validate",
    cost: "$0.002",
    description: "Validate a single IBAN",
  },
  {
    method: "POST",
    path: "/v1/iban/batch",
    cost: "$0.015",
    description: "Validate up to 10 IBANs",
  },
  {
    method: "GET",
    path: "/v1/bic/:code",
    cost: "$0.001",
    description: "Lookup BIC/SWIFT code",
  },
]

export default function Home() {
  return (
    <div className="flex flex-col">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center justify-center text-center px-4 py-28 gap-6">
        <Badge variant="outline" className="text-amber-500 border-amber-500/40 bg-amber-500/5 px-3 py-1 text-xs tracking-widest uppercase">
          v1 · Now live
        </Badge>

        <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight font-mono text-foreground">
          IBAN<span className="text-amber-500">forge</span>
        </h1>

        <p className="max-w-xl text-lg text-muted-foreground leading-relaxed">
          IBAN validation &amp; BIC/SWIFT lookup API for developers and AI agents
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mt-2">
          <Button
            size="lg"
            className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold px-6"
            render={<Link href="/playground" />}
          >
            Try it free
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="px-6"
            render={<Link href="/docs" />}
          >
            Read the docs
          </Button>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section className="px-4 py-20 max-w-5xl mx-auto w-full">
        <h2 className="text-2xl font-semibold tracking-tight mb-10 text-center">
          Everything you need
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FEATURES.map((feature) => (
            <div
              key={feature.badge}
              className="rounded-xl border border-border bg-zinc-900/50 p-6 flex flex-col gap-3"
            >
              <Badge
                variant="outline"
                className="w-fit text-amber-500 border-amber-500/40 bg-amber-500/5 font-mono text-xs"
              >
                {feature.badge}
              </Badge>
              <h3 className="font-semibold text-foreground">{feature.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Endpoints table ───────────────────────────────────────────────── */}
      <section className="px-4 py-20 max-w-5xl mx-auto w-full">
        <h2 className="text-2xl font-semibold tracking-tight mb-10 text-center">
          Paid endpoints
        </h2>

        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-zinc-900/60">
                <th className="px-5 py-3 text-left font-medium text-muted-foreground">
                  Method
                </th>
                <th className="px-5 py-3 text-left font-medium text-muted-foreground">
                  Path
                </th>
                <th className="px-5 py-3 text-left font-medium text-muted-foreground">
                  Cost
                </th>
                <th className="px-5 py-3 text-left font-medium text-muted-foreground hidden sm:table-cell">
                  Description
                </th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((endpoint, i) => (
                <tr
                  key={endpoint.path}
                  className={
                    i < ENDPOINTS.length - 1 ? "border-b border-border" : ""
                  }
                >
                  <td className="px-5 py-4">
                    <span className="font-mono text-xs font-semibold text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">
                      {endpoint.method}
                    </span>
                  </td>
                  <td className="px-5 py-4 font-mono text-xs text-foreground">
                    {endpoint.path}
                  </td>
                  <td className="px-5 py-4 font-mono text-xs text-muted-foreground">
                    {endpoint.cost}
                  </td>
                  <td className="px-5 py-4 text-muted-foreground hidden sm:table-cell">
                    {endpoint.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Quick start ───────────────────────────────────────────────────── */}
      <section className="px-4 py-20 max-w-5xl mx-auto w-full">
        <h2 className="text-2xl font-semibold tracking-tight mb-4 text-center">
          Quick start
        </h2>
        <p className="text-center text-muted-foreground mb-10 text-sm">
          No API key required — just send a request.
        </p>

        <CodeBlock code={CURL_EXAMPLE} language="bash" className="max-w-2xl mx-auto" />
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center text-center px-4 py-28 gap-6 border-t border-border">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Ready to build?
        </h2>
        <p className="text-muted-foreground max-w-md">
          Integrate in minutes. Pay only for what you use — no subscriptions, no rate limits.
        </p>
        <Button
          size="lg"
          className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold px-8 mt-2"
          render={<Link href="/docs" />}
        >
          Start building
        </Button>
      </section>
    </div>
  )
}

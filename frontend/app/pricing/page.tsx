import type { Metadata } from "next"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CostCalculator } from "./calculator"
import { Faq } from "./faq"

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple, transparent pay-per-call pricing. No subscriptions. No API keys. Pay with USDC via x402 micropayments.",
}

const ENDPOINTS = [
  {
    method: "POST",
    path: "/v1/iban/validate",
    cost: "$0.002",
    description: "Validate a single IBAN with full BBAN parsing",
  },
  {
    method: "POST",
    path: "/v1/iban/batch",
    cost: "$0.015",
    description: "Validate up to 10 IBANs in one request",
  },
  {
    method: "GET",
    path: "/v1/bic/:code",
    cost: "$0.001",
    description: "Lookup BIC/SWIFT code from GLEIF database",
  },
]

export default function PricingPage() {
  return (
    <div className="flex flex-col">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center justify-center text-center px-4 py-24 gap-5">
        <Badge
          variant="outline"
          className="text-amber-500 border-amber-500/40 bg-amber-500/5 px-3 py-1 text-xs tracking-widest uppercase"
        >
          Transparent pricing
        </Badge>

        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight font-mono">
          Pay per <span className="text-amber-500">call</span>
        </h1>

        <p className="max-w-xl text-lg text-muted-foreground leading-relaxed">
          No subscription. No API key. Fractions of a cent per request — billed
          on-chain with USDC via the x402 protocol.
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
            render={<Link href="/docs/x402" />}
          >
            x402 explained →
          </Button>
        </div>
      </section>

      {/* ── Pricing table ─────────────────────────────────────────────────── */}
      <section className="px-4 py-16 max-w-5xl mx-auto w-full">
        <h2 className="text-2xl font-semibold tracking-tight mb-2 text-center">
          Endpoint pricing
        </h2>
        <p className="text-center text-muted-foreground mb-10 text-sm">
          All prices in USD, paid in USDC on Base.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {ENDPOINTS.map((ep) => (
            <div
              key={ep.path}
              className="rounded-xl border border-border bg-zinc-900/50 p-6 flex flex-col gap-4"
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
                <p className="text-xs text-muted-foreground mt-1">per call</p>
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed border-t border-border pt-3">
                {ep.description}
              </p>
            </div>
          ))}
        </div>

        {/* Free endpoints note */}
        <div className="mt-6 rounded-xl border border-border bg-zinc-900/30 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Free endpoints</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                GET /v1/demo
              </code>
              {" "}and{" "}
              <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                GET /health
              </code>
              {" "}are always free — no payment required.
            </p>
          </div>
          <Link
            href="/playground"
            className="shrink-0 text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4 transition-colors"
          >
            Try in playground →
          </Link>
        </div>
      </section>

      {/* ── Cost calculator ───────────────────────────────────────────────── */}
      <section className="px-4 py-16 max-w-3xl mx-auto w-full">
        <h2 className="text-2xl font-semibold tracking-tight mb-2 text-center">
          Estimate your costs
        </h2>
        <p className="text-center text-muted-foreground mb-10 text-sm">
          Adjust the slider to see what you would pay each month.
        </p>

        <CostCalculator />
      </section>

      {/* ── x402 explainer ────────────────────────────────────────────────── */}
      <section className="px-4 py-16 max-w-5xl mx-auto w-full">
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-8 flex flex-col gap-8 sm:flex-row sm:gap-12">
          <div className="flex flex-col gap-4 flex-1">
            <Badge
              variant="outline"
              className="w-fit text-amber-500 border-amber-500/40 bg-amber-500/10 font-mono text-xs"
            >
              x402 Protocol
            </Badge>
            <h2 className="text-2xl font-semibold tracking-tight">
              How payments work
            </h2>
            <ul className="flex flex-col gap-3">
              {[
                {
                  icon: "💳",
                  text: "No subscription. No API key. Pay per call with USDC.",
                },
                {
                  icon: "⚡",
                  text: "Your HTTP client sends a tiny payment with each request — automatically, via standard headers.",
                },
                {
                  icon: "🔗",
                  text: "Payments settle on Base (Ethereum L2) — fast, cheap, and verifiable on-chain.",
                },
                {
                  icon: "🆓",
                  text: "Free testing available via the /v1/demo endpoint and the /playground.",
                },
              ].map((item) => (
                <li key={item.text} className="flex gap-3 text-sm text-muted-foreground leading-relaxed">
                  <span className="text-base shrink-0">{item.icon}</span>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/docs/x402"
              className="text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4 transition-colors w-fit mt-1"
            >
              Full x402 documentation →
            </Link>
          </div>

          {/* Code snippet */}
          <div className="flex-1">
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium">
              Example — automatic payment
            </p>
            <div className="rounded-lg bg-zinc-950 border border-border p-4 font-mono text-xs leading-relaxed overflow-x-auto">
              <p className="text-zinc-500"># Install the x402 HTTP client</p>
              <p className="text-zinc-300">npm install x402-fetch</p>
              <p className="mt-3 text-zinc-500"># Then call the API normally</p>
              <p className="text-amber-400">{"import"}{" "}<span className="text-zinc-300">{"{ wrapFetch }"}</span>{" "}<span className="text-amber-400">from</span>{" "}<span className="text-green-400">{'"x402-fetch"'}</span></p>
              <p className="text-zinc-500 mt-1">{"//"} Payment handled automatically</p>
              <p className="text-zinc-300">{"const"} fetch = wrapFetch()</p>
              <p className="mt-2 text-zinc-300">{"const"} res = <span className="text-amber-400">await</span> fetch(</p>
              <p className="text-green-400 pl-4">{'"https://api.ibanforge.com/v1/iban/validate"'}</p>
              <p className="text-zinc-300 pl-2">{")"}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────────── */}
      <section className="px-4 py-16 max-w-3xl mx-auto w-full">
        <h2 className="text-2xl font-semibold tracking-tight mb-10 text-center">
          Frequently asked questions
        </h2>

        <Faq />
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center text-center px-4 py-24 gap-6 border-t border-border">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Start building for free
        </h2>
        <p className="text-muted-foreground max-w-md">
          No credit card, no account. Hit the playground, read the docs, ship
          when you are ready.
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

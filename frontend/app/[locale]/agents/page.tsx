import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CodeBlock } from "@/components/code-block";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EndpointRow } from "@/components/ui/endpoint-row";
import { StatusDot } from "@/components/ui/status-dot";

export const metadata: Metadata = {
  title: "For AI Agents — IBANforge MCP + x402 + free API key",
  description:
    "Integrate IBANforge in 60 seconds — Claude Desktop, Cursor, Cline. Native MCP server with 5 tools. Free API key (200 req/month, no credit card). Pay-per-call in USDC via x402 on Base L2 — agents pay autonomously.",
};

const MCP_CLAUDE_DESKTOP_JSON = `{
  "mcpServers": {
    "ibanforge": {
      "command": "npx",
      "args": ["-y", "ibanforge-mcp"]
    }
  }
}`;

const FREE_KEY_CURL = `curl -X POST https://api.ibanforge.com/v1/keys/generate \\
  -H "Content-Type: application/json" \\
  -d '{"email":"agent@yourdomain.com"}'

# → returns { "api_key": "ifk_...", "monthly_limit": 200 }`;

const X402_CLIENT_TS = `import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const account = privateKeyToAccount(process.env.WALLET_KEY as \`0x\${string}\`);
const publicClient = createPublicClient({ chain: base, transport: http() });
const evmSigner = toClientEvmSigner(account, publicClient);

const client = new x402Client()
  .register("eip155:8453", new ExactEvmScheme(evmSigner));

const paid = wrapFetchWithPayment(fetch, client);

const r = await paid("https://api.ibanforge.com/v1/iban/validate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ iban: "CH9300762011623852957" }),
});
// pays $0.005 USDC autonomously, returns 200 with the response`;

const TOOLS = [
  {
    name: "validate_iban",
    price: "$0.005",
    description: "Validate any IBAN. Returns BIC, country, EMI/vIBAN flag, SEPA + VoP, risk score, Swiss BC-Nummer for CH/LI.",
  },
  {
    name: "batch_validate_iban",
    price: "$0.002 / IBAN",
    description: "Up to 100 IBANs in one call — CSV cleanup, payout list triage.",
  },
  {
    name: "lookup_bic",
    price: "$0.003",
    description: "Resolve a BIC/SWIFT into bank name, country, city, LEI, address. 121,197 GLEIF entries.",
  },
  {
    name: "lookup_ch_clearing",
    price: "$0.003",
    description: "Resolve a Swiss BC-Nummer / IID. Only API exposing SIC, euroSIC, QR-IID — 1,190 SIX entries.",
  },
  {
    name: "check_compliance",
    price: "$0.02",
    description: "Pre-flight risk triage: sanctions (OFAC/EU/UN), FATF, SEPA Instant, VoP. Returns risk_score 0-100.",
  },
];

export default async function AgentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("agents");

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="flex flex-col items-center text-center px-4 py-28 sm:py-32 gap-7 max-w-3xl mx-auto">
        <span className="eyebrow inline-flex items-center gap-2">
          <StatusDot kind="live" />
          {t("eyebrow")}
        </span>

        <h1
          className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight font-mono"
          style={{ lineHeight: 1.05, letterSpacing: "-0.035em" }}
        >
          {t("hero.title")}
        </h1>

        <p className="max-w-2xl text-lg text-muted-foreground" style={{ lineHeight: 1.65 }}>
          {t("hero.description")}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mt-2">
          <Button
            size="lg"
            className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold px-6"
            render={<a href="#mcp-quickstart" />}
          >
            {t("hero.cta.mcp")}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="px-6"
            render={<a href="#x402-quickstart" />}
          >
            {t("hero.cta.x402")}
          </Button>
        </div>
      </section>

      {/* Three-path overview */}
      <section className="px-4 py-24 max-w-6xl mx-auto w-full">
        <h2
          className="text-2xl sm:text-3xl font-semibold tracking-tight mb-14 text-center"
          style={{ letterSpacing: "-0.02em" }}
        >
          {t("paths.heading")}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {(["mcp", "apiKey", "x402"] as const).map((p) => (
            <div
              key={p}
              className="rounded-xl border p-7 flex flex-col gap-3"
              style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}
            >
              <Badge
                variant="outline"
                className="w-fit text-amber-500 border-amber-500/40 bg-amber-500/5 font-mono text-xs"
              >
                {t(`paths.${p}.badge`)}
              </Badge>
              <h3 className="font-semibold text-foreground">{t(`paths.${p}.title`)}</h3>
              <p className="text-sm text-muted-foreground" style={{ lineHeight: 1.65 }}>
                {t(`paths.${p}.description`)}
              </p>
              <p className="text-xs font-mono text-muted-foreground mt-2">
                {t(`paths.${p}.tradeoff`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* MCP quickstart */}
      <section id="mcp-quickstart" className="px-4 py-24 max-w-3xl mx-auto w-full">
        <span className="eyebrow mb-3 inline-block">{t("mcp.eyebrow")}</span>
        <h2
          className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3"
          style={{ letterSpacing: "-0.02em" }}
        >
          {t("mcp.heading")}
        </h2>
        <p className="text-muted-foreground mb-8 text-sm" style={{ lineHeight: 1.65 }}>
          {t("mcp.description")}
        </p>

        <div className="rounded-lg border p-5 mb-6" style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}>
          <p className="font-mono text-xs uppercase tracking-caps text-muted-foreground mb-2">
            {t("mcp.claudeLabel")}
          </p>
          <p className="text-sm text-muted-foreground mb-3">
            {t("mcp.claudePath")}
          </p>
          <CodeBlock code={MCP_CLAUDE_DESKTOP_JSON} language="json" />
        </div>

        <div className="rounded-lg border p-5" style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}>
          <p className="font-mono text-xs uppercase tracking-caps text-muted-foreground mb-2">
            {t("mcp.httpLabel")}
          </p>
          <p className="text-sm text-muted-foreground mb-2">
            {t("mcp.httpDescription")}
          </p>
          <code className="font-mono text-sm text-amber-500 break-all">
            https://api.ibanforge.com/mcp
          </code>
        </div>

        <h3 className="font-semibold mt-10 mb-4">{t("mcp.toolsHeading")}</h3>
        <div className="flex flex-col gap-3">
          {TOOLS.map((tool) => (
            <div
              key={tool.name}
              className="rounded-lg border px-5 py-4"
              style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}
            >
              <div className="flex items-center justify-between gap-3 mb-1">
                <code className="font-mono text-sm text-amber-500">{tool.name}</code>
                <span className="font-mono text-xs text-muted-foreground">{tool.price}</span>
              </div>
              <p className="text-xs text-muted-foreground" style={{ lineHeight: 1.65 }}>
                {tool.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Free API key */}
      <section className="px-4 py-24 max-w-3xl mx-auto w-full">
        <span className="eyebrow mb-3 inline-block">{t("apiKey.eyebrow")}</span>
        <h2
          className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3"
          style={{ letterSpacing: "-0.02em" }}
        >
          {t("apiKey.heading")}
        </h2>
        <p className="text-muted-foreground mb-8 text-sm" style={{ lineHeight: 1.65 }}>
          {t("apiKey.description")}
        </p>
        <CodeBlock code={FREE_KEY_CURL} language="bash" />
        <p className="text-xs text-muted-foreground mt-4" style={{ lineHeight: 1.65 }}>
          {t("apiKey.fallbackNote")}
        </p>
      </section>

      {/* x402 quickstart */}
      <section id="x402-quickstart" className="px-4 py-24 max-w-3xl mx-auto w-full">
        <span className="eyebrow mb-3 inline-block">{t("x402.eyebrow")}</span>
        <h2
          className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3"
          style={{ letterSpacing: "-0.02em" }}
        >
          {t("x402.heading")}
        </h2>
        <p className="text-muted-foreground mb-8 text-sm" style={{ lineHeight: 1.65 }}>
          {t("x402.description")}
        </p>
        <CodeBlock code={X402_CLIENT_TS} language="typescript" />
        <p className="text-xs text-muted-foreground mt-4" style={{ lineHeight: 1.65 }}>
          {t("x402.discoveryNote")}
        </p>
      </section>

      {/* Endpoints summary */}
      <section className="px-4 py-24 max-w-3xl mx-auto w-full">
        <h2
          className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3 text-center"
          style={{ letterSpacing: "-0.02em" }}
        >
          {t("endpoints.heading")}
        </h2>
        <p className="text-center text-muted-foreground mb-12 text-sm">
          {t("endpoints.subtitle")}
        </p>

        <div className="flex flex-col gap-3">
          <div className="rounded-lg border px-5 py-4" style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}>
            <EndpointRow method="POST" path="/v1/iban/validate" price="$0.005" />
          </div>
          <div className="rounded-lg border px-5 py-4" style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}>
            <EndpointRow method="POST" path="/v1/iban/batch" price="$0.002 / IBAN" />
          </div>
          <div className="rounded-lg border px-5 py-4" style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}>
            <EndpointRow method="GET" path="/v1/bic/:code" price="$0.003" />
          </div>
          <div className="rounded-lg border px-5 py-4" style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}>
            <EndpointRow method="GET" path="/v1/ch/clearing/:iid" price="$0.003" />
          </div>
          <div className="rounded-lg border px-5 py-4" style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}>
            <EndpointRow method="POST" path="/v1/iban/compliance" price="$0.02" />
          </div>
        </div>
      </section>

      {/* Discovery */}
      <section className="px-4 py-24 max-w-3xl mx-auto w-full">
        <span className="eyebrow mb-3 inline-block">{t("discovery.eyebrow")}</span>
        <h2
          className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3"
          style={{ letterSpacing: "-0.02em" }}
        >
          {t("discovery.heading")}
        </h2>
        <p className="text-muted-foreground mb-6 text-sm" style={{ lineHeight: 1.65 }}>
          {t("discovery.description")}
        </p>
        <ul className="text-sm text-muted-foreground space-y-2 font-mono">
          {[
            "/.well-known/x402",
            "/.well-known/agents.json",
            "/.well-known/mcp.json",
            "/openapi.json",
            "/llms.txt",
          ].map((p) => (
            <li key={p}>
              <a
                href={`https://api.ibanforge.com${p}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-500 hover:underline"
              >
                api.ibanforge.com{p}
              </a>
            </li>
          ))}
        </ul>
      </section>

      {/* Final CTA */}
      <section
        className="flex flex-col items-center text-center px-4 py-32 gap-6 border-t"
        style={{ borderColor: "var(--ink-4)", background: "var(--ink-0)" }}
      >
        <h2
          className="text-3xl sm:text-4xl font-bold tracking-tight"
          style={{ letterSpacing: "-0.02em" }}
        >
          {t("cta.heading")}
        </h2>
        <p className="text-muted-foreground max-w-md" style={{ lineHeight: 1.65 }}>
          {t("cta.description")}
        </p>
        <Button
          size="lg"
          className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold px-8 mt-2"
          render={<Link href={`/${locale}/playground`} />}
        >
          {t("cta.button")}
        </Button>
      </section>
    </div>
  );
}

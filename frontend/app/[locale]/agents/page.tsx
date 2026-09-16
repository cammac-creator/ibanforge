import catalogue from "@/data/onboarding.json";
import Link from "next/link";
import { localePath } from "@/lib/locale-path";
import { JourneyActions } from "@/components/journey-actions";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CodeBlock } from "@/components/code-block";
import { alternatesFor } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EndpointRow } from "@/components/ui/endpoint-row";
import { StatusDot } from "@/components/ui/status-dot";

/**
 * Translated, and correct about what we ship.
 *
 * The static `metadata` this replaces said "Native MCP server with 5 tools" in
 * English on all three locales, while the body of this very page said seven,
 * in the reader's own language, at six places. The meta line is the one a
 * search engine quotes and an assistant summarises, so the only sentence a
 * machine repeated about the page under-sold the product by two tools and
 * served English to a French or German reader. `export const metadata` cannot
 * read the locale — that is the whole reason the drift was possible — so this
 * follows the generateMetadata + getTranslations pattern already in place on
 * vendors, compare and sources.
 *
 * The title now names the question rather than the audience ("MCP Server for
 * IBAN Validation" rather than "For AI Agents"), because that is what someone
 * types when they are looking for exactly what this page is.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "agents" });
  return {
    title: t("meta.title", counts),
    description: t("meta.description", counts),
    alternates: alternatesFor(locale, "/agents"),
  };
}

const MCP_CLAUDE_DESKTOP_JSON = `{
  "mcpServers": {
    "ibanforge": {
      "command": "npx",
      "args": ["-y", "ibanforge-mcp"]
    }
  }
}`;

const counts = { daily: catalogue.remoteDaily, remote: catalogue.remote.length, installed: catalogue.installed.length };
const FREE_KEY_CURL = `curl -X POST https://api.ibanforge.com/v1/keys/generate

# → { "api_key": "ifk_...", "monthly_limit": ${catalogue.anonymousMonthly} }`;

const SDK_PYTHON_QUICKSTART = `# pip install ibanforge
import os
from ibanforge import IBANforge

with IBANforge(api_key=os.environ["IBANFORGE_API_KEY"]) as client:
    out = client.validate_iban("DE89370400440532013000")
    print(out["valid"])
    print(out.get("bank_code_check"))
    print(out.get("bic"))`;

const SDK_TYPESCRIPT_QUICKSTART = `// npm install @ibanforge/sdk
import { IBANforge } from "@ibanforge/sdk";

const ibanforge = new IBANforge({ apiKey: "ifk_..." });

const out = await ibanforge.validateIban("CH1000230000000012345");

console.log(out.country?.code);          // CH
console.log(out.bic?.bank_name);         // UBS Switzerland AG
console.log(out.sepa?.member);           // true`;

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
  body: JSON.stringify({ iban: "CH1000230000000012345" }),
});
// pays $0.005 USDC autonomously, returns 200 with the response`;

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

        <h1 className="text-6xl sm:text-7xl md:text-8xl display-forge">
          {t("hero.title")}
        </h1>

        <p className="max-w-2xl text-lg text-muted-foreground" style={{ lineHeight: 1.65 }}>
          {t("hero.description")}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mt-2">
          <Button
            size="lg"
            variant="amber"
            className="px-6"
            nativeButton={false}
            render={<a href="#mcp-quickstart" />}
          >
            {t("hero.cta.mcp")}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="px-6"
            nativeButton={false}
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
                {t(`paths.${p}.description`, counts)}
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
          {t("mcp.description", counts)}
        </p>

        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5 sm:p-7 mb-8">
          <h3 className="text-xl font-semibold mb-2">{t("http.heading")}</h3>
          <p className="text-sm text-muted-foreground mb-5">{t("http.body")}</p>
          <p className="text-xs text-muted-foreground mb-2">{t("http.label")}</p>
          <CodeBlock code="https://api.ibanforge.com/mcp" language="text" className="[&_pre]:whitespace-pre-wrap [&_code]:break-all" />
          <ol className="list-decimal pl-5 space-y-3 text-sm mt-5">
            {[0, 1, 2].map((step) => <li key={step}>{t(`http.steps.${step}`)}</li>)}
          </ol>
          <p className="text-xs text-muted-foreground mt-5">{t("http.limits", counts)}</p>
          <Link href={localePath(locale, "/docs/mcp")} className="inline-block mt-4 text-sm text-amber-500 underline underline-offset-4">{t("http.guide")} →</Link>
        </div>
        <h3 className="font-semibold mb-4">{t("http.local")}</h3>
        <div className="rounded-lg border p-5 mb-6" style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}>
          <p className="font-mono text-xs uppercase tracking-caps text-muted-foreground mb-2">
            {t("mcp.claudeLabel")}
          </p>
          <p className="text-sm text-muted-foreground mb-3 break-all">
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

        <h3 className="font-semibold mt-10 mb-4">{t("mcp.toolsHeading", counts)}</h3>
        <div className="flex flex-col gap-3">
          {catalogue.installed.map((name) => {
            const tool = catalogue.tools.find((item) => item.name === name);
            return (
            <div
              key={name}
              className="rounded-lg border px-5 py-4"
              style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}
            >
              <div className="flex items-center justify-between gap-3 mb-1">
                <code className="font-mono text-sm text-amber-500 break-all">{name}</code>
                <span className="font-mono text-xs text-muted-foreground">{(tool?.price === "free" || name === "audit_status") ? t("mcp.free") : tool ? `$${tool.price}${name === "batch_validate_iban" ? " / IBAN" : ""}` : t("mcp.auditPrice")}</span>
              </div>
              <p className="text-xs font-medium mb-2">{t(catalogue.remote.includes(name) ? "mcp.bothTransports" : "mcp.installedOnly")}</p>
              <p className="text-xs text-muted-foreground" style={{ lineHeight: 1.65 }}>
                {t(`toolDescriptions.${name}`)}
              </p>
            </div>
          ); })}
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

      {/* Native SDKs */}
      <section className="px-4 py-24 max-w-3xl mx-auto w-full">
        <span className="eyebrow mb-3 inline-block">SDKs</span>
        <h2
          className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3"
          style={{ letterSpacing: "-0.02em" }}
        >
          {t("http.sdkHeading")}
        </h2>
        <p className="text-muted-foreground mb-8 text-sm" style={{ lineHeight: 1.65 }}>
          {t("http.sdkBody")}
        </p>

        <div className="rounded-lg border p-5 mb-6" style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <p className="font-mono text-xs uppercase tracking-caps text-muted-foreground">
              Python
            </p>
            <a
              href="https://pypi.org/project/ibanforge/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-amber-500 hover:underline"
            >
              pypi.org/project/ibanforge ↗
            </a>
          </div>
          <CodeBlock code={SDK_PYTHON_QUICKSTART} language="python" />
        </div>

        <div className="rounded-lg border p-5" style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <p className="font-mono text-xs uppercase tracking-caps text-muted-foreground">
              TypeScript / JavaScript
            </p>
            <a
              href="https://www.npmjs.com/package/@ibanforge/sdk"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-amber-500 hover:underline"
            >
              npmjs.com/package/@ibanforge/sdk ↗
            </a>
          </div>
          <CodeBlock code={SDK_TYPESCRIPT_QUICKSTART} language="typescript" />
        </div>
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
            <EndpointRow className="max-sm:!grid-cols-[auto_minmax(0,1fr)] max-sm:[&>span:last-child]:col-start-2 [&>span:nth-child(2)]:break-all" method="POST" path="/v1/iban/validate" price="$0.005" />
          </div>
          <div className="rounded-lg border px-5 py-4" style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}>
            <EndpointRow className="max-sm:!grid-cols-[auto_minmax(0,1fr)] max-sm:[&>span:last-child]:col-start-2 [&>span:nth-child(2)]:break-all" method="POST" path="/v1/iban/batch" price="$0.002 / IBAN" />
          </div>
          <div className="rounded-lg border px-5 py-4" style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}>
            <EndpointRow className="max-sm:!grid-cols-[auto_minmax(0,1fr)] max-sm:[&>span:last-child]:col-start-2 [&>span:nth-child(2)]:break-all" method="GET" path="/v1/bic/:code" price="$0.003" />
          </div>
          <div className="rounded-lg border px-5 py-4" style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}>
            <EndpointRow className="max-sm:!grid-cols-[auto_minmax(0,1fr)] max-sm:[&>span:last-child]:col-start-2 [&>span:nth-child(2)]:break-all" method="GET" path="/v1/ch/clearing/:iid" price="$0.003" />
          </div>
          <div className="rounded-lg border px-5 py-4" style={{ borderColor: "var(--ink-4)", background: "var(--ink-1)" }}>
            <EndpointRow className="max-sm:!grid-cols-[auto_minmax(0,1fr)] max-sm:[&>span:last-child]:col-start-2 [&>span:nth-child(2)]:break-all" method="POST" path="/v1/iban/compliance" price="$0.02" />
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

      <div className="mx-auto w-full max-w-4xl px-4">
        <JourneyActions locale={locale} path="/agents" />
      </div>

    </div>
  );
}

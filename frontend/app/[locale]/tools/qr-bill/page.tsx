import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { QrBillClient } from "@/components/qr-bill-client";
import { ClientMessages } from "@/components/client-messages"
import { GetKeyButton } from "@/components/api-key-dialog";
import { alternatesFor } from "@/lib/seo";
import { localePath } from "@/lib/locale-path";

type GuideRule = { rule: string; mistake: string; code: string; message: string };

/**
 * Where each "related pages" label of the guide leads, in the order of
 * `qrBillGuide.more.items`. Paths, not URLs: localePath adds the prefix.
 */
const MORE_PATHS = [
  "/docs/swiss-qr-iban",
  "/docs/structured-addresses",
  "/iid",
  "/docs/ch-clearing",
  "/iban-validation-api",
  "/blog/2026-09-02-which-date-structured-addresses",
  "/blog/2026-11-04-six-iban-tool-retirement",
  "/audit",
] as const;

/** The example the API itself returns on an invalid request (src/routes/ch-qr-bill.ts). */
const REQUEST_EXAMPLE = `curl -s -X POST https://api.ibanforge.com/v1/ch/qr-bill/check \\
  -H "Content-Type: application/json" \\
  -d '{"payload":"SPC\\n0200\\n1\\nCH4431999123000889012\\nS\\nRobert Schneider AG\\nRue du Lac\\n1268\\n2501\\nBiel\\nCH\\n\\n\\n\\n\\n\\n\\n\\n1949.75\\nCHF\\nS\\nPia Rutschmann\\nMarktgasse\\n28\\n9400\\nRorschach\\nCH\\nQRR\\n210000000003139471430009017\\nOrder 15.06.2026\\nEPD"}'`;

/** A real answer of the route to that request, trimmed (local run of the same code). */
const RESPONSE_EXAMPLE = `{
  "valid": true,
  "ready_for_2026_11_14": true,
  "version": "0200",
  "creditor_iban": { "value": "CH4431999123000889012", "valid": true, "country": "CH", "qr_iban": true, "iid": "31999" },
  "creditor": { "structured": true, "...": "..." },
  "reference": {
    "type": "QRR",
    "value": "210000000003139471430009017",
    "valid": true,
    "note": "Checked with modulo 10 recursive over the first 26 digits, using the carry table of Annex B."
  },
  "findings": [],
  "next_steps": [
    "Structure and checksums pass. To learn the bank behind the IBAN and its payment-rail participation, call POST /v1/iban/validate (paid)."
  ]
}`;

/** The same call with the creditor address as type K: the part of the answer that proposes the structured form. */
const COMBINED_EXAMPLE = `"creditor": {
  "address": { "type": "K", "name": "Robert Schneider AG", "line1": "Rue du Lac 12", "line2": "2501 Biel", "country": "CH" },
  "structured": false,
  "proposed_structured": {
    "strt_nm": "Rue du Lac", "bldg_nb": "12", "pst_cd": "2501", "twn_nm": "Biel", "ctry": "CH",
    "confidence": "high",
    "note": "Derived from the combined lines: check the street and building number, then set AdrTp to S."
  }
}`;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "qrBill" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternatesFor(locale, "/tools/qr-bill"),
  };
}

export default async function QrBillPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("qrBill");
  const tk = await getTranslations("tools.keyBlock");
  const g = await getTranslations("qrBillGuide");
  const rules = Object.values(g.raw("rules.items") as Record<string, GuideRule>);
  const mistakes = Object.values(g.raw("mistakes.items") as Record<string, { title: string; text: string }>);
  const notChecked = Object.values(g.raw("notChecked.items") as Record<string, string>);
  const faq = Object.values(g.raw("faq.items") as Record<string, { q: string; a: string }>);
  const moreLabels = Object.values(g.raw("more.items") as Record<string, string>);

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-10">
      <header className="flex flex-col gap-4">
        <Badge variant="outline" className="w-fit">
          {t("eyebrow")}
        </Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground leading-relaxed max-w-prose">{t("intro")}</p>
        <p className="text-sm text-muted-foreground max-w-prose">
          {t("deadline")}{" "}
          <Link href={localePath(locale, '/docs/swiss-qr-iban')} className="underline">
            {t("docsLink")}
          </Link>
        </p>
      </header>

      <ClientMessages ns={["qrBill"]}><QrBillClient /></ClientMessages>

      {/* 2026-09-06: the free tool is where a developer decides; the door to
          the free key was two clicks away in the header. */}
      <section className="flex flex-wrap items-center gap-4 rounded-md border p-4" style={{ borderColor: "var(--hairline)" }}>
        <p className="text-sm text-muted-foreground max-w-prose">{tk("text")}</p>
        <GetKeyButton size="sm" evt="cta:key-tool">{tk("cta")}</GetKeyButton>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{g("how.title")}</h2>
        <p className="text-muted-foreground leading-relaxed">{g("how.p1")}</p>
        <p className="text-muted-foreground leading-relaxed">{g("how.p2")}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{g("rules.title")}</h2>
        <p className="text-muted-foreground leading-relaxed">{g("rules.intro")}</p>
        <ol className="flex flex-col gap-3">
          {rules.map((r, i) => (
            <li key={i} className="rounded-md border p-4 flex flex-col gap-2 text-sm" style={{ borderColor: "var(--hairline)" }}>
              <p><span className="font-semibold">{g("rules.colRule")}.</span> {r.rule}</p>
              <p className="text-muted-foreground"><span className="font-semibold text-foreground">{g("rules.colMistake")}.</span> {r.mistake}</p>
              <p className="font-mono text-xs break-words">{r.code}</p>
              <p className="rounded-md bg-muted p-3 text-xs break-words" lang="en">{r.message}</p>
            </li>
          ))}
        </ol>
        <p className="text-muted-foreground leading-relaxed">{g("rules.outro")}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{g("mistakes.title")}</h2>
        <ul className="flex flex-col gap-3">
          {mistakes.map((m, i) => (
            <li key={i} className="text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">{m.title}.</span> {m.text}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{g("notChecked.title")}</h2>
        <p className="text-muted-foreground leading-relaxed">{g("notChecked.intro")}</p>
        <ul className="flex flex-col gap-3 list-disc pl-5 text-muted-foreground leading-relaxed">
          {notChecked.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </section>

      <section className="text-sm text-muted-foreground leading-relaxed flex flex-col gap-2">
        <h2 className="font-semibold text-foreground">{t("api.title")}</h2>
        <p>{t("api.text")}</p>
        <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">{`curl -s -X POST https://api.ibanforge.com/v1/ch/qr-bill/check \\
  -H "Content-Type: application/json" \\
  -d '{"payload":"SPC\\n0200\\n1\\nCH4431999123000889012\\nS\\n..."}'`}</pre>
        <p>{t("api.mcp")}</p>
        <p>{g("dev.p1")}</p>
        <p className="font-semibold text-foreground">{g("dev.requestLabel")}</p>
        <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">{REQUEST_EXAMPLE}</pre>
        <p className="font-semibold text-foreground">{g("dev.responseLabel")}</p>
        <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">{RESPONSE_EXAMPLE}</pre>
        <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">{COMBINED_EXAMPLE}</pre>
        <p>{g("dev.p2")}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{g("faq.title")}</h2>
        <dl className="flex flex-col gap-4">
          {faq.map((f, i) => (
            <div key={i}>
              <dt className="font-semibold">{f.q}</dt>
              <dd className="text-muted-foreground leading-relaxed">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <nav className="flex flex-col gap-3" aria-label={g("more.title")}>
        <h2 className="text-xl font-semibold tracking-tight">{g("more.title")}</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {MORE_PATHS.map((path, i) => (
            <li key={path}>
              <Link href={localePath(locale, path)} className="underline underline-offset-4">
                {moreLabels[i]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

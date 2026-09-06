import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { alternatesFor } from "@/lib/seo";
import {
  REGISTER_INDEX,
  allCountryCodes,
  apiJson,
  countriesFile,
  countryName,
  formatIban,
  getCountry,
  isNationalRegister,
  type CountryEntry,
} from "@/lib/countries";
import { routing } from "@/i18n/routing";
import { localePath } from "@/lib/locale-path";

/**
 * One page per IBAN country: /iban/ch, /iban/de, … in lower case, the way a
 * URL is typed. Every page is pre-rendered from data/countries.json, exported
 * by the API repository from its own validate route, so the "what the API
 * answers" block is the route's answer and the layout is the ISO 13616
 * registry's, not a re-typed table. Anything else under /iban/ is a 404, the
 * upper-case form included: measured on 2026-09-06, the locale layout's
 * `dynamicParams = false` sends every unlisted path to the catch-all before
 * this file runs, so a redirect written here would never execute.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => allCountryCodes().map((cc) => ({ locale, cc: cc.toLowerCase() })));
}

const SCHEME_LABEL: Record<string, string> = { SCT: "SCT", SDD: "SDD", SCT_INST: "SCT Inst" };
const schemes = (entry: CountryEntry) => entry.sepa.schemes.map((s) => SCHEME_LABEL[s] ?? s).join(", ");

export async function generateMetadata({ params }: { params: Promise<{ locale: string; cc: string }> }): Promise<Metadata> {
  const { locale, cc } = await params;
  const entry = getCountry(cc.toUpperCase());
  if (!entry) return { title: "Not Found" };
  const t = await getTranslations({ locale, namespace: "countries" });
  const country = countryName(entry.code, locale, entry.name_en);
  return {
    title: t("metaTitle", { country }),
    description: t("metaDescription", { country, length: entry.length, example: formatIban(entry.example) }),
    alternates: alternatesFor(locale, `/iban/${cc}`),
  };
}

const FIELD_STYLE: Record<string, string> = {
  country: "border-zinc-500",
  check: "border-zinc-400",
  bank_code: "border-amber-500",
  branch_code: "border-sky-500",
  account_number: "border-emerald-500",
  other: "border-dashed border-zinc-500",
};

export default async function CountryPage({ params }: { params: Promise<{ locale: string; cc: string }> }) {
  const { locale, cc } = await params;
  const entry = getCountry(cc.toUpperCase());
  if (!entry) notFound();
  const t = await getTranslations("countries");
  const tr = await getTranslations("registers");
  const country = countryName(entry.code, locale, entry.name_en);
  const national = isNationalRegister(entry);
  const file = countriesFile();

  // The example, cut where the registry cuts it. What no field claims (a
  // national check digit, a currency code, an account type) is drawn too,
  // as "other": every character of the example stays on the page.
  const segments: Array<{ key: string; text: string }> = [
    { key: "country", text: entry.example.slice(0, 2) },
    { key: "check", text: entry.example.slice(2, 4) },
  ];
  let cursor = 5;
  for (const f of entry.fields) {
    if (f.from > cursor) segments.push({ key: "other", text: entry.example.slice(cursor - 1, f.from - 1) });
    segments.push({ key: f.name, text: entry.example.slice(f.from - 1, f.to) });
    cursor = f.to + 1;
  }
  if (cursor <= entry.length) segments.push({ key: "other", text: entry.example.slice(cursor - 1) });
  const legendKeys = Array.from(new Set(segments.map((s) => s.key)));

  const fieldRow = (f: CountryEntry["fields"][number]): [string, string] => {
    const label = f.name === "bank_code" ? t("facts.bank") : f.name === "branch_code" ? t("facts.branch") : t("facts.account");
    return [label, `${t("facts.positions", { from: f.from, to: f.to })}${f.spec ? ` · ${f.spec}` : ""}`];
  };
  const facts: Array<[string, string]> = [
    [t("facts.code"), entry.code],
    [t("facts.length"), t("facts.lengthValue", { length: entry.length })],
    [t("facts.check"), t("facts.checkValue")],
    ...entry.fields.map(fieldRow),
    [t("facts.example"), formatIban(entry.example)],
    [t("facts.sepa"), entry.sepa.member ? t("facts.sepaYes", { schemes: schemes(entry) }) : t("facts.sepaNo")],
    [t("facts.vop"), entry.sepa.vop_required ? t("facts.vopYes") : t("facts.vopNo")],
    [t("facts.register"), entry.register ? (national ? entry.register : t("facts.registerComposite")) : t("facts.registerNone")],
  ];

  const checks: string[] = [
    t("checks.structure"),
    entry.register ? (national ? t("checks.bankNational", { register: entry.register }) : t("checks.bankComposite")) : t("checks.bankNone"),
    entry.sepa.member ? t("checks.sepa", { schemes: schemes(entry) }) : t("checks.sepaOut"),
  ];
  if (entry.sepa.member) checks.push(t("checks.vop"));

  const registerIndex = REGISTER_INDEX[entry.code];

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <Badge variant="outline" className="w-fit">{t("eyebrow")}</Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-balance">{t("title", { country })}</h1>
        <p className="text-lg text-muted-foreground">{t("subtitle", { length: entry.length })}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("anatomyTitle")}</h2>
        <p className="flex flex-wrap gap-x-3 gap-y-2 font-mono text-base sm:text-xl tracking-wider" aria-label={formatIban(entry.example)}>
          {segments.map((s, i) => (
            <span key={`${s.key}-${i}`} className={`border-b-2 pb-1 ${FIELD_STYLE[s.key] ?? "border-zinc-500"}`} title={t(`legend.${s.key}`)}>
              {s.text}
            </span>
          ))}
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {legendKeys.map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span className={`inline-block h-0.5 w-4 border-b-2 ${FIELD_STYLE[k]}`} aria-hidden="true" />
              {t(`legend.${k}`)}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{t("anatomyNote")}</p>
        {national && (entry.api.bank_code_check as { status?: string } | null)?.status === "not_in_register" && (
          <p className="text-xs text-muted-foreground">{t("exampleNotAllocated", { register: entry.register ?? "" })}</p>
        )}
        {/* A country with register pages whose example still answers from the
            composite map: a supervisor's list covers some of its codes without
            covering the space. San Marino is the only one today, and without
            this line its page would read as having no register at all while
            /sm sits one click away naming four banks. Keyed on the condition,
            not on the country, so the next partial register inherits it. */}
        {!national && registerIndex && (
          <p className="text-xs text-muted-foreground">{t("examplePartialRegister")}</p>
        )}
      </section>

      <section className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--hairline)" }}>
        <table className="w-full text-sm">
          <caption className="sr-only">{t("facts.title", { country })}</caption>
          <tbody>
            {facts.map(([k, v]) => (
              <tr key={k} className="border-b last:border-b-0" style={{ borderColor: "var(--hairline)" }}>
                <th scope="row" className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap w-44">{k}</th>
                <td className="px-3 py-2 font-mono text-xs sm:text-sm">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-muted-foreground -mt-6">{t("specLegend")}</p>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("checksTitle", { country })}</h2>
        <ul className="list-disc pl-5 text-sm text-muted-foreground leading-relaxed flex flex-col gap-1">
          {checks.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{tr("common.apiTitle")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{tr("common.apiText")}</p>
        <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">{apiJson(entry.api)}</pre>
      </section>

      <section className="flex flex-wrap gap-4 text-sm">
        <Link href={localePath(locale, "/tools/test-iban")} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">{t("cta.tool", { country })}</Link>
        <Link href={localePath(locale, "/audit")} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">{tr("common.ctaAudit")}</Link>
        <Link href={localePath(locale, "/docs/iban-validate")} className="text-muted-foreground hover:text-foreground underline underline-offset-4">{t("cta.docs")}</Link>
        {registerIndex && (
          <Link href={localePath(locale, registerIndex)} className="text-muted-foreground hover:text-foreground underline underline-offset-4">{t("cta.registerIndex")}</Link>
        )}
        <Link href={localePath(locale, "/iban")} className="text-muted-foreground hover:text-foreground underline underline-offset-4">{t("cta.index")}</Link>
      </section>

      <p className="text-xs text-muted-foreground">{t("sourceNote", { date: file.generated_at })}</p>
    </div>
  );
}

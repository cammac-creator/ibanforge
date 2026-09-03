import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { alternatesFor } from "@/lib/seo";
import { apiJson, atBlzFile, formatIban, getAtCode } from "@/lib/registers";
import { routing } from "@/i18n/routing";

export const dynamicParams = true;

/** First batch pre-listed; every code of the directory renders on demand from the same JSON. */
export function generateStaticParams() {
  const { batch1 } = atBlzFile();
  return routing.locales.flatMap((locale) => batch1.map((code) => ({ locale, code })));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; code: string }> }): Promise<Metadata> {
  const { locale, code } = await params;
  const entry = getAtCode(code);
  if (!entry) return { title: "Not Found" };
  const t = await getTranslations({ locale, namespace: "registers" });
  const r = entry.register;
  const vars = { code: r.code, name: r.name, town: r.town ?? "", bic: r.bic ?? "" };
  return { title: t("at.metaTitle", vars), description: t("at.metaDescription", vars), alternates: alternatesFor(locale, `/at/${r.code}`) };
}

export default async function AtCodePage({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code } = await params;
  const entry = getAtCode(code);
  if (!entry) notFound();
  const t = await getTranslations("registers");
  const r = entry.register;
  const file = atBlzFile();
  const facts: Array<[string, string]> = [
    [t("at.facts.code"), r.code],
    [t("at.facts.bank"), r.name],
    [t("at.facts.bic"), r.bic ?? t("at.facts.none")],
    [t("at.facts.street"), r.street ?? t("at.facts.none")],
    [t("at.facts.postCode"), r.post_code ?? t("at.facts.none")],
    [t("at.facts.town"), r.town ?? t("at.facts.none")],
    [t("at.facts.lei"), r.lei ?? t("at.facts.none")],
  ];
  const related = entry.related.map((c) => file.entries[c]).filter(Boolean);
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <Badge variant="outline" className="w-fit">{t("at.eyebrow")}</Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t("at.title", { code: r.code })}</h1>
        <p className="text-lg text-muted-foreground">{t("at.subtitle", { name: r.name, town: r.town ?? "" })}</p>
      </header>

      <section className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--hairline)" }}>
        <table className="w-full text-sm">
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

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("common.exampleTitle")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("at.structure")}</p>
        <p className="font-mono text-sm sm:text-base tracking-wider">{formatIban(entry.example_iban)}</p>
        <p className="text-xs text-muted-foreground">{t("common.exampleNote")}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("common.apiTitle")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("common.apiText")}</p>
        <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">{apiJson(entry.api)}</pre>
      </section>

      {related.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("common.relatedTitle")}</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {related.map((e) => (
              <li key={e.register.code} className="flex gap-3 truncate">
                <Link href={`/${locale}/at/${e.register.code}`} className="font-mono text-amber-500 hover:text-amber-400 shrink-0">{e.register.code}</Link>
                <span className="text-muted-foreground truncate">{e.register.town ?? e.register.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-wrap gap-4 text-sm">
        <Link href={`/${locale}/playground`} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">{t("common.ctaCheck")}</Link>
        <Link href={`/${locale}/audit`} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">{t("common.ctaAudit")}</Link>
        <Link href={`/${locale}/docs/at-bank-codes`} className="text-muted-foreground hover:text-foreground underline underline-offset-4">{t("at.docLink")}</Link>
        <Link href={`/${locale}/at`} className="text-muted-foreground hover:text-foreground underline underline-offset-4">{t("at.indexTitle")}</Link>
      </section>

      <p className="text-xs text-muted-foreground">{t("common.sourceLabel")}: {file.source}, {t("common.asOfLabel")} {r.as_of}.</p>
    </div>
  );
}

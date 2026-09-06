import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { alternatesFor } from "@/lib/seo";
import { apiJson, formatIban, getSmCode, smBankFile, smCredit } from "@/lib/registers";
import { routing } from "@/i18n/routing";
import { localePath } from "@/lib/locale-path";

export const dynamicParams = true;

/** Four banks, all four pre-rendered: there is no tail to hold back. */
export function generateStaticParams() {
  const { batch1 } = smBankFile();
  return routing.locales.flatMap((locale) => batch1.map((code) => ({ locale, code })));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; code: string }> }): Promise<Metadata> {
  const { locale, code } = await params;
  const entry = getSmCode(code);
  if (!entry) return { title: "Not Found" };
  const t = await getTranslations({ locale, namespace: "registers" });
  const r = entry.register;
  const vars = { code: r.code, name: r.name, town: r.town ?? "", bic: r.bic ?? "" };
  return { title: t("sm.metaTitle", vars), description: t("sm.metaDescription", vars), alternates: alternatesFor(locale, `/sm/${r.code}`) };
}

export default async function SmCodePage({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code } = await params;
  const entry = getSmCode(code);
  if (!entry) notFound();
  const t = await getTranslations("registers");
  const r = entry.register;
  const facts: Array<[string, string]> = [
    [t("sm.facts.code"), r.code],
    [t("sm.facts.bank"), r.name],
    [t("sm.facts.bic"), r.bic ?? t("sm.facts.none")],
    [t("sm.facts.street"), r.street ?? t("sm.facts.none")],
    [t("sm.facts.postCode"), r.post_code ?? t("sm.facts.none")],
    [t("sm.facts.town"), r.town ?? t("sm.facts.none")],
  ];
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <Badge variant="outline" className="w-fit">{t("sm.eyebrow")}</Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t("sm.title", { code: r.code })}</h1>
        <p className="text-lg text-muted-foreground">{r.name}{r.town ? `, ${r.town}` : ""}</p>
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

      {/* 🚨 The one thing this page must not let a reader conclude. The API block
          below says `authoritative: false`, and this is why: the BCSM lists the
          banks it supervises, it does not publish the allocation of the ABI
          space, so a code missing from these four proves nothing. */}
      <section className="rounded-md border px-4 py-3 flex flex-col gap-2" style={{ borderColor: "var(--hairline)" }}>
        <h2 className="text-sm font-semibold">{t("sm.notExhaustiveTitle")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("sm.notExhaustive")}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("common.exampleTitle")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("sm.structure")}</p>
        <p className="font-mono text-sm sm:text-base tracking-wider">{formatIban(entry.example_iban)}</p>
        <p className="text-xs text-muted-foreground">{t("common.exampleNote")}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("common.apiTitle")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("common.apiText")}</p>
        <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">{apiJson(entry.api)}</pre>
      </section>

      <section className="flex flex-wrap gap-4 text-sm">
        <Link href={localePath(locale, '/playground')} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">{t("common.ctaCheck")}</Link>
        <Link href={localePath(locale, '/audit')} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">{t("common.ctaAudit")}</Link>
        <Link href={localePath(locale, '/docs/sm-bank-codes')} className="text-muted-foreground hover:text-foreground underline underline-offset-4">{t("sm.docLink")}</Link>
        <Link href={localePath(locale, '/sm')} className="text-muted-foreground hover:text-foreground underline underline-offset-4">{t("sm.indexTitle")}</Link>
      </section>

      <p className="text-xs text-muted-foreground">{smCredit(r)}</p>
    </div>
  );
}

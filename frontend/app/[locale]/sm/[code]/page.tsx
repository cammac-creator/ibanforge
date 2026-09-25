import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { alternatesFor } from "@/lib/seo";
import { apiJson, formatIban, smLiveCredit } from "@/lib/registers";
import { fetchLiveRegisterEntry } from "@/lib/register-live";
import { localePath } from "@/lib/locale-path";

/*
 * Rendue à la demande depuis l'API, jamais depuis un fichier (étape du retrait,
 * 25/09/2026) : la liste de la BCSM, dont la licence est inconnue, est servie par
 * l'API depuis une surcouche privée et ne vit plus dans ce dépôt public. Aucun
 * code n'est pré-rendu, la construction n'appelle jamais l'API ; chaque page est
 * mise en cache un jour. Voir lib/register-live.ts.
 */
export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; code: string }> }): Promise<Metadata> {
  const { locale, code } = await params;
  const entry = await fetchLiveRegisterEntry("SM", code);
  if (!entry) return { title: "Not Found" };
  const t = await getTranslations({ locale, namespace: "registers" });
  const vars = { code: entry.code, name: entry.name, town: entry.town ?? "", bic: entry.bic ?? "" };
  return { title: t("sm.metaTitle", vars), description: t("sm.metaDescription", vars), alternates: alternatesFor(locale, `/sm/${entry.code}`) };
}

export default async function SmCodePage({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code } = await params;
  const entry = await fetchLiveRegisterEntry("SM", code);
  if (!entry) notFound();
  const t = await getTranslations("registers");
  const facts: Array<[string, string]> = [
    [t("sm.facts.code"), entry.code],
    [t("sm.facts.bank"), entry.name],
    [t("sm.facts.bic"), entry.bic ?? t("sm.facts.none")],
    [t("sm.facts.street"), entry.street ?? t("sm.facts.none")],
    [t("sm.facts.postCode"), entry.post_code ?? t("sm.facts.none")],
    [t("sm.facts.town"), entry.town ?? t("sm.facts.none")],
  ];
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <Badge variant="outline" className="w-fit">{t("sm.eyebrow")}</Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t("sm.title", { code: entry.code })}</h1>
        <p className="text-lg text-muted-foreground">{entry.name}{entry.town ? `, ${entry.town}` : ""}</p>
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
          space, so a code missing from its list proves nothing. */}
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
        <p className="text-sm text-muted-foreground leading-relaxed">{t("common.apiTextLive")}</p>
        <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">{apiJson(entry.api)}</pre>
      </section>

      <section className="flex flex-wrap gap-4 text-sm">
        <Link href={localePath(locale, '/playground')} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">{t("common.ctaCheck")}</Link>
        <Link href={localePath(locale, '/audit')} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">{t("common.ctaAudit")}</Link>
        <Link href={localePath(locale, '/docs/sm-bank-codes')} className="text-muted-foreground hover:text-foreground underline underline-offset-4">{t("sm.docLink")}</Link>
        <Link href={localePath(locale, '/sm')} className="text-muted-foreground hover:text-foreground underline underline-offset-4">{t("sm.indexTitle")}</Link>
      </section>

      <p className="text-xs text-muted-foreground">{smLiveCredit(entry)}</p>
    </div>
  );
}

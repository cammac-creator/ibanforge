import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { alternatesFor } from "@/lib/seo";
import { apiJson, formatIban, getItCode, itBankFile, itCredit } from "@/lib/registers";
import { itCopy } from "@/lib/it-register-copy";
import { routing } from "@/i18n/routing";
import { localePath } from "@/lib/locale-path";

export const dynamicParams = true;

/**
 * Les codes en vigueur sont pré-rendus (le premier lot) ; les codes radiés ont
 * leur page aussi, rendue à la demande : c'est là qu'un lecteur qui tape un
 * ancien code apprend sa radiation et son successeur légal.
 */
export function generateStaticParams() {
  const { batch1 } = itBankFile();
  return routing.locales.flatMap((locale) => batch1.map((code) => ({ locale, code })));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; code: string }> }): Promise<Metadata> {
  const { locale, code } = await params;
  const entry = getItCode(code);
  if (!entry) return { title: "Not Found" };
  const c = itCopy(locale);
  const r = entry.register;
  const alternates = alternatesFor(locale, `/it/${r.code}`);
  if (r.status === "retired") {
    return {
      title: c.retiredMetaTitle(r.code, r.name),
      description: c.retiredMetaDescription(r.code, r.name, r.retired_on),
      alternates,
    };
  }
  return { title: c.metaTitle(r.code, r.name, r.town ?? ""), description: c.metaDescription(r.code, r.name, r.town ?? ""), alternates };
}

export default async function ItCodePage({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code } = await params;
  const entry = getItCode(code);
  if (!entry) notFound();
  const t = await getTranslations("registers");
  const c = itCopy(locale);
  const r = entry.register;
  const none = c.facts.none;
  const facts: Array<[string, string]> =
    r.status === "retired"
      ? [
          [c.facts.code, r.code],
          [c.facts.status, c.facts.retired],
          [c.facts.lastHolder, r.name],
          [c.facts.retiredOn, r.retired_on],
          [c.facts.successor, r.successor_code ? `${r.successor_name ?? ""} (${r.successor_code})` : none],
        ]
      : [
          [c.facts.code, r.code],
          [c.facts.status, c.facts.inForce],
          [c.facts.holder, r.name],
          [c.facts.street, r.street ?? none],
          [c.facts.postCode, r.post_code ?? none],
          [c.facts.town, r.town ?? none],
          [c.facts.lei, r.lei ?? none],
        ];
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <Badge variant="outline" className="w-fit">{c.eyebrow}</Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{c.title(r.code)}</h1>
        <p className="text-lg text-muted-foreground">
          {r.name}
          {r.status === "in_force" && r.town ? `, ${r.town}` : ""}
        </p>
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

      {/* 🚨 Un code radié n'est pas un refus : la page dit la date, le
          successeur LÉGAL (pas forcément la banque qui tient le compte) et
          ce qu'il faut faire, comme next_steps dans la réponse de l'API. */}
      {r.status === "retired" && (
        <section className="rounded-md border px-4 py-3 flex flex-col gap-2" style={{ borderColor: "var(--hairline)" }}>
          <h2 className="text-sm font-semibold">{c.retiredTitle}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{c.retiredText(r.retired_on)}</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {r.successor_code ? c.successorText(r.successor_name ?? "", r.successor_code) : c.noSuccessorText}
          </p>
          {r.successor_code && (
            <p className="text-sm">
              <Link href={localePath(locale, `/it/${r.successor_code}`)} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">{c.successorLink(r.successor_code)}</Link>
            </p>
          )}
        </section>
      )}

      <section className="rounded-md border px-4 py-3 flex flex-col gap-2" style={{ borderColor: "var(--hairline)" }}>
        <h2 className="text-sm font-semibold">{c.notExhaustiveTitle}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{c.notExhaustive}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("common.exampleTitle")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{c.structure}</p>
        <p className="font-mono text-sm sm:text-base tracking-wider">{formatIban(entry.example_iban)}</p>
        <p className="text-xs text-muted-foreground">{t("common.exampleNote")}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("common.apiTitle")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("common.apiText")}</p>
        <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">{apiJson(entry.api)}</pre>
      </section>

      <section className="flex flex-wrap gap-4 text-sm">
        <Link href={localePath(locale, "/playground")} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">{t("common.ctaCheck")}</Link>
        <Link href={localePath(locale, "/audit")} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">{t("common.ctaAudit")}</Link>
        <Link href={localePath(locale, "/docs/it-bank-codes")} className="text-muted-foreground hover:text-foreground underline underline-offset-4">{c.docLink}</Link>
        <Link href={localePath(locale, "/it")} className="text-muted-foreground hover:text-foreground underline underline-offset-4">{c.indexTitle}</Link>
      </section>

      {/* Le crédit que la licence CC BY 4.0 demande, lu dans la ligne du
          registre : auteur, jeu, licence, édition, et les modifications. */}
      <p className="text-xs text-muted-foreground break-words">{itCredit(r)}</p>
    </div>
  );
}

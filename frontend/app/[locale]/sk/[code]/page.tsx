import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { alternatesFor } from "@/lib/seo";
import { apiJson, formatIban, getSkCode, skBankFile, skCredit } from "@/lib/registers";
import { routing } from "@/i18n/routing";
import { localePath } from "@/lib/locale-path";

export const dynamicParams = true;

/**
 * The whole register is pre-listed, because the whole register is 38 codes.
 * The German and Austrian pages ship a first batch to keep Google's "scaled
 * content" rule at bay; at this size there is no tail to hold back.
 *
 * The unpadded forms are listed TOO — `200` beside `0200`. `getSkCode` pads, so
 * both resolve to the same entry either way; listing them here simply
 * pre-renders the alias instead of building it on demand. Only the four codes
 * the NBS publishes with a leading zero add an entry, and each declares the
 * padded form as its canonical, so the alias is a door and not a second page.
 *
 * (These were added on 06/09/2026 for a reason that turned out to be wrong: at
 * the time every param outside this list answered 404, which looked like
 * `dynamicParams` being ignored. Commit c57143e5 found the real cause — the
 * locale layout's own `dynamicParams = false` cascading down — and fixed it.
 * The entries are kept because pre-rendering four pages costs nothing.)
 */
export function generateStaticParams() {
  const { batch1 } = skBankFile();
  const codes = new Set(batch1);
  for (const code of batch1) codes.add(String(Number(code)));
  return routing.locales.flatMap((locale) => [...codes].map((code) => ({ locale, code })));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; code: string }> }): Promise<Metadata> {
  const { locale, code } = await params;
  const entry = getSkCode(code);
  if (!entry) return { title: "Not Found" };
  const t = await getTranslations({ locale, namespace: "registers" });
  const r = entry.register;
  const vars = { code: r.code, name: r.name, bic: r.bic ?? "" };
  return { title: t("sk.metaTitle", vars), description: t("sk.metaDescription", vars), alternates: alternatesFor(locale, `/sk/${r.code}`) };
}

export default async function SkCodePage({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code } = await params;
  const entry = getSkCode(code);
  if (!entry) notFound();
  const t = await getTranslations("registers");
  const r = entry.register;
  const facts: Array<[string, string]> = [
    [t("sk.facts.code"), r.code],
    [t("sk.facts.bank"), r.name],
    [t("sk.facts.bic"), r.bic ?? t("sk.facts.none")],
  ];
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <Badge variant="outline" className="w-fit">{t("sk.eyebrow")}</Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t("sk.title", { code: r.code })}</h1>
        <p className="text-lg text-muted-foreground">{r.name}</p>
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
        {/* No address row, and none is missing: the prevodník publishes a name
            and a BIC, nothing more. Saying so beats three empty cells. */}
      </section>
      <p className="text-xs text-muted-foreground">{t("sk.noAddress")}</p>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("common.exampleTitle")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("sk.structure")}</p>
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
        <Link href={localePath(locale, '/docs/sk-bank-codes')} className="text-muted-foreground hover:text-foreground underline underline-offset-4">{t("sk.docLink")}</Link>
        <Link href={localePath(locale, '/sk')} className="text-muted-foreground hover:text-foreground underline underline-offset-4">{t("sk.indexTitle")}</Link>
      </section>

      {/* The citation the NBS site terms make a condition of reuse. Read from
          the register row: version and effective date belong to one edition,
          and a credit rebuilt by hand is how the two drift apart. */}
      <p className="text-xs text-muted-foreground">{skCredit(r)}</p>
    </div>
  );
}

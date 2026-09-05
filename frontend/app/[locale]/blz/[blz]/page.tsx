import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { alternatesFor } from "@/lib/seo";
import { apiJson, deBlzFile, formatIban, getBlz } from "@/lib/registers";
import { routing } from "@/i18n/routing";
import { localePath } from "@/lib/locale-path";

export const dynamicParams = true;

/**
 * The first batch is the one the sitemap lists; every code of the register
 * renders on demand from the same JSON (see lib/registers.ts and
 * scripts/export-register-pages.ts in the API repository). The site renders
 * server-side, so these params only tell the build what the first batch is.
 */
export function generateStaticParams() {
  const { batch1 } = deBlzFile();
  return routing.locales.flatMap((locale) => batch1.map((blz) => ({ locale, blz })));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; blz: string }> }): Promise<Metadata> {
  const { locale, blz } = await params;
  const entry = getBlz(blz);
  if (!entry) return { title: "Not Found" };
  const t = await getTranslations({ locale, namespace: "registers" });
  const r = entry.register;
  const vars = { blz: r.blz, name: r.name, town: r.town ?? "", bic: r.bic ?? "" };
  return { title: t("blz.metaTitle", vars), description: t("blz.metaDescription", vars), alternates: alternatesFor(locale, `/blz/${r.blz}`) };
}

export default async function BlzPage({ params }: { params: Promise<{ locale: string; blz: string }> }) {
  const { locale, blz } = await params;
  const entry = getBlz(blz);
  if (!entry) notFound();
  const t = await getTranslations("registers");
  const r = entry.register;
  const file = deBlzFile();
  const facts: Array<[string, string]> = [
    [t("blz.facts.blz"), r.blz],
    [t("blz.facts.bank"), r.name],
    [t("blz.facts.shortName"), r.short_name ?? t("blz.facts.none")],
    [t("blz.facts.bic"), r.bic ?? t("blz.facts.none")],
    [t("blz.facts.postCode"), r.post_code ?? t("blz.facts.none")],
    [t("blz.facts.town"), r.town ?? t("blz.facts.none")],
    [t("blz.facts.status"), r.retired ? t("blz.facts.retired") : t("blz.facts.active")],
    [t("blz.facts.successor"), r.successor_blz ?? t("blz.facts.none")],
  ];
  const related = entry.related.map((b) => file.entries[b]).filter(Boolean);
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <Badge variant="outline" className="w-fit">{t("blz.eyebrow")}</Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t("blz.title", { blz: r.blz })}</h1>
        <p className="text-lg text-muted-foreground">{t("blz.subtitle", { name: r.name, town: r.town ?? "" })}</p>
      </header>

      <section className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--hairline)" }}>
        <table className="w-full text-sm">
          <tbody>
            {facts.map(([k, v]) => (
              <tr key={k} className="border-b last:border-b-0" style={{ borderColor: "var(--hairline)" }}>
                <th scope="row" className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap w-44">{k}</th>
                <td className="px-3 py-2 font-mono text-xs sm:text-sm">
                  {k === t("blz.facts.successor") && r.successor_blz ? (
                    <Link href={localePath(locale, `/blz/${r.successor_blz}`)} className="text-amber-500 underline underline-offset-2">{v}</Link>
                  ) : v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("common.exampleTitle")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("blz.structure")}</p>
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
              <li key={e.register.blz} className="flex gap-3 truncate">
                <Link href={localePath(locale, `/blz/${e.register.blz}`)} className="font-mono text-amber-500 hover:text-amber-400 shrink-0">{e.register.blz}</Link>
                <span className="text-muted-foreground truncate">{e.register.town ?? e.register.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-wrap gap-4 text-sm">
        <Link href={localePath(locale, '/playground')} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">{t("common.ctaCheck")}</Link>
        <Link href={localePath(locale, '/audit')} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">{t("common.ctaAudit")}</Link>
        <Link href={localePath(locale, '/blz')} className="text-muted-foreground hover:text-foreground underline underline-offset-4">{t("blz.indexTitle")}</Link>
      </section>

      <p className="text-xs text-muted-foreground">{t("common.sourceLabel")}: {file.source}, {t("common.asOfLabel")} {r.as_of}.</p>
    </div>
  );
}

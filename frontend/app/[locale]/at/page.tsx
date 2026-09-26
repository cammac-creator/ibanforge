import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { RegisterSearch } from "@/components/register-search";
import { alternatesFor } from "@/lib/seo";
import { localePath } from "@/lib/locale-path";

/*
 * Depuis l'étape du retrait (25/09/2026), cette page ne liste plus le registre :
 * l'API le sert depuis une surcouche privée, et en afficher la liste complète
 * serait le republier. Elle garde la recherche d'un code, qui ouvre la page de ce
 * code, rendue à la demande depuis l'API (lib/register-live.ts).
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "registers" });
  return { title: t("at.indexTitle"), description: t("at.indexIntro"), alternates: alternatesFor(locale, "/at") };
}

export default async function AtIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("registers");
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <Badge variant="outline" className="w-fit">{t("at.eyebrow")}</Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-balance">{t("at.indexTitle")}</h1>
        <p className="text-muted-foreground leading-relaxed max-w-prose">{t("at.indexIntro")}</p>
        <RegisterSearch locale={locale} kind="at" label={t("common.searchLabel")} button={t("common.searchButton")} placeholder="12345" />
        <p className="text-xs text-muted-foreground max-w-prose">{t("common.privateRegisterNote")}</p>
        <p className="text-sm">
          <Link href={localePath(locale, "/iban/at")} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">{t("at.countryLink")}</Link>
        </p>
      </header>
    </div>
  );
}

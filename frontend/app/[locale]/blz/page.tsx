import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { RegisterSearch } from "@/components/register-search";
import { alternatesFor } from "@/lib/seo";
import { deBlzFile } from "@/lib/registers";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "registers" });
  return { title: t("blz.indexTitle"), description: t("blz.indexIntro"), alternates: alternatesFor(locale, "/blz") };
}

export default async function BlzIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("registers");
  const file = deBlzFile();
  const rows = file.batch1.map((blz) => file.entries[blz]).filter(Boolean);
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <Badge variant="outline" className="w-fit">{t("blz.eyebrow")}</Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-balance">{t("blz.indexTitle")}</h1>
        <p className="text-muted-foreground leading-relaxed max-w-prose">{t("blz.indexIntro")}</p>
        <RegisterSearch locale={locale} kind="blz" label={t("common.searchLabel")} button={t("common.searchButton")} placeholder="37040044" />
        <p className="text-xs text-muted-foreground">{t("common.batchNote")} {t("common.sourceLabel")}: {file.source}, {t("common.asOfLabel")} {file.generated_at}.</p>
      </header>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
        {rows.map((e) => (
          <li key={e.register.blz} className="flex gap-3 truncate">
            <Link href={`/${locale}/blz/${e.register.blz}`} className="font-mono text-amber-500 hover:text-amber-400 shrink-0">{e.register.blz}</Link>
            <span className="text-muted-foreground truncate">{e.register.name}{e.register.town ? `, ${e.register.town}` : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

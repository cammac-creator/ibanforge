import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { RegisterSearch } from "@/components/register-search";
import { alternatesFor } from "@/lib/seo";
import { smBankFile, smCredit } from "@/lib/registers";
import { localePath } from "@/lib/locale-path";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "registers" });
  return { title: t("sm.indexTitle"), description: t("sm.indexIntro"), alternates: alternatesFor(locale, "/sm") };
}

export default async function SmIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("registers");
  const file = smBankFile();
  const rows = file.batch1.map((code) => file.entries[code]).filter(Boolean);
  const credit = rows[0] ? smCredit(rows[0].register) : null;
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <Badge variant="outline" className="w-fit">{t("sm.eyebrow")}</Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-balance">{t("sm.indexTitle")}</h1>
        <p className="text-muted-foreground leading-relaxed max-w-prose">{t("sm.indexIntro")}</p>
        <RegisterSearch locale={locale} kind="sm" label={t("common.searchLabel")} button={t("common.searchButton")} placeholder="03034" />
        {/* The caveat, on the index as well as on every code page: four verified
            answers must not read as a register that settles negatives too. */}
        <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground leading-relaxed" style={{ borderColor: "var(--hairline)" }}>
          {t("sm.notExhaustive")}
        </p>
        <p className="text-sm">
          <Link href={localePath(locale, "/iban/sm")} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">{t("sm.countryLink")}</Link>
        </p>
      </header>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
        {rows.map((e) => (
          <li key={e.register.code} className="flex gap-3 truncate">
            <Link href={localePath(locale, `/sm/${e.register.code}`)} className="font-mono text-amber-500 hover:text-amber-400 shrink-0">{e.register.code}</Link>
            <span className="text-muted-foreground truncate">{e.register.name}</span>
          </li>
        ))}
      </ul>
      {credit && <p className="text-xs text-muted-foreground">{credit}</p>}
    </div>
  );
}

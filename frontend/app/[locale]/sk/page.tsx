import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { RegisterSearch } from "@/components/register-search";
import { alternatesFor } from "@/lib/seo";
import { skBankFile, skCredit } from "@/lib/registers";
import { localePath } from "@/lib/locale-path";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "registers" });
  return { title: t("sk.indexTitle"), description: t("sk.indexIntro"), alternates: alternatesFor(locale, "/sk") };
}

export default async function SkIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("registers");
  const file = skBankFile();
  // The whole register, not a first batch: 38 codes is a list a reader reads,
  // so `batch1` and the register are the same set (see export-register-pages.ts).
  const rows = file.batch1.map((code) => file.entries[code]).filter(Boolean);
  const credit = rows[0] ? skCredit(rows[0].register) : null;
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <Badge variant="outline" className="w-fit">{t("sk.eyebrow")}</Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-balance">{t("sk.indexTitle")}</h1>
        <p className="text-muted-foreground leading-relaxed max-w-prose">{t("sk.indexIntro")}</p>
        <RegisterSearch locale={locale} kind="sk" label={t("common.searchLabel")} button={t("common.searchButton")} placeholder="1100" />
        <p className="text-xs text-muted-foreground">{t("sk.wholeRegister", { count: file.count })}</p>
        <p className="text-sm">
          <Link href={localePath(locale, "/iban/sk")} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">{t("sk.countryLink")}</Link>
        </p>
      </header>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
        {rows.map((e) => (
          <li key={e.register.code} className="flex gap-3 truncate">
            <Link href={localePath(locale, `/sk/${e.register.code}`)} className="font-mono text-amber-500 hover:text-amber-400 shrink-0">{e.register.code}</Link>
            <span className="text-muted-foreground truncate">{e.register.name}</span>
          </li>
        ))}
      </ul>
      {/* The citation the NBS site terms make a condition of reuse, read from
          the register file rather than written here. */}
      {credit && <p className="text-xs text-muted-foreground">{credit}</p>}
    </div>
  );
}

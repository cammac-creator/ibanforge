import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { alternatesFor } from "@/lib/seo";
import { allCountryCodes, countriesFile, countryName, isNationalRegister } from "@/lib/countries";
import { localePath } from "@/lib/locale-path";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "countries" });
  return { title: t("indexTitle"), description: t("indexIntro", { count: countriesFile().count }), alternates: alternatesFor(locale, "/iban") };
}

export default async function CountriesIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("countries");
  const file = countriesFile();
  const rows = allCountryCodes()
    .map((cc) => {
      const entry = file.countries[cc];
      return { cc, entry, name: countryName(cc, locale, entry.name_en) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  const yes = t("indexTable.yes");
  const no = t("indexTable.no");
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <Badge variant="outline" className="w-fit">{t("eyebrow")}</Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-balance">{t("indexTitle")}</h1>
        <p className="text-muted-foreground leading-relaxed max-w-prose">{t("indexIntro", { count: file.count })}</p>
      </header>
      <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--hairline)" }}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr className="border-b" style={{ borderColor: "var(--hairline)" }}>
              <th scope="col" className="px-3 py-2">{t("indexTable.code")}</th>
              <th scope="col" className="px-3 py-2">{t("indexTable.country")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("indexTable.length")}</th>
              <th scope="col" className="px-3 py-2">{t("indexTable.sepa")}</th>
              <th scope="col" className="px-3 py-2">{t("indexTable.vop")}</th>
              <th scope="col" className="px-3 py-2">{t("indexTable.register")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ cc, entry, name }) => (
              <tr key={cc} className="border-b last:border-b-0" style={{ borderColor: "var(--hairline)" }}>
                <td className="px-3 py-2 font-mono">
                  <Link href={localePath(locale, `/iban/${cc.toLowerCase()}`)} className="text-amber-500 hover:text-amber-400">{cc}</Link>
                </td>
                <td className="px-3 py-2">
                  <Link href={localePath(locale, `/iban/${cc.toLowerCase()}`)} className="hover:underline underline-offset-4">{name}</Link>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{entry.length}</td>
                <td className="px-3 py-2 text-muted-foreground">{entry.sepa.member ? yes : no}</td>
                <td className="px-3 py-2 text-muted-foreground">{entry.sepa.vop_required ? yes : no}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {entry.register ? (isNationalRegister(entry) ? t("indexTable.national") : t("indexTable.composite")) : t("indexTable.none")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t("sourceNote", { date: file.generated_at })}</p>
    </div>
  );
}

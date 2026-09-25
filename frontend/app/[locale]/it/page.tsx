import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { RegisterSearch } from "@/components/register-search";
import { alternatesFor } from "@/lib/seo";
import { itBankFile, itCredit } from "@/lib/registers";
import { itCopy } from "@/lib/it-register-copy";
import { localePath } from "@/lib/locale-path";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const c = itCopy(locale);
  const file = itBankFile();
  return { title: c.indexTitle, description: c.indexIntro(file.batch1.length), alternates: alternatesFor(locale, "/it") };
}

export default async function ItIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("registers");
  const c = itCopy(locale);
  const file = itBankFile();
  const rows = file.batch1.map((code) => file.entries[code]).filter(Boolean);
  const credit = rows[0] ? itCredit(rows[0].register) : null;
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <Badge variant="outline" className="w-fit">{c.eyebrow}</Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-balance">{c.indexTitle}</h1>
        <p className="text-muted-foreground leading-relaxed max-w-prose">{c.indexIntro(rows.length)}</p>
        <RegisterSearch locale={locale} kind="it" label={t("common.searchLabel")} button={t("common.searchButton")} placeholder="03069" />
        <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">{c.retiredHint}</p>
        {/* Le registre est partiel, et la page le dit avant la liste : des
            centaines de codes confirmés ne doivent pas se lire comme un
            registre qui tranche aussi les absences. */}
        <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground leading-relaxed" style={{ borderColor: "var(--hairline)" }}>
          {c.notExhaustive}
        </p>
        <p className="text-sm">
          <Link href={localePath(locale, "/iban/it")} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">{c.countryLink}</Link>
        </p>
      </header>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{c.inForceTitle}</h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {rows.map((e) => (
            <li key={e.register.code} className="flex gap-3 truncate">
              <Link href={localePath(locale, `/it/${e.register.code}`)} className="font-mono text-amber-500 hover:text-amber-400 shrink-0">{e.register.code}</Link>
              <span className="text-muted-foreground truncate">{e.register.name}</span>
            </li>
          ))}
        </ul>
      </section>
      {credit && <p className="text-xs text-muted-foreground break-words">{credit}</p>}
    </div>
  );
}

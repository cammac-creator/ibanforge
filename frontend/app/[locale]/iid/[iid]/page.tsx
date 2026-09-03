import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { alternatesFor } from "@/lib/seo";
import { apiJson, chIidFile, formatIban, getIid } from "@/lib/registers";
import { routing } from "@/i18n/routing";

export const dynamicParams = true;

export function generateStaticParams() {
  const { batch1 } = chIidFile();
  return routing.locales.flatMap((locale) => batch1.map((iid) => ({ locale, iid })));
}

type Api = {
  institution?: { type?: string; iid_type?: string; headquarters_iid?: string | null };
  address?: { street?: string | null; building_number?: string | null; post_code?: string | null; town?: string | null; country?: string };
  payment_services?: Record<string, boolean>;
  sic_iid?: string | null;
  qr_iid?: string | null;
  qr_iids?: string[];
  valid_on?: string;
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string; iid: string }> }): Promise<Metadata> {
  const { locale, iid } = await params;
  const entry = getIid(iid);
  if (!entry) return { title: "Not Found" };
  const t = await getTranslations({ locale, namespace: "registers" });
  const r = entry.register;
  const vars = { iid: r.iid, name: r.name, town: r.town ?? "", bic: r.bic ?? "" };
  return { title: t("iid.metaTitle", vars), description: t("iid.metaDescription", vars), alternates: alternatesFor(locale, `/iid/${r.iid}`) };
}

export default async function IidPage({ params }: { params: Promise<{ locale: string; iid: string }> }) {
  const { locale, iid } = await params;
  const entry = getIid(iid);
  if (!entry) notFound();
  const t = await getTranslations("registers");
  const r = entry.register;
  const api = entry.api as Api;
  const file = chIidFile();
  const typeKey = api.institution?.type ?? "other";
  const iidTypeKey = api.institution?.iid_type ?? "other";
  const address = api.address
    ? [[api.address.street, api.address.building_number].filter(Boolean).join(" "), [api.address.post_code, api.address.town].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    : "";
  const services = Object.entries(api.payment_services ?? {})
    .filter(([, on]) => on)
    .map(([k]) => t(`iid.services.${k}`));
  const qrList = api.qr_iids?.length ? api.qr_iids.join(", ") : (api.qr_iid ?? r.qr_iid ?? null);
  const facts: Array<[string, React.ReactNode]> = [
    [t("iid.facts.iid"), r.iid],
    [t("iid.facts.institution"), r.name],
    [t("iid.facts.type"), t(`iid.types.${typeKey}`)],
    [t("iid.facts.iidType"), t(`iid.types.${iidTypeKey}`)],
    [t("iid.facts.headquarters"), api.institution?.headquarters_iid && api.institution.headquarters_iid !== r.iid ? <Link href={`/${locale}/iid/${api.institution.headquarters_iid}`} className="text-amber-500 underline underline-offset-2">{api.institution.headquarters_iid}</Link> : (api.institution?.headquarters_iid ?? t("iid.facts.none"))],
    [t("iid.facts.address"), address || t("iid.facts.none")],
    [t("iid.facts.bic"), r.bic ?? t("iid.facts.none")],
    [t("iid.facts.services"), services.length ? services.join(" · ") : t("iid.facts.none")],
    [t("iid.facts.sicIid"), api.sic_iid ?? t("iid.facts.none")],
    [t("iid.facts.qrIid"), qrList ?? t("iid.facts.none")],
    [t("iid.facts.validOn"), api.valid_on ?? r.valid_on],
  ];
  const related = entry.related.map((i) => file.entries[i]).filter(Boolean);
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <Badge variant="outline" className="w-fit">{t("iid.eyebrow")}</Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t("iid.title", { iid: r.iid })}</h1>
        <p className="text-lg text-muted-foreground">{t("iid.subtitle", { name: r.name, town: r.town ?? "" })}</p>
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

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("common.exampleTitle")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("iid.structure")}</p>
        <p className="font-mono text-sm sm:text-base tracking-wider">{formatIban(entry.example_iban)}</p>
        <p className="text-xs text-muted-foreground">{t("common.exampleNote")}</p>
        {qrList && <p className="text-sm text-muted-foreground">{t("iid.qrNote", { qr: qrList })}</p>}
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
              <li key={e.register.iid} className="flex gap-3 truncate">
                <Link href={`/${locale}/iid/${e.register.iid}`} className="font-mono text-amber-500 hover:text-amber-400 shrink-0">{e.register.iid}</Link>
                <span className="text-muted-foreground truncate">{e.register.town ?? e.register.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-wrap gap-4 text-sm">
        <Link href={`/${locale}/playground`} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">{t("common.ctaCheck")}</Link>
        <Link href={`/${locale}/audit`} className="text-amber-500 hover:text-amber-400 underline underline-offset-4">{t("common.ctaAudit")}</Link>
        <Link href={`/${locale}/iid`} className="text-muted-foreground hover:text-foreground underline underline-offset-4">{t("iid.indexTitle")}</Link>
      </section>

      <p className="text-xs text-muted-foreground">{t("common.sourceLabel")}: {file.source}, {t("common.asOfLabel")} {api.valid_on ?? r.valid_on}.</p>
    </div>
  );
}

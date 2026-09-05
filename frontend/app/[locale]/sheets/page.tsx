import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { GetKeyButton } from "@/components/api-key-dialog";
import { alternatesFor } from "@/lib/seo";
import { localePath } from "@/lib/locale-path";

const SOURCE_URL = "https://github.com/cammac-creator/ibanforge/tree/main/integrations/sheets";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "sheets" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: alternatesFor(locale, "/sheets"),
  };
}

// The Google Sheets add-on page (03/09/2026). Written BEFORE the Marketplace
// listing exists: the status block says so, and the install path offered today
// is the open-source script, not a store button. When Google's review completes
// the status block and the install steps change, nothing else.
export default async function SheetsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("sheets");
  const functions = [0, 1, 2, 3].map((i) => ({
    formula: t(`functions.${i}.formula`),
    returns: t(`functions.${i}.returns`),
  }));
  const steps = [0, 1, 2, 3].map((i) => t(`install.steps.${i}`));

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 flex flex-col gap-10">
      <header className="flex flex-col gap-4">
        <Badge variant="outline" className="w-fit">
          {t("eyebrow")}
        </Badge>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-balance">{t("title")}</h1>
        <p className="text-muted-foreground leading-relaxed max-w-prose">{t("intro")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <GetKeyButton size="sm" variant="amber" className="px-4">
            {t("cta.key")}
          </GetKeyButton>
          <a
            href={SOURCE_URL}
            className="text-sm text-amber-500 hover:text-amber-400 underline underline-offset-4 transition-colors"
            rel="noopener"
          >
            {t("cta.source")}
          </a>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("functions.title")}</h2>
        <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--hairline)" }}>
          <table className="w-full text-sm">
            <tbody>
              {functions.map((f) => (
                <tr key={f.formula} className="border-b last:border-b-0" style={{ borderColor: "var(--hairline)" }}>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-amber-500">{f.formula}</td>
                  <td className="px-3 py-2 text-muted-foreground">{f.returns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted-foreground">{t("functions.aliases")}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("install.title")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("install.status")}</p>
        <ol className="list-decimal pl-5 text-sm text-muted-foreground leading-relaxed flex flex-col gap-1">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("billing.title")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("billing.text")}</p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("billing.privacy")}{" "}
          <Link href={localePath(locale, '/legal/privacy')} className="underline underline-offset-2 hover:text-foreground">
            {t("billing.privacyLink")}
          </Link>
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">{t("billing.limits")}</p>
      </section>
    </div>
  );
}

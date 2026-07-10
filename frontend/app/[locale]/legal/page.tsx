import Link from "next/link";
import { getAllLegalDocs } from "@/lib/legal";
import { getTranslations } from "next-intl/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal" });
  return {
    title: `${t("index.title")} | IBANforge`,
    description: t("index.subtitle"),
  };
}

export default async function LegalIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal" });
  const docs = getAllLegalDocs();

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-14">
      <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("index.title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("index.subtitle")}</p>
      {locale !== "en" && (
        <p className="mt-3 text-xs text-muted-foreground border border-border rounded-md px-3 py-1.5 inline-block">
          {t("englishOnly")}
        </p>
      )}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {docs.map((doc) => (
          <Link
            key={doc.slug}
            href={`/${locale}/legal/${doc.slug}`}
            className="group rounded-lg border border-border bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
          >
            <h2 className="font-heading font-semibold text-foreground group-hover:text-primary transition-colors">
              {doc.title}
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{doc.description}</p>
            <p className="mt-3 text-xs font-mono text-muted-foreground">
              {t("updated")} {doc.updated}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}

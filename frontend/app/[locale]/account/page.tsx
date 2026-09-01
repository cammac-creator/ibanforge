import { getTranslations } from "next-intl/server";
import { AccountApp } from "@/components/account/account-app";
import { alternatesFor } from "@/lib/seo";

/**
 * The customer-facing account page.
 *
 * Deliberately outside the dashboard's protected group: it has no session, no
 * password and no server secret. The visitor's own API key is the credential,
 * and it is used from the browser against the API host directly — see the note
 * in `AccountApp`. That makes this the one operator-grade surface that renders
 * identically in a preview deployment.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account" });
  return {
    // No "| IBANforge" suffix: the locale layout's title template already
    // appends it (WEB-20, audit 2026-09-01).
    title: t("title"),
    description: t("subtitle"),
    alternates: alternatesFor(locale, "/account"),
    // Nothing here is indexable — the page is empty without a key, and we do
    // not want a credential form competing with the docs in search results.
    robots: { index: false, follow: true },
  };
}

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("account");
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 lg:px-8">
      <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("subtitle")}</p>
      <div className="mt-10">
        <AccountApp locale={locale} />
      </div>
    </div>
  );
}

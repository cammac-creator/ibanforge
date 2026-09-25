import { getTranslations } from "next-intl/server";
import { AccountApp } from "@/components/account/account-app";
import { GetKeyButton } from "@/components/api-key-dialog";
import { ClientMessages } from "@/components/client-messages"
import { alternatesFor } from "@/lib/seo";

/**
 * La page du compte client (« Mon compte »).
 *
 * Volontairement hors du groupe protégé du tableau de bord : ni mot de passe,
 * ni secret serveur. Deux façons d'y lire ses clés, toutes deux du navigateur
 * vers l'hôte de l'API, sans route Next ni action serveur (voir l'en-tête
 * d'`AccountApp`) :
 * - par défaut, la connexion par adresse e-mail et code à six chiffres, dont
 *   la session est un cookie posé par l'API sur son propre hôte ;
 * - en repli, la clé collée, qui ne touche jamais nos serveurs.
 *
 * Le repli se rend à l'identique dans un déploiement de prévisualisation ; la
 * connexion suppose le même site que l'API (ibanforge.com et api.ibanforge.com).
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
        <ClientMessages ns={["account"]}><AccountApp locale={locale} /></ClientMessages>
      </div>
      {/* 2026-09-06: the header sent every newcomer here, to a form that asks
          for a key they do not have. The page now offers the first one. */}
      <div className="mt-10 flex flex-wrap items-center gap-4 rounded-md border p-4 text-sm" style={{ borderColor: "var(--hairline)" }}>
        <p className="text-muted-foreground">{t("noKeyYet")}</p>
        <GetKeyButton size="sm" evt="cta:key-account">{t("getKey")}</GetKeyButton>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ClientMessages } from "@/components/client-messages";
import { DeviceApproveClient } from "@/components/device-approve-client";

/**
 * L'adresse que l'agent montre à son humain : `/device`, `/fr/device`,
 * `/de/device` (anglais à la racine, `localePrefix: 'as-needed'`).
 *
 * 🚨 `noindex, nofollow`, et donc absente du sitemap : c'est une page de
 * consentement à usage unique, dont l'URL canonique ne mène à rien sans un
 * code vivant. Indexée, elle offrirait à un moteur — et à un copieur — la
 * page d'approbation d'IBANforge comme résultat de recherche.
 *
 * Le corps tient en trois lignes parce que tout ce qui bouge est dans le
 * composant client : le patron est `app/[locale]/audit/done/page.tsx`.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "device" });
  // Pas de suffixe « | IBANforge » : le gabarit de titre du layout l'ajoute.
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function DevicePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-8 px-4 py-10 sm:px-6 sm:py-16">
      <ClientMessages ns={["device"]}>
        <DeviceApproveClient />
      </ClientMessages>
    </div>
  );
}

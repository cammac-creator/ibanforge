import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FamilleClient } from "./famille-client";

export const metadata: Metadata = {
  // `absolute` opts out of the parent layout template ("%s | IBANforge"),
  // qui dédoublerait sinon la marque dans le <title> rendu.
  title: {
    absolute: "IBANforge — vérifiez le bénéficiaire avant chaque paiement",
  },
  description:
    "Le contrôle qu'un agent IA exécute avant d'envoyer un paiement : validation IBAN, banque/BIC, clearing suisse, screening sanctions et score de risque — verdict en moins de 500 ms.",
};

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (locale !== "fr") notFound();

  return (
    <>
      {/* Polices de la maquette — hoistées dans le <head> par l'App Router.
          Le CSS embarqué référence ces familles par leur nom. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin=""
      />
      <link
        href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&family=JetBrains+Mono:wght@400;500;700&family=Familjen+Grotesk:wght@400;500;600&display=swap"
        rel="stylesheet"
      />
      <FamilleClient />
    </>
  );
}

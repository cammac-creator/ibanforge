import type { Metadata } from "next";
import { Bricolage_Grotesque, Familjen_Grotesk } from "next/font/google";
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

/*
 * Polices de la maquette, servies par le site lui-même depuis le 11/11/2026
 * (audit WEB-03).
 *
 * La page chargeait sa feuille et ses fichiers chez Google Fonts : chaque
 * visiteur était annoncé à Google, et la règle de sécurité du contenu,
 * désormais appliquée, n'autorise les polices et les feuilles que depuis
 * ibanforge.com. next/font les télécharge une fois, à la
 * construction, comme Inter et JetBrains Mono dans le layout racine (qui sert
 * déjà JetBrains Mono à toutes les pages, d'où son absence ici).
 *
 * Le CSS de la maquette, embarqué tel quel, demande ses familles par leur nom
 * dans trois variables de :root. Elles sont redéfinies ci-dessous avec le nom
 * que next/font donne réellement à chaque famille et sa police de repli
 * ajustée, plutôt que de dépendre de ce nom.
 */
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], axes: ["opsz"], display: "swap" });
const familjen = Familjen_Grotesk({ subsets: ["latin"], display: "swap" });

const FONT_VARIABLES = `html:root{--font-display:${bricolage.style.fontFamily},${familjen.style.fontFamily},system-ui,sans-serif;--font-body:${familjen.style.fontFamily},system-ui,-apple-system,sans-serif;--font-mono:var(--font-jetbrains-mono),ui-monospace,"SF Mono",Menlo,monospace}`;

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (locale !== "fr") notFound();

  return (
    <>
      <FamilleClient />
      <style dangerouslySetInnerHTML={{ __html: FONT_VARIABLES }} />
    </>
  );
}

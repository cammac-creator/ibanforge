import type { ReactNode } from "react";
import { GetKeyButton } from "@/components/api-key-dialog";

/**
 * `<TryApi>…</TryApi>` dans un document MDX : le bouton qui ouvre le dialogue
 * de clé, placé là où le résultat vient d'être expliqué (pages pilotes du
 * contrat de mesure, 15.09.2026). Le libellé est le contenu de la balise, la
 * page en reste l'auteur ; `cta:try-api-inline` est le nom remonté au clic.
 *
 * Vit ici et non dans `lib/mdx.ts` : ce module-là est chargé par les tests
 * de contenu sous Node, où un composant client ne se charge pas.
 */
export function TryApi({ children }: { children?: ReactNode }) {
  return (
    <p className="not-prose my-6">
      <GetKeyButton variant="amber" size="sm" evt="cta:try-api-inline">
        {children}
      </GetKeyButton>
    </p>
  );
}

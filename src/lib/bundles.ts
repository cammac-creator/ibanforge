/**
 * Les packs de crédits prépayés : combien de crédits, à quel prix en USDC.
 *
 * Sortis de `src/routes/api-keys.ts` le 10.11.2026 (audit d'architecture,
 * ARCH-02) : le paywall x402 et le contrat OpenAPI les lisaient en important un
 * fichier de routes entier. Ce module n'importe rien ;
 * `src/routes/api-keys.ts` les réexporte pour les anciens appelants.
 *
 * Un tarif par crédit plus doux que l'appel unitaire x402, pour qu'un agent ait
 * une raison d'acheter en gros. Le prix encaissé par le paywall est le `price`
 * de chaque route de `src/middleware/x402.ts` ; cette table en donne les mots, et
 * `src/routes/pack-price-claims.test.ts` exige que chaque texte servi la cite
 * au même prix. Un prix est la décision de Claude-Alain.
 *
 * Exportée aussi pour que la table de prix du résumé hebdomadaire
 * (`src/lib/business-summary.ts`) soit testée contre celle-ci : un prix qui
 * dériverait ici sans dériver là fausserait en silence la ligne des recettes.
 */
export const BUNDLES: Record<string, { credits: number; price_usdc: number }> = {
  '1k': { credits: 1000, price_usdc: 4 },
  '5k': { credits: 5000, price_usdc: 20 },
  '25k': { credits: 25000, price_usdc: 80 },
};

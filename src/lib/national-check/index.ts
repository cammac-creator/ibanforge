import { checkBelgianMod97 } from './be-mod97.js';
import { checkSpanishDc } from './es-dc.js';
import { checkFrenchRibKey } from './fr-rib.js';
import { checkItalianCin } from './it-cin.js';
import type { NationalCheck, NationalCheckScheme } from './types.js';

export type { NationalCheck, NationalCheckScheme, NationalCheckStatus } from './types.js';

/**
 * Point d'entrée des clés de contrôle nationales : un IBAN en entrée, un bloc
 * en sortie, ou `null` quand le pays n'a pas d'algorithme ici.
 *
 * ## État au 24.09.2026 : écrit, PAS branché
 *
 * Aucune réponse de l'API ne sert encore ce bloc. Le branchement dans
 * l'enrichissement viendra après les changements en cours sur le contrat des
 * réponses, avec sa documentation et son annonce au journal des changements.
 *
 * ## Ce que la fonction attend
 *
 * Un IBAN, de préférence déjà validé par iban-core (modulo 97 et structure du
 * BBAN). Elle ne refait pas ce contrôle : elle normalise comme iban-core
 * (espaces et tirets retirés, majuscules), lit le code pays, puis découpe
 * elle-même le BBAN brut (positions 5 et suivantes). Elle ne lit jamais les
 * champs analysés par iban-core, qui rangent la clé nationale dans le numéro
 * de compte (France, Monaco, Espagne) ou la sautent (Italie, Saint-Marin).
 *
 * Fonction pure : ni base, ni réseau, ni horloge.
 *
 * ## Les pays
 *
 * France et Monaco (clé RIB), Belgique (modulo 97 des dix premiers chiffres),
 * Italie et Saint-Marin (CIN), Espagne (DC). L'Allemagne attend : la
 * Bundesbank attribue une méthode par code banque, et le chargeur ne garde pas
 * encore cette colonne.
 */
export const NATIONAL_CHECK_SCHEMES: Readonly<Record<string, NationalCheckScheme>> = Object.freeze({
  FR: 'fr_rib_key',
  MC: 'fr_rib_key',
  BE: 'be_mod97',
  IT: 'it_cin',
  SM: 'it_cin',
  ES: 'es_dc',
});

const CHECKERS: Readonly<
  Record<NationalCheckScheme, (country: string, bban: string) => NationalCheck>
> = {
  fr_rib_key: checkFrenchRibKey,
  be_mod97: checkBelgianMod97,
  it_cin: checkItalianCin,
  es_dc: checkSpanishDc,
};

/** Le verdict de la clé nationale d'un IBAN, ou `null` si le pays n'en a pas ici. */
export function checkNationalKey(iban: string): NationalCheck | null {
  const cleaned = iban.replace(/[\s-]/g, '').toUpperCase();
  const country = cleaned.slice(0, 2);
  // Propriété propre seulement : la table ne répond jamais par son prototype.
  if (!Object.hasOwn(NATIONAL_CHECK_SCHEMES, country)) return null;
  const scheme = NATIONAL_CHECK_SCHEMES[country];
  return CHECKERS[scheme](country, cleaned.slice(4));
}

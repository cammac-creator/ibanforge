/**
 * Clés de contrôle nationales du BBAN : la forme commune des résultats.
 *
 * ## Ce que ce contrôle ajoute au modulo 97 de l'IBAN
 *
 * Les deux chiffres de contrôle ISO 13616 prouvent que l'IBAN a été recopié
 * sans faute. Ils ne disent rien de la partie nationale : un outil qui fabrique
 * un IBAN à partir d'un numéro de compte faux calcule sans peine des chiffres
 * ISO justes. Plusieurs pays gardent, À L'INTÉRIEUR du BBAN, leur propre clé
 * héritée des coordonnées bancaires d'avant l'IBAN (clé RIB, CIN italien,
 * chiffres de contrôle belges et espagnols). Cette clé-là est un second
 * contrôle, indépendant du premier.
 *
 * ## Ce que veulent dire les trois statuts
 *
 * - `pass` : la clé nationale est celle que l'algorithme donne. Le numéro est
 *   BIEN FORMÉ ; cela ne dit pas que le compte existe, ni qu'il est ouvert.
 *   La Bundesbank l'écrit pour ses propres méthodes : un numéro dont la clé se
 *   recalcule ne dit rien de l'existence du compte.
 * - `fail` : la clé ne correspond pas. Ce numéro ne peut pas avoir été émis tel
 *   qu'il est écrit (faute de frappe ou numéro fabriqué), même si l'IBAN passe
 *   le modulo 97.
 * - `not_applicable` : le pays a une clé, mais le BBAN reçu n'a pas la forme
 *   nationale (longueur, chiffres attendus), donc aucun calcul n'a eu lieu.
 *   Avec un IBAN déjà validé par iban-core, ce cas n'arrive pas ; il existe
 *   pour qu'une entrée imprévue ne produise jamais un verdict inventé.
 *
 * Un pays sans algorithme ne reçoit AUCUN bloc (la fonction d'entrée rend
 * `null`) : l'absence de contrôle se dit dans `checks.national_check_digits`
 * (`not_checked`), et non par un faux `not_applicable`.
 *
 * ## L'Allemagne (06.10.2026)
 *
 * La clé allemande dépend de la banque : la Bundesbank attribue à chaque code
 * banque une méthode de calcul parmi plus d'une centaine. Le bloc allemand
 * porte donc deux sens de plus :
 *
 * - `not_applicable` aussi quand la banque n'a pas de clé (méthode 09), ou que
 *   sa méthode n'en définit pas pour cette plage de numéros ;
 * - `not_checked` quand le contrôle n'a pas eu lieu de NOTRE fait : code banque
 *   absent du fichier de la Bundesbank, ou méthode pas encore vérifiée ici
 *   (de/verified.ts). C'est le même mot que `checks.national_check_digits`, et
 *   il ne dit jamais rien du bénéficiaire.
 *
 * Il porte aussi `method` (le code de la Bundesbank), `source` (avec la mention
 * qu'elle demande) et `table_fetched_on` (le jour où la table des méthodes a
 * été lue), comme `modulus_check` pour le Royaume-Uni.
 *
 * ## La langue
 *
 * `detail` est servi aux clients de l'API : il est en anglais, comme le reste
 * des réponses. Les commentaires restent en français.
 */

/** L'algorithme appliqué : un nom stable, que le client peut citer. */
export type NationalCheckScheme = 'fr_rib_key' | 'be_mod97' | 'it_cin' | 'es_dc' | 'de_pruefziffer';

export type NationalCheckStatus = 'pass' | 'fail' | 'not_applicable' | 'not_checked';

/** Les quatre statuts, pour les schémas publiés (OpenAPI, MCP). */
export const NATIONAL_CHECK_STATUSES: readonly NationalCheckStatus[] = Object.freeze([
  'pass',
  'fail',
  'not_applicable',
  'not_checked',
]);

export interface NationalCheck {
  /** Code pays de l'IBAN tel qu'il a été reçu : MC reste MC, SM reste SM. */
  country: string;
  scheme: NationalCheckScheme;
  status: NationalCheckStatus;
  /** Présent sur `fail`, `not_applicable` et `not_checked` : un `pass` se lit seul. */
  detail?: string;
  /** Allemagne seulement : le code de méthode de la Bundesbank pour ce code banque. */
  method?: string;
  /** Allemagne seulement : la source, avec la mention que la Bundesbank demande. */
  source?: string;
  /** Allemagne seulement : le jour où la table des méthodes a été lue (AAAA-MM-JJ). */
  table_fetched_on?: string;
}

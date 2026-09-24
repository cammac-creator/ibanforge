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
 * `null`) : l'absence de contrôle se dira ailleurs, dans le champ de ce qui
 * n'a pas été vérifié, et non par un faux `not_applicable`.
 *
 * ## La langue
 *
 * `detail` est servi aux clients de l'API : il est en anglais, comme le reste
 * des réponses. Les commentaires restent en français.
 */

/** L'algorithme appliqué : un nom stable, que le client peut citer. */
export type NationalCheckScheme = 'fr_rib_key' | 'be_mod97' | 'it_cin' | 'es_dc';

export type NationalCheckStatus = 'pass' | 'fail' | 'not_applicable';

export interface NationalCheck {
  /** Code pays de l'IBAN tel qu'il a été reçu : MC reste MC, SM reste SM. */
  country: string;
  scheme: NationalCheckScheme;
  status: NationalCheckStatus;
  /** Présent sur `fail` et `not_applicable` seulement : un `pass` se lit seul. */
  detail?: string;
}

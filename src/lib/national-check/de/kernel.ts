/**
 * Allemagne : les briques communes des méthodes de clé de la Bundesbank.
 *
 * Chaque banque allemande déclare à la Bundesbank une méthode de calcul de la
 * clé de ses numéros de compte (« Prüfzifferberechnungsmethode », champ 9 de la
 * Bankleitzahlendatei). La Bundesbank publie la description de chaque méthode
 * dans « Prüfzifferberechnungsmethoden zur Prüfung von Kontonummern auf ihre
 * Richtigkeit » (Stand: Juni 2018, toujours en vigueur au 7 décembre 2026 selon
 * la page de la Bundesbank lue le 06.10.2026) :
 * https://www.bundesbank.de/resource/blob/603320/16a80c739bbbae592ca575905975c2d0/mL/pruefzifferberechnungsmethoden-data.pdf
 *
 * Ce fichier ne contient que des opérations arithmétiques écrites d'après ce
 * document. Aucune ligne n'est reprise d'une bibliothèque sous GPL ou LGPL
 * (kontocheck, ktoblzcheck) : le dépôt est sous licence MIT.
 *
 * ## Les conventions de la spécification, reprises telles quelles
 *
 * - Le numéro de compte compte toujours dix chiffres, complétés à gauche par
 *   des zéros. Dans un IBAN allemand, ce sont les positions 13 à 22 ; le BBAN
 *   ne contient que le code banque (huit chiffres) et ce numéro.
 * - Les positions se comptent de 1 à 10, de gauche à droite (« Stelle 1 » à
 *   « Stelle 10 »). La position 10 porte le plus souvent la clé.
 * - Les poids s'appliquent le plus souvent de droite à gauche, en partant de la
 *   position qui précède la clé (« von rechts nach links »).
 */

/**
 * Ce qu'une méthode dit d'un numéro de compte.
 *
 * - `pass` : la clé est celle que la méthode donne.
 * - `fail` : elle ne l'est pas, ou la méthode déclare ce numéro inutilisable.
 * - `no_check` : la méthode ne définit aucune clé pour ce numéro (méthode 09,
 *   ou plage de numéros que la banque déclare sans clé).
 */
export type DeOutcome = 'pass' | 'fail' | 'no_check';

/**
 * Une méthode : le numéro de compte (dix chiffres exactement, zéros à gauche
 * compris) et le code banque (huit chiffres), que quelques méthodes lisent.
 */
export type DeMethod = (account: string, blz: string) => DeOutcome;

/** `pass` si la condition tient, `fail` sinon. */
export function verdict(ok: boolean): DeOutcome {
  return ok ? 'pass' : 'fail';
}

/** Le chiffre de la position `pos` (1 à 10, de gauche à droite). */
export function digitAt(account: string, pos: number): number {
  return account.charCodeAt(pos - 1) - 48;
}

/**
 * Les chiffres des positions `from` à `to` (1 à 10, bornes comprises), lus de
 * DROITE à GAUCHE : le premier élément est celui de la position `to`. C'est
 * l'ordre dans lequel la spécification applique ses poids.
 */
export function rtl(account: string, from: number, to: number): number[] {
  const out: number[] = [];
  for (let p = to; p >= from; p--) out.push(digitAt(account, p));
  return out;
}

/**
 * Les chiffres des positions `from` à `to`, lus de GAUCHE à DROITE, pour les
 * méthodes dont les poids s'écrivent dans ce sens (17, 24, 31, 64…).
 */
export function ltr(account: string, from: number, to: number): number[] {
  const out: number[] = [];
  for (let p = from; p <= to; p++) out.push(digitAt(account, p));
  return out;
}

/** La somme des chiffres d'un nombre positif (« Quersumme »), en une passe. */
export function crossSum(n: number): number {
  let total = 0;
  for (let v = n; v > 0; v = Math.floor(v / 10)) total += v % 10;
  return total;
}

/**
 * Somme des produits chiffre × poids. Les poids se répètent quand il y a plus
 * de chiffres que de poids (« 2, 3, 4, 5, 6, 7, 2, 3 ff. »).
 */
export function weighted(digits: readonly number[], weights: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < digits.length; i++) total += digits[i] * weights[i % weights.length];
  return total;
}

/**
 * Comme `weighted`, mais chaque produit à deux chiffres est remplacé par la
 * somme de ses chiffres avant l'addition (« nachdem jeweils aus den
 * zweistelligen Produkten die Quersumme gebildet wurde », méthode 00).
 */
export function weightedCross(digits: readonly number[], weights: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < digits.length; i++) {
    total += crossSum(digits[i] * weights[i % weights.length]);
  }
  return total;
}

/**
 * Modulus 10 « comme la méthode 00 » : seule l'unité de la somme compte, elle
 * est retranchée de 10, et un résultat de 10 donne la clé 0.
 */
export function mod10Key(sum: number): number {
  return (10 - (sum % 10)) % 10;
}

/**
 * Modulus 11 « comme la méthode 06 » : le reste est retranché de 11 ; un reste
 * de 0 donne la clé 0, et un reste de 1 aussi (de 10, seule l'unité 0 sert).
 */
export function mod11Key(sum: number): number {
  const r = sum % 11;
  return r <= 1 ? 0 : 11 - r;
}

/**
 * Modulus 11 « comme la méthode 02 » : comme 06, sauf qu'un reste de 1 rend le
 * numéro inutilisable (la clé aurait deux chiffres). `null` dans ce cas.
 */
export function mod11KeyStrict(sum: number): number | null {
  const r = sum % 11;
  if (r === 1) return null;
  return r === 0 ? 0 : 11 - r;
}

/** Vrai quand la clé attendue (ou `null`, numéro inutilisable) est à la position `pos`. */
export function keyAt(account: string, pos: number, expected: number | null): boolean {
  return expected !== null && digitAt(account, pos) === expected;
}

/** Les poids les plus courants, écrits une fois. */
export const W_2_1 = [2, 1] as const;
export const W_2_TO_7 = [2, 3, 4, 5, 6, 7] as const;
export const W_2_TO_10 = [2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/**
 * Les poids 2, 4, 8, 5, 10, 9, 7, 3, 6, 1, 2, 4… : les puissances de 2 modulo
 * 11, que les méthodes 33 à 40, 44, 52 et suivantes tronquent à leur longueur.
 */
export const W_POW2_MOD11 = [2, 4, 8, 5, 10, 9, 7, 3, 6, 1] as const;

/**
 * Le calcul le plus fréquent : les positions `from` à `to` pondérées de droite
 * à gauche, la clé en position `keyPos`.
 */
export function mod11At(
  account: string,
  from: number,
  to: number,
  weights: readonly number[],
  keyPos: number,
): boolean {
  return keyAt(account, keyPos, mod11Key(weighted(rtl(account, from, to), weights)));
}

/** Pendant modulus 10 de `mod11At`, avec somme des chiffres des produits. */
export function mod10CrossAt(
  account: string,
  from: number,
  to: number,
  weights: readonly number[],
  keyPos: number,
): boolean {
  return keyAt(account, keyPos, mod10Key(weightedCross(rtl(account, from, to), weights)));
}

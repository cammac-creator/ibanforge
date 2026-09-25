import type { NationalCheck } from './types.js';

/**
 * France et Monaco : la clé RIB.
 *
 * ## L'algorithme
 *
 * Le BBAN français se lit code banque (5 chiffres), code guichet (5 chiffres),
 * numéro de compte (11 caractères, chiffres ou lettres) et clé RIB (2 chiffres).
 * La clé vaut :
 *
 *     clé = 97 − ((89 × banque + 15 × guichet + 3 × compte) mod 97)
 *
 * Elle va donc de 01 à 97, jamais 00. Avant le calcul, chaque lettre du numéro
 * de compte est remplacée par un chiffre : A et J valent 1 ; B, K et S valent
 * 2 ; C, L et T valent 3 ; et ainsi de suite jusqu'à I, R et Z qui valent 9.
 * S vaut 2 et non 1 : la table saute une valeur entre R et S. C'est l'erreur
 * classique d'une réécriture naïve, et le test la couvre.
 *
 * ## Sources
 *
 * - Wikipédia, « Relevé d'identité bancaire », section sur la clé RIB :
 *   https://fr.wikipedia.org/wiki/Relev%C3%A9_d%27identit%C3%A9_bancaire,
 *   consultée le 24.09.2026 (formule 89, 15, 3 ; table des lettres avec le
 *   saut entre R et S ; clé valable pour les comptes français et monégasques).
 * - Recoupement : bibliothèque schwifty 2025.9.0 (licence MIT), module
 *   `checksum/france.py`, même formule et même table, enregistrée pour FR et MC.
 *   Les vecteurs du fichier de test ont été calculés par elle, pas par ce code.
 * - La norme du CFONB elle-même n'a pas été consultée : non vérifié à cette
 *   source.
 *
 * ## Monaco et les territoires d'outre-mer
 *
 * iban-core reconnaît deux pays à ce format : FR et MC (`IBAN_LENGTHS`,
 * `BBAN_SPECS` = 5!n5!n11!c2!n pour les deux). Les départements et
 * collectivités d'outre-mer ont des IBAN qui commencent par FR ; les anciens
 * préfixes GF, GP, MQ, RE, NC, PF… sont refusés en amont comme pays inconnus,
 * ce module ne les reçoit donc jamais et ne les accepte pas.
 *
 * ## Ce que la clé ne voit pas
 *
 * Deux lettres jumelles (A et J, D et M, B et K…) donnent le même chiffre :
 * remplacer l'une par l'autre laisse la clé juste. Un `pass` veut dire « numéro
 * bien formé », jamais « compte existant ».
 *
 * ## Pourquoi le BBAN est découpé ici
 *
 * `BBAN_STRUCTURE` d'iban-core range la clé RIB DANS `account_number`
 * (positions 10 à 23). Passer `result.bban.account_number` à `computeRibKey`
 * donnerait une clé fausse sur chaque IBAN. Ce module découpe lui-même le BBAN
 * brut ; ne pas le « simplifier » en lisant les champs déjà analysés.
 */

/** Les neuf groupes de la table de conversion : le rang du groupe + 1 est le chiffre. */
const RIB_LETTER_GROUPS = ['AJ', 'BKS', 'CLT', 'DMU', 'ENV', 'FOW', 'GPX', 'HQY', 'IRZ'] as const;

/** Lettre du numéro de compte → chiffre, d'après la table ci-dessus. */
export const RIB_LETTER_VALUES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    RIB_LETTER_GROUPS.flatMap((letters, i) => [...letters].map((l) => [l, String(i + 1)])),
  ),
);

/**
 * La clé RIB que donnent un code banque, un code guichet et un numéro de compte,
 * ou `null` quand l'un d'eux n'a pas la forme française (rien à calculer).
 */
export function computeRibKey(bank: string, branch: string, account: string): string | null {
  if (!/^\d{5}$/.test(bank) || !/^\d{5}$/.test(branch) || !/^[0-9A-Z]{11}$/.test(account)) {
    return null;
  }
  const numericAccount = [...account].map((c) => RIB_LETTER_VALUES[c] ?? c).join('');
  // Au plus 89 × 99 999 + 15 × 99 999 + 3 × 99 999 999 999, loin de la limite
  // des entiers exacts en virgule flottante : pas besoin de BigInt.
  const remainder = (89 * Number(bank) + 15 * Number(branch) + 3 * Number(numericAccount)) % 97;
  return String(97 - remainder).padStart(2, '0');
}

/** Le verdict sur un BBAN français ou monégasque (23 caractères, clé comprise). */
export function checkFrenchRibKey(country: string, bban: string): NationalCheck {
  const key = bban.length === 23 ? bban.slice(21) : '';
  const expected = computeRibKey(bban.slice(0, 5), bban.slice(5, 10), bban.slice(10, 21));
  if (expected === null || !/^\d{2}$/.test(key)) {
    return {
      country,
      scheme: 'fr_rib_key',
      status: 'not_applicable',
      detail:
        'The BBAN does not follow the French RIB layout (5-digit bank code, 5-digit branch code, 11-character account number, 2-digit key), so the RIB key could not be computed.',
    };
  }
  if (key === expected) return { country, scheme: 'fr_rib_key', status: 'pass' };
  return {
    country,
    scheme: 'fr_rib_key',
    status: 'fail',
    detail:
      'The RIB key (the last two digits of the BBAN) does not match the bank code, branch code and account number: this account number cannot have been issued as written.',
  };
}

import type { NationalCheck } from './types.js';

/**
 * Espagne : les deux chiffres de contrôle (DC) du code compte client.
 *
 * ## L'algorithme
 *
 * Le BBAN espagnol, ancien CCC, compte vingt chiffres : entité (4), agence (4),
 * DC (2) et numéro de compte (10). Chaque chiffre de contrôle se calcule sur
 * dix chiffres, pondérés de gauche à droite par 1, 2, 4, 8, 5, 10, 9, 7, 3, 6
 * (les puissances de 2 modulo 11) :
 *
 * - le premier sur « 00 » suivi de l'entité et de l'agence ;
 * - le second sur le numéro de compte.
 *
 * Le chiffre vaut 11 moins le reste de la somme divisée par 11 ; 11 devient 0
 * et 10 devient 1.
 *
 * ## Sources
 *
 * - Wikipédia en espagnol, « Código cuenta cliente » :
 *   https://es.wikipedia.org/wiki/C%C3%B3digo_cuenta_cliente, consultée le
 *   24.09.2026 (poids, préfixe 00, 11 moins le reste, 10 → 1 et 11 → 0 ;
 *   exemple 0049-1500-05-1234567892).
 * - Recoupement : python-stdnum 2.2 (`es/ccc.py`, qui renvoie à la même page
 *   et au registre des entités de la Banco de España) et schwifty 2025.9.0
 *   (`checksum/spain.py`).
 * - La norme d'origine du Consejo Superior Bancario n'a pas été consultée : non
 *   vérifié à cette source.
 *
 * ## Ce que le DC ne voit pas
 *
 * Les restes 1 et 10 donnent le même chiffre (10 → 1, et 11 − 10 = 1) : deux
 * numéros de compte différents peuvent partager leur DC, et certaines fautes
 * d'un seul chiffre passent. Un `pass` veut dire « bien formé ».
 *
 * ## Pourquoi le BBAN est découpé ici
 *
 * `BBAN_STRUCTURE` d'iban-core range le DC DANS `account_number` (positions 8
 * à 20). Passer ce champ à `computeSpanishDc` donnerait un DC faux. Ce module
 * lit le BBAN brut.
 */

/** Poids appliqués de gauche à droite aux dix chiffres de chaque calcul. */
export const ES_DC_WEIGHTS = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6] as const;

/** Un chiffre de contrôle sur dix chiffres. */
function dcDigit(tenDigits: string): number {
  let sum = 0;
  for (let i = 0; i < ES_DC_WEIGHTS.length; i++) sum += Number(tenDigits[i]) * ES_DC_WEIGHTS[i];
  const digit = 11 - (sum % 11);
  if (digit === 11) return 0;
  if (digit === 10) return 1;
  return digit;
}

/**
 * Les deux chiffres de contrôle que donnent une entité, une agence et un
 * numéro de compte, ou `null` quand l'un d'eux n'a pas la forme espagnole.
 */
export function computeSpanishDc(bank: string, branch: string, account: string): string | null {
  if (!/^\d{4}$/.test(bank) || !/^\d{4}$/.test(branch) || !/^\d{10}$/.test(account)) return null;
  return `${dcDigit(`00${bank}${branch}`)}${dcDigit(account)}`;
}

/** Le verdict sur un BBAN espagnol (20 chiffres, DC aux positions 9 et 10). */
export function checkSpanishDc(country: string, bban: string): NationalCheck {
  const dc = bban.slice(8, 10);
  const expected =
    bban.length === 20
      ? computeSpanishDc(bban.slice(0, 4), bban.slice(4, 8), bban.slice(10))
      : null;
  if (expected === null || !/^\d{2}$/.test(dc)) {
    return {
      country,
      scheme: 'es_dc',
      status: 'not_applicable',
      detail:
        'The BBAN does not follow the Spanish layout (20 digits: 4-digit bank, 4-digit branch, 2 check digits, 10-digit account), so the national check digits could not be computed.',
    };
  }
  if (dc === expected) return { country, scheme: 'es_dc', status: 'pass' };
  return {
    country,
    scheme: 'es_dc',
    status: 'fail',
    detail:
      'The two national check digits (positions 9 and 10 of the BBAN) do not match the bank, branch and account number: this account number cannot have been issued as written.',
  };
}

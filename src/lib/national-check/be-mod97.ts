import type { NationalCheck } from './types.js';

/**
 * Belgique : les deux derniers chiffres du numéro de compte.
 *
 * ## L'algorithme
 *
 * Le numéro de compte belge (le BBAN) compte douze chiffres, lus 3-7-2 : le
 * code d'identification de la banque (3), le numéro de compte dans la banque
 * (7) et deux chiffres de contrôle. Ces deux chiffres sont le reste de la
 * division par 97 du nombre formé par les dix premiers chiffres ; quand ce reste
 * est nul, la clé est 97. La clé va donc de 01 à 97, jamais 00.
 *
 * Ce n'est PAS le modulo 97 de l'IBAN : celui-là réarrange toute la chaîne,
 * pays compris, et vise le reste 1. Les deux contrôles sont indépendants, et un
 * IBAN belge peut passer le premier en échouant au second.
 *
 * ## Sources
 *
 * - Wikipédia en néerlandais, « Bankrekeningnummer », section Belgique :
 *   https://nl.wikipedia.org/wiki/Bankrekeningnummer, consultée le 24.09.2026
 *   (groupes 3-7-2 ; « de rest bij deling door 97 van het getal dat gevormd
 *   wordt door de 10 voorafgaande cijfers » ; 97 quand le reste est 0 ; exemple
 *   091-0122401-16).
 * - Banque nationale de Belgique, « Bank identification codes » :
 *   https://www.nbb.be/en/payment-systems/payment-standards/bank-identification-codes,
 *   consultée le 24.09.2026 (les trois premiers chiffres de tout numéro de
 *   compte belge sont le code d'identification de la banque ; la page ne décrit
 *   pas la clé).
 * - Recoupement : python-stdnum 2.2 (`be/iban.py`) et schwifty 2025.9.0
 *   (`checksum/belgium.py`) appliquent la même règle, 0 remplacé par 97.
 * - Le texte normatif de Febelfin n'a pas été consulté : non vérifié à cette
 *   source.
 *
 * ## Pourquoi le BBAN est découpé ici
 *
 * `BBAN_STRUCTURE` d'iban-core ne donne pas les deux chiffres de contrôle à
 * part (`accountNumber` = positions 3 à 10). Ce module lit le BBAN brut.
 */

/**
 * Les deux chiffres de contrôle que donnent les dix premiers chiffres, ou
 * `null` quand l'entrée n'est pas faite de dix chiffres.
 */
export function computeBelgianCheckDigits(firstTen: string): string | null {
  if (!/^\d{10}$/.test(firstTen)) return null;
  const remainder = Number(firstTen) % 97;
  return String(remainder === 0 ? 97 : remainder).padStart(2, '0');
}

/** Le verdict sur un BBAN belge (12 chiffres, clé comprise). */
export function checkBelgianMod97(country: string, bban: string): NationalCheck {
  const expected = bban.length === 12 ? computeBelgianCheckDigits(bban.slice(0, 10)) : null;
  const key = bban.slice(10);
  if (expected === null || !/^\d{2}$/.test(key)) {
    return {
      country,
      scheme: 'be_mod97',
      status: 'not_applicable',
      detail:
        'The BBAN does not follow the Belgian layout (12 digits: 3-digit bank code, 7-digit account, 2 check digits), so the national check digits could not be computed.',
    };
  }
  if (key === expected) return { country, scheme: 'be_mod97', status: 'pass' };
  return {
    country,
    scheme: 'be_mod97',
    status: 'fail',
    detail:
      'The last two digits of the Belgian account number are not the remainder of its first ten digits divided by 97: this account number cannot have been issued as written.',
  };
}

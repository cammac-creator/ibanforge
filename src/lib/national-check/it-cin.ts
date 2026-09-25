import type { NationalCheck } from './types.js';

/**
 * Italie et Saint-Marin : le CIN, lettre de contrôle en tête du BBAN.
 *
 * ## L'algorithme
 *
 * Le BBAN italien compte 23 caractères : le CIN (une lettre), le code ABI de
 * la banque (5 chiffres), le code CAB de l'agence (5 chiffres) et le numéro de
 * compte (12 caractères, chiffres ou lettres majuscules). Le CIN contrôle les
 * 22 caractères qui le suivent.
 *
 * Chaque caractère a un code : les chiffres 0 à 9 valent 0 à 9, les lettres A
 * à Z valent 0 à 25. En numérotant les 22 caractères de 1 à 22, une position
 * PAIRE ajoute son code tel quel, une position IMPAIRE ajoute la valeur que la
 * table ci-dessous donne pour son code. Le reste de la somme divisée par 26,
 * lu comme une lettre (0 = A … 25 = Z), est le CIN.
 *
 * ## Sources
 *
 * - Alexandre Rodichevski, « BBAN, standard di comunicazione delle coordinate
 *   bancarie » : https://alexandrerodichevski.chiappani.it/doc.php?n=218,
 *   consultée le 24.09.2026 (codes des caractères, table des positions
 *   impaires, somme modulo 26 ; exemple « Q0123412345000000753XYZ » dont le CIN
 *   est Q ; norme en vigueur depuis le 01.01.2003). Source secondaire.
 * - Wikipédia en italien, « Coordinate bancarie » :
 *   https://it.wikipedia.org/wiki/Coordinate_bancarie, consultée le 24.09.2026
 *   (le CIN est une lettre calculée à partir de l'ABI, du CAB et du compte ; la
 *   page ne donne pas l'algorithme).
 * - Recoupement : schwifty 2025.9.0 (`checksum/italy.py`), même table, même
 *   règle, enregistrée pour IT et SM. Les deux implémentations ont été
 *   comparées sur des BBAN tirés au sort le 24.09.2026, sans écart.
 * - La circulaire de l'ABI ou de la Banca d'Italia qui fixe la norme n'a pas
 *   été consultée : non vérifié à cette source.
 *
 * ## Saint-Marin
 *
 * Le registre IBAN donne à SM le même BBAN que l'Italie (1!a5!n5!n12!c) et
 * l'exemple officiel de SM passe ce calcul. Le Vatican (VA) a un autre format,
 * sans CIN : il n'a pas de bloc.
 *
 * ## Ce que le CIN ne voit pas
 *
 * Un chiffre et la lettre de même code (0 et A, 1 et B … 9 et J) pèsent
 * pareil : dans le numéro de compte, où les lettres sont permises, remplacer
 * l'un par l'autre laisse le CIN juste. Un `pass` veut dire « bien formé ».
 *
 * ## Pourquoi le BBAN est découpé ici
 *
 * `BBAN_STRUCTURE` d'iban-core saute le CIN (`bankCode` commence à la
 * position 1) : le CIN n'est dans aucun champ analysé. Ce module lit le BBAN
 * brut.
 */

/** Valeur ajoutée par une position impaire, indexée par le code du caractère (0 à 25). */
export const CIN_ODD_VALUES = [
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23,
] as const;

/** Code d'un caractère : 0-9 pour les chiffres, 0-25 pour A-Z. */
function cinCode(ch: string): number {
  const c = ch.charCodeAt(0);
  return c >= 48 && c <= 57 ? c - 48 : c - 65;
}

/**
 * Le CIN que donnent un code ABI, un code CAB et un numéro de compte, ou
 * `null` quand l'un d'eux n'a pas la forme italienne.
 */
export function computeItalianCin(abi: string, cab: string, account: string): string | null {
  if (!/^\d{5}$/.test(abi) || !/^\d{5}$/.test(cab) || !/^[0-9A-Z]{12}$/.test(account)) {
    return null;
  }
  const chars = abi + cab + account;
  let sum = 0;
  for (let i = 0; i < chars.length; i++) {
    const code = cinCode(chars[i]);
    // i part de 0 : i pair = position 1, 3, 5… de la norme, donc impaire.
    sum += i % 2 === 0 ? CIN_ODD_VALUES[code] : code;
  }
  return String.fromCharCode(65 + (sum % 26));
}

/** Le verdict sur un BBAN italien ou saint-marinais (23 caractères, CIN en tête). */
export function checkItalianCin(country: string, bban: string): NationalCheck {
  const cin = bban.slice(0, 1);
  const expected =
    bban.length === 23
      ? computeItalianCin(bban.slice(1, 6), bban.slice(6, 11), bban.slice(11))
      : null;
  if (expected === null || !/^[A-Z]$/.test(cin)) {
    return {
      country,
      scheme: 'it_cin',
      status: 'not_applicable',
      detail:
        'The BBAN does not follow the Italian layout (1 control letter, 5-digit ABI, 5-digit CAB, 12-character account number), so the CIN could not be computed.',
    };
  }
  if (cin === expected) return { country, scheme: 'it_cin', status: 'pass' };
  return {
    country,
    scheme: 'it_cin',
    status: 'fail',
    detail:
      'The CIN (the control letter at the start of the BBAN) does not match the ABI, CAB and account number: this account number cannot have been issued as written.',
  };
}

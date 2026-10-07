import {
  type DeMethod,
  type DeOutcome,
  W_2_1,
  W_2_TO_10,
  W_2_TO_7,
  W_POW2_MOD11,
  digitAt,
  keyAt,
  mod10CrossAt,
  mod10Key,
  mod11At,
  mod11Key,
  rtl,
  verdict,
  weighted,
} from './kernel.js';
import { DE_METHODS_00_39 } from './methods-00-39.js';

/**
 * Allemagne : les méthodes 80 à A9 de la Bundesbank que la Bankleitzahlendatei
 * attribue aujourd'hui (88, 91, 92, 94, 95, 96, 98, 99, A2 à A8), plus la
 * méthode 93, à laquelle renvoie la variante 4 de A4.
 *
 * Écrites d'après « Prüfzifferberechnungsmethoden » (Stand: Juni 2018), pages
 * 46 à 60 ; chaque entrée cite ce que dit la spécification, et seulement cela.
 * Les méthodes de cette plage qu'aucune banque n'utilise (80 à 87, 89, 90, 97,
 * A0, A1, A9) ne sont pas écrites : un code banque qui y passerait recevrait
 * `not_checked`.
 *
 * Une méthode écrite ici n'est pas pour autant servie : verified.ts dit
 * lesquelles donnent un verdict, et sur quelle base (numéros officiels de la
 * Bundesbank, ou implémentation indépendante seulement).
 */

/** Les méthodes de base auxquelles celles-ci renvoient (« wie bei Verfahren 00 »). */
const M = DE_METHODS_00_39;

/** Le numéro de compte lu comme un nombre (dix chiffres au plus : exact en double). */
function asNumber(account: string): number {
  return Number(account);
}

/** La première variante qui donne `pass` ; sinon le verdict de la dernière. */
function firstPass(...variants: Array<() => boolean>): boolean {
  return variants.some((v) => v());
}

/**
 * Modulus 7 (A4 variante 2, 93 variante 2) : le reste de la somme modulo 7 est
 * retranché de 7 ; sans reste, la clé est 0.
 */
function mod7Key(sum: number): number {
  const r = sum % 7;
  return r === 0 ? 0 : 7 - r;
}

/**
 * Méthode 93 : un numéro de client de cinq chiffres, pondéré 2, 3, 4, 5, 6 de
 * droite à gauche. Cas b) quand les positions 1 à 4 valent « 0000 » : client en
 * 5 à 9, clé en 10 ; sinon cas a) : client en 1 à 5, clé en 6, sous-numéro et
 * type de compte en 7 à 10, hors calcul. Variante 1 modulus 11 (comme 06),
 * puis, sur un échec, variante 2 modulus 7.
 */
function method93(account: string): boolean {
  const caseB = account.startsWith('0000');
  const from = caseB ? 5 : 1;
  const keyPos = caseB ? 10 : 6;
  const sum = weighted(rtl(account, from, from + 4), [2, 3, 4, 5, 6]);
  return keyAt(account, keyPos, mod11Key(sum)) || keyAt(account, keyPos, mod7Key(sum));
}

/**
 * L'exception des comptes généraux de la méthode 51 (position 3 = 9), à laquelle
 * A8 renvoie « mit den gleichen Ergebnissen und Testkontonummern ». Variante 1 :
 * positions 3 à 9, poids 2 à 8 de droite à gauche ; variante 2 : positions 1 à
 * 9, poids 2 à 10. Reste 0 ou 1 : clé 0, sinon 11 − reste. Écrite ici en
 * fonction privée : la méthode 51 appartient à la plage 40 à 79.
 */
function method51Sachkonto(account: string): boolean {
  return firstPass(
    () => mod11At(account, 3, 9, [2, 3, 4, 5, 6, 7, 8], 10),
    () => mod11At(account, 1, 9, W_2_TO_10, 10),
  );
}

/** Une méthode de base (00 à 39) vue comme une condition, `pass` seulement. */
function passes(code: string, account: string, blz: string): boolean {
  return M[code](account, blz) === 'pass';
}

export const DE_METHODS_80_A9: Readonly<Record<string, DeMethod>> = Object.freeze<
  Record<string, DeMethod>
>({
  // 88 : comme 06 sur les positions 4 à 9, poids 2 à 7 ; si la position 3 vaut
  // 9, les positions 3 à 9 avec les poids 2 à 8.
  '88': (a) =>
    verdict(
      digitAt(a, 3) === 9
        ? mod11At(a, 3, 9, [2, 3, 4, 5, 6, 7, 8], 10)
        : mod11At(a, 4, 9, W_2_TO_7, 10),
    ),

  // 91 : la clé est en position 7 ; quatre variantes « comme 06 », essayées dans
  // l'ordre jusqu'à la première juste :
  // 1. positions 1 à 6, poids 2 à 7 de droite à gauche ;
  // 2. positions 1 à 6, poids 7 à 2 de droite à gauche ;
  // 3. positions 1 à 10, poids 2, 3, 4, 0, 5, 6, 7, 8, 9, 10 de droite à gauche
  //    (la clé, en 7, porte le poids 0) ;
  // 4. positions 1 à 6, poids 2, 4, 8, 5, 10, 9.
  // Un numéro qu'aucune variante ne justifie est « nicht prüfbar » : la
  // Bundesbank range ses numéros de test de ce cas parmi les « falsch ».
  '91': (a) =>
    verdict(
      firstPass(
        () => mod11At(a, 1, 6, W_2_TO_7, 7),
        () => mod11At(a, 1, 6, [7, 6, 5, 4, 3, 2], 7),
        () => mod11At(a, 1, 10, [2, 3, 4, 0, 5, 6, 7, 8, 9, 10], 7),
        () => mod11At(a, 1, 6, W_POW2_MOD11.slice(0, 6), 7),
      ),
    ),

  // 92 : comme 01 (modulus 10 sans somme des chiffres) sur les seules positions
  // 4 à 9, poids 3, 7, 1 de droite à gauche.
  '92': (a) => verdict(keyAt(a, 10, mod10Key(weighted(rtl(a, 4, 9), [3, 7, 1])))),

  // 93 : voir `method93` : cas a) ou b), modulus 11 puis modulus 7.
  '93': (a) => verdict(method93(a)),

  // 94 : comme 00 sur les positions 1 à 9, mais poids 1, 2, 1… de droite à
  // gauche (la position 9 porte le poids 1).
  '94': (a) => verdict(mod10CrossAt(a, 1, 9, [1, 2], 10)),

  // 95 : comme 06, poids 2 à 7 puis 2, 3, 4 ; cinq plages de numéros n'ont pas
  // de clé (« keine Prüfzifferberechnung möglich. Sie sind als richtig
  // anzusehen »).
  '95': (a) => {
    const n = asNumber(a);
    if (
      (n >= 1 && n <= 1999999) ||
      (n >= 9000000 && n <= 25999999) ||
      (n >= 396000000 && n <= 499999999) ||
      (n >= 700000000 && n <= 799999999) ||
      (n >= 910000000 && n <= 989999999)
    ) {
      return 'no_check';
    }
    return verdict(mod11At(a, 1, 9, [2, 3, 4, 5, 6, 7, 2, 3, 4], 10));
  },

  // 96 : variante 1 : méthode 19 ; sur un échec, variante 2 : méthode 00 ; si
  // les deux échouent, un numéro compris entre 0001300000 et 0099399999 « gilt
  // als richtig » sans calcul (aucune clé contrôlée : `no_check`), tout autre
  // numéro est faux.
  '96': (a, blz) => {
    if (passes('19', a, blz) || passes('00', a, blz)) return 'pass';
    const n = asNumber(a);
    return n >= 1300000 && n <= 99399999 ? 'no_check' : 'fail';
  },

  // 98 : comme 01 sur les positions 3 à 9, poids 3, 1, 7 de droite à gauche
  // (position 9 : poids 3) ; sur un échec, la méthode 32.
  '98': (a, blz) =>
    verdict(keyAt(a, 10, mod10Key(weighted(rtl(a, 3, 9), [3, 1, 7]))) || passes('32', a, blz)),

  // 99 : comme 06, poids 2 à 7 puis 2, 3, 4 ; les numéros 0396000000 à
  // 0499999999 n'ont pas de clé.
  '99': (a) => {
    const n = asNumber(a);
    if (n >= 396000000 && n <= 499999999) return 'no_check';
    return verdict(mod11At(a, 1, 9, [2, 3, 4, 5, 6, 7, 2, 3, 4], 10));
  },

  // A2 : variante 1 : méthode 00 ; sur un échec, variante 2 : méthode 04.
  A2: (a, blz) => verdict(passes('00', a, blz) || passes('04', a, blz)),

  // A3 : variante 1 : méthode 00 ; sur un échec, variante 2 : méthode 10.
  A3: (a, blz) => verdict(passes('00', a, blz) || passes('10', a, blz)),

  // A4 : un numéro portant « 99 » en positions 3 et 4 se contrôle par la
  // variante 3, puis la 4 ; tout autre par la variante 1, puis la 2, puis la 4.
  // 1. positions 4 à 9, poids 2 à 7, comme 06 ;
  // 2. les mêmes positions et poids, modulus 7 ;
  // 3. positions 5 à 9, poids 2 à 6, comme 06 ;
  // 4. la méthode 93.
  A4: (a) => {
    if (a.slice(2, 4) === '99') {
      return verdict(
        firstPass(
          () => mod11At(a, 5, 9, [2, 3, 4, 5, 6], 10),
          () => method93(a),
        ),
      );
    }
    return verdict(
      firstPass(
        () => mod11At(a, 4, 9, W_2_TO_7, 10),
        () => keyAt(a, 10, mod7Key(weighted(rtl(a, 4, 9), W_2_TO_7))),
        () => method93(a),
      ),
    );
  },

  // A5 : variante 1 : méthode 00. Sur un échec, un numéro de dix chiffres qui
  // commence par 9 est faux ; tout autre passe à la variante 2 : méthode 10.
  A5: (a, blz): DeOutcome => {
    if (passes('00', a, blz)) return 'pass';
    if (digitAt(a, 1) === 9) return 'fail';
    return verdict(passes('10', a, blz));
  },

  // A6 : si la position 2 vaut 8, méthode 00 ; sinon méthode 01.
  A6: (a, blz) => (digitAt(a, 2) === 8 ? M['00'](a, blz) : M['01'](a, blz)),

  // A7 : variante 1 : méthode 00 ; sur un échec, variante 2 : méthode 03.
  A7: (a, blz) => verdict(passes('00', a, blz) || passes('03', a, blz)),

  // A8 : si la position 3 vaut 9 (comptes généraux), l'exception de la méthode
  // 51. Sinon variante 1 : positions 4 à 9, poids 2 à 7, comme 06 ; sur un
  // échec, variante 2 : les mêmes positions, poids 2, 1, 2, 1, 2, 1 de droite
  // à gauche, comme 00.
  A8: (a) => {
    if (digitAt(a, 3) === 9) return verdict(method51Sachkonto(a));
    return verdict(mod11At(a, 4, 9, W_2_TO_7, 10) || mod10CrossAt(a, 4, 9, W_2_1, 10));
  },
});

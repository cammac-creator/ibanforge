import {
  type DeMethod,
  W_2_1,
  W_2_TO_7,
  W_POW2_MOD11,
  digitAt,
  keyAt,
  ltr,
  mod10CrossAt,
  mod10Key,
  mod11At,
  rtl,
  verdict,
  weighted,
  weightedCross,
} from './kernel.js';
import { DE_METHODS_00_39 } from './methods-00-39.js';

/**
 * Allemagne : les méthodes 40 à 79 de la Bundesbank que la Bankleitzahlendatei
 * utilise aujourd'hui.
 *
 * Écrites d'après « Prüfzifferberechnungsmethoden » (Stand: Juni 2018), pages
 * 12 à 35 ; chaque entrée cite ce que dit la spécification, et seulement cela.
 * Les méthodes de cette plage qu'aucune banque n'utilise (45, 51 à 55, 58, 62,
 * 66, 69, 70, 72, 73, 75, 77, 79) ne sont pas écrites : une banque qui en
 * adopterait une passerait d'elle-même à `not_checked`.
 *
 * Une méthode écrite ici n'est pas pour autant servie : seules celles de
 * `DE_VERIFIED_METHODS` (verified.ts), qui passent tous les numéros de test
 * publiés par la Bundesbank, donnent un verdict.
 */

/** La méthode 00, à laquelle plusieurs méthodes de cette plage renvoient. */
const method00 = (a: string): boolean => mod10CrossAt(a, 1, 9, W_2_1, 10);

/** Le numéro décalé de `n` positions vers la gauche, complété à droite par des zéros. */
function shiftLeft(account: string, n: number): string {
  return account.slice(n) + '0'.repeat(n);
}

/**
 * Méthodes 61 et 65 : la clé des positions 1 à 7 (poids 2, 1, 2… de gauche à
 * droite, comme 00) en position 8 ; quand la position 9 porte le chiffre
 * `typeDigit`, les positions 9 et 10 entrent aussi dans le calcul, avec les
 * poids 1 et 2.
 */
function key8WithType(account: string, typeDigit: number): boolean {
  const digits = ltr(account, 1, 7);
  const weights = [2, 1, 2, 1, 2, 1, 2];
  if (digitAt(account, 9) === typeDigit) {
    digits.push(digitAt(account, 9), digitAt(account, 10));
    weights.push(1, 2);
  }
  return keyAt(account, 8, mod10Key(weightedCross(digits, weights)));
}

/**
 * Méthode 57 : les préfixes (deux premiers chiffres) de chaque variante, tels
 * que la spécification les énumère.
 */
const M57_V1 = new Set([
  51, 55, 61, 64, 65, 66, 70, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 88, 94, 95,
]);
const M57_V3 = new Set([40, 50, 91, 99]);

export const DE_METHODS_40_79: Readonly<Record<string, DeMethod>> = Object.freeze<
  Record<string, DeMethod>
>({
  // 40 : comme 06 sur les positions 1 à 9, poids 2, 4, 8, 5, 10, 9, 7, 3, 6.
  '40': (a) => verdict(mod11At(a, 1, 9, W_POW2_MOD11.slice(0, 9), 10)),

  // 41 : comme 00 ; quand la position 4 vaut 9, les positions 1 à 3 n'entrent
  // pas dans le calcul.
  '41': (a) => verdict(mod10CrossAt(a, digitAt(a, 4) === 9 ? 4 : 1, 9, W_2_1, 10)),

  // 42 : comme 06 sur les positions 2 à 9, poids 2 à 9.
  '42': (a) => verdict(mod11At(a, 2, 9, [2, 3, 4, 5, 6, 7, 8, 9], 10)),

  // 43 : poids 1 à 9 de droite à gauche sur les positions 1 à 9, produits
  // additionnés tels quels ; clé = 10 − (somme modulo 10), et 0 pour 10.
  '43': (a) => verdict(keyAt(a, 10, mod10Key(weighted(rtl(a, 1, 9), [1, 2, 3, 4, 5, 6, 7, 8, 9])))),

  // 44 : « wie bei Verfahren 33 » avec les poids 2, 4, 8, 5, 10 sur les
  // positions 5 à 9.
  '44': (a) => verdict(mod11At(a, 5, 9, W_POW2_MOD11.slice(0, 5), 10)),

  // 46 : comme 06 sur les positions 3 à 7, poids 2 à 6 ; clé en position 8.
  '46': (a) => verdict(mod11At(a, 3, 7, [2, 3, 4, 5, 6], 8)),

  // 47 : comme 06 sur les positions 4 à 8, poids 2 à 6 ; clé en position 9.
  '47': (a) => verdict(mod11At(a, 4, 8, [2, 3, 4, 5, 6], 9)),

  // 48 : comme 06 sur les positions 3 à 8, poids 2 à 7 ; clé en position 9.
  '48': (a) => verdict(mod11At(a, 3, 8, W_2_TO_7, 9)),

  // 49 : variante 1 : la méthode 00 ; en cas d'échec, variante 2 : la méthode 01.
  '49': (a, b) => (method00(a) ? 'pass' : verdict(DE_METHODS_00_39['01'](a, b) === 'pass')),

  // 50 : comme 06 sur le numéro de base des positions 1 à 6 (poids 7 à 2 de
  // gauche à droite), clé en position 7 ; le sous-numéro (8 à 10) reste hors
  // calcul. Quand le sous-numéro « 000 » a été omis, la spécification recommande
  // un second calcul sur le numéro décalé de trois positions vers la gauche,
  // « 000 » ajouté en 8 à 10. Lu ici sans perdre de chiffre : un numéro de sept
  // chiffres significatifs ou moins est décalé de trois positions ; un numéro
  // de huit chiffres finissant par 0, de deux (sous-numéro écrit « 0 ») ; un
  // numéro de neuf chiffres finissant par 00, d'une (sous-numéro écrit « 00 »).
  // Cette lecture accepte plus que le décalage littéral de trois positions,
  // jamais moins : elle ne peut pas créer de faux « fail ».
  '50': (a) => {
    if (mod11At(a, 1, 6, W_2_TO_7, 7)) return 'pass';
    const significant = a.replace(/^0+/, '').length;
    let shift = 0;
    if (significant <= 7) shift = 3;
    else if (significant === 8 && a.endsWith('0')) shift = 2;
    else if (significant === 9 && a.endsWith('00')) shift = 1;
    return verdict(shift > 0 && mod11At(shiftLeft(a, shift), 1, 6, W_2_TO_7, 7));
  },

  // 56 : poids 2 à 7 puis 2, 3, 4 sur les positions 1 à 9, clé = 11 − reste ;
  // un résultat de 10 ou 11 rend le numéro faux, sauf pour un numéro à dix
  // chiffres commençant par 9 : 10 donne alors la clé 7, et 11 la clé 8.
  '56': (a) => {
    const result = 11 - (weighted(rtl(a, 1, 9), [2, 3, 4, 5, 6, 7, 2, 3, 4]) % 11);
    if (result < 10) return verdict(digitAt(a, 10) === result);
    if (digitAt(a, 1) !== 9) return 'fail';
    return verdict(digitAt(a, 10) === (result === 10 ? 7 : 8));
  },

  // 57 : la variante dépend des deux premiers chiffres ; une variante qui
  // échoue rend le numéro faux. Un numéro qui commence par 00 est toujours faux.
  // - Variante 1 (51, 55, 61, 64 à 66, 70, 73 à 82, 88, 94, 95) : poids 1, 2…
  //   de GAUCHE à droite sur les positions 1 à 9, comme 00, clé en 10 ; les
  //   numéros commençant par 777777 ou 888888 sont « immer als richtig
  //   (= Methode 09) ».
  // - Variante 2 (tous les autres préfixes de 32 à 98) : poids 1, 2… de gauche
  //   à droite sur les positions 1, 2, 4 à 10, clé en position 3.
  // - Variante 3 (40, 50, 91, 99) : méthode 09, pas de clé.
  // - Variante 4 (01 à 31) : pas de clé, mais une forme imposée : les
  //   positions 3 et 4 valent de 01 à 12 et les positions 7 à 9 moins de 500 ;
  //   hors de cette forme, le numéro est faux. Dans la forme, il n'y a pas de
  //   clé à recalculer : `no_check`. Le numéro 0185125434, hors forme, est
  //   « als richtig zu bewerten » : `no_check` aussi.
  '57': (a) => {
    const prefix = Number(a.slice(0, 2));
    if (prefix === 0) return 'fail';
    if (M57_V3.has(prefix)) return 'no_check';
    if (prefix <= 31) {
      if (a === '0185125434') return 'no_check';
      const month = Number(a.slice(2, 4));
      return month >= 1 && month <= 12 && Number(a.slice(6, 9)) < 500 ? 'no_check' : 'fail';
    }
    if (M57_V1.has(prefix)) {
      if (a.startsWith('777777') || a.startsWith('888888')) return 'no_check';
      return verdict(keyAt(a, 10, mod10Key(weightedCross(ltr(a, 1, 9), [1, 2]))));
    }
    const digits = [...ltr(a, 1, 2), ...ltr(a, 4, 10)];
    return verdict(keyAt(a, 3, mod10Key(weightedCross(digits, [1, 2]))));
  },

  // 59 : comme 00 ; un numéro de moins de neuf chiffres n'entre pas dans le
  // calcul et « als richtig behandelt » : pas de clé.
  '59': (a) => (a.startsWith('00') ? 'no_check' : verdict(method00(a))),

  // 60 : comme 00 sur le numéro de base des positions 3 à 9, clé en 10 ; le
  // sous-compte (positions 1 et 2) reste hors calcul.
  '60': (a) => verdict(mod10CrossAt(a, 3, 9, W_2_1, 10)),

  // 61 : BBBSSSSPAU : clé des positions 1 à 7 en position 8 ; quand le chiffre
  // de type (position 9) vaut 8, les positions 9 et 10 entrent dans le calcul.
  '61': (a) => verdict(key8WithType(a, 8)),

  // 63 : numéro de base des positions 2 à 7, clé en position 8, comme 00 ; la
  // position 1 doit être 0, sinon le numéro est faux. Quand le sous-compte
  // « 00 » a été omis et le numéro complété par des zéros à gauche (positions 1
  // à 3 nulles, clé en 10), le calcul se fait sur le numéro décalé de deux
  // positions vers la gauche.
  '63': (a) => {
    if (digitAt(a, 1) !== 0) return 'fail';
    if (mod10CrossAt(a, 2, 7, W_2_1, 8)) return 'pass';
    return verdict(a.startsWith('000') && mod10CrossAt(shiftLeft(a, 2), 2, 7, W_2_1, 8));
  },

  // 64 : positions 1 à 6, poids 9, 10, 5, 8, 4, 2 de gauche à droite, puis
  // comme 06 ; clé en position 7.
  '64': (a) => verdict(mod11At(a, 1, 6, W_POW2_MOD11.slice(0, 6), 7)),

  // 65 : GGGSSSSPKU : comme 61, avec le chiffre de type 9.
  '65': (a) => verdict(key8WithType(a, 9)),

  // 67 : comme 00 sur les positions 1 à 7, clé en 8 ; sous-compte en 9 et 10.
  '67': (a) => verdict(mod10CrossAt(a, 1, 7, W_2_1, 8)),

  // 68 : numérotation des positions DE DROITE dans le texte ; traduite ici.
  // - Dix chiffres : le calcul de 00 porte sur les positions 4 à 9 (2e à 7e
  //   depuis la droite), et la position 4 doit valoir 9.
  // - Neuf chiffres de 400 000 000 à 499 999 999 : pas de clé.
  // - Six à neuf chiffres : variante 1, la méthode 00 entière ; en cas
  //   d'échec, variante 2, la même sans les positions 3 et 4 (7e et 8e depuis
  //   la droite).
  '68': (a) => {
    if (digitAt(a, 1) !== 0) {
      return verdict(digitAt(a, 4) === 9 && mod10CrossAt(a, 4, 9, W_2_1, 10));
    }
    if (digitAt(a, 2) === 4) return 'no_check';
    if (method00(a)) return 'pass';
    return verdict(method00(a.slice(0, 2) + '00' + a.slice(4)));
  },

  // 71 : positions 2 à 7, poids 6 à 1 de gauche à droite ; clé = 11 − reste ;
  // un reste nul donne 0, un reste de 1 donne 10, dont la dizaine (1) est la clé.
  '71': (a) => {
    const r = weighted(ltr(a, 2, 7), [6, 5, 4, 3, 2, 1]) % 11;
    return verdict(digitAt(a, 10) === (r === 0 ? 0 : r === 1 ? 1 : 11 - r));
  },

  // 74 : variante 1 : comme 00 ; pour un numéro de six chiffres qui échoue, un
  // second calcul porte la somme à la demi-dizaine suivante (un nombre qui
  // finit par 5), et l'écart est la clé : somme 21, demi-dizaine 25, clé 4
  // (l'exemple de la page 30). Une somme qui finit déjà par 5 donne l'écart 0.
  // En cas d'échec, variante 2 : la méthode 04, pour tous les numéros, ceux de
  // six chiffres compris (242241, numéro de test officiel de la variante 2).
  '74': (a, b) => {
    if (method00(a)) return 'pass';
    if (a.startsWith('0000') && digitAt(a, 5) !== 0) {
      const sum = weightedCross(rtl(a, 1, 9), W_2_1);
      if (digitAt(a, 10) === (15 - (sum % 10)) % 10) return 'pass';
    }
    return verdict(DE_METHODS_00_39['04'](a, b) === 'pass');
  },

  // 76 : A S S S S S S P U U : la clé est le reste modulo 11 du numéro de base
  // des positions 2 à 7 (poids 2, 3, 4… de droite à gauche), en position 8 ; le
  // type de compte (position 1) et le sous-compte (9 et 10) restent hors
  // calcul. Quand le sous-compte « 00 » a été omis (clé en 10), le calcul se
  // fait sur le numéro décalé de deux positions vers la gauche.
  // Deux lectures prudentes, qui ne peuvent pas créer de faux « fail » :
  // - un reste de 10 « kann die Kontonummer nicht geprüft werden » (et non
  //   « ist falsch » ou « nicht verwendbar », les mots des autres méthodes) :
  //   `no_check`, si aucune lecture ne donne `pass` ;
  // - le type de compte « kann den Wert 0, 4, 6, 7, 8 oder 9 haben » : la phrase
  //   décrit les numéros, elle n'est pas présentée comme un contrôle, et n'est
  //   pas imposée ici.
  '76': (a) => {
    const layouts = a.startsWith('00') ? [a, shiftLeft(a, 2)] : [a];
    let uncheckable = false;
    for (const n of layouts) {
      const r = weighted(rtl(n, 2, 7), [2, 3, 4, 5, 6, 7]) % 11;
      if (r === 10) uncheckable = true;
      else if (digitAt(n, 8) === r) return 'pass';
    }
    return uncheckable ? 'no_check' : 'fail';
  },

  // 78 : comme 00 ; un numéro de huit chiffres ne porte pas de clé.
  '78': (a) => (a.startsWith('00') && digitAt(a, 3) !== 0 ? 'no_check' : verdict(method00(a))),
});

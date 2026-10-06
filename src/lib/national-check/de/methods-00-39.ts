import {
  type DeMethod,
  W_2_1,
  W_2_TO_10,
  W_2_TO_7,
  W_POW2_MOD11,
  crossSum,
  digitAt,
  keyAt,
  ltr,
  mod10CrossAt,
  mod10Key,
  mod11At,
  mod11Key,
  mod11KeyStrict,
  rtl,
  verdict,
  weighted,
  weightedCross,
} from './kernel.js';

/**
 * Allemagne : les méthodes 00 à 39 de la Bundesbank.
 *
 * Écrites d'après « Prüfzifferberechnungsmethoden » (Stand: Juni 2018), pages
 * 1 à 12 ; chaque entrée cite ce que dit la spécification, et seulement cela.
 * Ce sont les méthodes de base : les méthodes suivantes y renvoient souvent
 * (« Die Berechnung erfolgt wie bei Verfahren 06 »).
 *
 * Une méthode écrite ici n'est pas pour autant servie : seules celles de
 * `DE_VERIFIED_METHODS` (verified.ts), qui passent tous les numéros de test
 * publiés par la Bundesbank, donnent un verdict.
 */

/** Le numéro de compte lu comme un nombre (dix chiffres au plus : exact en double). */
function asNumber(account: string): number {
  return Number(account);
}

/** Modulus 10 sans somme des chiffres (« wie bei Verfahren 01 ») sur les positions 1 à 9. */
function mod10Plain(account: string, weights: readonly number[]): boolean {
  return keyAt(account, 10, mod10Key(weighted(rtl(account, 1, 9), weights)));
}

/** Modulus 11 strict (« wie bei Verfahren 02 ») sur les positions 1 à 9. */
function mod11Strict(account: string, weights: readonly number[]): boolean {
  return keyAt(account, 10, mod11KeyStrict(weighted(rtl(account, 1, 9), weights)));
}

/**
 * La transformation itérée M10H (méthodes 27 et 29) : chaque chiffre des
 * positions 1 à 9 est remplacé par sa valeur dans la ligne de la table que lui
 * donne son rang depuis la droite (1, 2, 3, 4, 1, 2…), puis modulus 10.
 */
const M10H_ROWS = [
  [0, 1, 5, 9, 3, 7, 4, 8, 2, 6],
  [0, 1, 7, 6, 9, 8, 3, 2, 5, 4],
  [0, 1, 8, 4, 6, 2, 9, 5, 7, 3],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
] as const;

function m10hKey(account: string): number {
  let sum = 0;
  rtl(account, 1, 9).forEach((d, i) => (sum += M10H_ROWS[i % 4][d]));
  return mod10Key(sum);
}

/** Décale le numéro de deux positions vers la gauche et complète par « 00 ». */
function shiftLeftTwo(account: string): string {
  return account.slice(2) + '00';
}

/**
 * Méthode 13 (et 63 plus loin) : la clé du numéro de base (positions 2 à 7) en
 * position 8, comme la méthode 00 ; le sous-compte (positions 9 et 10) n'entre
 * pas dans le calcul.
 */
function base6Key8(account: string): boolean {
  return mod10CrossAt(account, 2, 7, W_2_1, 8);
}

export const DE_METHODS_00_39: Readonly<Record<string, DeMethod>> = Object.freeze<
  Record<string, DeMethod>
>({
  // 00 : Modulus 10, poids 2, 1, 2… de droite à gauche, somme des chiffres des
  // produits ; clé en position 10.
  '00': (a) => verdict(mod10CrossAt(a, 1, 9, W_2_1, 10)),

  // 01 : Modulus 10, poids 3, 7, 1… ; produits additionnés tels quels.
  '01': (a) => verdict(mod10Plain(a, [3, 7, 1])),

  // 02 : Modulus 11, poids 2 à 9 puis 2 ; un reste de 1 rend le numéro
  // inutilisable (« Die Kontonummer ist dann nicht verwendbar »).
  '02': (a) => verdict(mod11Strict(a, [2, 3, 4, 5, 6, 7, 8, 9, 2])),

  // 03 : Modulus 10, poids 2, 1… « wie bei Verfahren 01 » : sans somme des
  // chiffres des produits, à la différence de 00.
  '03': (a) => verdict(mod10Plain(a, W_2_1)),

  // 04 : Modulus 11, poids 2 à 7 puis 2, 3, 4, « wie bei Verfahren 02 ».
  '04': (a) => verdict(mod11Strict(a, [2, 3, 4, 5, 6, 7, 2, 3, 4])),

  // 05 : Modulus 10, poids 7, 3, 1… « wie bei Verfahren 01 ».
  '05': (a) => verdict(mod10Plain(a, [7, 3, 1])),

  // 06 : Modulus 11, poids 2 à 7 répétés ; reste 0 ou 1 : clé 0.
  '06': (a) => verdict(mod11At(a, 1, 9, W_2_TO_7, 10)),

  // 07 : Modulus 11, poids 2 à 10, « wie bei Verfahren 02 ».
  '07': (a) => verdict(mod11Strict(a, W_2_TO_10)),

  // 08 : comme 00, « jedoch erst ab der Kontonummer 60 000 » : en dessous, la
  // méthode ne définit pas de clé.
  '08': (a) => (asNumber(a) < 60000 ? 'no_check' : verdict(mod10CrossAt(a, 1, 9, W_2_1, 10))),

  // 09 : « Keine Prüfzifferberechnung ».
  '09': () => 'no_check',

  // 10 : Modulus 11, poids 2 à 10, « wie bei Verfahren 06 ».
  '10': (a) => verdict(mod11At(a, 1, 9, W_2_TO_10, 10)),

  // 11 : comme 10, mais un résultat de 10 (reste 1) donne la clé 9 au lieu de 0.
  '11': (a) => {
    const r = weighted(rtl(a, 1, 9), W_2_TO_10) % 11;
    return verdict(digitAt(a, 10) === (r === 0 ? 0 : r === 1 ? 9 : 11 - r));
  },

  // 13 : comme 00 sur le numéro de base des positions 2 à 7, clé en 8 ; le
  // sous-compte (9 et 10) reste hors calcul. Quand le sous-compte « 00 » a été
  // omis, la spécification recommande un second calcul sur le numéro décalé de
  // deux positions vers la gauche, « 00 » ajouté en 9 et 10. Ce décalage n'a
  // de sens que si les positions 1 et 2 sont nulles : sinon il perdrait des
  // chiffres du numéro.
  '13': (a) => verdict(base6Key8(a) || (a.startsWith('00') && base6Key8(shiftLeftTwo(a)))),

  // 14 : comme 02 (strict) sur les positions 4 à 9, poids 2 à 7 ; les
  // positions 2 et 3 portent le type de compte, hors calcul.
  '14': (a) => verdict(keyAt(a, 10, mod11KeyStrict(weighted(rtl(a, 4, 9), W_2_TO_7)))),

  // 15 : comme 06 sur les seules positions 6 à 9, poids 2, 3, 4, 5.
  '15': (a) => verdict(mod11At(a, 6, 9, [2, 3, 4, 5], 10)),

  // 16 : comme 06 (poids 2 à 7 puis 2, 3, 4) ; sur un reste de 1, le numéro est
  // juste « unabhängig vom eigentlichen Berechnungsergebnis » si les positions
  // 9 et 10 sont identiques, et faux sinon : c'est la lecture que la méthode 23,
  // qui renvoie à celle-ci, écrit en toutes lettres dans son tableau.
  '16': (a) => {
    const r = weighted(rtl(a, 1, 9), [2, 3, 4, 5, 6, 7, 2, 3, 4]) % 11;
    if (r === 1) return verdict(digitAt(a, 9) === digitAt(a, 10));
    return verdict(digitAt(a, 10) === mod11Key(r));
  },

  // 17 : numéro KSSSSSSPUU : les six chiffres S (positions 2 à 7), poids 1, 2…
  // de gauche à droite, somme des chiffres des produits ; on retire 1 de la
  // somme, puis clé = 10 − (reste modulo 11), et 0 quand le reste est nul.
  '17': (a) => {
    // Six chiffres nuls donnent −1 : le reste se prend positif.
    const r = (((weightedCross(ltr(a, 2, 7), [1, 2]) - 1) % 11) + 11) % 11;
    return verdict(digitAt(a, 8) === (r === 0 ? 0 : (10 - r) % 10));
  },

  // 18 : Modulus 10, poids 3, 9, 7, 1… « wie bei Verfahren 01 ».
  '18': (a) => verdict(mod10Plain(a, [3, 9, 7, 1])),

  // 19 : Modulus 11, poids 2 à 9 puis 1, « entsprechen dem Verfahren 06 ».
  '19': (a) => verdict(mod11At(a, 1, 9, [2, 3, 4, 5, 6, 7, 8, 9, 1], 10)),

  // 20 : Modulus 11, poids 2 à 9 puis 3, « entsprechen dem Verfahren 06 ».
  '20': (a) => verdict(mod11At(a, 1, 9, [2, 3, 4, 5, 6, 7, 8, 9, 3], 10)),

  // 21 : comme 00, puis la somme est réduite par sommes de chiffres répétées
  // jusqu'à un seul chiffre ; la clé est 10 moins ce chiffre.
  '21': (a) => {
    let v = weightedCross(rtl(a, 1, 9), W_2_1);
    while (v > 9) v = crossSum(v);
    return verdict(digitAt(a, 10) === (10 - v) % 10);
  },

  // 22 : poids 3, 1… ; seule l'unité de chaque produit est gardée ; la clé est
  // l'écart jusqu'à la dizaine suivante.
  '22': (a) => {
    const sum = rtl(a, 1, 9).reduce((s, d, i) => s + ((d * (i % 2 === 0 ? 3 : 1)) % 10), 0);
    return verdict(digitAt(a, 10) === mod10Key(sum));
  },

  // 23 : comme 16 sur les six premiers chiffres (poids 7 à 2 de gauche à
  // droite), clé en position 7 ; reste 1 : les positions 6 et 7 doivent être
  // identiques ; positions 8 à 10 non contrôlées.
  '23': (a) => {
    const r = weighted(rtl(a, 1, 6), W_2_TO_7) % 11;
    if (r === 1) return verdict(digitAt(a, 6) === digitAt(a, 7));
    return verdict(digitAt(a, 7) === (r === 0 ? 0 : 11 - r));
  },

  // 24 : positions 1 à 9, à partir du premier chiffre non nul, poids 1, 2, 3…
  // de gauche à droite ; à chaque produit s'ajoute son poids, puis le reste
  // modulo 11 ; la clé est l'unité de la somme des restes. Un 3, 4, 5 ou 6 en
  // position 1 compte pour 0 ; un 9 en position 1 annule aussi les positions
  // 2 et 3.
  '24': (a) => {
    const d = ltr(a, 1, 9);
    if (d[0] >= 3 && d[0] <= 6) d[0] = 0;
    if (d[0] === 9) d[0] = d[1] = d[2] = 0;
    const start = d.findIndex((x) => x !== 0);
    let sum = 0;
    if (start >= 0) {
      d.slice(start).forEach((x, i) => {
        const w = [1, 2, 3][i % 3];
        sum += (x * w + w) % 11;
      });
    }
    return verdict(digitAt(a, 10) === sum % 10);
  },

  // 25 : positions 2 à 9, poids 2 à 9 de droite à gauche ; clé 11 − reste,
  // 0 sur un reste nul ; sur un reste de 1 la clé est 0, réservée aux chiffres
  // de travail (position 2) 8 et 9 : le numéro est inutilisable pour les autres.
  '25': (a) => {
    const r = weighted(rtl(a, 2, 9), [2, 3, 4, 5, 6, 7, 8, 9]) % 11;
    if (r === 1) return verdict(digitAt(a, 10) === 0 && digitAt(a, 2) >= 8);
    return verdict(digitAt(a, 10) === (r === 0 ? 0 : 11 - r));
  },

  // 26 : quand les positions 1 et 2 sont nulles, le numéro est décalé de deux
  // positions vers la gauche (« 00 » en 9 et 10) ; puis comme 06 sur les
  // positions 1 à 7, poids 2 à 7 puis 2, clé en position 8.
  '26': (a) => {
    const n = a.startsWith('00') ? shiftLeftTwo(a) : a;
    return verdict(mod11At(n, 1, 7, W_2_TO_7, 8));
  },

  // 27 : comme 00 pour les numéros 1 à 999 999 999 ; à partir de 1 000 000 000,
  // la transformation itérée M10H (voir 29).
  '27': (a) =>
    digitAt(a, 1) === 0
      ? verdict(mod10CrossAt(a, 1, 9, W_2_1, 10))
      : verdict(digitAt(a, 10) === m10hKey(a)),

  // 28 : positions 1 à 7, poids 2 à 8 de droite à gauche, comme 06 ; clé en
  // position 8, sous-compte en 9 et 10.
  '28': (a) => verdict(mod11At(a, 1, 7, [2, 3, 4, 5, 6, 7, 8], 8)),

  // 29 : la transformation itérée M10H sur les positions 1 à 9.
  '29': (a) => verdict(digitAt(a, 10) === m10hKey(a)),

  // 30 : poids 2, 0, 0, 0, 0, 1, 2, 1, 2 de GAUCHE à droite sur les positions
  // 1 à 9, produits additionnés tels quels, puis comme 00.
  '30': (a) =>
    verdict(digitAt(a, 10) === mod10Key(weighted(ltr(a, 1, 9), [2, 0, 0, 0, 0, 1, 2, 1, 2]))),

  // 31 : poids 9 à 1 de droite à gauche (position 1 : poids 1) ; la clé est le
  // reste modulo 11 ; un reste de 10 rend le numéro faux.
  '31': (a) => {
    const r = weighted(rtl(a, 1, 9), [9, 8, 7, 6, 5, 4, 3, 2, 1]) % 11;
    return verdict(r !== 10 && digitAt(a, 10) === r);
  },

  // 32 : comme 06 sur les positions 4 à 9, poids 2 à 7.
  '32': (a) => verdict(mod11At(a, 4, 9, W_2_TO_7, 10)),

  // 33 : comme 06 sur les positions 5 à 9, poids 2 à 6.
  '33': (a) => verdict(mod11At(a, 5, 9, [2, 3, 4, 5, 6], 10)),

  // 34 : la méthode 28 (positions 1 à 7, clé en 8) avec les poids 2, 4, 8, 5,
  // 10, 9, 7.
  '34': (a) => verdict(mod11At(a, 1, 7, W_POW2_MOD11.slice(0, 7), 8)),

  // 35 : poids 2 à 10 sur les positions 1 à 9 ; la clé est le reste modulo
  // 11 ; un reste de 10 rend le numéro juste si les positions 9 et 10 sont
  // identiques.
  '35': (a) => {
    const r = weighted(rtl(a, 1, 9), W_2_TO_10) % 11;
    return verdict(r === 10 ? digitAt(a, 9) === digitAt(a, 10) : digitAt(a, 10) === r);
  },

  // 36 : comme 06 sur les positions 6 à 9, poids 2, 4, 8, 5.
  '36': (a) => verdict(mod11At(a, 6, 9, W_POW2_MOD11.slice(0, 4), 10)),

  // 37 : comme 06 sur les positions 5 à 9, poids 2, 4, 8, 5, 10.
  '37': (a) => verdict(mod11At(a, 5, 9, W_POW2_MOD11.slice(0, 5), 10)),

  // 38 : comme 06 sur les positions 4 à 9, poids 2, 4, 8, 5, 10, 9.
  '38': (a) => verdict(mod11At(a, 4, 9, W_POW2_MOD11.slice(0, 6), 10)),

  // 39 : comme 06 sur les positions 3 à 9, poids 2, 4, 8, 5, 10, 9, 7.
  '39': (a) => verdict(mod11At(a, 3, 9, W_POW2_MOD11.slice(0, 7), 10)),
});

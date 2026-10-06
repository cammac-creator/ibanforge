import {
  type DeMethod,
  type DeOutcome,
  W_2_1,
  W_POW2_MOD11,
  digitAt,
  keyAt,
  ltr,
  mod10CrossAt,
  mod10Key,
  mod11KeyStrict,
  rtl,
  verdict,
  weighted,
  weightedCross,
} from './kernel.js';
import { DE_METHODS_00_39 } from './methods-00-39.js';

/**
 * Allemagne : les méthodes B0 à E4 de la Bundesbank que la Bankleitzahlendatei
 * attribue aujourd'hui (B1, B2, B3, B5, B6, B7, B8, C0, C1, C2, C3, C5, C7, C8,
 * C9, D0, D2, D6, D7, D8, E0, E3, E4).
 *
 * Écrites d'après « Prüfzifferberechnungsmethoden » (Stand: Juni 2018), pages
 * 62 à 88. Ces méthodes récentes sont presque toutes des assemblages : des
 * variantes qui renvoient à une méthode plus ancienne, choisies soit par la
 * forme du numéro (« Kontonummern, die an der 1. Stelle … den Wert 9
 * beinhalten »), soit l'une après l'autre (« Führt die Berechnung nach
 * Variante 1 zu einem Prüfzifferfehler, so ist nach Variante 2 zu prüfen »).
 *
 * Les méthodes de base 00 à 39 viennent de methods-00-39.ts. Celles des autres
 * plages auxquelles ces variantes renvoient (52, 53, 58, 63, 68, 75, 95) sont
 * écrites ici en fonctions privées, d'après leur propre page de la
 * spécification, et ne sont pas servies seules.
 *
 * Une méthode écrite ici n'est pas pour autant servie : verified.ts dit
 * lesquelles donnent un verdict, et sur quelle base (numéros officiels de la
 * Bundesbank, ou implémentation indépendante seulement).
 */

const M = DE_METHODS_00_39;

/**
 * Des variantes essayées l'une après l'autre : la première qui ne donne pas
 * `fail` décide (`pass`, ou `no_check` quand une variante déclare le numéro
 * sans clé) ; `fail` seulement si toutes échouent.
 */
function chain(account: string, blz: string, ...variants: readonly DeMethod[]): DeOutcome {
  for (const variant of variants) {
    const outcome = variant(account, blz);
    if (outcome !== 'fail') return outcome;
  }
  return 'fail';
}

/** Le numéro lu comme un nombre (dix chiffres au plus : exact en double). */
function asNumber(account: string): number {
  return Number(account);
}

/** Vrai quand le numéro est dans la plage [from, to], bornes comprises. */
function inRange(account: string, from: number, to: number): boolean {
  const n = asNumber(account);
  return n >= from && n <= to;
}

// ------------------------------------------------- méthodes d'autres plages

/**
 * 52 et 53 (pages 17 et 18) : le numéro du système ESER d'avant, reconstruit à
 * partir du code banque, puis pondéré de droite à gauche par 2, 4, 8, 5, 10,
 * 9, 7, 3, 6, 1, 2, 4 avec la clé mise à 0. Au reste de la division par 11
 * s'ajoute un multiple du poids qui tombe sur la clé ; la clé est le facteur
 * qui amène ce total au reste 10. Si aucun chiffre n'y parvient, le numéro est
 * inutilisable.
 *
 * `head` est la partie qui précède la clé (quatre chiffres tirés du code
 * banque, puis un chiffre du numéro), `tail` la suite du numéro, ses zéros de
 * tête retirés (« da evtl. vorlaufende Nullen eliminiert werden »).
 */
const W_ESER = [...W_POW2_MOD11, 2, 4] as const;

function eserKey(head: string, tail: string): number | null {
  const alt = head + '0' + tail;
  const digits: number[] = [];
  for (let i = alt.length - 1; i >= 0; i--) digits.push(alt.charCodeAt(i) - 48);
  const r = weighted(digits, W_ESER) % 11;
  const wKey = W_ESER[tail.length];
  for (let k = 0; k <= 9; k++) if ((r + k * wKey) % 11 === 10) return k;
  return null;
}

/**
 * 52 : numéro à huit chiffres XPXXXXXX (positions 3 à 10 du champ de dix,
 * clé en position 4), code banque XXX5XXXX ; numéro ESER : les quatre derniers
 * chiffres du code banque, X, P, puis les six derniers chiffres sans leurs
 * zéros de tête. Les numéros à dix chiffres commençant par 9 suivent la
 * méthode 20. N'est appelée que par C0, sur un numéro à huit chiffres.
 */
function m52(a: string, blz: string): DeOutcome {
  if (digitAt(a, 1) === 9) return M['20'](a, blz);
  const head = blz.slice(4, 8) + a[2];
  return verdict(keyAt(a, 4, eserKey(head, a.slice(4).replace(/^0+/, ''))));
}

/**
 * 53 : comme 52, pour un numéro à neuf chiffres XTPXXXXXX (positions 2 à 10,
 * clé en position 4) ; numéro ESER : les quatre derniers chiffres du code
 * banque dont le troisième est remplacé par T, X, P, puis les six derniers
 * chiffres sans leurs zéros de tête. Les numéros à dix chiffres commençant par
 * 9 suivent la méthode 20. N'est appelée que par B6.
 *
 * La méthode n'est définie que « für neunstellige Kontonummern ». B6 lui
 * envoie pourtant « alle anderen Kontonummern », les plus courts compris :
 * pour eux, la spécification ne dit rien, et un calcul mécanique donnerait un
 * verdict au hasard. Ils reçoivent `no_check`, la lecture qui ne peut pas
 * produire de faux « fail ». (L'implémentation indépendante consultée hors
 * ligne les déclare invalides ; nous ne l'écrivons pas sans texte.)
 */
function m53(a: string, blz: string): DeOutcome {
  if (digitAt(a, 1) === 9) return M['20'](a, blz);
  if (digitAt(a, 1) !== 0 || digitAt(a, 2) === 0) return 'no_check';
  const head = blz.slice(4, 6) + a[2] + blz[7] + a[1];
  return verdict(keyAt(a, 4, eserKey(head, a.slice(4).replace(/^0+/, ''))));
}

/**
 * 58 (page 20) : positions 5 à 9, poids 2 à 6 de droite à gauche, la suite
 * comme 02 : reste 0, clé 0 ; reste 1, numéro faux.
 */
function m58(a: string): DeOutcome {
  return verdict(keyAt(a, 10, mod11KeyStrict(weighted(rtl(a, 5, 9), [2, 3, 4, 5, 6]))));
}

/**
 * 63 (page 23) : position 1 nulle, sinon faux ; le numéro de base des
 * positions 2 à 7 comme 00, clé en position 8, sous-compte en 9 et 10. Quand
 * le sous-compte « 00 » est omis et le numéro complété par des zéros à gauche
 * (positions 1 à 3 nulles), la clé est en position 10 : c'est le même calcul
 * sur le numéro décalé de deux positions vers la gauche.
 */
function m63Plain(a: string): boolean {
  return digitAt(a, 1) === 0 && mod10CrossAt(a, 2, 7, W_2_1, 8);
}
function m63(a: string): DeOutcome {
  return verdict(m63Plain(a) || (a.startsWith('000') && m63Plain(a.slice(2) + '00')));
}

/**
 * 68 (pages 26 et 27) : à dix chiffres, les positions 4 à 9 comme 00 et la
 * position 4 doit être un 9 ; de six à neuf chiffres, d'abord comme 00 sur
 * tout le numéro (variante 1), puis sans les positions 3 et 4 (variante 2) ;
 * les numéros à neuf chiffres de 400 000 000 à 499 999 999 n'ont pas de clé.
 */
function m68(a: string): DeOutcome {
  if (digitAt(a, 1) !== 0) {
    return verdict(digitAt(a, 4) === 9 && mod10CrossAt(a, 4, 9, W_2_1, 10));
  }
  if (digitAt(a, 2) === 4) return 'no_check';
  if (mod10CrossAt(a, 1, 9, W_2_1, 10)) return 'pass';
  return verdict(keyAt(a, 10, mod10Key(weightedCross(rtl(a, 1, 9), [2, 1, 2, 1, 2, 0, 0, 1, 2]))));
}

/**
 * 95 (page 53) : comme 06 (poids 2 à 7 puis 2, 3, 4), sauf cinq plages de
 * numéros sans clé possible, « als richtig anzusehen ».
 */
const M95_NO_CHECK: ReadonlyArray<readonly [number, number]> = [
  [1, 1999999],
  [9000000, 25999999],
  [396000000, 499999999],
  [700000000, 799999999],
  [910000000, 989999999],
];
function m95(a: string, blz: string): DeOutcome {
  if (M95_NO_CHECK.some(([from, to]) => inRange(a, from, to))) return 'no_check';
  return M['06'](a, blz);
}

// ------------------------------------------------------------- B0 à E4

/** C1, variante 2 : KNNNNNNNNP, poids 1, 2, 1… de gauche à droite (page 69). */
function c1Variant2(a: string): DeOutcome {
  const r = (((weightedCross(ltr(a, 1, 9), [1, 2]) - 1) % 11) + 11) % 11;
  return verdict(digitAt(a, 10) === (r === 0 ? 0 : 10 - r));
}

/** C5, variante 1 : la méthode 75 sur les numéros à six ou à neuf chiffres. */
function c5Variant1(a: string): DeOutcome | null {
  // Six chiffres, position 5 de 1 à 8 : 0000100000 à 0000899999.
  if (inRange(a, 100000, 899999)) return verdict(mod10CrossAt(a, 5, 9, W_2_1, 10));
  // Neuf chiffres, position 2 de 1 à 8 : 0100000000 à 0899999999.
  if (inRange(a, 100000000, 899999999)) return verdict(mod10CrossAt(a, 2, 6, W_2_1, 7));
  return null;
}

export const DE_METHODS_B0_E4: Readonly<Record<string, DeMethod>> = Object.freeze<
  Record<string, DeMethod>
>({
  // B1 (page 62) : variante 1 : méthode 05 ; variante 2 : méthode 01 ;
  // variante 3 : méthode 00, chacune essayée après l'échec de la précédente.
  B1: (a, b) => chain(a, b, M['05'], M['01'], M['00']),

  // B2 (page 63) : position 1 de 0 à 7 : méthode 02 ; 8 ou 9 : méthode 00.
  B2: (a, b) => (digitAt(a, 1) <= 7 ? M['02'](a, b) : M['00'](a, b)),

  // B3 (page 63) : position 1 de 0 à 8 : méthode 32 ; 9 : méthode 06.
  B3: (a, b) => (digitAt(a, 1) <= 8 ? M['32'](a, b) : M['06'](a, b)),

  // B5 (pages 64 et 65) : variante 1 : poids de 05, calcul de 01 (c'est la
  // méthode 05). En échec, un numéro qui commence par 8 ou 9 est faux ; les
  // autres passent à la variante 2, la méthode 00.
  B5: (a, b) => {
    if (M['05'](a, b) === 'pass') return 'pass';
    if (digitAt(a, 1) >= 8) return 'fail';
    return M['00'](a, b);
  },

  // B6 (page 65) : position 1 de 1 à 9, ou positions 1 à 5 de 02691 à 02699 :
  // méthode 20 ; tous les autres : variante 2, méthode 53 (qui lit le code
  // banque).
  B6: (a, b) => {
    const first5 = asNumber(a.slice(0, 5));
    if (digitAt(a, 1) !== 0 || (first5 >= 2691 && first5 <= 2699)) return M['20'](a, b);
    return m53(a, b);
  },

  // B7 (page 65) : plages 0001000000 à 0005999999 et 0700000000 à 0899999999 :
  // méthode 01, un échec rend le numéro faux ; tous les autres : méthode 09,
  // pas de clé.
  B7: (a, b) =>
    inRange(a, 1000000, 5999999) || inRange(a, 700000000, 899999999) ? M['01'](a, b) : 'no_check',

  // B8 (page 66) : variante 1 : méthode 20 ; variante 2 : méthode 29 ;
  // variante 3, après deux échecs : pas de clé (méthode 09) pour les plages
  // 5100000000 à 5999999999 et 9010000000 à 9109999999 ; faux ailleurs.
  B8: (a, b) => {
    const outcome = chain(a, b, M['20'], M['29']);
    if (outcome !== 'fail') return outcome;
    return inRange(a, 5100000000, 5999999999) || inRange(a, 9010000000, 9109999999)
      ? 'no_check'
      : 'fail';
  },

  // C0 (page 68) : exactement deux zéros de tête : variante 1, méthode 52 (qui
  // lit le code banque), puis en échec variante 2, méthode 20 ; tous les
  // autres numéros : variante 2 seule.
  C0: (a, b) =>
    a.startsWith('00') && digitAt(a, 3) !== 0 ? chain(a, b, m52, M['20']) : M['20'](a, b),

  // C1 (pages 68 et 69) : position 1 différente de 5 : méthode 17, un échec
  // rend le numéro faux ; position 1 égale à 5 : variante 2, positions 1 à 9,
  // poids 1, 2, 1… de gauche à droite, somme des chiffres des produits, moins
  // 1 ; clé = 10 − (reste modulo 11), 0 sur un reste nul.
  C1: (a, b) => (digitAt(a, 1) !== 5 ? M['17'](a, b) : c1Variant2(a)),

  // C2 (page 70) : variante 1 : méthode 22 ; variante 2 : méthode 00 ;
  // variante 3 : méthode 04.
  C2: (a, b) => chain(a, b, M['22'], M['00'], M['04']),

  // C3 (page 71) : position 1 différente de 9 : méthode 00 ; égale à 9 :
  // méthode 58.
  C3: (a, b) => (digitAt(a, 1) !== 9 ? M['00'](a, b) : m58(a)),

  // C5 (pages 72 et 73) : la variante dépend de la plage du numéro ; un numéro
  // hors des plages listées, ou en échec dans sa variante, est faux.
  // Variante 1 (méthode 75) : six chiffres, position 5 de 1 à 8 (clé en 10) ;
  // neuf chiffres, position 2 de 1 à 8 (positions 2 à 6, clé en 7).
  // Variante 2 (méthode 29) : dix chiffres commençant par 1, 4, 5, 6 ou 9.
  // Variante 3 (méthode 00) : dix chiffres commençant par 3.
  // Variante 4 (méthode 09, pas de clé) : huit chiffres dont la position 3 vaut
  // 3, 4 ou 5 ; dix chiffres commençant par 70 ou 85.
  C5: (a, b) => {
    const v1 = c5Variant1(a);
    if (v1 !== null) return v1;
    const first = digitAt(a, 1);
    if ([1, 4, 5, 6, 9].includes(first)) return M['29'](a, b);
    if (first === 3) return M['00'](a, b);
    if (inRange(a, 30000000, 59999999)) return 'no_check';
    if (a.startsWith('70') || a.startsWith('85')) return 'no_check';
    return 'fail';
  },

  // C7 (page 74) : variante 1 : méthode 63 ; variante 2 : méthode 06.
  C7: (a, b) => chain(a, b, m63, M['06']),

  // C8 (page 75) : variante 1 : méthode 00 ; variante 2 : méthode 04 (un reste
  // de 1 compte comme un échec) ; variante 3 : méthode 07.
  C8: (a, b) => chain(a, b, M['00'], M['04'], M['07']),

  // C9 (page 76) : variante 1 : méthode 00 ; variante 2 : méthode 07.
  C9: (a, b) => chain(a, b, M['00'], M['07']),

  // D0 (page 76) : positions 1 et 2 différentes de 57 : méthode 20, un échec
  // rend le numéro faux ; 5700000000 à 5799999999 : méthode 09, pas de clé.
  D0: (a, b) => (a.startsWith('57') ? 'no_check' : M['20'](a, b)),

  // D2 (page 78) : variante 1 : méthode 95, exceptions comprises ; variante 2 :
  // méthode 00 ; variante 3 : méthode 68, exceptions comprises.
  D2: (a, b) => chain(a, b, m95, M['00'], m68),

  // D6 (page 82) : variante 1 : méthode 07 ; variante 2 : méthode 03 ;
  // variante 3 : méthode 00.
  D6: (a, b) => chain(a, b, M['07'], M['03'], M['00']),

  // D7 (page 83) : poids 2, 1… de droite à gauche sur les positions 1 à 9,
  // somme des chiffres des produits ; la clé est l'unité de la somme elle-même
  // (et non 10 moins cette unité).
  D7: (a) => verdict(digitAt(a, 10) === weightedCross(rtl(a, 1, 9), W_2_1) % 10),

  // D8 (page 84) : 1000000000 à 9999999999 : méthode 00 ; 0010000000 à
  // 0099999999 : méthode 09, pas de clé ; toute autre plage est fausse.
  D8: (a, b) => {
    if (digitAt(a, 1) !== 0) return M['00'](a, b);
    if (inRange(a, 10000000, 99999999)) return 'no_check';
    return 'fail';
  },

  // E0 (page 85) : comme 00, mais 7 s'ajoute à la somme avant de garder
  // l'unité.
  E0: (a) => verdict(keyAt(a, 10, mod10Key(weightedCross(rtl(a, 1, 9), W_2_1) + 7))),

  // E3 (page 88) : variante 1 : méthode 00 ; variante 2 : méthode 21.
  E3: (a, b) => chain(a, b, M['00'], M['21']),

  // E4 (page 88) : variante 1 : méthode 02 ; variante 2 : méthode 00.
  E4: (a, b) => chain(a, b, M['02'], M['00']),
});

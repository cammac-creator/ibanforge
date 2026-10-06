import type { DeVectors } from './vectors-types.js';

/**
 * Numéros de test officiels des méthodes 00 à 39, recopiés de
 * « Prüfzifferberechnungsmethoden » (Stand: Juni 2018). Aucun n'est calculé
 * par ce dépôt ni par une autre bibliothèque.
 *
 * Les méthodes de cette plage absentes d'ici (01 à 05, 07, 08, 11, 13 à 16,
 * 18, 20 à 23, 30) n'ont ni numéro de test ni exemple complet dans le
 * document. Celles qu'une banque utilise sont servies au second niveau,
 * vérifiées contre une implémentation indépendante seulement (verified.ts) ;
 * les autres (02, 04, 07, 14, 15, 23) ne servent que de briques.
 */
export const DE_VECTORS_00_39: DeVectors = {
  '00': [{ page: 1, kind: 'test_numbers', pass: ['9290701', '539290858', '1501824', '1501832'] }],
  '06': [{ page: 2, kind: 'test_numbers', pass: ['94012341', '5073321010'] }],
  '10': [{ page: 2, kind: 'test_numbers', pass: ['12345008', '87654008'] }],
  '17': [
    // L'exemple de calcul et le numéro de test sont le même numéro.
    { page: 3, kind: 'test_numbers', pass: ['0446786040'] },
  ],
  '19': [{ page: 4, kind: 'test_numbers', pass: ['0240334000', '0200520016'] }],
  '24': [
    // Les quatre exemples de calcul : 138301 (sans exception), 1306118605,
    // 3307118608 (un 3 en position 1 compte pour 0) et 9307118603 (un 9 en
    // position 1 annule aussi les positions 2 et 3).
    { page: 5, kind: 'worked_example', pass: ['138301', '1306118605'] },
    { page: 6, kind: 'worked_example', pass: ['3307118608', '9307118603'] },
  ],
  '25': [
    // « Kontonr.: 5 2 1 3 8 2 1 8 P », P = 1, la position 1 restant vide.
    { page: 6, kind: 'worked_example', pass: ['521382181'] },
  ],
  '26': [{ page: 7, kind: 'test_numbers', pass: ['0520309001', '1111118111', '0005501024'] }],
  '27': [
    // L'exemple de la transformation itérée M10H : 284716948, clé 8.
    { page: 7, kind: 'worked_example', pass: ['2847169488'] },
  ],
  '28': [{ page: 8, kind: 'test_numbers', pass: ['19999000', '9130000201'] }],
  '29': [
    // 314586302, clé 9.
    { page: 8, kind: 'worked_example', pass: ['3145863029'] },
  ],
  '31': [
    { page: 9, kind: 'worked_example', pass: ['0263160165'] },
    { page: 9, kind: 'test_numbers', pass: ['1000000524', '1000000583'] },
  ],
  '32': [
    {
      page: 9,
      kind: 'test_numbers',
      pass: ['9141405', '1709107983', '0122116979', '0121114867', '9030101192', '9245500460'],
    },
  ],
  '33': [{ page: 10, kind: 'test_numbers', pass: ['48658', '84956'] }],
  '34': [{ page: 10, kind: 'test_numbers', pass: ['9913000700', '9914001000'] }],
  '35': [
    // Exemple 1 : reste 3, clé 3. Exemple 2 : reste 10, positions 9 et 10
    // identiques, donc juste. Les deux figurent aussi parmi les numéros de test.
    { page: 10, kind: 'worked_example', pass: ['0000108443', '0000101599'] },
    {
      page: 10,
      kind: 'test_numbers',
      pass: ['0000108443', '0000107451', '0000102921', '0000102349', '0000101709', '0000101599'],
    },
  ],
  '36': [{ page: 11, kind: 'test_numbers', pass: ['113178', '146666'] }],
  '37': [{ page: 11, kind: 'test_numbers', pass: ['624315', '632500'] }],
  '38': [{ page: 11, kind: 'test_numbers', pass: ['191919', '1100660'] }],
  '39': [{ page: 11, kind: 'test_numbers', pass: ['200205', '10019400'] }],
};

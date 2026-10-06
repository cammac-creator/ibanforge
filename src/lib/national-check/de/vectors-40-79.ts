import type { DeVectors } from './vectors-types.js';

/**
 * Numéros de test officiels des méthodes 40 à 79 utilisées aujourd'hui,
 * recopiés de « Prüfzifferberechnungsmethoden » (Stand: Juni 2018). Aucun
 * n'est calculé par ce dépôt ni par une autre bibliothèque.
 *
 * Les méthodes utilisées de cette plage absentes d'ici (48, 49, 59, 60, 67)
 * n'ont ni numéro de test ni exemple complet dans le document : elles sont
 * servies au second niveau, vérifiées contre une implémentation indépendante
 * seulement (verified.ts).
 */
export const DE_VECTORS_40_79: DeVectors = {
  '40': [{ page: 12, kind: 'test_numbers', pass: ['1258345', '3231963'] }],
  '41': [
    // L'exemple : un 9 en position 4 écarte les positions 1 à 3.
    { page: 12, kind: 'worked_example', pass: ['4019110008'] },
    {
      page: 12,
      kind: 'test_numbers',
      pass: ['4013410024', '4016660195', '0166805317', '4019310079', '4019340829', '4019151002'],
    },
  ],
  '42': [{ page: 12, kind: 'test_numbers', pass: ['59498', '59510'] }],
  '43': [{ page: 13, kind: 'test_numbers', pass: ['6135244', '9516893476'] }],
  '44': [{ page: 13, kind: 'test_numbers', pass: ['889006', '2618040504'] }],
  '46': [{ page: 13, kind: 'test_numbers', pass: ['0235468612', '0837890901', '1041447600'] }],
  '47': [{ page: 14, kind: 'test_numbers', pass: ['1018000', '1003554450'] }],
  '50': [{ page: 14, kind: 'test_numbers', pass: ['4000005001', '4444442001'] }],
  '56': [
    // Exemple 1 : 029054500, clé 5. Exemple 2 : 971830403, résultat 10 sur un
    // numéro de dix chiffres commençant par 9, clé 7.
    { page: 19, kind: 'worked_example', pass: ['0290545005', '9718304037'] },
  ],
  '57': [
    {
      page: 20,
      kind: 'test_numbers',
      pass: [
        '7500021766',
        '9400001734',
        '7800028282',
        '8100244186',
        '3251080371',
        '3891234567',
        '9322111030',
        '7400060823',
      ],
      // Imprimés parmi les « richtig », mais sans clé à recalculer : 7777778800
      // (préfixe 777777, « = Methode 09 »), 5001050352 et 5045090090 (préfixe
      // 50, variante 3, méthode 09), 1909700805 (variante 4, une forme et pas
      // une clé). 0185125434 est l'exception que le texte déclare « als
      // richtig zu bewerten ».
      noCheck: ['7777778800', '5001050352', '5045090090', '1909700805', '0185125434'],
      fail: ['5302707782', '6412121212', '1813499124', '2206735010'],
    },
  ],
  '61': [
    // Exemple 1 : 2063099, clé 2, sous-compte 00. Exemple 2 : chiffre de type 8,
    // les positions 9 et 10 entrent dans le calcul, clé 4.
    { page: 21, kind: 'worked_example', pass: ['2063099200', '0260760481'] },
  ],
  '63': [
    // Le numéro de base 123456, clé 6, sous-compte 00 : « 1 2 3 4 5 6 6 0 0 ».
    { page: 22, kind: 'worked_example', pass: ['123456600'] },
    // Le même numéro, sous-compte omis, clé en position 10.
    { page: 23, kind: 'worked_example', pass: ['0001234566'] },
  ],
  '64': [{ page: 23, kind: 'test_numbers', pass: ['1206473010', '5016511020'] }],
  '65': [
    // Exemple 1 : clé 4, type 0. Exemple 2 : type 9, les positions 9 et 10
    // entrent dans le calcul, clé 5.
    { page: 24, kind: 'worked_example', pass: ['1234567400', '1234567590'] },
  ],
  '68': [
    // Dix chiffres (8889654328), puis neuf chiffres par la variante 1
    // (987654324) et par la variante 2 (987654328).
    { page: 26, kind: 'worked_example', pass: ['8889654328', '987654324', '987654328'] },
  ],
  '71': [{ page: 28, kind: 'worked_example', pass: ['7101234007'] }],
  '74': [
    // L'exemple à six chiffres : « la clé peut être 4 ou 9 ».
    { page: 30, kind: 'worked_example', pass: ['239319', '239314'] },
    // Variante 1, numéros justes.
    {
      page: 30,
      kind: 'test_numbers',
      pass: ['1016', '26260', '242243', '242248', '18002113', '1821200043'],
    },
    // Variante 2, numéros justes : faux sous la variante 1, justes au total.
    {
      page: 30,
      kind: 'test_numbers',
      pass: ['1015', '26263', '242241', '18002116', '1821200047', '3456789012'],
    },
    // Faux sous les deux variantes, donc faux au total : la liste « falsch »
    // de la variante 2, qui contient celle de la variante 1.
    {
      page: 30,
      kind: 'test_numbers',
      fail: ['1011', '26265', '242249', '18002118', '1234567890', '6160000024'],
    },
  ],
  '76': [
    // Six chiffres de base, type 0 : 0012345600, clé 6 ; le même, sous-compte
    // omis : 0000123456.
    { page: 32, kind: 'worked_example', pass: ['0012345600', '0000123456'] },
    { page: 32, kind: 'test_numbers', pass: ['0006543200', '9012345600', '7876543100'] },
  ],
  '78': [{ page: 33, kind: 'test_numbers', pass: ['7581499', '9999999981'] }],
};

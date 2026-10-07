import type { DeVectors } from './vectors-types.js';

/**
 * Numéros de test officiels des méthodes 80 à A9 écrites ici (88, 91 à 96,
 * 98, 99, A2 à A8), recopiés de « Prüfzifferberechnungsmethoden » (Stand: Juni
 * 2018). Aucun n'est calculé par ce dépôt ni par une autre bibliothèque.
 *
 * Variantes enchaînées (91, 96, 98, A2, A3, A4, A5, A7, A8) : un numéro juste
 * sous une variante est juste pour la méthode ; un numéro faux sous la DERNIÈRE
 * variante essayée est faux pour la méthode, puisque le document ne le teste
 * là qu'après l'échec des précédentes. Un numéro faux sous une variante
 * intermédiaire, que le document ne range nulle part ailleurs, n'est pas repris :
 * son verdict d'ensemble n'est pas imprimé (91 : 8840017000, 8840023000,
 * 8840041000, 8840014000, 8840026000, 8840011000, 8840025000, 8840062000 ;
 * A4 : 8623420004, 8623420000, 6099702031).
 *
 * La méthode 92, en usage, n'a ni numéro de test ni exemple complet : elle est
 * écrite, mais n'est pas servie (verified.ts).
 */
export const DE_VECTORS_80_A9: DeVectors = {
  '88': [
    {
      page: 46,
      kind: 'test_numbers',
      pass: ['2525259', '1000500', '90013000', '92525253', '99913003'],
    },
  ],
  '91': [
    // Variante 1.
    { page: 50, kind: 'test_numbers', pass: ['2974118000', '5281741000', '9952810000'] },
    // Variantes 2, 3 et 4 ; 8840045000, faux sous la variante 2, est juste
    // sous la 3. Les deux numéros faux de la variante 4, la dernière, ne
    // passent aucune variante (« nicht prüfbar », rangés « falsch »).
    {
      page: 51,
      kind: 'test_numbers',
      pass: [
        '2974117000',
        '5281770000',
        '9952812000',
        '8840019000',
        '8840050000',
        '8840087000',
        '8840045000',
        '8840012000',
        '8840055000',
        '8840080000',
      ],
      fail: ['8840010000', '8840057000'],
    },
  ],
  '93': [
    // Chaque numéro est imprimé sous ses deux formes, cas a) et cas b).
    {
      page: 52,
      kind: 'test_numbers',
      pass: [
        '6714790000',
        '0000671479',
        '1277830000',
        '0000127783',
        '1277910000',
        '0000127791',
        '3067540000',
        '0000306754',
      ],
    },
  ],
  '94': [{ page: 53, kind: 'test_numbers', pass: ['6782533003'] }],
  '95': [
    {
      page: 53,
      kind: 'test_numbers',
      pass: ['0068007003', '0847321750', '6450060494', '6454000003'],
    },
  ],
  '96': [
    // « Gültige Kontonummern » des variantes 1 et 2.
    {
      page: 53,
      kind: 'test_numbers',
      pass: ['0000254100', '9421000009', '0000000208', '0101115152', '0301204301'],
    },
  ],
  '98': [
    // Exemple de calcul : 9 6 1 9 6 0 8 1 1, clé 8.
    { page: 54, kind: 'worked_example', pass: ['9619608118'] },
    {
      page: 54,
      kind: 'test_numbers',
      pass: ['9619439213', '9619509976', '9619319999', '3009800016', '5989800173', '6719430018'],
    },
  ],
  '99': [{ page: 54, kind: 'test_numbers', pass: ['0068007003', '0847321750'] }],
  A2: [
    // 3456789012, faux sous la variante 1, est juste sous la 2 ; 1234567890
    // est faux sous les deux ; 0123456789 est faux sous la 2, la dernière.
    {
      page: 56,
      kind: 'test_numbers',
      pass: ['3456789019', '5678901231', '6789012348', '3456789012'],
      fail: ['1234567890', '0123456789'],
    },
  ],
  A3: [
    // 9876543210 et 1234567890, faux sous la variante 1, sont justes sous la 2
    // (comme 0123456789) ; 6543217890 et 0543216789 sont faux sous les deux.
    {
      page: 56,
      kind: 'test_numbers',
      pass: ['1234567897', '0123456782', '9876543210', '1234567890', '0123456789'],
      fail: ['6543217890', '0543216789'],
    },
  ],
  A4: [
    // Exemples des variantes 1 et 2 ; variantes 1 et 2 (0004711172, faux sous
    // la 1, est juste sous la 2 ; 0001123458, faux sous la 1 et la 2, est
    // juste sous la 4).
    { page: 57, kind: 'worked_example', pass: ['0004711173', '0004711172'] },
    {
      page: 57,
      kind: 'test_numbers',
      pass: ['0004711173', '0007093330', '0004711172', '0007093335'],
    },
    // Exemple de la variante 3 ; variantes 3 et 4 (1299503117, faux sous la 3,
    // est juste sous la 4). Les deux numéros faux de la variante 4, la
    // dernière, sont faux pour la méthode.
    { page: 58, kind: 'worked_example', pass: ['1199503010'] },
    {
      page: 58,
      kind: 'test_numbers',
      pass: [
        '1199503010',
        '8499421235',
        '0000862342',
        '8997710000',
        '0664040000',
        '0000905844',
        '5030101099',
        '0001123458',
        '1299503117',
      ],
      fail: ['0000399443', '0000553313'],
    },
  ],
  A5: [
    // 9941510002 et 9961230020 échouent à la variante 1 avec dix chiffres et
    // un 9 en tête : faux sans variante 2. 0000251438 et 0007948345 sont faux
    // sous la variante 2, la dernière.
    {
      page: 58,
      kind: 'test_numbers',
      pass: [
        '9941510001',
        '9961230019',
        '9380027210',
        '9932290910',
        '0000251437',
        '0007948344',
        '0000159590',
        '0000051640',
      ],
      fail: ['9941510002', '9961230020', '0000251438', '0007948345'],
    },
  ],
  A6: [
    // Un 8 en position 2 : méthode 00 ; sinon méthode 01.
    {
      page: 59,
      kind: 'test_numbers',
      pass: ['800048548', '0855000014', '17', '55300030', '150178033', '600003555', '900291823'],
      fail: ['860000817', '810033652', '305888', '200071280'],
    },
  ],
  A7: [
    // 19010660, 19010876 et 209010892, faux sous la variante 1, sont justes
    // sous la 2 ; 209010893 est faux sous les deux.
    {
      page: 59,
      kind: 'test_numbers',
      pass: ['19010008', '19010438', '19010660', '19010876', '209010892'],
      fail: ['209010893'],
    },
  ],
  A8: [
    // 7436660 et 7436678, faux sous la variante 1, sont justes sous la 2 ;
    // les numéros faux de la variante 2, la dernière, sont faux.
    {
      page: 60,
      kind: 'test_numbers',
      pass: ['7436661', '7436670', '1359100', '7436660', '7436678', '0003503398', '0001340967'],
      fail: ['7436666', '7436677', '0003503391', '0001340966'],
    },
    // Comptes généraux (position 3 = 9) : A8 renvoie à l'exception de la
    // méthode 51 « mit den gleichen Ergebnissen und Testkontonummern ».
    // 0199100004 et 2599100003, faux sous la variante 1 de l'exception, sont
    // justes sous la 2 ; les numéros faux de la variante 2 sont faux.
    {
      page: 16,
      kind: 'test_numbers',
      pass: ['0199100002', '0099100010', '2599100002', '0199100004', '2599100003', '3199204090'],
      fail: ['0099345678', '0099100110', '0199100040'],
    },
  ],
};

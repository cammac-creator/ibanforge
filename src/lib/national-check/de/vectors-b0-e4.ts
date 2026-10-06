import type { DeVectors } from './vectors-types.js';

/**
 * Numéros de test officiels des méthodes B0 à E4 en usage, recopiés de
 * « Prüfzifferberechnungsmethoden » (Stand: Juni 2018), pages 62 à 88.
 * Aucun n'est calculé par ce dépôt ni par une autre bibliothèque.
 *
 * Le verdict est celui de la méthode ENTIÈRE (voir vectors-types.ts). Pour
 * les méthodes à variantes enchaînées, un numéro juste sous n'importe quelle
 * variante est juste ; un numéro faux n'est rangé en `fail` que si la
 * Bundesbank le donne faux dans la dernière variante qu'il atteint. Quelques
 * numéros ne sont publiés que comme faux sous une variante intermédiaire, sans
 * que le document dise ce que donnent les suivantes : leur verdict d'ensemble
 * n'est pas écrit, ils ne figurent donc pas ici et sont cités dans le
 * commentaire de leur méthode.
 */
export const DE_VECTORS_B0_E4: DeVectors = {
  B1: [
    // Variante 1 (05), puis 2 (01), puis 3 (00). Les numéros faux sous les
    // variantes 1 et 2 sont tous repris, justes ou faux, par les suivantes.
    {
      page: 62,
      kind: 'test_numbers',
      pass: [
        '1434253150',
        '2746315471',
        '7414398260',
        '8347251693',
        '1501824',
        '1501832',
        '539290858',
        '7414398268',
        '8347251699',
      ],
      fail: ['0123456789', '2345678901', '5678901234'],
    },
  ],
  B2: [
    {
      page: 63,
      kind: 'test_numbers',
      pass: ['0020012357', '0080012345', '0926801910', '1002345674', '8000990054', '9000481805'],
      fail: [
        '0020012399',
        '0080012347',
        '0080012370',
        '0932100027',
        '3310123454',
        '8000990057',
        '8011000126',
        '9000481800',
        '9980480111',
      ],
    },
  ],
  B3: [
    {
      page: 63,
      kind: 'test_numbers',
      pass: [
        '1000000060',
        '0000000140',
        '0000000019',
        '1002798417',
        '8409915001',
        '9635000101',
        '9730200100',
      ],
      fail: ['0002799899', '1000000111', '9635100101', '9730300100'],
    },
  ],
  B5: [
    // Variante 1 (05) ; en échec, faux si la position 1 vaut 8 ou 9
    // (8347251693, 9000293707), sinon variante 2 (00). Publiés faux sous la
    // seule variante 1, sans verdict de la variante 2 : 7414398260,
    // 1151043211, 2345678901, 5678901234 (non repris ici).
    {
      page: 64,
      kind: 'test_numbers',
      pass: [
        '0159006955',
        '2000123451',
        '1151043216',
        '9000939033',
        '0123456782',
        '0130098767',
        '1045000252',
      ],
      fail: ['8347251693', '9000293707', '0159004165', '0023456787', '0056789018', '3045000333'],
    },
  ],
  B6: [
    // Variante 1 (méthode 20) : position 1 de 1 à 9, ou 02691 à 02699.
    {
      page: 65,
      kind: 'test_numbers',
      pass: ['9110000000', '0269876545'],
      fail: ['9111000000', '0269456780'],
    },
    // Variante 2 (méthode 53), qui lit le code banque : chaque numéro est
    // publié avec le sien.
    { page: 65, kind: 'test_numbers', blz: '80053782', pass: ['487310018'] },
    { page: 65, kind: 'test_numbers', blz: '80053762', fail: ['467310018'] },
    { page: 65, kind: 'test_numbers', blz: '80053772', fail: ['477310018'] },
  ],
  B7: [
    {
      page: 65,
      kind: 'test_numbers',
      pass: [
        '0700001529',
        '0730000019',
        '0001001008',
        '0001057887',
        '0001007222',
        '0810011825',
        '0800107653',
        '0005922372',
      ],
      fail: ['0001057886', '0003815570', '0005620516', '0740912243', '0893524479'],
    },
  ],
  B8: [
    // Variante 1 (20), puis 2 (29), puis 3 : pas de clé dans les plages
    // 5100000000 à 5999999999 et 9010000000 à 9109999999. Publié faux sous la
    // seule variante 1, absent des listes de la variante 2 : 5011654366.
    {
      page: 66,
      kind: 'test_numbers',
      pass: ['0734192657', '6932875274', '3145863029', '2938692523'],
      fail: ['0132572975', '9000412340', '9310305011'],
      noCheck: ['5432198760', '9070873333'],
    },
  ],
  C0: [
    // Variante 1 (méthode 52) avec le code banque publié. 82335729, faux sous
    // la variante 1, est juste sous la variante 2 (0082335729). Publié faux
    // sous la seule variante 1 : 29837521.
    {
      page: 68,
      kind: 'test_numbers',
      blz: '13051172',
      pass: ['43001500', '48726458', '82335729'],
    },
    {
      page: 68,
      kind: 'test_numbers',
      pass: ['0082335729', '0734192657', '6932875274'],
      fail: ['0132572975', '3038752371'],
    },
  ],
  C1: [
    // Variante 1 (méthode 17) : position 1 différente de 5.
    {
      page: 68,
      kind: 'test_numbers',
      pass: ['0446786040', '0478046940', '0701625830', '0701625840', '0882095630'],
      fail: ['0446786240', '0478046340', '0701625730', '0701625440', '0882095130'],
    },
    // Variante 2 : position 1 égale à 5 ; l'exemple de calcul est le premier.
    { page: 69, kind: 'worked_example', pass: ['5432112349'] },
    {
      page: 69,
      kind: 'test_numbers',
      pass: ['5432112349', '5543223456', '5654334563', '5765445670', '5876556788'],
      fail: ['5432112341', '5543223458', '5654334565', '5765445672', '5876556780'],
    },
  ],
  C2: [
    // Variante 1 (22), puis 2 (00), puis 3 (04).
    {
      page: 70,
      kind: 'test_numbers',
      pass: [
        '2394871426',
        '4218461950',
        '7352569148',
        '5127485166',
        '8738142564',
        '0076543216',
        '3456789012',
        '9024675138',
      ],
      fail: ['0328705282', '7352569145', '9024675131'],
    },
  ],
  C3: [
    {
      page: 71,
      kind: 'test_numbers',
      pass: ['9294182', '4431276', '19919', '9000420530', '9000010006', '9000577650'],
      fail: ['17002', '123451', '122448', '9000734028', '9000733227', '9000731120'],
    },
  ],
  C5: [
    // Variante 1 (méthode 75), numéros à six puis à neuf chiffres ; variante 2
    // (méthode 29), dix chiffres commençant par 1, 4, 5, 6 ou 9.
    {
      page: 72,
      kind: 'test_numbers',
      pass: [
        '0000301168',
        '0000302554',
        '0300020050',
        '0300566000',
        '1000061378',
        '1000061412',
        '4450164064',
        '4863476104',
        '5000000028',
        '5000000391',
        '6450008149',
        '6800001016',
        '9000100012',
        '9000210017',
      ],
      fail: [
        '0000302589',
        '0000507336',
        '0302555000',
        '0302589000',
        '1000061457',
        '1000061498',
        '4864446015',
        '4865038012',
        '5000001028',
        '5000001075',
        '6450008150',
        '6542812818',
        '9000110012',
        '9000300310',
      ],
    },
    // Variante 3 (méthode 00), dix chiffres commençant par 3.
    {
      page: 73,
      kind: 'test_numbers',
      pass: ['3060188103', '3070402023'],
      fail: ['3081000783', '3081308871'],
    },
  ],
  C7: [
    // Variante 1 (63), puis 2 (06) : 94012341 et 5073321010, faux sous la
    // première, sont justes sous la seconde.
    {
      page: 74,
      kind: 'test_numbers',
      pass: ['3500022', '38150900', '600103660', '39101181', '94012341', '5073321010'],
      fail: ['1234517892', '987614325'],
    },
  ],
  C8: [
    // Variante 1 (00), puis 2 (04), puis 3 (07).
    {
      page: 75,
      kind: 'test_numbers',
      pass: ['3456789019', '5678901231', '3456789012', '0022007130', '0123456789', '0552071285'],
      fail: ['1234567890', '9012345678'],
    },
  ],
  C9: [
    // Variante 1 (00), puis 2 (07). Publié faux sous la seule variante 1,
    // absent des listes de la variante 2 : 3456789012.
    {
      page: 76,
      kind: 'test_numbers',
      pass: ['3456789019', '5678901231', '0123456789'],
      fail: ['1234567890', '9012345678'],
    },
  ],
  D0: [
    {
      page: 76,
      kind: 'test_numbers',
      pass: ['6100272324', '6100273479'],
      fail: ['6100272885', '6100273377', '6100274012'],
    },
  ],
  D2: [
    // Variante 1 (95), puis 2 (00), puis 3 (68).
    {
      page: 78,
      kind: 'test_numbers',
      pass: ['189912137', '235308215', '4455667784', '1234567897', '51181008', '71214205'],
      fail: ['6414241', '179751314'],
    },
  ],
  D6: [
    // Variante 1 (07), puis 2 (03), puis 3 (00). Publiés faux sous une
    // variante intermédiaire seulement : 33394, 595795, 16400501 (variante 1),
    // 3615071237, 6039267013, 6039316014 (variante 2).
    {
      page: 82,
      kind: 'test_numbers',
      pass: [
        '3409',
        '585327',
        '1650513',
        '3601671056',
        '4402001046',
        '6100268241',
        '7001000681',
        '9000111105',
        '9001291005',
      ],
      fail: ['7004017653', '9002720007', '9017483524'],
    },
  ],
  D7: [
    { page: 83, kind: 'worked_example', pass: ['0500018205'] },
    {
      page: 83,
      kind: 'test_numbers',
      pass: [
        '0500018205',
        '0230103715',
        '0301000434',
        '0330035104',
        '0420001202',
        '0134637709',
        '0201005939',
        '0602006999',
      ],
      fail: [
        '0501006102',
        '0231307867',
        '0301005331',
        '0330034104',
        '0420001302',
        '0135638809',
        '0202005939',
        '0601006977',
      ],
    },
  ],
  D8: [
    { page: 84, kind: 'worked_example', pass: ['6899999954'] },
    {
      page: 84,
      kind: 'test_numbers',
      pass: ['1403414848', '6800000439', '6899999954'],
      fail: ['3012084101', '1062813622', '0000260986'],
    },
  ],
  E0: [
    { page: 85, kind: 'worked_example', pass: ['1234568013'] },
    {
      page: 85,
      kind: 'test_numbers',
      pass: ['1234568013', '1534568010', '2610015', '8741013011'],
      fail: ['1234769013', '2710014', '9741015011'],
    },
  ],
  E3: [
    // Variante 1 (00), puis 2 (21).
    {
      page: 88,
      kind: 'test_numbers',
      pass: [
        '9290701',
        '539290858',
        '1501824',
        '1501832',
        '9290708',
        '539290854',
        '1501823',
        '1501831',
        '2345678909',
        '5678901237',
      ],
      fail: ['0123456789', '2345678901', '5678901234', '7414398260'],
    },
  ],
  E4: [
    // Variante 1 (02), puis 2 (00).
    {
      page: 88,
      kind: 'test_numbers',
      pass: ['1501836', '9290702', '539290858', '1501824', '1501832', '9290701'],
      fail: ['12345007', '87654005'],
    },
  ],
};

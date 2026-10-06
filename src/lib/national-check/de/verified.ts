/**
 * Allemagne : les méthodes de la Bundesbank qui donnent un verdict, en deux
 * niveaux (décision de la session principale du 06.10.2026).
 *
 * ## Premier niveau : `DE_VERIFIED_METHODS`, vérifiées sur les numéros officiels
 *
 * Un faux « fail » bloquerait l'inscription SEPA d'un vrai client : c'est pire
 * que pas de contrôle. Une méthode n'entre dans cette liste que si
 *
 * 1. elle est écrite d'après la spécification de la Bundesbank ;
 * 2. la Bundesbank publie pour elle au moins un numéro de test ou un exemple
 *    de calcul complet, et TOUS ceux qu'elle publie donnent le verdict attendu
 *    (`DE_OFFICIAL_VECTORS`, vérifiés par methods.test.ts) ;
 * 3. elle a été confrontée hors ligne, sur environ 21 000 numéros chacune, à une
 *    implémentation indépendante utilisée comme boîte noire, et chaque désaccord
 *    a été tranché par le texte de la spécification, toujours dans le sens qui
 *    ne peut pas produire de faux « fail » (passation de la PR du 06.10.2026) ;
 * 4. aucun IBAN fabriqué selon les règles IBAN des banques (champ 14 du fichier
 *    étendu, non public) ne l'a fait échouer dans la mesure du 06.10.2026.
 *
 * Verdict servi avec `verified_by: "bundesbank_test_numbers"` ; un `fail` y est
 * bloquant (étape `national_check_digits_failed`).
 *
 * ## Second niveau : `DE_INDEPENDENTLY_VERIFIED_METHODS`
 *
 * La Bundesbank ne publie pour ces méthodes ni numéro de test ni exemple
 * complet : la condition 2 ne peut pas être remplie (« zéro cas » ne vaut pas
 * « tous les cas »). Elles remplissent 1, 3 (accord complet avec
 * l'implémentation indépendante sur chaque numéro essayé) et 4. Verdict servi
 * avec `verified_by: "independent_implementation"` ; un `fail` n'est qu'un
 * avertissement (étape `national_check_digits_suspect`), jamais un arrêt.
 *
 * ## Le reste
 *
 * - 44 : une règle IBAN de ses banques remplace le numéro de compte par un
 *   numéro SANS clé ; un IBAN parfaitement réel y échouerait. Elle reste aussi
 *   plus stricte que l'implémentation indépendante sur une partie des numéros.
 *   `not_checked`, à aucun niveau.
 * - Les méthodes qu'aucune banque n'utilise aujourd'hui ne sont pas écrites,
 *   ou seulement comme brique d'une autre (02, 04, 07, 14, 15, 23…) : une
 *   banque qui y passerait reçoit `not_checked` au rafraîchissement mensuel
 *   suivant.
 * - La méthode 09 (« Keine Prüfzifferberechnung ») n'est pas une méthode à
 *   vérifier : elle dit que la banque n'a pas de clé, et sert `not_applicable`.
 */
export const DE_VERIFIED_METHODS: ReadonlySet<string> = new Set([
  // 00 à 39
  '00',
  '06',
  '10',
  '17',
  '19',
  '24',
  '25',
  '26',
  '27',
  '28',
  '29',
  '31',
  '32',
  '33',
  '34',
  '35',
  '36',
  '37',
  '38',
  '39',
  // 40 à 79 (44 écartée, voir plus haut)
  '40',
  '41',
  '42',
  '43',
  '46',
  '47',
  '50',
  '56',
  '57',
  '61',
  '63',
  '64',
  '65',
  '68',
  '71',
  '74',
  '76',
  '78',
  // 80 à A9 (93 n'est utilisée par aucune banque aujourd'hui ; A4 l'appelle)
  '88',
  '91',
  '93',
  '94',
  '95',
  '96',
  '98',
  '99',
  'A2',
  'A3',
  'A4',
  'A5',
  'A6',
  'A7',
  'A8',
  // B0 à E4
  'B1',
  'B2',
  'B3',
  'B5',
  'B6',
  'B7',
  'B8',
  'C0',
  'C1',
  'C2',
  'C3',
  'C5',
  'C7',
  'C8',
  'C9',
  'D0',
  'D2',
  'D6',
  'D7',
  'D8',
  'E0',
  'E3',
  'E4',
]);

/**
 * Le second niveau : sans numéro publié par la Bundesbank, vérifiées seulement
 * contre l'implémentation indépendante (voir plus haut). Jamais en même temps
 * dans `DE_VERIFIED_METHODS`, jamais la 44 (tests de methods.test.ts).
 */
export const DE_INDEPENDENTLY_VERIFIED_METHODS: ReadonlySet<string> = new Set([
  '01',
  '03',
  '05',
  '08',
  '11',
  '13',
  '16',
  '18',
  '20',
  '21',
  '22',
  '30',
  '48',
  '49',
  '59',
  '60',
  '67',
  '92',
]);

/** Les méthodes écartées à tout niveau, avec leur raison (voir plus haut). */
export const DE_EXCLUDED_METHODS: ReadonlySet<string> = new Set(['44']);

/**
 * La forme des numéros de test officiels de la Bundesbank.
 *
 * Chaque jeu est recopié de « Prüfzifferberechnungsmethoden » (Stand: Juni
 * 2018), à la page indiquée. Deux sortes de numéros y figurent :
 *
 * - `test_numbers` : les « Testkontonummern », justes (« richtig ») ou fausses
 *   (« falsch ») ; les plus anciennes méthodes ne donnent que des justes ;
 * - `worked_example` : le numéro complet d'un exemple de calcul (« Beispiel »),
 *   juste par construction.
 *
 * Les numéros sont écrits comme la Bundesbank les imprime, parfois plus courts
 * que dix chiffres : le test les complète par des zéros à gauche, comme dans un
 * IBAN. Le verdict attendu est celui de la méthode ENTIÈRE. Quand une méthode
 * enchaîne des variantes (« ergibt die Berechnung nach Variante 1 einen
 * Prüfzifferfehler, ist nach Variante 2 zu prüfen »), un numéro « falsch » sous
 * la première variante et « richtig » sous la suivante est rangé en `pass`, et
 * le commentaire du jeu le dit.
 */
export interface DeVectorSet {
  /** Page du PDF où les numéros sont imprimés. */
  page: number;
  kind: 'test_numbers' | 'worked_example';
  /** Code banque à passer à la méthode, pour celles qui le lisent (52, 53, B6…). */
  blz?: string;
  pass?: readonly string[];
  fail?: readonly string[];
  /** Numéros pour lesquels la méthode ne définit pas de clé (« keine Prüfziffer »). */
  noCheck?: readonly string[];
}

/** Les jeux de numéros, par code de méthode. */
export type DeVectors = Readonly<Record<string, readonly DeVectorSet[]>>;

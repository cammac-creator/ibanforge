/**
 * Israël et Mongolie (28/10/2026) : le crédit que chaque réponse tirée de ces deux
 * registres porte, et la réserve qui en fait des registres partiels.
 *
 * Un module sans aucun import, comme src/lib/sm-credit.ts : `national-registers.ts`
 * et `enrich.ts` le lisent tous deux.
 *
 * Les deux sources sont servies au titre de la règle du 28/10/2026 (case 2 :
 * conditions absentes ou réservées, servi depuis le fichier privé, source citée,
 * retiré dans les 48 heures sur demande ; src/lib/restricted-family.ts). Citer la
 * source n'est donc pas ici la condition d'une licence lue, c'est la moitié de la
 * règle : chaque réponse nomme l'éditeur, le jeu ou le document, et sa date.
 *
 * - Israël : la ligne stockée nomme le jeu de data.gov.il qui a nommé le code (la
 *   liste des sociétés bancaires, ou celle des agences pour les codes qu'elle ne
 *   porte pas) ; `as_of` est le jour de mise à jour de ce jeu, que les conditions
 *   historiques du portail demandaient de citer avec son nom.
 * - Mongolie : la Mongolbank ne date pas son PDF ; `as_of` est le jour où IBANforge
 *   l'a lu, et le crédit le dit comme tel, jamais « publié le ».
 */

const SCOPE = {
  IL: 'the Bank of Israel lists banking corporations and their branches, not the allocation of the bank-code space, so an absence is not a non-allocation',
  MN: 'the register lists payment system participants, not the allocation of the bank-code space, so an absence is not a non-allocation; only its SWIFT column is served as a BIC',
} as const;

export type IlMnCountry = keyof typeof SCOPE;

export function isIlMn(cc: string): cc is IlMnCountry {
  return cc === 'IL' || cc === 'MN';
}

/** Le nom du registre là où aucune ligne n'est lue (couverture par pays) : sans date. */
export const IL_MN_REGISTER_NAME: Record<IlMnCountry, string> = {
  IL: `Bank of Israel, lists of banking corporations and bank branches on data.gov.il (${SCOPE.IL})`,
  MN: `Bank of Mongolia (Mongolbank), unified register of payment system participants (${SCOPE.MN})`,
};

/** Ce que `bic.source` imprime : « Source: », la ligne stockée et sa date, dite pour ce qu'elle est. */
export function ilMnCredit(cc: IlMnCountry, source: string, asOf: string): string {
  return cc === 'IL'
    ? `Source: ${source}, dataset updated ${asOf}`
    : `Source: ${source} (read by IBANforge on ${asOf})`;
}

/** Ce que `bank_code_check.register` imprime pour un code listé : le crédit daté, puis la réserve. */
export function ilMnRegisterName(cc: IlMnCountry, source: string, asOf: string): string {
  return `${ilMnCredit(cc, source, asOf)}. Partial register: ${SCOPE[cc]}`;
}

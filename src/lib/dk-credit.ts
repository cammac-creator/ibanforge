/**
 * Danemark, Groenland et îles Féroé (18/11/2026) : le crédit que chaque réponse tirée
 * de la liste IBAN d'e-nettet porte, et la réserve qui en fait un registre partiel.
 *
 * Un module sans aucun import, comme src/lib/il-mn-credit.ts : `national-registers.ts`
 * et `enrich.ts` le lisent tous deux.
 *
 * e-nettet A/S, la société de l'infrastructure commune des banques danoises, publie
 * sur www.iban-denmark.com la liste « IBAN Denmark, Greenland and Faroe Islands » :
 * des plages de numéros de registre (registreringsnummer, positions 5 à 8 de l'IBAN),
 * chacune avec la banque, sa ville et son BIC. Aucune condition de réutilisation n'est
 * publiée : servie au titre de la règle du 28/10/2026 (case 2), depuis le fichier
 * privé, source citée, retirée dans les 48 heures sur demande
 * (src/lib/restricted-family.ts, origine `e-nettet.dk`).
 *
 * `as_of` est la date de l'ÉDITION, celle que porte le nom du fichier lié depuis la
 * page (scripts/seed-national-dk.ts), jamais le jour où IBANforge l'a lue : la liste
 * est « updated whenever there are changes », une édition ancienne est donc celle en
 * vigueur, et sa date dit à l'appelant de quand date ce qu'il lit.
 */

/** Ce que la liste est, et pourquoi une absence n'y prouve rien. */
const SCOPE =
  'the list maps the registration numbers of Danish, Faroese and Greenlandic IBANs to banks and their BICs, not the allocation of the registration-number space, so an absence is not a non-allocation';

export type DkListCountry = 'DK' | 'FO' | 'GL';

export function isDkList(cc: string): cc is DkListCountry {
  return cc === 'DK' || cc === 'FO' || cc === 'GL';
}

/**
 * Le nom du registre là où aucune ligne n'est lue (couverture par pays) : sans date,
 * le même pour les trois pays, pour que les textes publics les groupent sous une seule
 * source.
 */
export const DK_REGISTER_NAME = `e-nettet A/S, IBAN overview for Denmark, Greenland and the Faroe Islands (${SCOPE})`;

/** Ce que `bic.source` imprime : « Source: », la ligne stockée et la date de l'édition. */
export function dkCredit(source: string, asOf: string): string {
  return `Source: ${source}, edition ${asOf}`;
}

/** Ce que `bank_code_check.register` imprime pour un code listé : le crédit daté, puis la réserve. */
export function dkRegisterName(source: string, asOf: string): string {
  return `${dkCredit(source, asOf)}. Partial register: ${SCOPE}`;
}

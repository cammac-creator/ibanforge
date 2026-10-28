/**
 * Russie (28/10/2026, décision « Nommer seulement ») : le crédit que chaque réponse
 * tirée du répertoire des BIK de la Banque de Russie porte, et la réserve qui en
 * fait un registre partiel.
 *
 * Un module sans aucun import, comme src/lib/il-mn-credit.ts : `national-registers.ts`,
 * `enrich.ts` et le chargeur (scripts/seed-national-ru.ts) le lisent tous.
 *
 * Les conditions du site de la Banque de Russie permettent la reproduction sans
 * restriction, à la seule condition d'un lien vers la source (case 1 de la règle du
 * 28/10/2026, docs/data-sources.md) : chaque réponse nomme l'éditeur, le répertoire,
 * son adresse et le jour ouvrable auquel il s'applique (`BusinessDay` de l'ED807).
 */

/** Le crédit stocké avec chaque ligne, lien vers la source compris. */
export const RU_SOURCE =
  'Bank of Russia, BIC directory of the Bank of Russia payment system (ED807), https://www.cbr.ru';

const SCOPE =
  'IBANforge serves the credit institutions and branches the directory lists as active and unrestricted, not its other participants, so an absence is not a non-allocation';

/** Le nom du registre là où aucune ligne n'est lue (couverture par pays) : sans date. */
export const RU_REGISTER_NAME = `${RU_SOURCE} (${SCOPE})`;

/** Ce que `bic.source` imprime : « Source: », la ligne stockée et le jour ouvrable du répertoire. */
export function ruCredit(source: string, asOf: string): string {
  return `Source: ${source}, business day ${asOf}`;
}

/** Ce que `bank_code_check.register` imprime pour un code listé : le crédit daté, puis la réserve. */
export function ruRegisterName(source: string, asOf: string): string {
  return `${ruCredit(source, asOf)}. Partial register: ${SCOPE}`;
}

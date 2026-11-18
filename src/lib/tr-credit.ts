/**
 * Turquie (18/11/2026) : le crédit que chaque réponse tirée de la liste des participants
 * des systèmes de paiement de la banque centrale de Turquie (TCMB) porte, et la réserve
 * qui en fait une liste partielle.
 *
 * Un module sans aucun import, comme src/lib/dk-credit.ts : `national-registers.ts` et
 * `enrich.ts` le lisent tous deux.
 *
 * La TCMB publie « TCMB Ödeme Sistemleri Katılımcıları », un PDF lié depuis la page de
 * son système EFT : un code de participant à quatre chiffres et un nom par ligne, aucun
 * BIC. Ses conditions (« Kullanım Şartları », lues le 18/11/2026) permettent de citer
 * l'information avec sa source, et soumettent l'usage commercial à son accord écrit :
 * servie au titre de la règle du 28/10/2026 (case 2), depuis le fichier privé, source
 * citée, retirée sous 48 heures sur demande (src/lib/restricted-family.ts, origine
 * `tcmb.gov.tr`).
 *
 * Le code de l'IBAN turc a cinq chiffres ; IBANforge le lit comme un zéro suivi du code
 * de participant. C'est notre lecture : le communiqué IBAN de la TCMB dit qu'elle
 * détermine et annonce les codes de banque, et son propre IBAN d'exemple porte 00001,
 * son code de participant 0001 précédé d'un zéro. Le crédit le dit.
 *
 * `as_of` est le jour où IBANforge a lu la liste : le PDF ne porte aucune date de
 * publication. Le crédit le dit comme tel, jamais « publié le ».
 */

/** Ce que la liste est, comment le code de l'IBAN y est lu, et pourquoi une absence n'y prouve rien. */
const SCOPE =
  'the TCMB lists the participants in its payment systems, not every holder of a Turkish IBAN bank code, so an absence is not a non-allocation; IBANforge reads the five-digit IBAN bank code as a zero followed by the four-digit participant code and serves the participants numbered below 0800 (the banks, the TCMB included); the list gives no BIC';

/**
 * Le nom de la liste quand la ligne lue ne porte ni source ni date (une base écrite à la
 * main, jamais le seeder) : sans date plutôt qu'avec une date inventée.
 */
export const TR_LIST_NAME = `Central Bank of the Republic of Türkiye (TCMB), participants in the TCMB payment systems (${SCOPE})`;

/** Ce que la ligne stockée dit de la source ; la date est ajoutée par `trCredit`. */
export function trCredit(source: string, asOf: string): string {
  return `Source: ${source} (read by IBANforge on ${asOf})`;
}

/** Ce que `bank_code_check.register` imprime pour un code listé : le crédit daté, puis la réserve. */
export function trRegisterName(source: string, asOf: string): string {
  return `${trCredit(source, asOf)}. Partial list: ${SCOPE}`;
}

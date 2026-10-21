/**
 * Saint-Marin : le crédit que la Banque centrale de la République de Saint-Marin
 * a accepté par écrit, pour sa liste « Operating Banks ».
 *
 * Un module sans aucun import, exprès : `national-registers.ts` et `enrich.ts`
 * le lisent tous deux, et le placer dans le premier créait un cycle d'imports
 * (lancé depuis scripts/seed-national.ts, `enrich.ts` lisait la constante avant
 * son initialisation).
 *
 * Le 16/10/2026, son service des relations extérieures a répondu à notre demande
 * du 07/09/2026 : nommer la banque derrière un IBAN saint-marinais à partir de sa
 * page « Operating Banks », y compris pour des clients payants, « is acceptable
 * provided that the information is accurately reproduced, appropriately
 * attributed to its source, and not presented in a misleading manner », et
 * l'attribution proposée, « Source: Central Bank of the Republic of San Marino,
 * Operating Banks », accompagnée de la date de consultation, « is acceptable ».
 * Ce n'est ni une licence ni un engagement de la Banque (son courriel, envoyé de
 * bonne foi, ne crée aucune obligation pour elle) : une confirmation écrite que
 * cet usage est acceptable, à ces conditions. docs/data-sources.md, NOTICE.
 *
 * D'où une constante, comme pour la Grèce, le Monténégro ou la Serbie : la
 * formule est celle que la Banque a acceptée, mot pour mot, et non celle que la
 * ligne stockée porte. Seule la date vient des lignes : le jour où nous avons lu
 * la page, la BCSM ne datant pas sa liste.
 */
const SM_NAME = 'Central Bank of the Republic of San Marino, Operating Banks';
export const SM_CREDIT = `Source: ${SM_NAME}`;

/** Ce que `bic.source` imprime pour un code de la liste : la formule acceptée et le jour de lecture. */
export function smCredit(readOn: string): string {
  return `${SM_CREDIT} (read by IBANforge on ${readOn})`;
}

/**
 * La réserve qui tient la troisième condition (ne pas présenter l'information de
 * façon trompeuse) : la liste nomme des banques, elle n'attribue pas l'espace des
 * codes ABI, et une absence n'y est donc pas une non-attribution.
 */
const SM_SCOPE =
  'the list does not publish the allocation of the ABI code space, so an absence is not a non-allocation';

/**
 * Ce que `bank_code_check.register` imprime pour un code de la liste : le crédit
 * daté, puis la réserve (même forme que meRegisterName pour le Monténégro).
 */
export function smRegisterName(readOn: string): string {
  return `${smCredit(readOn)}. Banks only: ${SM_SCOPE}`;
}

/**
 * Le nom du registre là où aucune ligne n'est lue, donc sans date ni crédit : la
 * couverture par pays (`registerCoverage` : pages pays, colonne `register` de
 * l'audit de fichier), que les phrases du site insèrent après « against ». Une
 * réponse sur un code de la liste porte, elle, le crédit accepté et sa date
 * (`smRegisterName`).
 */
export const SM_REGISTER_NAME = `${SM_NAME} (banks only; ${SM_SCOPE})`;

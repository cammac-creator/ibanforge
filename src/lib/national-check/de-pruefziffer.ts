import { DE_METHODS } from './de/methods.js';
import { DE_TABLE_SOURCE, loadDeMethodTable } from './de/table.js';
import { DE_VERIFIED_METHODS } from './de/verified.js';
import type { NationalCheck } from './types.js';

/**
 * Allemagne : la clé du numéro de compte, selon la méthode que la Bundesbank
 * attribue au code banque (06.10.2026).
 *
 * ## Ce que ce contrôle ajoute au modulo 97
 *
 * Les chiffres de contrôle de l'IBAN allemand couvrent déjà tout le BBAN (code
 * banque et numéro de compte) : ils prouvent que l'IBAN a été recopié sans
 * faute. Ils ne disent pas si la banque a pu émettre ce numéro de compte. Un
 * outil qui fabrique un IBAN autour d'un numéro faux (chiffre oublié, chiffres
 * inversés dans le numéro saisi au départ) calcule sans peine des chiffres ISO
 * justes. Chaque banque allemande, elle, est tenue de n'utiliser que des
 * numéros de compte conformes à la méthode qu'elle a déclarée (Merkblatt
 * Bankleitzahlendatei, champ 9) : un numéro qui viole cette méthode ne peut pas
 * avoir été émis tel qu'il est écrit.
 *
 * ## Ce qu'il ne prouve pas
 *
 * La Bundesbank l'écrit elle-même : un numéro dont la clé se recalcule ne dit
 * rien de l'existence du compte, seulement qu'il serait un numéro valable. Ni
 * l'existence, ni l'ouverture, ni le titulaire.
 *
 * ## Le verdict, cas par cas
 *
 * - table des méthodes absente (fichier manquant) : aucun bloc, comme un pays
 *   sans algorithme ; `checks.national_check_digits` dit `not_checked` ;
 * - code banque absent du fichier de la Bundesbank : `not_checked` ;
 * - méthode 09 (la banque n'a pas de clé) : `not_applicable` ;
 * - méthode absente de `DE_VERIFIED_METHODS` : `not_checked`, jamais un verdict
 *   tiré d'un calcul que les numéros officiels n'ont pas confirmé ;
 * - méthode vérifiée qui ne définit pas de clé pour ce numéro : `not_applicable` ;
 * - sinon `pass` ou `fail`.
 *
 * Seul `fail` déclenche l'étape bloquante de `next_steps`, et il ne peut venir
 * que d'une méthode vérifiée.
 */
export function checkGermanAccount(country: string, bban: string): NationalCheck | null {
  if (!/^\d{18}$/.test(bban)) {
    return {
      country,
      scheme: 'de_pruefziffer',
      status: 'not_applicable',
      detail:
        'The BBAN does not follow the German layout (8-digit bank code, 10-digit account number), so the account check digit could not be computed.',
    };
  }
  const table = loadDeMethodTable();
  if (!table) return null;

  const blz = bban.slice(0, 8);
  const account = bban.slice(8);
  const provenance = { source: DE_TABLE_SOURCE, table_fetched_on: table.fetched_on };

  if (!Object.hasOwn(table.methods, blz)) {
    return {
      country,
      scheme: 'de_pruefziffer',
      status: 'not_checked',
      detail:
        "The bank code is not in the Bundesbank's bank code file, so no check-digit method is known for it and the account number was not checked.",
      ...provenance,
    };
  }
  const method = table.methods[blz];
  if (method === '09') {
    return {
      country,
      scheme: 'de_pruefziffer',
      status: 'not_applicable',
      method,
      detail:
        'This bank uses no check digit in its account numbers (Bundesbank method 09), so there is nothing to check.',
      ...provenance,
    };
  }
  const run = DE_METHODS[method];
  if (!run || !DE_VERIFIED_METHODS.has(method)) {
    return {
      country,
      scheme: 'de_pruefziffer',
      status: 'not_checked',
      method,
      detail: `Bundesbank method ${method} is not checked here yet: a verdict is served only for the methods that give the expected answer on every test number the Bundesbank publishes.`,
      ...provenance,
    };
  }

  const outcome = run(account, blz);
  if (outcome === 'pass') {
    return { country, scheme: 'de_pruefziffer', status: 'pass', method, ...provenance };
  }
  if (outcome === 'no_check') {
    return {
      country,
      scheme: 'de_pruefziffer',
      status: 'not_applicable',
      method,
      detail: `Bundesbank method ${method} defines no check digit for this range of account numbers, so there is nothing to check.`,
      ...provenance,
    };
  }
  return {
    country,
    scheme: 'de_pruefziffer',
    status: 'fail',
    method,
    detail: `The account number does not satisfy check-digit method ${method}, which the Bundesbank lists for this bank code: this account number cannot have been issued as written.`,
    ...provenance,
  };
}

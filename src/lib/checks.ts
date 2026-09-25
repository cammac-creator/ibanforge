/**
 * Ce qui a été vérifié, et ce qui ne l'a pas été, contrôle par contrôle.
 *
 * ## Pourquoi ce module existe
 *
 * `valid` répond à la norme ISO 13616 (structure et modulo 97), et rien d'autre.
 * Une IA ou un intégrateur qui ne lit que lui prend un code banque que personne
 * ne détient, ou une banque que seule notre carte composite nomme, pour une
 * banque confirmée. `bank_code_check` dit déjà la vérité, mais dans un
 * vocabulaire (`verified` veut dire « résolu ») qui se lit comme une
 * confirmation chez qui ignore `authoritative`.
 *
 * Deux champs AJOUTÉS à côté de `valid`, qui ne change pas (décision du
 * 24/09/2026) :
 * - `bank_code_holder` : qui détient le code banque, et d'après quelle force de
 *   source ;
 * - `checks` : un statut court par contrôle, y compris ceux qu'IBANforge ne fait
 *   jamais (le nom du titulaire, l'existence du compte, les sanctions du
 *   bénéficiaire), pour qu'aucun lecteur ne les croie faits.
 *
 * La preuve de chaque contrôle reste dans son bloc (`bank_code_check`, `bic`,
 * `sepa`, `modulus_check`, `compliance`). Aucune explication par contrôle dans
 * la réponse : elle est statique et vit dans l'OpenAPI et les descriptions MCP
 * (CHECKS_NOT_CHECKED_NOTE), pour ne pas alourdir un lot de 100.
 *
 * Une clé ajoutée plus tard est un ajout ; une clé ne disparaît jamais.
 * Fonctions pures.
 */
import type { ComplianceResult, IBANValidationResult } from '../types.js';

/** Le vocabulaire unique des statuts, réutilisé par les étapes suivantes. */
export type CheckStatus =
  'pass' | 'fail' | 'inferred' | 'unknown' | 'not_checked' | 'not_applicable';

/**
 * Qui détient le code banque.
 * - `confirmed` : un registre qui publie les détenteurs a nommé celui de ce code ;
 * - `inferred` : nous nommons un détenteur, d'après une source qui ne tranche pas
 *   (la carte composite, le repli par préfixe, une règle structurelle publiée,
 *   ou la carte quand le registre du pays n'a pas pu être lu) ;
 * - `not_allocated` : le registre national dit que personne ne le détient ;
 * - `unknown` : aucune conclusion.
 */
export type BankCodeHolder = 'confirmed' | 'inferred' | 'not_allocated' | 'unknown';

export interface Checks {
  iban_structure: 'pass';
  iban_checksum: 'pass';
  bank_code: 'pass' | 'fail' | 'inferred' | 'unknown';
  bic: 'pass' | 'inferred' | 'unknown' | 'not_applicable';
  sepa_reachability: 'pass' | 'fail' | 'unknown' | 'not_applicable';
  national_check_digits: 'pass' | 'fail' | 'not_applicable' | 'not_checked';
  account_exists: 'not_checked';
  payee_name: 'not_checked';
  institution_sanctions: 'not_checked' | 'pass' | 'fail' | 'unknown';
  country_sanctions: 'not_checked' | 'pass' | 'fail' | 'unknown';
  payee_sanctions: 'not_checked';
}

/** Les clés, dans l'ordre servi. */
export const CHECK_KEYS = [
  'iban_structure',
  'iban_checksum',
  'bank_code',
  'bic',
  'sepa_reachability',
  'national_check_digits',
  'account_exists',
  'payee_name',
  'institution_sanctions',
  'country_sanctions',
  'payee_sanctions',
] as const satisfies ReadonlyArray<keyof Checks>;

/** Les valeurs que chaque clé peut prendre, pour l'OpenAPI et les tests. */
export const CHECK_VALUES: { readonly [K in keyof Checks]: ReadonlyArray<Checks[K]> } = {
  iban_structure: ['pass'],
  iban_checksum: ['pass'],
  bank_code: ['pass', 'fail', 'inferred', 'unknown'],
  bic: ['pass', 'inferred', 'unknown', 'not_applicable'],
  sepa_reachability: ['pass', 'fail', 'unknown', 'not_applicable'],
  national_check_digits: ['pass', 'fail', 'not_applicable', 'not_checked'],
  account_exists: ['not_checked'],
  payee_name: ['not_checked'],
  institution_sanctions: ['not_checked', 'pass', 'fail', 'unknown'],
  country_sanctions: ['not_checked', 'pass', 'fail', 'unknown'],
  payee_sanctions: ['not_checked'],
};

export const BANK_CODE_HOLDERS: readonly BankCodeHolder[] = [
  'confirmed',
  'inferred',
  'not_allocated',
  'unknown',
];

/** `checks.bank_code` se lit dans `bank_code_holder`, jamais ailleurs : les deux ne divergent pas. */
export function bankCodeCheckStatus(holder: BankCodeHolder | undefined): Checks['bank_code'] {
  switch (holder) {
    case 'confirmed':
      return 'pass';
    case 'not_allocated':
      return 'fail';
    case 'inferred':
      return 'inferred';
    default:
      return 'unknown';
  }
}

/**
 * La clé nationale. Le Royaume-Uni seul en 1.x : dérivée de `modulus_check`.
 * Ailleurs `not_checked`, jusqu'au branchement du module des clés nationales,
 * dont le résultat `null` (pas d'algorithme pour ce pays) donnera aussi
 * `not_checked`.
 */
function nationalCheckDigits(result: IBANValidationResult): Checks['national_check_digits'] {
  if (result.country?.code !== 'GB') return 'not_checked';
  const modulus = result.modulus_check;
  // Table Vocalink absente : le contrôle n'a pas eu lieu.
  if (!modulus) return 'not_checked';
  // Aucune plage publiée ne couvre ce code guichet : pas de contrôle défini.
  if (!modulus.checked) return 'not_applicable';
  if (modulus.passed === true) return 'pass';
  if (modulus.passed === false) return 'fail';
  return 'not_checked';
}

/** Les contrôles d'une validation. À n'appeler que sur un IBAN valide. */
export function buildChecks(result: IBANValidationResult): Checks {
  const holder = result.bank_code_holder;
  const bic: Checks['bic'] =
    result.bic?.authoritative === true
      ? 'pass'
      : result.bic
        ? 'inferred'
        : holder === 'not_allocated'
          ? 'not_applicable'
          : 'unknown';

  let sepa: Checks['sepa_reachability'];
  if (!result.sepa) sepa = 'unknown';
  else if (!result.sepa.member) sepa = 'not_applicable';
  else if (result.sepa.bank_reachability === 'listed') sepa = 'pass';
  else if (result.sepa.bank_reachability === 'bank_code_not_allocated') sepa = 'fail';
  // `not_listed` (une absence du registre n'est pas une exclusion du schéma),
  // `no_bank`, ou registres non consultés (`null`).
  else sepa = 'unknown';

  return {
    iban_structure: 'pass',
    iban_checksum: 'pass',
    bank_code: bankCodeCheckStatus(holder),
    bic,
    sepa_reachability: sepa,
    national_check_digits: nationalCheckDigits(result),
    account_exists: 'not_checked',
    payee_name: 'not_checked',
    institution_sanctions: 'not_checked',
    country_sanctions: 'not_checked',
    payee_sanctions: 'not_checked',
  };
}

/**
 * La banque du bénéficiaire figure-t-elle sur une liste de sanctions ?
 *
 * `null` quand aucune banque n'a été criblée, ET quand rien ne correspond alors
 * qu'une liste que le service nomme n'est pas chargée (drapeau
 * `sanctions_list_unavailable_<liste>`) : un « non » sur les listes lues n'est
 * pas un « non » sur la liste manquante. Même règle que `sanctions.listed` de
 * `GET /v1/bic/:code` depuis le 25/09/2026.
 */
export function institutionListed(compliance: ComplianceResult): boolean | null {
  const s = compliance.sanctions;
  if (!s.bank_screened) return null;
  if (s.bank_sanctioned) return true;
  const listMissing = compliance.flags.some((f) => f.startsWith('sanctions_list_unavailable_'));
  return listMissing ? null : false;
}

/** Les contrôles d'une réponse de conformité : les deux axes de sanctions en plus. */
export function withComplianceChecks(checks: Checks, compliance: ComplianceResult): Checks {
  const listed = institutionListed(compliance);
  const country: Checks['country_sanctions'] = compliance.sanctions.country_sanctioned
    ? 'fail'
    : // Base de conformité illisible : l'axe pays peut ne pas avoir été lu, et
      // son `false` est alors un défaut, pas un constat.
      compliance.flags.includes('compliance_data_unavailable')
      ? 'unknown'
      : 'pass';
  return {
    ...checks,
    institution_sanctions: listed === true ? 'fail' : listed === false ? 'pass' : 'unknown',
    country_sanctions: country,
  };
}

/** Les contrôles qui ne concluent pas : déduits, inconnus ou jamais faits. */
export function notVerified(checks: Checks): Array<keyof Checks> {
  return CHECK_KEYS.filter((k) => {
    const v: CheckStatus = checks[k];
    return v === 'inferred' || v === 'unknown' || v === 'not_checked';
  });
}

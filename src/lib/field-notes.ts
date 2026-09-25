/**
 * Les phrases qui expliquent les champs de vérité ajoutés le 25/09/2026, écrites
 * une fois pour les surfaces qui les servent : l'OpenAPI, les schémas de sortie
 * MCP (src/mcp/output-schemas.ts) et les descriptions d'outils des deux
 * transports internes (src/mcp/server.ts, src/routes/mcp-http.ts).
 *
 * Le paquet npm `ibanforge-mcp` n'est PAS relié à ce fichier : il est figé
 * jusqu'à sa prochaine version, qui reprendra ces phrases.
 *
 * Aucun mois écrit à la main : celui de la copie figée est lu dans les comptes
 * servis (frozenBicShare), comme toutes les surfaces qui le nomment. Aucune
 * liste de sanctions nommée ici : src/routes/sanctions-claims.test.ts veille à
 * ce qu'aucune surface ne nomme une liste que la base ne porte pas.
 */
import { frozenBicShare } from './positioning.js';

/**
 * Ce que disent `source`, `source_name`, `source_as_of` et `listed_in_current_source`
 * d'une fiche BIC.
 *
 * `withMonth` lit le mois de la copie figée dans la base : réservé aux
 * descriptions construites avec le serveur, jamais à un module évalué à
 * l'import (les schémas de sortie), qui ouvrirait la base à son chargement.
 */
export function bicSourceNote(options: { withMonth?: boolean } = {}): string {
  let month: string | null = null;
  if (options.withMonth) {
    try {
      month = frozenBicShare().month;
    } catch {
      month = null;
    }
  }
  return (
    'source names the dataset of this row and source_name spells it out; source_as_of is present only when that dataset is a copy frozen at that month' +
    (month ? ` (the public copy of the SWIFT directory, frozen in ${month})` : '') +
    '. listed_in_current_source says whether this BIC8 still appears in a list refreshed this cycle (GLEIF, a national register, the EPC scheme registers, the EBA STEP2 and NBP lists): true when one of them carries it, null when it was not found in what could be read in full. ' +
    'It never answers false today: the EBA STEP2 and NBP lists are only read through our deduplicated directory, which can drop a BIC they carry, so an absence is not proven. It does not prove the bank still exists under this name.'
  );
}

/** `listed_in_current_source` sur le bloc `bic` d'une validation. */
export const LISTED_IN_CURRENT_SOURCE_NOTE =
  'Whether this BIC8 still appears in a list refreshed this cycle: GLEIF, the directory sources that carry no vintage, a national register, the EPC scheme registers. true when one of them carries it; null when it was not found in what could be read in full (never false by default). false is reserved for an index built from every list read in full, which is not the case today: the EBA STEP2 and NBP lists are only read through our deduplicated directory, so this field answers true or null. It does NOT prove the bank still exists under this name: a clearing list can keep the name of a bank that was absorbed.';

/** `source_as_of` sur le bloc `bic` d'une validation, élargi à la carte composite. */
export const BIC_SOURCE_AS_OF_NOTE =
  "Year-month the source DATA is from, present ONLY when it differs from as_of. On a curated_map or directory_prefix answer it dates the directory row that supplied the name, the city, the LEI or the address when that row comes from a frozen public copy; never present on a national_register answer, whose name comes from the register and is dated by as_of. Absent means no gap has been established, never 'this is current'.";

/** `bank_code_holder`, pour l'OpenAPI et les schémas MCP. */
export const BANK_CODE_HOLDER_NOTE =
  'Who holds the bank code. confirmed: a register that publishes holders names the holder of this code (a national register that settles the code space, or a partial register on a hit). inferred: we name a holder from a source that cannot settle it (our composite map, the prefix fallback, a published structural rule), so read it as our inference. not_allocated: the national register says nobody holds this code, so do not send. unknown: no conclusion. valid stays true in all four: it only means the IBAN is well formed. bank_code_check.status verified means resolved; this field says whether a source settles it.';

/**
 * `checks`, et l'explication des contrôles jamais faits. Aucune liste de
 * sanctions nommée : la garde des affirmations (sanctions-claims.test.ts).
 */
export const CHECKS_NOTE =
  'One status per check: pass (checked against a source that settles it), fail (checked, and wrong), inferred (answered from a source that does not settle it), unknown (attempted, no conclusion), not_checked (IBANforge does not make this check here), not_applicable (the check has no object for this IBAN). ' +
  "payee_name: never checked here; the name check is made by the payee's bank through Verification of Payee (VoP), and sepa.vop_register_status says whether that bank answers VoP requests. " +
  "account_exists: never checked here; only the payee's bank knows whether the account is open. " +
  "payee_sanctions: never checked; the sanctions screen of POST /v1/iban/compliance is made on the payee's bank (BIC8) and country only. " +
  'institution_sanctions and country_sanctions are filled by POST /v1/iban/compliance and not_checked on a validation. ' +
  'national_check_digits: the check key a country keeps inside the BBAN, a second check independent of mod-97. ' +
  'Checked for FR and MC (RIB key), BE (the last two digits, modulo 97), IT and SM (CIN) and ES (DC), with the proof in the national_check_digits block, ' +
  'and for GB (Vocalink modulus), with the proof in modulus_check; not_checked elsewhere (the German account-number methods are not checked yet). ' +
  'pass means the account number is well formed, never that the account exists; fail means it cannot have been issued as written, and valid stays true. ' +
  'A key may be added later; a key is never removed. Present only when valid is true.';

/**
 * Le bloc `national_check_digits` (clé de contrôle nationale du BBAN), pour
 * l'OpenAPI et les schémas MCP. Les pays et les noms d'algorithme cités ici
 * sont tenus par un test contre la table du module (national-check/index.ts).
 */
export const NATIONAL_CHECK_DIGITS_NOTE =
  'The check key a country keeps inside the BBAN, recomputed from the IBAN alone. Present only on a valid IBAN of FR, MC, BE, IT, SM or ES (GB has modulus_check instead); absent elsewhere, where checks.national_check_digits is not_checked. ' +
  'country is the IBAN country. scheme names the algorithm: fr_rib_key (FR and MC: the RIB key, the last two digits of the BBAN, over the bank code, branch code and account number), ' +
  'be_mod97 (BE: the last two digits, the first ten digits modulo 97, or 97 when the remainder is 0), ' +
  'it_cin (IT and SM: the CIN, the control letter at the start of the BBAN, over the ABI, CAB and account number), ' +
  'es_dc (ES: the two DC digits, positions 9 and 10 of the BBAN). ' +
  'status: pass (the key matches, so the account number is well formed; it does not prove the account exists or is open) or fail (the key does not match: this account number cannot have been issued as written, a typo or a made-up number). ' +
  'A fail never makes valid false, because the IBAN check digits are right: read the two separately, and confirm the details with the beneficiary before paying. ' +
  'not_applicable is reserved for a BBAN without the national layout, which a valid IBAN never has. ' +
  'detail, present on fail and not_applicable only, says which digits disagree; it never gives the expected key. checks.national_check_digits repeats status.';

/** `sepa.bank_reachability`. */
export const BANK_REACHABILITY_NOTE =
  'Whether the EPC scheme registers list the resolved BANK, never borrowed from the country (member, schemes and basis still describe the country and are unchanged). listed: the bank has rows in the SCT, SCT Inst or SDD register. not_listed: it has none (an absence from the register is not an exclusion from the scheme). no_bank: no BIC resolved for this bank code, so no bank could be looked up in the EPC registers (a register may still name the holder: see bank_code_holder and bank_code_check). bank_code_not_allocated: the national register says nobody holds the bank code. null: the registers are not loaded on this deployment (not consulted, never read as not_listed). Absent outside SEPA.';

/** `sepa.vop_register_status` et `compliance.vop.register_status`. */
export const VOP_REGISTER_STATUS_NOTE =
  "The bank's status in the EPC Verification of Payee register: active (the same as vop_participant true), pending, inactive, or not_listed when the register has no row for it; null when no BIC resolved or the register was not consulted (screened false). Outside the SEPA area the country answers instead of the register (not_listed on POST /v1/iban/compliance) whether or not the register is loaded; the validation carries no sepa.vop_register_status there. It says whether the payee's bank answers VoP requests; IBANforge never runs the name check itself.";

/**
 * La tête de la ligne « Returns » de validate_iban (et du lot, et de la
 * conformité, qui en reprennent la forme), dans les deux transports internes.
 */
export const VALIDATE_TRUTH_RETURNS =
  'bank_code_holder: confirmed (a register names who holds the bank code), inferred (we name a holder from a source that cannot settle it: our composite map, the prefix fallback, a published structural rule), not_allocated (the national register says nobody holds it: do not send) or unknown. valid stays true in all four: it only means the IBAN is well formed. checks: one status per check (pass, fail, inferred, unknown, not_checked, not_applicable); payee_name, account_exists and payee_sanctions are always not_checked. ' +
  'national_check_digits { country, scheme, status: pass | fail, detail? } (FR, MC, BE, IT, SM and ES only): the national key inside the BBAN; fail means the account number cannot have been issued as written, and valid stays true.';

/** Les noms honnêtes du bloc de conformité, pour la description de check_compliance. */
export const COMPLIANCE_HONEST_NAMES =
  "compliance.sanctions.institution_listed says whether the payee's bank is on a list (null when no bank was screened, where bank_sanctioned still answers false) and payee_screened is always false; compliance.reachability.listed_in_epc_registers and compliance.vop.register_status name the registers' answers, null when not consulted (screened false); outside the SEPA area the country answers (false, not_listed) whether or not the registers are loaded. The flag bank_code_inferred carries no weight.";

import { getCountryRisk } from './countries.js';
import {
  buildComplianceResult,
  type BankCodeConfidence,
  unassessableCompliance,
  unreadableComplianceResult,
} from './compliance.js';
import { getComplianceMeta, type ComplianceMeta } from './compliance-db.js';
import { enrichResult, isTestBic } from './enrich.js';
import { validateIBAN } from './iban.js';
import { validateBIC } from './bic-validator.js';
import { bicCountryName, lookup, namedRow } from './bic-lookup.js';
import { classifyIssuer } from './issuers.js';
import type { BicComplianceResponse, ComplianceResult, IBANValidationResult } from '../types.js';
import { institutionListed, withComplianceChecks } from './checks.js';

/**
 * Les noms honnêtes du bloc `compliance` (25/09/2026), AJOUTÉS à côté des
 * anciens, qui gardent leur valeur :
 * - `sanctions.institution_listed` : `bank_sanctioned` quand une banque a été
 *   criblée contre toutes les listes que le service nomme, `null` sinon ;
 *   `bank_sanctioned: false` se lisait « propre » même sans criblage ;
 * - `sanctions.payee_screened` : toujours `false`, le bénéficiaire n'est
 *   jamais criblé ;
 * - `reachability.listed_in_epc_registers` : un des trois schémas au moins,
 *   `null` quand les registres n'ont pas été consultés ;
 * - `vop.register_status` : le statut du registre VoP au bon nom, `null` quand
 *   il n'a pas été consulté.
 *
 * UNE fonction, appliquée à chaque bloc qui sort d'ici (le chemin IBAN, le
 * chemin BIC, la base illisible, l'IBAN invalide) : écrits à la main à côté de
 * chaque assembleur, ces champs dériveraient.
 */
export function withHonestNames(compliance: ComplianceResult): ComplianceResult {
  const { sanctions, reachability, vop } = compliance;
  return {
    ...compliance,
    sanctions: {
      ...sanctions,
      institution_listed: institutionListed(compliance),
      payee_screened: false,
    },
    reachability: {
      ...reachability,
      listed_in_epc_registers: reachability.screened
        ? reachability.sct || reachability.sdd || reachability.sepa_instant
        : null,
    },
    vop: {
      ...vop,
      register_status: vop.screened
        ? vop.status === 'not_found'
          ? 'not_listed'
          : vop.status
        : null,
    },
  };
}

/**
 * Ce que le score doit savoir du code banque, lu dans `bank_code_holder`
 * (25/09/2026) : `inferred` porte le drapeau sans poids `bank_code_inferred`,
 * les trois autres gardent exactement le poids qu'ils avaient. Sans détenteur
 * (enrichissement arrêté avant le verdict), l'ancienne lecture de
 * `bank_code_check`, qui donnait `confirmed` faute de verdict.
 */
function bankCodeConfidence(result: IBANValidationResult): BankCodeConfidence {
  switch (result.bank_code_holder) {
    case 'confirmed':
      return 'confirmed';
    case 'inferred':
      return 'inferred';
    case 'not_allocated':
      return 'denied';
    case 'unknown':
      return 'unverified';
    default: {
      const check = result.bank_code_check;
      return !check || check.status === 'verified'
        ? 'confirmed'
        : check.authoritative
          ? 'denied'
          : 'unverified';
    }
  }
}

/**
 * The one place a compliance response is assembled.
 *
 * ## Why this file exists
 *
 * The audit of 28/07/2026 found the same assembly written four times: the REST
 * route, both MCP servers, and the demo route. Four copies of "validate,
 * enrich, derive the arguments, score, attach the disclaimer" that nothing kept
 * in step. Two had already drifted, invisibly:
 *
 *  - `src/routes/mcp-http.ts` — the transport agents actually reach at
 *    /mcp — was the only surface that omitted `meta`, so the one caller most
 *    likely to be a machine never received the `bank_bic_only` disclaimer
 *    saying the screening is on the bank and not on the beneficiary.
 *  - The REST route derived country risk from `getCountryRisk(countryCode)`
 *    while the three others read `result.risk_indicators?.country_risk`, which
 *    is absent whenever BBAN parsing fails. That divergence is not theoretical:
 *    the comment it carries records a Russian IBAN that scored 60/high instead
 *    of critical because of exactly this.
 *
 * A shared function is not tidiness here. It is the only way a fix lands on
 * every surface at once, which the audit's headline defect needed: the missing
 * validity guard had to be closed on REST and on both MCP transports, and
 * fixing the route alone would have left the agents' surface broken.
 *
 * ## What stays with the caller
 *
 * Everything that genuinely differs: the price (`cost_usdc` depends on whether
 * the caller authenticated with a key), the timing, the stats recording, and
 * the transport's own envelope. This function owns the answer, not the framing.
 */
export interface ComplianceResponse extends IBANValidationResult {
  compliance: ComplianceResult;
  meta: ComplianceMeta;
}

export function buildComplianceResponse(iban: string): ComplianceResponse {
  const result: IBANValidationResult = validateIBAN(iban);
  enrichResult(result);

  // Nothing to screen. Returning here is the whole point of the fix: before it,
  // an unvalidatable IBAN fell through to the scorer, missed every lookup, and
  // those misses added up to 10 out of 100, which reads as 'low'. See
  // unassessableCompliance() and the note on RiskLevel in types.ts.
  if (!result.valid) {
    return {
      ...result,
      compliance: withHonestNames(unassessableCompliance()),
      meta: getComplianceMeta(),
    };
  }

  const countryCode = result.country?.code ?? '';
  const bic8 = result.bic?.code?.slice(0, 8) ?? null;
  const issuerType = result.issuer?.type ?? 'bank';
  // The bank-code verdict enrichResult already computed, fed into the score.
  // Until 29/07/2026 this endpoint ignored it and scored a fabricated bank code
  // exactly like Commerzbank, while next_steps routed callers here from the
  // endpoint that had stopped guessing. A pilot customer caught it by reading the two
  // payloads against each other.
  const bankCode = bankCodeConfidence(result);
  // Country risk comes straight from the country code — NEVER from
  // risk_indicators, which only exists when BBAN parsing/enrichment succeeded.
  // (Countries without a BBAN_STRUCTURE used to silently fall back to
  // 'standard' here: RU scored 60/high instead of >=80/critical.) This was
  // correct in the REST route and wrong in the three copies; the merge makes
  // the correct one the only one.
  const countryRisk = countryCode ? getCountryRisk(countryCode) : 'standard';
  const isTestBic = result.risk_indicators?.test_bic ?? false;

  let compliance: ComplianceResult;
  try {
    compliance = buildComplianceResult(
      true,
      countryCode,
      bic8,
      issuerType,
      countryRisk,
      isTestBic,
      bankCode,
    );
  } catch {
    // The database is unreachable, which is a different thing from an IBAN we
    // could not read: here we HAVE a valid IBAN and cannot check it, so the
    // honest answer is elevated-and-say-so, not unassessable.
    // Depuis le 25/09/2026, les axes encore lisibles répondent quand même :
    // voir unreadableComplianceResult().
    compliance = unreadableComplianceResult(
      countryCode,
      bic8,
      issuerType,
      countryRisk,
      isTestBic,
      bankCode,
    );
  }

  const honest = withHonestNames(compliance);
  return {
    ...result,
    // Les deux axes de sanctions rejoignent les contrôles de la validation.
    ...(result.checks ? { checks: withComplianceChecks(result.checks, honest) } : {}),
    compliance: honest,
    meta: getComplianceMeta(),
  };
}

/** What the caller must be told when the BIC itself is malformed. */
export interface BicComplianceRejection {
  error: 'invalid_bic_format';
  message: string;
}

/**
 * Screen a BIC directly, for the banks no IBAN can reach.
 *
 * Same scorer, same lists, same disclaimer as the IBAN path — only the way the
 * institution is identified differs, and here it is identified by the caller
 * rather than resolved by us. See BicComplianceResponse in types.ts for why
 * that route has to exist.
 */
export function buildBicComplianceResponse(
  bic: string,
): (BicComplianceResponse & { meta: ComplianceMeta }) | BicComplianceRejection {
  const validation = validateBIC(bic);
  if (!validation.valid || !validation.bic8 || !validation.country_code) {
    return {
      error: 'invalid_bic_format',
      message: 'BIC must be 8 or 11 characters in ISO 9362 form, e.g. UBSWCHZH or COBADEFFXXX.',
    };
  }

  const bic8 = validation.bic8;
  const countryCode = validation.country_code;
  // The directory is consulted to NAME the institution, never to decide whether
  // to screen it. A miss here is a gap in our coverage, not an absence of risk.
  // Une ligne sans nom ne nomme personne : traitée comme introuvable, comme
  // GET /v1/bic/:code (25/09/2026).
  const row = namedRow(lookup(bic8));
  const known = classifyIssuer(bic8, row?.institution ?? undefined);
  const issuerType = known?.type ?? 'bank';
  const countryRisk = getCountryRisk(countryCode);

  let compliance: ComplianceResult;
  try {
    // `bankCode` stays at its default: there is no bank code in play, so there
    // is nothing to confirm or deny about one. Scoring it as 'unverified' would
    // penalise the caller for a check this input does not involve.
    compliance = buildComplianceResult(
      true,
      countryCode,
      bic8,
      issuerType,
      countryRisk,
      isTestBic(bic8),
    );
  } catch {
    compliance = unreadableComplianceResult(
      countryCode,
      bic8,
      issuerType,
      countryRisk,
      isTestBic(bic8),
    );
  }

  return {
    bic: validation.bic,
    bic8,
    valid_format: true,
    found: row !== null,
    institution: row?.institution ?? null,
    // Le nom du pays, même pour un BIC que l'annuaire ne porte pas : il
    // répondait le code sous le nom `name` (25/09/2026).
    country: { code: countryCode, name: bicCountryName(row, countryCode) },
    compliance: withHonestNames(compliance),
    meta: getComplianceMeta(),
    cost_usdc: 0,
  };
}

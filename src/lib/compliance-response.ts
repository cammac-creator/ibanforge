import { getCountryRisk } from './countries.js';
import { buildComplianceResult, type BankCodeConfidence, unassessableCompliance } from './compliance.js';
import { getComplianceMeta, type ComplianceMeta } from './compliance-db.js';
import { enrichResult } from './enrich.js';
import { validateIBAN } from './iban.js';
import type { ComplianceResult, IBANValidationResult } from '../types.js';

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
    return { ...result, compliance: unassessableCompliance(), meta: getComplianceMeta() };
  }

  const countryCode = result.country?.code ?? '';
  const bic8 = result.bic?.code?.slice(0, 8) ?? null;
  const issuerType = result.issuer?.type ?? 'bank';
  // The bank-code verdict enrichResult already computed, fed into the score.
  // Until 29/07/2026 this endpoint ignored it and scored a fabricated bank code
  // exactly like Commerzbank, while next_steps routed callers here from the
  // endpoint that had stopped guessing. A pilot customer caught it by reading the two
  // payloads against each other.
  const check = result.bank_code_check;
  const bankCode: BankCodeConfidence =
    !check || check.status === 'verified'
      ? 'confirmed'
      : check.authoritative
        ? 'denied'
        : 'unverified';
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
    compliance = buildComplianceResult(true, countryCode, bic8, issuerType, countryRisk, isTestBic, bankCode);
  } catch {
    // The database is unreachable, which is a different thing from an IBAN we
    // could not read: here we HAVE a valid IBAN and cannot check it, so the
    // honest answer is elevated-and-say-so, not unassessable.
    compliance = {
      sanctions: { country_sanctioned: false, bank_sanctioned: false, matched_lists: [], fatf_status: 'non_member', bank_screened: false },
      reachability: { sepa_instant: false, sct: false, sdd: false, screened: false },
      vop: { participant: false, status: 'not_found', screened: false },
      risk_score: 50,
      risk_level: 'elevated',
      flags: ['compliance_data_unavailable'],
    };
  }

  return { ...result, compliance, meta: getComplianceMeta() };
}

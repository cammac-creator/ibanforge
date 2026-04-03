/**
 * IBANforge — Post-validation enrichment (BIC, issuer, SEPA, risk)
 *
 * Centralizes the enrichment logic used by routes, batch, and MCP.
 */

import { lookupByCountryBank } from './bic-lookup.js';
import { classifyIssuer } from './issuers.js';
import { getCountryRisk } from './countries.js';
import type { IBANValidationResult } from '../types.js';

/**
 * Enrich a valid IBAN result with BIC lookup, issuer classification,
 * and risk indicators. Mutates the result object in place.
 */
export function enrichResult(result: IBANValidationResult): void {
  if (!result.valid || !result.bban?.bank_code) return;

  const cc = result.country!.code;

  // BIC lookup
  result.bic = lookupByCountryBank(cc, result.bban.bank_code);

  // Issuer classification
  if (result.bic) {
    const known = classifyIssuer(result.bic.code);
    result.issuer = known ?? { type: 'bank', name: result.bic.bank_name ?? 'Unknown' };
  }

  // Risk indicators
  result.risk_indicators = {
    issuer_type: result.issuer?.type ?? 'bank',
    country_risk: getCountryRisk(cc),
    test_bic: false,
    sepa_reachable: result.sepa?.member ?? false,
    vop_coverage: result.sepa?.vop_required ?? false,
  };
}

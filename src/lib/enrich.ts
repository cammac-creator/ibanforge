/**
 * IBANforge — Post-validation enrichment (BIC, issuer, SEPA, risk)
 *
 * Centralizes the enrichment logic used by routes, batch, and MCP.
 */

import { lookupByCountryBank, countryHasReferenceData, getReferenceAsOf } from './bic-lookup.js';
import { classifyIssuer } from './issuers.js';
import { getCountryRisk } from './countries.js';
import { lookupClearingByBankCode } from './ch-clearing.js';
import type { BankCodeCheck, IBANValidationResult } from '../types.js';

/**
 * A BIC is a test/internal institution if the second character of the
 * location code is "0" (ISO 9362 §5.3). The location code occupies
 * positions 7-8 (0-indexed) of the BIC.
 */
export function isTestBic(bicCode: string | null | undefined): boolean {
  return !!bicCode && bicCode.length >= 8 && bicCode[7] === '0';
}

/**
 * Countries whose bank code we check against the national register itself
 * rather than against a composite map, and where an absence is therefore
 * evidence that the code is not allocated.
 *
 * SIX BankMaster is the Swiss register of IIDs (BC-Nummern); it is downloaded
 * and reseeded monthly by the same workflow that refreshes the BIC set, and it
 * covers Liechtenstein alongside Switzerland. Nothing else we hold is a national
 * register: `source='bundesbank'` is 144 rows, `nbp` 21, `eba_step2` 189 — those
 * are supplementary, not exhaustive, so promoting them would be an overclaim.
 *
 * Adding a country here is a claim that a miss means non-existence. It requires
 * ingesting that country's register, not merely improving coverage.
 */
const NATIONAL_REGISTERS: Record<string, string> = {
  CH: 'SIX BankMaster (Swiss IID / BC-Nummer register)',
  LI: 'SIX BankMaster (Swiss IID / BC-Nummer register)',
};

/**
 * Named for what it is, not for what fed it.
 *
 * This string used to list the contributing sources, Bundesbank among them. A
 * customer asking whether we check German bank codes against the Bundesbank
 * register would read that as yes, while `authoritative: false` on the same
 * object says no — the two fields contradicting each other on the exact point at
 * issue. The provenance belongs in the documentation, where it cannot be mistaken
 * for a claim of exhaustiveness. `source='bundesbank'` is 144 rows.
 */
const COMPOSITE_REGISTER = 'IBANforge composite bank-code map (assembled from BIC directories, not a national bank-code register)';

/**
 * Decide the bank-code verdict, and be explicit about how much it is worth.
 *
 * For CH and LI the register answers on its own: an allocated IID identifies a
 * real institution whether or not we also hold a BIC for it, so existence and
 * BIC availability are answered separately instead of being collapsed the way
 * `bic: null` collapsed them.
 */
function checkBankCode(
  cc: string,
  bankCode: string,
  hit: { match: 'register' | 'prefix'; candidates?: number } | null,
): BankCodeCheck {
  const as_of = getReferenceAsOf();
  const national = NATIONAL_REGISTERS[cc];

  if (national) {
    const allocated = lookupClearingByBankCode(bankCode);
    return {
      value: bankCode,
      status: allocated ? 'verified' : 'not_in_register',
      match: allocated ? 'register' : null,
      register: national,
      authoritative: true,
      as_of,
    };
  }

  if (hit) {
    return {
      value: bankCode,
      status: 'verified',
      match: hit.match,
      register: COMPOSITE_REGISTER,
      authoritative: false,
      ...(hit.match === 'prefix' ? { candidates: hit.candidates ?? 1 } : {}),
      as_of,
    };
  }

  const hasData = countryHasReferenceData(cc);
  return {
    value: bankCode,
    status: hasData ? 'not_in_register' : 'unavailable',
    match: null,
    register: hasData ? COMPOSITE_REGISTER : null,
    authoritative: false,
    as_of,
  };
}

/**
 * Enrich a valid IBAN result with BIC lookup, issuer classification,
 * and risk indicators. Mutates the result object in place.
 */
export function enrichResult(result: IBANValidationResult): void {
  // Make the invariant local and explicit instead of relying on a non-null
  // assertion on result.country (a valid IBAN always carries country + bban,
  // but the guard documents and enforces it here).
  if (!result.valid || !result.country || !result.bban?.bank_code) return;

  const cc = result.country.code;
  const bankCode = result.bban.bank_code;

  // BIC lookup
  const hit = lookupByCountryBank(cc, bankCode);
  result.bic = hit ? { code: hit.code, bank_name: hit.bank_name, city: hit.city } : null;

  // Issuer classification — BIC8 exact match, then institution-name fallback
  if (result.bic) {
    // 'bank' is the fallback for every BIC8 the curated set does not name, which
    // is 47,356 of 48,386 (97.9%, measured 29/07/2026). Mostly right, and still
    // an assumption dressed as a determination — the same defect as defaulting
    // issuer_type on an unresolved bank code, one layer down. Saying which of
    // the two it is costs one field and lets a caller sizing virtual-IBAN
    // exposure count only the identifications.
    const known = classifyIssuer(result.bic.code, result.bic.bank_name ?? undefined);
    result.issuer = known
      ? { ...known, classification: 'curated' }
      : { type: 'bank', name: result.bic.bank_name ?? 'Unknown', classification: 'default' };
  }

  result.risk_indicators = {
    // Null, not 'bank'. The old default typed an institution we had not found,
    // which is exactly the assertion a payee pre-flight must not be handed.
    issuer_type: result.issuer?.type ?? null,
    country_risk: getCountryRisk(cc),
    test_bic: isTestBic(result.bic?.code),
    sepa_reachable: result.sepa?.member ?? false,
    // The value was never wrong; the name invited an account-level reading of a
    // country-level fact. Germany is SEPA-reachable whether or not this
    // particular bank code exists.
    sepa_reachable_scope: 'country',
    vop_coverage: result.sepa?.vop_required ?? false,
  };

  result.bank_code_check = checkBankCode(cc, bankCode, hit);

  // Swiss clearing enrichment (CH and LI IBANs)
  if ((cc === 'CH' || cc === 'LI') && result.bban?.bank_code) {
    const clearing = lookupClearingByBankCode(result.bban.bank_code);
    if (clearing) {
      result.clearing = {
        iid: clearing.iid,
        name: clearing.name,
        type: clearing.institution_type,
        town: clearing.address.town,
        sic: clearing.payment_services.sic,
        instant_payments_chf: clearing.payment_services.instant_payments_chf,
        eurosic: clearing.payment_services.eurosic,
        qr_iid: clearing.qr_iid,
        // QR-IBAN: the BBAN carries a QR-IID (30000–31999); iid above is the
        // institution's standard IID, qr_iid the one from the IBAN.
        ...(clearing.is_qr_iid ? { is_qr_iid: true } : {}),
      };
    } else {
      result.clearing = null;
    }
  }
}

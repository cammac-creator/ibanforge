/**
 * IBANforge — Post-validation enrichment (BIC, issuer, SEPA, risk)
 *
 * Centralizes the enrichment logic used by routes, batch, and MCP.
 */

import {
  lookupByCountryBank,
  countryHasReferenceData,
  getReferenceAsOf,
  lookupByBic11,
  registeredAddress,
} from './bic-lookup.js';
import { classifyIssuer } from './issuers.js';
import { lookupFiInstitution } from './fi-register.js';
import { lookupNationalCode, nationalRegisterAvailable } from './national-registers.js';
import { lookupNlPsp } from './nl-psp.js';
import { getCountryRisk } from './countries.js';
import { lookupClearingByBankCode } from './ch-clearing.js';
import { blzRegisterAvailable, lookupBlz } from './de-blz.js';
import { checkVop } from './compliance.js';
import { checkUkModulus } from './uk-modulus.js';
import type { BankCodeCheck, IBANValidationResult, RegisterInstitution } from '../types.js';
import { nextSteps } from './next-steps.js';

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
  DE: 'Deutsche Bundesbank Bankleitzahlendatei',
  // Finland says what it is worth in the string itself. CH, LI and DE allocate
  // to institutions; Finland allocates prefixes to banking groups, so a hit
  // confirms the group rather than a specific bank. Same field name, weaker
  // positive, and leaving that undeclared would be the collapse this whole
  // verdict exists to undo.
  FI: 'Finance Finland monetary institution codes (allocated to banking groups, not individual institutions)',
  AT: 'Oesterreichische Nationalbank SEPA-Zahlungsverkehrs-Verzeichnis',
  BE: 'Banque nationale de Belgique, bank identification codes (Protocol Secretariat)',
};

/**
 * Ask the right register for a country. Each returns whether the code is
 * allocated and, when the register says so, that it is being retired and what
 * takes over.
 */
function askNationalRegister(
  cc: string,
  bankCode: string,
  bban?: string,
): {
  allocated: boolean;
  retired?: true;
  successor?: string;
  /** The code actually checked, when it is not the positional slice. */
  value?: string;
  /** The register defines this space but names no holder: decline, do not deny. */
  inconclusive?: true;
  /** What the register publishes about the allocated institution. */
  institution?: RegisterInstitution;
} | null {
  if (cc === 'CH' || cc === 'LI') {
    const hit = lookupClearingByBankCode(bankCode);
    if (!hit) return { allocated: false };
    return {
      allocated: true,
      institution: {
        name: hit.name,
        // SIX splits street and house number; GLEIF and the OeNB publish one
        // line. Serve the one-line shape everywhere.
        street: [hit.address.street, hit.address.building_number].filter(Boolean).join(' ') || null,
        post_code: hit.address.post_code,
        town: hit.address.town,
        country: hit.address.country || cc,
      },
    };
  }
  if (cc === 'FI') {
    // Finland needs the whole BBAN, not the 3-digit slice: institution codes
    // run 1 to 4 characters and only the longest allocated prefix is the real
    // one. Asking about the slice would read Nordea's '1' as '123' and deny
    // the country's largest bank.
    if (!bban) return null;
    const hit = lookupFiInstitution(bban);
    if (!hit) return null;
    if (hit.status === 'unknown') return { allocated: false, inconclusive: true };
    if (hit.status === 'not_allocated') return { allocated: false };
    return { allocated: true, value: hit.code };
  }
  if (cc === 'AT' || cc === 'BE') {
    // Same safe failure as Germany: no table means no ground truth, so decline
    // authority rather than reading every code as unallocated.
    if (!nationalRegisterAvailable(cc)) return null;
    const hit = lookupNationalCode(cc, bankCode);
    if (!hit) return { allocated: false };
    return {
      allocated: true,
      institution: {
        name: hit.name,
        // OeNB: full seat address. BNB: names only — nulls are the honest
        // shape of what Belgium publishes, not missing data on our side.
        street: hit.street,
        post_code: hit.post_code,
        town: hit.town,
        country: cc,
        ...(hit.lei ? { lei: hit.lei } : {}),
      },
    };
  }
  if (cc === 'DE') {
    // A database built before the seeder existed has no table. Declining
    // authority is the safe failure: Germany degrades to the composite map it
    // used before rather than claiming every code is unallocated.
    if (!blzRegisterAvailable()) return null;
    const hit = lookupBlz(bankCode);
    if (!hit) return { allocated: false };
    return {
      allocated: true,
      institution: {
        name: hit.name,
        // The Bankleitzahlendatei has no street column at all — PLZ and Ort
        // are the whole address the register publishes.
        street: null,
        post_code: hit.post_code,
        town: hit.town,
        country: 'DE',
      },
      ...(hit.retired ? { retired: true as const } : {}),
      ...(hit.successor ? { successor: hit.successor } : {}),
    };
  }
  return null;
}

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
  bban?: string,
): BankCodeCheck {
  const as_of = getReferenceAsOf();
  const national = NATIONAL_REGISTERS[cc];

  const verdict = national ? askNationalRegister(cc, bankCode, bban) : null;
  if (national && verdict?.inconclusive) {
    // The register defines this code space but publishes no holder for it.
    // Silence is not a denial, so this reports unavailable and drops the
    // authority claim rather than telling a caller to stop a payment.
    return {
      value: verdict.value ?? bankCode,
      status: 'unavailable',
      match: null,
      register: national,
      authoritative: false,
      as_of,
    };
  }
  if (national && verdict) {
    return {
      value: verdict.value ?? bankCode,
      status: verdict.allocated ? 'verified' : 'not_in_register',
      match: verdict.allocated ? 'register' : null,
      register: national,
      authoritative: true,
      ...(verdict.retired ? { retired: true as const } : {}),
      ...(verdict.successor ? { superseded_by: verdict.successor } : {}),
      ...(verdict.institution ? { institution: verdict.institution } : {}),
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
  result.bic = hit
    ? { code: hit.code, bank_name: hit.bank_name, city: hit.city, source: hit.source, as_of: hit.as_of }
    : null;

  // Germany: the Bundesbank register carries the exact 11-character BIC per
  // BLZ, so serve it over the composite BIC8 fallback. The fallback resolves
  // the first eight characters, and for Sparkassen and cooperative banks those
  // eight name the shared clearing institution — the Landesbank — not the bank
  // holding the account. A German integrator measured the failure precisely
  // (BLZ 55350010 is a Sparkasse with BIC MALADE51WOR, while MALADE51 alone is
  // the Landesbank) and dropped the API over it. Register truth first; the
  // composite stays as the fallback for the 2 of 3,506 BLZ without a BIC.
  if (cc === 'DE') {
    const reg = lookupBlz(bankCode);
    if (reg?.bic) {
      // Provenance follows the answer: this BIC comes from the national
      // register, not from the directory the fallback would have read.
      result.bic = {
        code: reg.bic,
        bank_name: reg.name,
        city: reg.town,
        source: NATIONAL_REGISTERS.DE,
        as_of: getReferenceAsOf() || null,
      };
    }
  }

  // The directory row behind the resolved BIC, for the fields this block used
  // to drop on the floor.
  //
  // Until now `validate` answered code / bank_name / city and stopped, while
  // `/v1/bic/:code` served the LEI and the registered address off the very same
  // row — so a caller who validated an IBAN paid a second lookup for data
  // already fetched. Nothing new is downloaded here: `bic_entries` has carried
  // `lei`, `lei_status`, `street`, `post_code`, `region` and `address_en` since
  // the first GLEIF seed.
  //
  // The lookup is by BIC11, so a branch code resolves the branch's own row.
  // No branch guard is needed at this layer — it runs at seed time — and adding
  // one here would risk disagreeing with it.
  if (result.bic?.code) {
    const code = result.bic.code;
    const row = lookupByBic11(code.length === 8 ? `${code}XXX` : code);
    if (row) {
      result.bic.lei = row.lei ?? null;
      result.bic.lei_status = row.lei_status ?? null;
      // Dated and sourced by the shared builder. An address that arrives beside
      // a monthly-refreshed bank name reads as equally current; it usually is
      // not, and `as_of` is what stops that reading.
      result.bic.address = registeredAddress(row, cc);
    }
  }

  // Issuer classification — BIC8 exact match, then institution-name fallback
  if (result.bic) {
    // 'bank' is the fallback for every BIC8 the curated set does not name, which
    // is 42,195 of 43,199 (97.7%, recounted 29/07/2026 against bic_entries; the
    // count drifts at every monthly refresh, so re-measure before quoting it).
    // Mostly right, and still
    // an assumption dressed as a determination — the same defect as defaulting
    // issuer_type on an unresolved bank code, one layer down. Saying which of
    // the two it is costs one field and lets a caller sizing virtual-IBAN
    // exposure count only the identifications.
    const known = classifyIssuer(result.bic.code, result.bic.bank_name ?? undefined);
    result.issuer = known
      ? { ...known, classification: 'curated' }
      : { type: 'bank', name: result.bic.bank_name ?? 'Unknown', classification: 'default' };

    // Does the country's own list of IBAN-issuing providers name this holder?
    //
    // Only the Netherlands publishes one today, and it exists because the Dutch
    // bank code is an identifier handed to a provider BECAUSE it issues IBANs.
    // Holding a Dutch BIC is a different fact: measured 29/07/2026, only 90 of
    // our 815 Dutch keys are on that list, and a fabricated IBAN carrying SHEL
    // was served as a bank named SHELL ASSET MANAGEMENT COMPANY B.V.
    //
    // 'not_listed' drops the type to null rather than denying the code. The
    // list is not exhaustive, so absence is not proof of non-issuance; but
    // 'bank' was an assertion we could not support, which is the same defect
    // this file already fixed one layer down for unresolved bank codes.
    if (cc === 'NL') {
      const listed = lookupNlPsp(bankCode);
      result.issuer.iban_issuer = listed ? 'confirmed' : 'not_listed';
      if (!listed && result.issuer.classification === 'default') result.issuer.type = null;
    }
  }

  // VoP readiness at the BANK level: is the resolved institution listed as
  // "ready" in the EPC Verification of Payee scheme register? Country-level
  // duty already lives in sepa.vop_required; this answers the other half a
  // payer needs since the IPR deadlines (euro-area PSPs answer VoP since
  // 2025-10-09, payer-side real-time checks since 2026-04). Null when no
  // institution was resolved — same rule as issuer.type: no substantiated
  // subject, no claim about it.
  if (result.sepa) {
    result.sepa.vop_participant = result.bic?.code
      ? checkVop(result.bic.code.slice(0, 8)).participant
      : null;
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

  // The BBAN, taken from the normalised IBAN rather than reassembled from the
  // parsed parts: Finland resolves on the whole string, and a country whose
  // bank_code slice is not a prefix of the BBAN would silently reassemble wrong.
  result.bank_code_check = checkBankCode(cc, bankCode, hit, result.iban.slice(4));

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
        // An ordinary Swiss IBAN used to answer `qr_iid: null` unconditionally,
        // because SIX only publishes the pairing on the QR row. The reverse
        // index in ch-clearing.ts resolves it; `qr_iid_source` distinguishes the
        // pairing SIX publishes from the one inherited from a head office.
        qr_iid_source: clearing.qr_iid_source,
        ...(clearing.qr_iids ? { qr_iids: clearing.qr_iids } : {}),
        // QR-IBAN: the BBAN carries a QR-IID (30000–31999); iid above is the
        // institution's standard IID, qr_iid the one from the IBAN.
        ...(clearing.is_qr_iid ? { is_qr_iid: true } : {}),
      };
    } else {
      result.clearing = null;
    }
  }

  // United Kingdom: a GB IBAN carries the sorting code and the account number
  // whole, so the national checksum over the pair can be run on what we already
  // parsed — no extra input, no extra call. mod97 proved the string was
  // transcribed correctly; this proves the pair is one the owning institution
  // could have issued, which is a different and stronger claim.
  //
  // The sorting code lives in branch_code, not bank_code: a GB BBAN is
  // 4!a6!n8!n, so bank_code holds the four-letter institution mnemonic.
  //
  // Silent when the reference table is not loaded, rather than reporting a check
  // that did not happen.
  if (cc === 'GB' && result.bban.branch_code) {
    const modulus = checkUkModulus(result.bban.branch_code, result.bban.account_number);
    if (modulus) result.modulus_check = modulus;
  }

  // Last, so every field it reasons about is already populated.
  result.next_steps = nextSteps(result);
}

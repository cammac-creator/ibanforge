/**
 * IBANforge — Post-validation enrichment (BIC, issuer, SEPA, risk)
 *
 * Centralizes the enrichment logic used by routes, batch, and MCP.
 */

import {
  lookupByCountryBank,
  countryHasReferenceData,
  getReferenceAsOf,
  lookup,
  registeredAddress,
  bic8CountForPrefix,
  type BankLookupHit,
} from './bic-lookup.js';
import { classifyIssuer } from './issuers.js';
import { lookupFiInstitution } from './fi-register.js';
import { lookupNationalCode, nationalRegisterAvailable } from './national-registers.js';
import { lookupNlPsp } from './nl-psp.js';
import { getCountryRisk } from './countries.js';
import { lookupClearingByBankCode, lookupClearingSeatByBic } from './ch-clearing.js';
import { toIso20022PostalAddress, type Iso20022PostalAddress } from './postal-address.js';
import { blzRegisterAvailable, lookupBlz } from './de-blz.js';
import { bgBaeRegisterAvailable, getBgAsOf, lookupBgBankCode } from './bg-bae.js';
import { checkVop } from './compliance.js';
import { checkUkModulus } from './uk-modulus.js';
import { praAuthorisationByLei } from './pra-banks.js';
import { officialIdentityByNationalCode } from './official-identity.js';
import { psdRegistrationByBankCode, type PsdEntityType } from './psd-register.js';
import type { BankCodeCheck, BicBasis, IBANValidationResult, RegisterInstitution } from '../types.js';
import { nextSteps } from './next-steps.js';

/**
 * The `bic` block of a validation result, widened with the ISO 20022 postal
 * address. Declared here, beside its only usage, rather than in src/types.ts —
 * see the note at the assignment site.
 */
type BicBlockWithPostalAddress = NonNullable<IBANValidationResult['bic']> & {
  postal_address?: Iso20022PostalAddress;
};

/**
 * A BIC is a test/internal institution if the second character of the
 * location code is "0" (ISO 9362 §5.3). The location code occupies
 * positions 7-8 (0-indexed) of the BIC.
 */
export function isTestBic(bicCode: string | null | undefined): boolean {
  return !!bicCode && bicCode.length >= 8 && bicCode[7] === '0';
}

/**
 * The Bulgarian register, named as the licence requires it to be named.
 *
 * Written out rather than abbreviated on purpose: "BNB" already means the
 * Banque nationale de Belgique everywhere else in this codebase, and two
 * central banks behind one abbreviation is how a Belgian answer ends up wearing
 * a Bulgarian credit.
 */
const BG_REGISTER_NAME = 'Bulgarian National Bank, BAE register';

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
  // Bulgaria says what the claim covers, like Finland does. A BAE code is the
  // NOTE: the bare name lives in BG_REGISTER_NAME below — the caveat qualifies
  // the VERDICT, and repeating it beside a BIC would attach it to a field it
  // says nothing about.
  // bank code AND the branch digits (IBAN positions 5-12); the register
  // allocates the four-letter bank-code space exhaustively, but 28 of its 36
  // banks publish a single branch code while one publishes 63, so only the bank
  // code is verified. Spelled out in full: "BNB" already means the Banque
  // nationale de Belgique one line above.
  BG: `${BG_REGISTER_NAME} (bank code, IBAN positions 5-8; branch digits are not separately verified)`,
};

/**
 * EBA PSD2 register types that map onto an issuer type, and the ones that
 * deliberately do not.
 *
 * `aisp` is absent because an account information service provider reads
 * accounts and issues none. `exempted_emi` and `exempted_payment_institution`
 * are absent because they are waivers from authorisation, granted to operators
 * below a volume threshold — the opposite of a licence to issue, and 2,758 of
 * the register's 4,416 authorised entities are exempted Polish ones. Reading
 * either as an issuer type would be the overclaim `classification` exists to
 * prevent.
 */
const PSD_TYPE_TO_ISSUER: Partial<Record<PsdEntityType, 'emi' | 'payment_institution'>> = {
  emi: 'emi',
  payment_institution: 'payment_institution',
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
  /**
   * Year-month the REGISTER itself states, when it publishes one of its own.
   *
   * Most registers are re-read on our monthly cycle and the database refresh
   * date is the honest answer for them. The Bulgarian one is republished on
   * request rather than on a calendar and carries its own effective date, so
   * dating it with our refresh month would claim a freshness its publisher
   * never stated — and that date is half of the attribution its terms require.
   */
  as_of?: string;
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
  if (cc === 'BG') {
    // Same safe failure as Germany: no table means no ground truth, so decline
    // authority rather than reading every Bulgarian code as unallocated.
    if (!bgBaeRegisterAvailable()) return null;
    // The four-letter bank code only. The IBAN's branch digits are NOT passed:
    // the register allocates the bank-code space exhaustively, but does not
    // enumerate every bank's branches to the same standard, so denying on the
    // branch would be a denial off a coverage gap. See lib/bg-bae.ts.
    // Dated from the register on the negative branch too: a denial a caller
    // will act on has to say how current the list behind it is, and the
    // database refresh month would overstate that.
    const registerDate = getBgAsOf()?.slice(0, 7);
    const hit = lookupBgBankCode(bankCode);
    if (!hit) return { allocated: false, as_of: registerDate };
    return {
      allocated: true,
      institution: {
        name: hit.name,
        // Names only, as the register publishes them — the same honest shape as
        // Belgium. Nulls here are what Bulgaria publishes, not missing data on
        // our side, and inventing an address would be the distortion the
        // Bulgarian National Bank's terms forbid.
        street: null,
        post_code: null,
        town: null,
        country: 'BG',
      },
      as_of: hit.as_of.slice(0, 7),
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
 * Countries whose own authority PUBLISHES that the IBAN's bank-code positions
 * are the first four characters of the institution's BIC.
 *
 * This is not a register and it is not our own inference — it is a documented
 * structural rule, which is a strictly better provenance than "assembled from
 * BIC directories" for the pairing it explains. Latvijas Banka publishes it for
 * the Latvian IBAN (positions 5-8), and the Gibraltar Financial Services
 * Commission publishes the same rule in Guidance Note 07.
 *
 * ## Why `authoritative` stays false
 *
 * The rule tells you how to READ the IBAN. It does not tell you the BIC it
 * points at was ever allocated, and it does not make our directory exhaustive.
 * Setting `authoritative: true` here would license a `not_in_register` verdict
 * — "this code is not allocated, do not send" — off a coverage gap. That is the
 * exact overclaim NATIONAL_REGISTERS above is documented to require real
 * ingestion for, and no amount of published structure substitutes for it.
 *
 * ## Why it only relabels a pairing we already made
 *
 * Both countries already resolve through the curated map and did so before this
 * rule was named: LV `HABA` → HABALV22, GI `TNOV` → TNOVGIGI. Nothing in the
 * verdict changes. What changes is that the answer stops crediting our own
 * assembly for a pairing a central bank published, and starts saying how many
 * institutions the rule alone actually singles out.
 */
const STRUCTURAL_BIC_PREFIX_RULE: Record<string, string> = {
  LV: 'structural rule published by Latvijas Banka (IBAN positions 5-8 are the first four characters of the BIC)',
  GI: 'structural rule published by the Gibraltar Financial Services Commission (Guidance Note 07: IBAN positions 5-8 are the first four characters of the BIC)',
};

/**
 * Does the published structural rule explain this pairing?
 *
 * Requires all three: the country publishes the rule, the bank code is the four
 * letters the rule speaks about, and the BIC we actually resolved really does
 * begin with it. The third condition is what keeps this honest — crediting a
 * rule for a pairing the rule does not produce would be a worse citation than
 * the vague one it replaces.
 */
function structuralPrefixRule(
  cc: string,
  bankCode: string,
  resolvedBic: string | null | undefined,
): { register: string; candidates: number } | null {
  const register = STRUCTURAL_BIC_PREFIX_RULE[cc];
  if (!register || !resolvedBic) return null;
  if (!/^[A-Z]{4}$/.test(bankCode)) return null;
  if (!resolvedBic.toUpperCase().startsWith(bankCode)) return null;
  return { register, candidates: bic8CountForPrefix(cc, bankCode) };
}

/**
 * Decide the bank-code verdict, and be explicit about how much it is worth.
 *
 * For CH and LI the register answers on its own: an allocated IID identifies a
 * real institution whether or not we also hold a BIC for it, so existence and
 * BIC availability are answered separately instead of being collapsed the way
 * `bic: null` collapsed them.
 *
 * Every path out of here is a VERDICT. The guard that stands between this
 * function and the response is `checkBankCode` below — read its note before
 * adding a reference lookup anywhere in this file.
 */
function decideBankCode(
  cc: string,
  bankCode: string,
  // `code` joined the shape for the LV/GI structural rule: crediting a
  // published rule for a pairing requires checking the rule actually produces
  // it, and that check is `resolvedBic.startsWith(bankCode)`.
  hit: { match: 'register' | 'prefix'; candidates?: number; code: string } | null,
  bban: string | undefined,
  /**
   * A reference lookup this verdict would have read already failed. Consulted
   * ONLY in the composite fallback at the bottom: a national register that
   * answered on its own is a better answer than the composite map ever was, and
   * discarding it because a second source was unreadable would throw away the
   * only authoritative verdict in the response.
   */
  lookupFailed: boolean,
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
      reason: 'register_names_no_holder',
      match: null,
      register: national,
      authoritative: false,
      as_of: verdict.as_of ?? as_of,
    };
  }
  if (national && verdict) {
    return {
      value: verdict.value ?? bankCode,
      status: verdict.allocated ? 'verified' : 'not_in_register',
      ...(verdict.allocated ? {} : { reason: 'not_allocated' as const }),
      match: verdict.allocated ? 'register' : null,
      register: national,
      authoritative: true,
      ...(verdict.retired ? { retired: true as const } : {}),
      ...(verdict.successor ? { superseded_by: verdict.successor } : {}),
      ...(verdict.institution ? { institution: verdict.institution } : {}),
      // The register's own date where it publishes one, our refresh month
      // otherwise. See the `as_of` note on the verdict shape above.
      as_of: verdict.as_of ?? as_of,
    };
  }

  if (hit) {
    // LV and GI: credit the authority that published the rule, not our own
    // assembly. See STRUCTURAL_BIC_PREFIX_RULE — the verdict is unchanged,
    // `authoritative` stays false, and `candidates` says how many institutions
    // the rule alone leaves standing.
    const structural = structuralPrefixRule(cc, bankCode, hit.code);
    if (structural) {
      return {
        value: bankCode,
        status: 'verified',
        match: hit.match,
        register: structural.register,
        authoritative: false,
        ...(structural.candidates > 1 ? { candidates: structural.candidates } : {}),
        as_of,
      };
    }

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

  // Nothing resolved. Two very different things can produce that, and only one
  // of them is an answer: the composite map really has no such code, or the
  // lookup that would have found it could not run. Asking
  // countryHasReferenceData() here would answer the first question with the
  // second one's evidence and publish `not_in_register` off an outage.
  if (lookupFailed) {
    return {
      value: bankCode,
      status: 'unavailable',
      reason: 'lookup_failed',
      match: null,
      register: null,
      authoritative: false,
      as_of,
    };
  }

  // A country whose register we normally decide against, reaching this line,
  // reached it because that register could not be consulted — `national` is
  // set and `askNationalRegister` returned nothing. The status below is
  // unchanged (a composite miss is a composite miss, and it already carries
  // `authoritative: false`), but the reason must not say "absent from our
  // reference data" when the reference data that decides this country was
  // never read.
  const registerDown = !!national;
  const hasData = countryHasReferenceData(cc);
  return {
    value: bankCode,
    status: hasData ? 'not_in_register' : 'unavailable',
    reason: registerDown
      ? 'national_register_unavailable'
      : hasData
        ? 'absent_from_reference_data'
        : 'no_reference_data_for_country',
    match: null,
    register: hasData ? COMPOSITE_REGISTER : null,
    authoritative: false,
    as_of,
  };
}

/**
 * The verdict, with a failure of ours barred from ever wearing its clothes.
 *
 * ## The failure this exists to stop
 *
 * `not_in_register` is the one answer in this API a caller may act on as
 * non-existence: on an authoritative country it means "no institution holds
 * this account, do not send". Every path that produces it reads a database. So
 * a database that cannot be read — a corrupt file, a table missing after a bad
 * deploy, a statement that raises mid-query — must not be allowed to arrive at
 * the caller as anything a payment engine could mistake for a refusal.
 *
 * Before this guard the two outcomes of an unreadable reference set were a 500
 * (the whole request, and in `/v1/iban/batch` the whole batch of 100, lost over
 * one row) or, worse, silence: a lookup that returns nothing instead of raising
 * lands on `not_in_register` and reads exactly like a denial.
 *
 * `unavailable` is the state the field already carries for "we hold no opinion
 * here", and it is what a caller is already documented to treat as "let the
 * downstream name check decide". Mapping our own failure onto it says the true
 * thing with vocabulary the integrator has already implemented.
 *
 * ## Why this is not a silent catch
 *
 * Nothing is swallowed: the failure becomes an explicit, machine-readable state
 * in the payload rather than an exception the caller cannot see. The house rule
 * this respects is the one against a catch that produces a WRONG answer — and
 * the wrong answer here would be a refusal we invented.
 *
 * `as_of` falls back to the empty string, which is what `getReferenceAsOf()`
 * already returns when it cannot date the reference set. A failure that cannot
 * read the data cannot date it either, and inventing a month would be the same
 * class of lie one field over.
 */
function checkBankCode(
  cc: string,
  bankCode: string,
  hit: { match: 'register' | 'prefix'; candidates?: number; code: string } | null,
  bban: string | undefined,
  /** A reference lookup feeding this verdict already failed; see enrichResult. */
  lookupFailed: boolean,
): BankCodeCheck {
  try {
    return decideBankCode(cc, bankCode, hit, bban, lookupFailed);
  } catch {
    return {
      value: bankCode,
      status: 'unavailable',
      reason: 'lookup_failed',
      match: null,
      register: null,
      authoritative: false,
      as_of: safeReferenceAsOf(),
    };
  }
}

/** The reference date, or none — dating the answer must not be what breaks it. */
function safeReferenceAsOf(): string {
  try {
    return getReferenceAsOf();
  } catch {
    return '';
  }
}

/**
 * Which kinds of source license storing a BIC and settling against it.
 *
 * ONE table, and `authoritative` is read out of it rather than written beside
 * the basis at each call site. The class of defect this forecloses is already
 * documented one screen up, on COMPOSITE_REGISTER: a field naming a real
 * register while the flag next to it said the answer was not authoritative —
 * two halves of the same object contradicting each other on the exact point at
 * issue. A derived boolean cannot do that.
 *
 * Only the national register is true today — served for DE, AT, BE and BG —
 * and the flat answer "advisory outside a register" is worth more than a field
 * that flatters the other two. Adding a country here means its register
 * publishes the BIC per bank code AND that we read it — not that our pairing
 * happens to agree with one.
 */
const BIC_BASIS_IS_AUTHORITATIVE: Record<BicBasis, boolean> = {
  national_register: true,
  curated_map: false,
  directory_prefix: false,
};

function bicProvenance(basis: BicBasis): { basis: BicBasis; authoritative: boolean } {
  return { basis, authoritative: BIC_BASIS_IS_AUTHORITATIVE[basis] };
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

  // BIC lookup.
  //
  // Guarded, and the guard is the point: this call and the German register read
  // below are the two reference lookups the bank-code verdict is built on. When
  // one of them cannot run, `lookupFailed` carries that fact to checkBankCode,
  // which turns it into `unavailable` instead of letting a missing table arrive
  // as `not_in_register` — a sentence a payment engine reads as "do not send".
  // `bic: null` beside it is the answer this block already gives for a code it
  // cannot resolve, and the one the docs already tell callers not to read as a
  // denial.
  let lookupFailed = false;
  let hit: BankLookupHit | null = null;
  try {
    hit = lookupByCountryBank(cc, bankCode);
  } catch {
    lookupFailed = true;
  }
  result.bic = hit
    ? {
        code: hit.code,
        bank_name: hit.bank_name,
        city: hit.city,
        source: hit.source,
        as_of: hit.as_of,
        // `source` names the dataset; `basis` says what KIND of source it is,
        // which is the half a payment engine can branch on. The prefix fallback
        // and an exact curated key are both advisory, and they are advisory for
        // different reasons — one may have matched several institutions, the
        // other is our own assembly — so they stay separate values.
        ...bicProvenance(hit.match === 'prefix' ? 'directory_prefix' : 'curated_map'),
      }
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
    try {
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
          // The one basis that licenses settling against the BIC: the
          // Bankleitzahlendatei publishes it per BLZ, so this pairing is the
          // register's, not ours.
          ...bicProvenance('national_register'),
        };
      }
    } catch {
      // The register the German verdict is decided against is unreadable. Flag
      // it here rather than letting checkBankCode meet the same failure and
      // fall back to the composite map: a Germany that cannot consult the
      // Bundesbank has no opinion, and must not manufacture one.
      lookupFailed = true;
    }
  }

  // Austria and Belgium: the same rule as Germany, one register over. Both
  // tables have carried a BIC per bank code since they were seeded, and until
  // now it was read only for the bank-code verdict while the served BIC still
  // came from the composite map. Measured against the registers on 29/08/2026,
  // that split kept three retired pairings in circulation (two Belgian, one
  // Austrian) and resolved a dozen Belgian EMIs to nothing while their BIC sat
  // in our own database. Register truth first; the composite stays as the
  // fallback for the rows the register publishes without a BIC.
  if (cc === 'AT' || cc === 'BE') {
    try {
      const reg = nationalRegisterAvailable(cc) ? lookupNationalCode(cc, bankCode) : null;
      if (reg?.bic) {
        result.bic = {
          code: reg.bic,
          bank_name: reg.name,
          // The OeNB publishes the seat, the NBB publishes names only — so
          // Belgium takes its city from the directory row for the BIC the
          // register named, the same division of labour the Bulgarian block
          // below documents.
          city: reg.town ?? lookup(`${reg.bic}XXX`)?.city ?? null,
          source: NATIONAL_REGISTERS[cc],
          as_of: getReferenceAsOf() || null,
          // Same licence as the German block above: the register publishes
          // this BIC per bank code, so the pairing is the register's, not ours.
          ...bicProvenance('national_register'),
        };
      }
    } catch {
      lookupFailed = true;
    }
  }

  // Bulgaria: the register publishes the head-office BIC beside the BAE code,
  // so serve it over the composite fallback for the same reason Germany does.
  //
  // The fallback here is not merely less precise, it is a coin flip: a Bulgarian
  // bank code is four letters, so `bic8 LIKE 'BNBG%'` matches every BIC8 opening
  // on them — three of them for the central bank alone — and the pick is decided
  // by an ORDER BY rather than by anything about the account. The register names
  // one, and it is the institution the code is allocated to.
  //
  // Dated and credited from the loaded rows: the Bulgarian National Bank's terms
  // require the source to be cited, and a provenance written by hand beside a
  // value read from the database is how the two drift apart.
  if (cc === 'BG') {
    try {
      const reg = lookupBgBankCode(bankCode);
      if (reg?.bic) {
        result.bic = {
          code: reg.bic,
          // Verbatim, in Cyrillic, as the register writes it. Transliterating
          // would be the alteration its terms forbid.
          bank_name: reg.name,
          // The register publishes no town. Taken from the directory row for the
          // BIC the register named — same division of labour the curated map
          // documents: one source decides WHICH institution holds the code, the
          // directory only supplies its details.
          city: lookup(`${reg.bic}XXX`)?.city ?? null,
          // The bare register name: the caveat NATIONAL_REGISTERS.BG carries is
          // about the bank-code verdict, not about this BIC.
          source: BG_REGISTER_NAME,
          // Year-month, as this field is documented. The full effective date the
          // licence attribution needs lives in bgAttribution().
          as_of: reg.as_of.slice(0, 7),
          // The BAE register publishes the head-office BIC per bank code, the
          // same licence the German and Austrian/Belgian blocks read out of
          // BIC_BASIS_IS_AUTHORITATIVE. Written here rather than in the block
          // that shipped it because the two branches landed in parallel.
          ...bicProvenance('national_register'),
        };
      }
    } catch {
      // Same failure discipline as the register blocks above: a Bulgaria that
      // cannot consult the BAE table has no opinion, and must not let the
      // verdict below manufacture one out of the composite map.
      lookupFailed = true;
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
    // `lookup`, not `lookupByBic11`: for an 11-character argument the two are
    // the same query, but lookup() memoises it. Cheap either way (0.019 ms
    // measured), and there is no reason for the hot path to skip a cache that
    // already exists.
    const row = lookup(code.length === 8 ? `${code}XXX` : code);
    if (row) {
      result.bic.lei = row.lei ?? null;
      result.bic.lei_status = row.lei_status ?? null;
      // Dated and sourced by the shared builder. An address that arrives beside
      // a monthly-refreshed bank name reads as equally current; it usually is
      // not, and `as_of` is what stops that reading.
      result.bic.address = registeredAddress(row);

      // The same seat in ISO 20022 `PostalAddress` vocabulary, for the November
      // 2026 structured-address rules. Strictly additive — `address` above is
      // untouched — and built by the one shared constructor, so /v1/bic/:code
      // and this path cannot serve a different shape for the same row.
      //
      // Declared as a local intersection rather than on the shared
      // IBANValidationResult: same reasoning as `shared_bic8` and
      // `official_identity` in routes/bic-lookup.ts — a shared type file is the
      // worst place to take a lock for one optional field.
      const postalAddress = toIso20022PostalAddress(row, lookupClearingSeatByBic(row.bic11));
      if (postalAddress) {
        (result.bic as BicBlockWithPostalAddress).postal_address = postalAddress;
      }
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

  // Europe: does the EBA's PSD2 register name the holder of this bank code as
  // an authorised payment or e-money institution?
  //
  // Joined on country + national reference code, because there is nothing else
  // to join on: measured over the whole 217 MB golden copy, the file carries no
  // BIC and no LEI for any entity. And in 29 of its 30 countries that reference
  // code is a company or tax number from an unrelated space — a Polish NIP, a
  // French SIREN, a Dutch DNB reference — so joining it to a bank code would
  // hand a real institution's authorisation to whatever bank shared the digits.
  // Only countries where the code was MEASURED to be the one the IBAN carries
  // are served; today that is Spain alone. See lib/psd-register.ts.
  //
  // Silent on a miss. The register's own disclaimer says an institution
  // omitted from it is authorised all the same, so an absence is not a finding.
  const psd = psdRegistrationByBankCode(cc, bankCode);
  if (psd) {
    result.psd_registration = psd;

    // The issuer type is FILLED, never overridden. A curated classification is
    // a hand-verified BIC8 pairing and stays exactly as it was — which is what
    // makes this incapable of regressing an existing identification. Only the
    // 'bank' fallback gives way, and it is an assumption rather than a finding.
    //
    // Two of the five register types map to an issuer type, and they map to
    // themselves rather than upward: an e-money institution is 'emi', a payment
    // institution is 'payment_institution'. The other three deliberately do
    // not. An AISP only reads accounts and issues nothing; the two exempted
    // types are waivers FROM authorisation granted to small operators, and
    // reading a waiver as a licence would be the overclaim this whole file
    // guards against.
    const issuerType = PSD_TYPE_TO_ISSUER[psd.entity_type];
    if (issuerType) {
      if (!result.issuer) {
        // Spain's payment institutions hold numeric bank codes, and no Spanish
        // BIC8 begins with digits — so 110 of the 112 resolve no BIC at all and
        // would otherwise be described by nothing. The register is a better
        // source for "who holds this code" than the silence it replaces: it
        // names the institution, dates the answer and says which authority
        // granted it. `psd_registration` beside it carries that provenance.
        result.issuer = { type: issuerType, name: psd.name, classification: 'register' };
      } else if (result.issuer.classification === 'default') {
        result.issuer.type = issuerType;
        result.issuer.classification = 'register';
        // 'Unknown' is what the fallback writes when the directory row carried
        // no institution name. The register has one; anything else it already
        // had is left alone.
        if (result.issuer.name === 'Unknown') result.issuer.name = psd.name;
      }
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
  result.bank_code_check = checkBankCode(cc, bankCode, hit, result.iban.slice(4), lookupFailed);

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

  // United Kingdom, second answer: is the institution behind this IBAN one the
  // PRA authorises to accept deposits?
  //
  // Joined on the LEI the directory row already carries — never on the firm
  // name, which is how "Alpha Bank Example Plc" ends up wearing the licence of
  // "Alpha Bank Example (Europe) SA". `cc` is passed as the jurisdiction of the
  // claim: for a GB IBAN it is GB by construction, and the same guard inside
  // praAuthorisationByLei is what stops the branch section's head-office LEI
  // from authorising the parent's own foreign BICs.
  //
  // Silent on a miss. The list is one permission out of many and says so in its
  // own preamble; an absence is not a finding.
  if (cc === 'GB' && result.bic?.lei) {
    const pra = praAuthorisationByLei(result.bic.lei, cc);
    if (pra) result.pra_authorisation = pra;
  }

  // France and Spain: who does the central bank say holds this bank code?
  //
  // Placed AFTER checkBankCode on purpose, and reading nothing it wrote. This
  // block is additive identity, not a verdict: `valid` and `bank_code_check`
  // must come out byte-identical whether or not a list is loaded. Routing
  // either source through NATIONAL_REGISTERS above would have set
  // `authoritative: true` and turned an absence into `not_in_register` — a
  // claim neither publisher supports, and one the Banco de España's terms
  // explicitly forbid.
  //
  // Silent on a miss, like pra_authorisation: neither list allocates the code
  // space, so absence from it is not evidence the code is unallocated.
  const identity = officialIdentityByNationalCode(cc, bankCode);
  if (identity) result.official_identity = identity;

  // Last, so every field it reasons about is already populated.
  result.next_steps = nextSteps(result);
}

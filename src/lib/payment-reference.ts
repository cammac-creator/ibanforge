/**
 * Structured payment references — checksum verdicts, and the Swiss pairing rule.
 *
 * Four schemes are verified arithmetically here, each against a primary source
 * that publishes the algorithm for free and carries a date. Two more (Norwegian
 * KID, Swedish OCR) are RECOGNISED but never judged, because their rules are not
 * a property of the string: they are configured per creditor account by the
 * beneficiary's bank. Answering `valid: false` on those would be a lie dressed
 * as arithmetic, so they answer `valid: null` with a status that says why.
 *
 * The part no checksum library reproduces is at the bottom: `buildReferenceCheck`
 * decides whether a reference may legally travel with a given IBAN. That rule
 * needs the SIX QR-IID allocation range, which this product already embeds.
 */

import { isQrIidRange } from './ch-clearing.js';
import type { IBANValidationResult } from '../types.js';

/**
 * Every scheme this module knows about.
 *
 * Exported and iterated by the provenance test rather than re-typed there: a
 * seventh scheme added without a source entry must turn that test red, which it
 * cannot do if the test carries its own hand-written list.
 */
export const REFERENCE_SCHEMES = ['rf', 'qrr', 'ogm', 'viitenumero', 'kid', 'ocr'] as const;

export type ReferenceScheme = (typeof REFERENCE_SCHEMES)[number];

/**
 * What happened to the reference, kept separate from `valid`.
 *
 * `unverifiable_without_creditor_config` is the honest verdict for KID and OCR:
 * the format is plausible, and no generic checker can go further.
 */
export type ReferenceStatus = 'checked' | 'unverifiable_without_creditor_config' | 'unrecognised';

/** The document that publishes a rule, and the date it carries. */
export interface ReferenceProvenance {
  /** Publisher, title and version, written so a reader can find the document. */
  source: string;
  /** `YYYY-MM` of the DOCUMENT, house convention. Never a future validity date. */
  as_of: string;
}

/**
 * One entry per scheme, no exceptions — this is the provenance contract.
 *
 * `as_of` dates the document, not the day its rules start to apply. The two SIX
 * guidelines below are dated February 2026 and become binding in November 2026;
 * putting the November date here would read as data from the future, so the
 * validity date lives inside the `source` sentence where it belongs.
 */
export const REFERENCE_SOURCES: Record<ReferenceScheme, ReferenceProvenance> = {
  rf: {
    source:
      'Finance Finland, "Structure of the RF Creditor Reference (ISO 11649)", October 2023 (check-digit algorithm); SIX Swiss Implementation Guidelines for the QR-bill v2.4 § 2.12.2, valid from 14 November 2026 (structure). ISO 11649 itself is a paid ISO standard; both cited documents publish the rule free of charge.',
    as_of: '2023-10',
  },
  qrr: {
    source:
      'SIX Swiss Implementation Guidelines for the QR-bill v2.4 (document dated 24.02.2026, valid from 14 November 2026), Annex B "Check digit calculation by modulo 10 recursive".',
    as_of: '2026-02',
  },
  ogm: {
    source:
      'Febelfin, "XML-bericht voor overschrijvingsopdracht – Implementatierichtlijnen" v3.3, 01-02-2019: the last two digits are a modulo-97 check on the first ten, and a remainder of 0 is written 97.',
    as_of: '2019-02',
  },
  viitenumero: {
    source:
      'Finance Finland, "Forming a Finnish reference number", 1 November 2009: digits weighted 7-3-1 from right to left, checksum = next full ten minus the sum, a difference of 10 written 0.',
    as_of: '2009-11',
  },
  kid: {
    source:
      'Bits AS, "Regler om kontroll av krediteringstransaksjoner", updated 15.03.2018. The rules confirm that modulus type AND KID length are declared per creditor account by the beneficiary bank (up to three alternatives) and redistributed to paying banks; the arithmetic itself is not published.',
    as_of: '2018-03',
  },
  ocr: {
    source:
      'Bankgirot, "Beräkning av kontrollsiffra 10-modulen", 2016-12-01, together with Bankgirot\'s OCR reference-check documentation. The Luhn step is published, but the accepted length is either carried by a length digit or fixed by contract between Bankgirot and the creditor.',
    as_of: '2016-12',
  },
};

/**
 * Where the pairing rule comes from — a DIFFERENT document from the checksums,
 * so it carries its own provenance rather than borrowing theirs.
 */
export const PAIRING_SOURCE: ReferenceProvenance = {
  source:
    'SIX Swiss Implementation Guidelines Credit Transfer (pain.001), SPS 2026 v2.3 (document dated 20.02.2026, valid from 14 November 2026), CdtTrfTxInf/RmtInf/Strd/CdtrRefInf/Tp; and SIX Swiss Implementation Guidelines for the QR-bill v2.4 § 4.3.2.',
  as_of: '2026-02',
};

/** The pairing verdict between a reference and the account it would travel with. */
export type ReferencePairing =
  | 'ok'
  | 'qrr_requires_qr_iban'
  | 'scor_forbidden_with_qr_iban'
  | 'not_applicable';

/** A second reading of the same string, when more than one scheme fits it. */
export interface ReferenceAlternative {
  scheme: ReferenceScheme;
  valid: boolean;
  check_digit_expected?: string;
}

export interface PaymentReferenceResult {
  /** Uppercased, separators removed. Echoed so the caller sees what was judged. */
  reference: string;
  /** Null when nothing recognised the string. */
  scheme: ReferenceScheme | null;
  /**
   * Null is a real answer, not a missing one: it means the scheme was
   * recognised and cannot be checked without the creditor's bank configuration.
   */
  valid: boolean | null;
  status: ReferenceStatus;
  /**
   * The check digit(s) the algorithm requires, as a STRING. OGM remainders are
   * two characters and can legitimately start with a zero, so a number type
   * would silently turn `03` into `3` and make the field untrustworthy.
   */
  check_digit_expected?: string;
  /** Null only when `scheme` is null — no rule applied, so no rule to cite. */
  source: string | null;
  as_of?: string;
  /** One honest sentence about what was checked, and what was not. */
  note: string;
  /**
   * Present when the same digits satisfy another scheme's length rule. A bare
   * 12-digit string is simultaneously a Belgian OGM and a legal Finnish
   * reference length; picking one silently would answer `valid: false` on a
   * perfectly good reference from the other country.
   */
  also_valid_as?: ReferenceAlternative;
}

/** Uppercase, and drop the separators humans and printers put in references. */
export function normalizeReference(input: string): string {
  return input.toUpperCase().replace(/[\s/+*.-]/g, '');
}

/**
 * ISO 7064 MOD 97-10 over an alphanumeric string, letters as A=10 … Z=35.
 *
 * Written out rather than imported: `iban-core` exposes `validate` and friends
 * but no mod-97 primitive, and the RF scheme needs the raw remainder.
 */
function mod97(value: string): number {
  let remainder = 0;
  for (const char of value) {
    const expanded = /[0-9]/.test(char) ? char : (char.charCodeAt(0) - 55).toString();
    for (const digit of expanded) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder;
}

/**
 * The modulo-10-recursive carry table, SIX QR-bill guidelines Annex B, Figure 21.
 *
 * Row = carry-over so far, column = the digit being consumed, cell = the new
 * carry-over. Reading starts left to right with carry 0; the check digit is
 * (10 − final carry) mod 10.
 */
const MOD10_CARRY_TABLE: readonly (readonly number[])[] = [
  [0, 9, 4, 6, 8, 2, 7, 1, 3, 5],
  [9, 4, 6, 8, 2, 7, 1, 3, 5, 0],
  [4, 6, 8, 2, 7, 1, 3, 5, 0, 9],
  [6, 8, 2, 7, 1, 3, 5, 0, 9, 4],
  [8, 2, 7, 1, 3, 5, 0, 9, 4, 6],
  [2, 7, 1, 3, 5, 0, 9, 4, 6, 8],
  [7, 1, 3, 5, 0, 9, 4, 6, 8, 2],
  [1, 3, 5, 0, 9, 4, 6, 8, 2, 7],
  [3, 5, 0, 9, 4, 6, 8, 2, 7, 1],
  [5, 0, 9, 4, 6, 8, 2, 7, 1, 3],
];

/** Modulo 10 recursive over a digit string — the QR-reference check digit. */
export function mod10RecursiveCheckDigit(digits: string): number {
  let carry = 0;
  for (const char of digits) {
    carry = MOD10_CARRY_TABLE[carry][Number(char)];
  }
  return (10 - carry) % 10;
}

/** The two RF check digits required for a given reference body. */
export function rfCheckDigits(body: string): string {
  // ISO 7064 MOD 97-10: append the country-style prefix with 00 check digits,
  // take the remainder, and the digits are 98 minus it.
  const remainder = mod97(`${body}RF00`);
  return String(98 - remainder).padStart(2, '0');
}

/** The two OGM/VCS check digits for a 10-digit body. */
export function ogmCheckDigits(body: string): string {
  const remainder = Number(body) % 97;
  // Febelfin, v3.3: "maar als het resultaat 0 is, dan is het controlegetal 97".
  return String(remainder === 0 ? 97 : remainder).padStart(2, '0');
}

/** The single viitenumero check digit for a reference body. */
export function viitenumeroCheckDigit(body: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  // Weighted from RIGHT to left, which is what makes a leading zero harmless.
  for (let i = 0; i < body.length; i++) {
    sum += Number(body[body.length - 1 - i]) * weights[i % 3];
  }
  return (10 - (sum % 10)) % 10;
}

const RF_PATTERN = /^RF\d{2}[0-9A-Z]{1,21}$/;
const DIGITS_ONLY = /^\d+$/;

/** Scheme names a caller may pass, including the SPS codes for RF and QRR. */
const TYPE_ALIASES: Record<string, ReferenceScheme> = {
  rf: 'rf',
  scor: 'rf',
  iso11649: 'rf',
  qrr: 'qrr',
  qr: 'qrr',
  ogm: 'ogm',
  vcs: 'ogm',
  viitenumero: 'viitenumero',
  fi: 'viitenumero',
  kid: 'kid',
  ocr: 'ocr',
};

/** Resolve a caller-supplied type string, or null when it names nothing. */
export function resolveReferenceType(input: string | undefined | null): ReferenceScheme | null {
  // Defensive on the type as well as the value: callers hand this straight from
  // unvalidated JSON bodies, where a `reference_type: 123` would otherwise reach
  // String.prototype.trim and throw. An unusable hint is "no hint", never a 500.
  if (!input || typeof input !== 'string') return null;
  return TYPE_ALIASES[input.trim().toLowerCase()] ?? null;
}

/**
 * Which schemes a normalised string could belong to, most specific first.
 *
 * The ambiguity is real and is not hidden: only `RF` and a 27-digit length pin a
 * scheme down. Every other numeric length is shared, because these schemes are
 * national conventions that were never coordinated with each other.
 */
/**
 * The schemes `detectSchemes` is able to propose from a string alone.
 *
 * `kid` and `ocr` are absent on purpose and permanently: nothing in a run of
 * digits says Norway or Sweden, and guessing would attribute every Finnish
 * reference to three countries at once. They are reachable only through an
 * explicit `reference_type`.
 */
export const DETECTABLE_SCHEMES: readonly ReferenceScheme[] = ['rf', 'qrr', 'ogm', 'viitenumero'];

export function detectSchemes(reference: string): ReferenceScheme[] {
  if (RF_PATTERN.test(reference)) return ['rf'];
  if (!DIGITS_ONLY.test(reference)) return [];

  const candidates: ReferenceScheme[] = [];
  // 27 digits is the QR reference and nothing else: a viitenumero stops at 20
  // and a KID at 25, so this length is the one unambiguous numeric signal.
  if (reference.length === 27) candidates.push('qrr');
  // Exactly 12 digits IS the Belgian OGM definition, while it is merely one
  // permitted length among seventeen for a Finnish reference — so OGM leads,
  // and the Finnish reading is reported alongside rather than discarded.
  if (reference.length === 12) candidates.push('ogm');
  if (reference.length >= 4 && reference.length <= 20) candidates.push('viitenumero');
  return candidates;
}

/** Judge a string against one specific scheme. */
function checkAs(reference: string, scheme: ReferenceScheme): PaymentReferenceResult {
  const provenance = REFERENCE_SOURCES[scheme];
  const base = { reference, scheme, source: provenance.source, as_of: provenance.as_of };

  if (scheme === 'rf') {
    if (!RF_PATTERN.test(reference)) {
      return {
        ...base,
        valid: false,
        status: 'checked',
        note: 'An ISO 11649 Creditor Reference is "RF", two check digits, then 1 to 21 alphanumeric characters. This string does not have that shape.',
      };
    }
    const expected = rfCheckDigits(reference.slice(4));
    return {
      ...base,
      valid: mod97(reference.slice(4) + reference.slice(0, 4)) === 1,
      status: 'checked',
      check_digit_expected: expected,
      note: 'Checked with mod 97-10, the same arithmetic as an IBAN: the first four characters move to the end, letters count as A=10 to Z=35, and a valid reference leaves a remainder of 1.',
    };
  }

  if (scheme === 'qrr') {
    if (!DIGITS_ONLY.test(reference) || reference.length !== 27) {
      return {
        ...base,
        valid: false,
        status: 'checked',
        note: 'A Swiss QR reference is exactly 27 numeric characters: 26 digits followed by a modulo-10-recursive check digit.',
      };
    }
    const expected = mod10RecursiveCheckDigit(reference.slice(0, 26));
    return {
      ...base,
      valid: expected === Number(reference[26]),
      status: 'checked',
      check_digit_expected: String(expected),
      note: 'Checked with modulo 10 recursive over the first 26 digits, using the carry table of Annex B.',
    };
  }

  if (scheme === 'ogm') {
    if (!DIGITS_ONLY.test(reference) || reference.length !== 12) {
      return {
        ...base,
        valid: false,
        status: 'checked',
        note: 'A Belgian structured communication (OGM/VCS) is exactly 12 digits: a 10-digit body followed by a 2-digit modulo-97 check.',
      };
    }
    const expected = ogmCheckDigits(reference.slice(0, 10));
    return {
      ...base,
      valid: expected === reference.slice(10),
      status: 'checked',
      check_digit_expected: expected,
      // The +++123/4567/89012+++ presentation is accepted on input and stripped,
      // but it is NOT in the Febelfin document cited above — only the arithmetic
      // is. Saying so keeps the citation from covering more than it does.
      note: 'Checked with modulo 97 over the first ten digits, a remainder of 0 being written 97. The +++…+++ display form is accepted and stripped on input; that presentation convention is not part of the cited Febelfin document.',
    };
  }

  if (scheme === 'viitenumero') {
    if (!DIGITS_ONLY.test(reference) || reference.length < 4 || reference.length > 20) {
      return {
        ...base,
        valid: false,
        status: 'checked',
        note: 'A Finnish reference number (viitenumero) is 4 to 20 digits, the last being the checksum.',
      };
    }
    const expected = viitenumeroCheckDigit(reference.slice(0, -1));
    return {
      ...base,
      valid: expected === Number(reference[reference.length - 1]),
      status: 'checked',
      check_digit_expected: String(expected),
      note: 'Checked with weights 7-3-1 applied from right to left; the checksum is the next full ten minus the sum, and a difference of 10 is written 0.',
    };
  }

  // Norway and Sweden. Recognised, never judged — see the note on each source.
  const country = scheme === 'kid' ? 'Norwegian KID' : 'Swedish OCR';
  return {
    ...base,
    valid: null,
    status: DIGITS_ONLY.test(reference) ? 'unverifiable_without_creditor_config' : 'unrecognised',
    note: DIGITS_ONLY.test(reference)
      ? `The string is a plausible ${country} reference, and that is as far as any generic checker can honestly go: the modulus type and the accepted length are configured per creditor account by the beneficiary's bank, then distributed to paying banks. Ask the creditor's bank, or read the configuration that came with the invoice. This is deliberately not answered "invalid".`
      : `A ${country} reference is numeric; this string is not.`,
  };
}

/**
 * Validate a free-form payment reference, detecting the scheme when not told.
 *
 * @param input Raw reference, separators and case as printed.
 * @param requestedType Optional scheme hint (`rf`/`scor`, `qrr`, `ogm`, …).
 */
export function validatePaymentReference(
  input: string,
  requestedType?: string | null,
): PaymentReferenceResult {
  const reference = normalizeReference(input);
  const requested = resolveReferenceType(requestedType);
  const detected = detectSchemes(reference);

  if (requested) {
    const result = checkAs(reference, requested);
    // A hint that contradicts the string is reported, not obeyed silently: the
    // caller's metadata and the caller's string disagree, and only they can say
    // which one is wrong.
    //
    // Guarded by DETECTABLE_SCHEMES, and that guard is the whole point. The
    // detector structurally never proposes `kid` or `ocr` — a country cannot be
    // read off a run of digits — so an unguarded test is ALWAYS true for those
    // two, and every ordinary KID lookup came back saying the string "looks like
    // VIITENUMERO, not the KID you asked for". That is an artefact of the
    // candidate list, not a fact about the string, and it sat right beside the
    // one sentence this feature exists to state honestly.
    if (
      DETECTABLE_SCHEMES.includes(requested) &&
      detected.length > 0 &&
      !detected.includes(requested)
    ) {
      return {
        ...result,
        note: `${result.note} Note: the string looks like ${detected[0].toUpperCase()}, not the ${requested.toUpperCase()} you asked for — the verdict above judges it as ${requested.toUpperCase()}, as requested.`,
      };
    }
    return result;
  }

  if (detected.length === 0) {
    return {
      reference,
      scheme: null,
      valid: null,
      status: 'unrecognised',
      source: null,
      note: 'No supported scheme matches this string. RF references start with "RF"; a Swiss QR reference is 27 digits; a Belgian OGM is 12 digits; a Finnish reference is 4 to 20 digits. Pass reference_type to force a scheme.',
    };
  }

  const primary = checkAs(reference, detected[0]);

  // Report the second reading with its own verdict rather than dropping it.
  if (detected.length > 1) {
    const alternative = checkAs(reference, detected[1]);
    if (typeof alternative.valid === 'boolean') {
      return {
        ...primary,
        also_valid_as: {
          scheme: alternative.scheme as ReferenceScheme,
          valid: alternative.valid,
          ...(alternative.check_digit_expected
            ? { check_digit_expected: alternative.check_digit_expected }
            : {}),
        },
        note: `${primary.note} This string is also a legal length for a ${detected[1]} reference, where it checks out as ${alternative.valid ? 'valid' : 'invalid'} — see also_valid_as. Pass reference_type when you know the country.`,
      };
    }
  }

  return primary;
}

/**
 * The pairing block served inside a paid IBAN validation.
 *
 * Deliberately a strict SUPERSET of PaymentReferenceResult, plus the pairing
 * fields. The MCP tool returns one shape or the other depending on whether an
 * IBAN was supplied, and the MCP SDK validates output against a single declared
 * schema — where Zod silently strips, and silently rejects, anything that does
 * not line up. Keeping the two shapes compatible is what stops that failure,
 * which produces no error and simply drops `structuredContent`.
 */
export interface ReferenceCheckBlock {
  /** Echo of the normalised reference — the caller sent it with separators. */
  reference: string;
  scheme: ReferenceScheme | null;
  valid: boolean | null;
  status: ReferenceStatus;
  check_digit_expected?: string;
  also_valid_as?: ReferenceAlternative;
  /** Provenance of the CHECKSUM verdict. Null only when no scheme matched. */
  source: string | null;
  as_of?: string;
  pairing: ReferencePairing;
  /** Provenance of the PAIRING verdict — a different document from `source`. */
  pairing_source?: string;
  pairing_as_of?: string;
  note: string;
}

/**
 * Decide whether a reference may legally travel with this account.
 *
 * The Swiss rule, from the guidelines cited in PAIRING_SOURCE: a QRR reference
 * may only be used with a QR-IBAN (an IID in the SIX allocation range
 * 30000–31999), and an ISO 11649 reference — SCOR in Swiss Payment Standards —
 * may NOT be used with one. The guidelines mark violations CH16 and CH17; the
 * wording of those codes lives in a status-report document that has not been
 * consulted, so nothing here claims to quote them.
 *
 * Outside Switzerland and Liechtenstein there is no QR-IBAN to pair against, so
 * the verdict is `not_applicable` for every scheme — including a valid RF, whose
 * own checksum verdict is unaffected and travels in `valid`.
 *
 * Deliberately NOT part of `enrichResult`: that function feeds batch validation
 * and several MCP tools, and a block appearing there would be silently stripped
 * by output schemas that do not name it.
 */
export function buildReferenceCheck(
  result: IBANValidationResult,
  reference: string,
  referenceType?: string | null,
): ReferenceCheckBlock {
  const checked = validatePaymentReference(reference, referenceType);
  const countryCode = result.country?.code;
  const isSwiss = countryCode === 'CH' || countryCode === 'LI';
  const bankCode = result.bban?.bank_code;

  const block: ReferenceCheckBlock = {
    reference: checked.reference,
    scheme: checked.scheme,
    valid: checked.valid,
    status: checked.status,
    ...(checked.check_digit_expected ? { check_digit_expected: checked.check_digit_expected } : {}),
    ...(checked.also_valid_as ? { also_valid_as: checked.also_valid_as } : {}),
    source: checked.source,
    ...(checked.as_of ? { as_of: checked.as_of } : {}),
    pairing: 'not_applicable',
    note: checked.note,
  };

  if (!isSwiss || !bankCode) {
    block.note = `${checked.note} No pairing verdict: the QRR/SCOR pairing rule is a Swiss Payment Standards rule and there is no QR-IBAN to pair against outside CH and LI.`;
    return block;
  }

  // A QR-IBAN is identified by its IID falling in the SIX QR allocation range —
  // read straight from the BBAN, so the verdict does not depend on the
  // institution being present in the register.
  const isQrIban = isQrIidRange(bankCode);

  if (checked.scheme === 'qrr') {
    block.pairing = isQrIban ? 'ok' : 'qrr_requires_qr_iban';
    block.pairing_source = PAIRING_SOURCE.source;
    block.pairing_as_of = PAIRING_SOURCE.as_of;
    block.note = isQrIban
      ? `${checked.note} Pairing: this is a QR-IBAN (IID ${bankCode} is in the SIX QR range 30000–31999), which is the only kind of account a QRR reference may be used with, per the Swiss Implementation Guidelines (SPS).`
      : `${checked.note} Pairing: IID ${bankCode} is outside the SIX QR range 30000–31999, so this is an ordinary IBAN, and a QRR reference may only be used in combination with a QR-IBAN per the Swiss Implementation Guidelines (SPS). Either use the creditor's QR-IBAN or send this payment without a QRR reference.`;
    return block;
  }

  if (checked.scheme === 'rf') {
    block.pairing = isQrIban ? 'scor_forbidden_with_qr_iban' : 'ok';
    block.pairing_source = PAIRING_SOURCE.source;
    block.pairing_as_of = PAIRING_SOURCE.as_of;
    block.note = isQrIban
      ? `${checked.note} Pairing: IID ${bankCode} is in the SIX QR range 30000–31999, so this is a QR-IBAN, and an ISO 11649 reference (SCOR) must not be used with one per the Swiss Implementation Guidelines (SPS). A QR-IBAN takes a QRR reference.`
      : `${checked.note} Pairing: IID ${bankCode} is outside the SIX QR range 30000–31999, so this is an ordinary IBAN, which is what an ISO 11649 reference (SCOR) requires per the Swiss Implementation Guidelines (SPS).`;
    return block;
  }

  block.note = `${checked.note} No pairing verdict: the Swiss Payment Standards pairing rule covers QRR and SCOR (ISO 11649) references only.`;
  return block;
}

/**
 * Swiss QR-bill payload check ("Swiss Payments Code", the text inside the QR).
 *
 * The payload is a fixed sequence of lines (SIX, Swiss Implementation
 * Guidelines QR-bill). This module parses it, checks every rule of the
 * standard that it can check, and answers the one question that decides
 * whether a QR-bill still gets paid: is the creditor address STRUCTURED
 * (address type S), or still COMBINED (type K), which the standard has not
 * permitted since 21 November 2025 and whose payment the banks guaranteed only
 * until the end of September 2026?
 *
 * Two rules of 29.10.2026, each with its own source:
 *   - the character set (ch. 4.1.1), in force since version 2.3 and unchanged
 *     in 2.4: an `error`, so `valid` turns false;
 *   - QR-IBAN and QR reference in CHF only, a rule of version 2.4 (valid from
 *     14 November 2026) while version 2.3 remains valid until November 2027:
 *     a `warning`, so `valid` and `ready_for_2026_11_14` do not move.
 *
 * What it reuses rather than re-implements:
 *   - IBAN structure and check digits: validateIBAN (src/lib/iban.ts)
 *   - QR-IID range 30000-31999: isQrIidRange (src/lib/ch-clearing.ts)
 *   - QRR (mod 10 recursive) and RF (ISO 11649) references: validatePaymentReference
 *   - the SPS structured-address rules, each finding sourced: checkPostalAddress
 *   - for a type S address in CH or LI, postcode and town in the official
 *     directory of localities of swisstopo (src/lib/ch-localities.ts,
 *     29.10.2026): a warning when the pair is not listed, never an error
 *
 * Rule evaluation plus that directory, read from a file shipped with the
 * server: no network, no storage. Free on every surface: the rules are
 * published commodities and the directory is open data; the paid surface is
 * the bank behind the IBAN (/v1/iban/validate).
 */
import { validateIBAN } from './iban.js';
import { isQrIidRange } from './ch-clearing.js';
import { validatePaymentReference } from './payment-reference.js';
import { checkPostalAddress, type AddressCheckResult } from './address-conformity.js';
import { COMBINED_ADDRESS_NOTICE, COMBINED_ADDRESS_SOURCE } from './qr-bill-notice.js';
import { POSTCODE_LOCALITY_WARNINGS, type PostcodeLocalityStatus } from './ch-localities.js';

export {
  COMBINED_ADDRESS_CLAUSE,
  COMBINED_ADDRESS_FORBIDDEN_FROM,
  COMBINED_ADDRESS_NOTICE,
  COMBINED_ADDRESS_PAYMENT_GUARANTEED_UNTIL,
  COMBINED_ADDRESS_SOURCE,
  SPS_2026_ADDRESS_RULES_FROM,
} from './qr-bill-notice.js';

/**
 * The source of every finding but one: the standard itself. It used to end on
 * a sentence credited to a SIX factsheet of 19.08.2025 ("from 14 November 2026
 * payments based on QR-bills with a combined (type K) address are no longer
 * processed") that neither SIX factsheet of that day contains. The type K
 * finding now carries its own source, COMBINED_ADDRESS_SOURCE (qr-bill-notice.ts).
 */
export const QR_BILL_SOURCE =
  'SIX, Swiss Implementation Guidelines QR-bill, version 2.3 (published 2023, mandatory from 21 November 2025): ' +
  'data structure of the Swiss QR Code, ch. 4.';

/**
 * The source of the one rule this check takes from version 2.4 (29.10.2026).
 * QR_BILL_SOURCE stays on 2.3: it goes out with every other finding, and those
 * rules were checked against 2.3. Read in the PDF of 24.02.2026: ch. 2.10 (the
 * QR-IBAN "can only be used for invoicing and payments in CHF"), ch. 2.12.1
 * and 4.3.2 (the QR reference, "only be used for invoicing in CHF"), and the
 * change control on page 4 ("For invoicing in euros (EUR), only the
 * combination IBAN/SCOR reference and IBAN/unstructured message is possible";
 * "Version 2.3 remains valid until November 2027"). Version 2.3 has no such
 * rule in its ch. 2.10, 2.12.1 or 4.3.2, hence a warning and not an error.
 */
export const QR_BILL_IG24_SOURCE =
  'SIX, Swiss Implementation Guidelines QR-bill, version 2.4 of 24.02.2026, valid from 14 November 2026 ' +
  '(https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.4-en.pdf, read 29.10.2026): ' +
  'change control (p. 4), ch. 2.10, 2.12.1 and 4.3.2. Version 2.3 remains valid until November 2027.';

/**
 * The source of the character-set rule (29.10.2026). Chapter 4.1.1 reads the
 * same in version 2.3 (valid from 21 November 2025, in force today) and in
 * version 2.4, so the rule is checked as an error.
 */
export const QR_BILL_CHARSET_SOURCE =
  'SIX, Swiss Implementation Guidelines QR-bill, version 2.3, valid from 21 November 2025 ' +
  '(https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.3-en.pdf, read 29.10.2026), ' +
  'ch. 4.1.1 Character set; the same set in version 2.4, valid from 14 November 2026, ch. 4.1.1.';

export type QrFindingSeverity = 'error' | 'warning';

/**
 * The warning code of each state of the postcode and town lookup that is
 * worth one (src/lib/ch-localities.ts). Severity `warning` for all three.
 */
export const POSTCODE_LOCALITY_CODES: Partial<Record<PostcodeLocalityStatus, string>> = {
  town_mismatch: 'postcode_town_mismatch',
  other_country: 'postcode_other_country',
  postcode_not_listed: 'postcode_not_listed',
};

export interface QrFinding {
  code: string;
  severity: QrFindingSeverity;
  field: string;
  detail: string;
  source: string;
}

export interface QrAddress {
  type: 'S' | 'K' | '' | string;
  name: string;
  line1: string;
  line2: string;
  postal_code: string;
  town: string;
  country: string;
}

export interface StructuredProposal {
  strt_nm?: string;
  bldg_nb?: string;
  pst_cd?: string;
  twn_nm?: string;
  ctry?: string;
  confidence: 'high' | 'low';
  note: string;
}

export interface QrPartyReport {
  present: boolean;
  address: QrAddress;
  structured: boolean | null;
  sps_check: AddressCheckResult | null;
  proposed_structured: StructuredProposal | null;
}

export interface SwissQrBillCheck {
  valid: boolean;
  ready_for_2026_11_14: boolean;
  qr_type: string;
  version: string;
  coding: string;
  creditor_iban: {
    value: string;
    valid: boolean;
    country: string | null;
    qr_iban: boolean;
    iid: string | null;
  };
  creditor: QrPartyReport;
  ultimate_creditor_empty: boolean;
  amount: string | null;
  currency: string | null;
  ultimate_debtor: QrPartyReport;
  reference: {
    type: string;
    value: string;
    valid: boolean | null;
    note: string;
  };
  unstructured_message: string | null;
  trailer: string;
  billing_information: string | null;
  alternative_schemes: string[];
  findings: QrFinding[];
  next_steps: string[];
  source: string;
}

const MAX = {
  name: 70,
  line1: 70,
  line2_s: 16,
  line2_k: 70,
  postal_code: 16,
  town: 35,
  country: 2,
  message: 140,
  billing: 140,
  alt: 100,
  ref_qrr: 27,
  ref_scor: 25,
} as const;

function party(lines: string[], start: number): QrAddress {
  const at = (i: number) => (lines[start + i] ?? '').trim();
  return {
    type: at(0),
    name: at(1),
    line1: at(2),
    line2: at(3),
    postal_code: at(4),
    town: at(5),
    country: at(6).toUpperCase(),
  };
}

function isEmpty(a: QrAddress): boolean {
  return !a.type && !a.name && !a.line1 && !a.line2 && !a.postal_code && !a.town && !a.country;
}

/** Split "1003 Lausanne" / "8001 Zürich" into postal code and town; conservative. */
function splitCombinedLine2(line2: string): { pst_cd?: string; twn_nm?: string } {
  const m = /^\s*([A-Z]{1,2}-)?(\d{4,5})\s+(.+?)\s*$/i.exec(line2);
  if (!m) return {};
  return { pst_cd: m[2], twn_nm: m[3] };
}

function splitCombinedLine1(line1: string): { strt_nm?: string; bldg_nb?: string } {
  const m = /^(.*?)[\s,]+(\d+\s?[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?)\s*$/.exec(line1.trim());
  if (!m || !m[1]) return line1.trim() ? { strt_nm: line1.trim() } : {};
  return { strt_nm: m[1].trim(), bldg_nb: m[2].trim() };
}

function reportParty(
  label: 'creditor' | 'ultimate_debtor',
  a: QrAddress,
  findings: QrFinding[],
  required: boolean,
): QrPartyReport {
  const present = !isEmpty(a);
  const report: QrPartyReport = {
    present,
    address: a,
    structured: null,
    sps_check: null,
    proposed_structured: null,
  };
  const field = (f: string) => `${label}.${f}`;
  if (!present) {
    if (required) {
      findings.push({
        code: 'creditor_missing',
        severity: 'error',
        field: label,
        detail: 'The creditor block is empty.',
        source: QR_BILL_SOURCE,
      });
    }
    return report;
  }
  if (!a.name) {
    findings.push({
      code: 'name_missing',
      severity: 'error',
      field: field('name'),
      detail: 'Name is mandatory.',
      source: QR_BILL_SOURCE,
    });
  }
  if (a.name.length > MAX.name) {
    findings.push({
      code: 'field_too_long',
      severity: 'error',
      field: field('name'),
      detail: `Name has ${a.name.length} characters; maximum ${MAX.name}.`,
      source: QR_BILL_SOURCE,
    });
  }
  if (a.country && !/^[A-Z]{2}$/.test(a.country)) {
    findings.push({
      code: 'country_invalid',
      severity: 'error',
      field: field('country'),
      detail: `Country must be an ISO 3166-1 alpha-2 code, got "${a.country}".`,
      source: QR_BILL_SOURCE,
    });
  }
  if (a.type === 'S') {
    report.structured = true;
    if (!a.postal_code)
      findings.push({
        code: 'address_field_missing',
        severity: 'error',
        field: field('postal_code'),
        detail: 'PstCd is mandatory for a structured (S) address.',
        source: QR_BILL_SOURCE,
      });
    if (!a.town)
      findings.push({
        code: 'address_field_missing',
        severity: 'error',
        field: field('town'),
        detail: 'TwnNm is mandatory for a structured (S) address.',
        source: QR_BILL_SOURCE,
      });
    if (!a.country)
      findings.push({
        code: 'address_field_missing',
        severity: 'error',
        field: field('country'),
        detail: 'Ctry is mandatory.',
        source: QR_BILL_SOURCE,
      });
    if (a.line1.length > MAX.line1)
      findings.push({
        code: 'field_too_long',
        severity: 'error',
        field: field('street'),
        detail: `StrtNm has ${a.line1.length} characters; maximum ${MAX.line1}.`,
        source: QR_BILL_SOURCE,
      });
    if (a.line2.length > MAX.line2_s)
      findings.push({
        code: 'field_too_long',
        severity: 'error',
        field: field('building_number'),
        detail: `BldgNb has ${a.line2.length} characters; maximum ${MAX.line2_s}.`,
        source: QR_BILL_SOURCE,
      });
    if (a.postal_code.length > MAX.postal_code)
      findings.push({
        code: 'field_too_long',
        severity: 'error',
        field: field('postal_code'),
        detail: `PstCd has ${a.postal_code.length} characters; maximum ${MAX.postal_code}.`,
        source: QR_BILL_SOURCE,
      });
    if (a.town.length > MAX.town)
      findings.push({
        code: 'field_too_long',
        severity: 'error',
        field: field('town'),
        detail: `TwnNm has ${a.town.length} characters; maximum ${MAX.town}.`,
        source: QR_BILL_SOURCE,
      });
    report.sps_check = checkPostalAddress('sps', {
      strt_nm: a.line1 || undefined,
      bldg_nb: a.line2 || undefined,
      pst_cd: a.postal_code || undefined,
      twn_nm: a.town || undefined,
      ctry: a.country || undefined,
    });
    for (const f of report.sps_check.findings) {
      if (f.verdict === 'fail') {
        findings.push({
          code: `sps_${f.rule}`,
          severity: 'error',
          field: field('address'),
          detail: f.detail,
          source: f.source,
        });
      }
    }
    // NPA et localité au répertoire officiel de swisstopo (29.10.2026) : un
    // avertissement, jamais une erreur, donc ni `valid` ni
    // `ready_for_2026_11_14` ne bougent. Un NPA absent dont la localité figure
    // sous un autre NPA de la même zone (case postale probable) n'en donne pas.
    const locality = report.sps_check.postcode_locality;
    if (locality && POSTCODE_LOCALITY_WARNINGS.has(locality.status)) {
      findings.push({
        code: POSTCODE_LOCALITY_CODES[locality.status]!,
        severity: 'warning',
        field: field(locality.status === 'town_mismatch' ? 'town' : 'postal_code'),
        detail: locality.detail,
        source: locality.source,
      });
    }
  } else if (a.type === 'K') {
    report.structured = false;
    findings.push({
      code: 'combined_address',
      severity: 'error',
      field: field('address_type'),
      detail: COMBINED_ADDRESS_NOTICE.en,
      source: COMBINED_ADDRESS_SOURCE,
    });
    if (!a.line2)
      findings.push({
        code: 'address_field_missing',
        severity: 'error',
        field: field('address_line_2'),
        detail: 'AdrLine2 (postal code and town) is mandatory for a combined (K) address.',
        source: QR_BILL_SOURCE,
      });
    if (!a.country)
      findings.push({
        code: 'address_field_missing',
        severity: 'error',
        field: field('country'),
        detail: 'Ctry is mandatory.',
        source: QR_BILL_SOURCE,
      });
    if (a.line1.length > MAX.line1)
      findings.push({
        code: 'field_too_long',
        severity: 'error',
        field: field('address_line_1'),
        detail: `AdrLine1 has ${a.line1.length} characters; maximum ${MAX.line1}.`,
        source: QR_BILL_SOURCE,
      });
    if (a.line2.length > MAX.line2_k)
      findings.push({
        code: 'field_too_long',
        severity: 'error',
        field: field('address_line_2'),
        detail: `AdrLine2 has ${a.line2.length} characters; maximum ${MAX.line2_k}.`,
        source: QR_BILL_SOURCE,
      });
    if (a.postal_code || a.town)
      findings.push({
        code: 'combined_address_stray_fields',
        severity: 'error',
        field: field('address'),
        detail:
          'PstCd and TwnNm must be empty for a combined (K) address; the postal code and town go into AdrLine2.',
        source: QR_BILL_SOURCE,
      });
    const l2 = splitCombinedLine2(a.line2);
    const l1 = splitCombinedLine1(a.line1);
    const complete = !!(l2.pst_cd && l2.twn_nm && a.country);
    report.proposed_structured = {
      ...l1,
      ...l2,
      ctry: a.country || undefined,
      confidence: complete && (!a.line1 || !!l1.bldg_nb) ? 'high' : 'low',
      note: complete
        ? 'Derived from the combined lines: check the street and building number, then set AdrTp to S.'
        : 'AdrLine2 does not split cleanly into postal code and town; complete the structured fields by hand.',
    };
  } else {
    findings.push({
      code: 'address_type_invalid',
      severity: 'error',
      field: field('address_type'),
      detail:
        a.type === ''
          ? 'AdrTp is missing; it must be S (structured).'
          : `AdrTp must be S (structured) or, historically, K; got "${a.type}".`,
      source: QR_BILL_SOURCE,
    });
  }
  return report;
}

/** Normalise line endings and trailing whitespace; keep empty lines, they carry meaning. */
export function splitPayload(payload: string): string[] {
  return payload
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''));
}

/**
 * Ch. 4.1.1: Basic Latin (U+0020-U+007E), Latin-1 Supplement (U+00A0-U+00FF),
 * Latin Extended-A (U+0100-U+017F), plus S and T with comma below
 * (U+0218-U+021B) and the euro sign (U+20AC).
 */
export function isQrBillCharacter(codePoint: number): boolean {
  return (
    (codePoint >= 0x20 && codePoint <= 0x7e) ||
    (codePoint >= 0xa0 && codePoint <= 0x17f) ||
    (codePoint >= 0x218 && codePoint <= 0x21b) ||
    codePoint === 0x20ac
  );
}

const PARTY_FIELDS = ['address_type', 'name', '', '', 'postal_code', 'town', 'country'] as const;

/**
 * The response field a payload line feeds, named as the other findings name it.
 * The ultimate creditor block is one field, `ultimate_creditor`, as in
 * `ultimate_creditor_not_allowed`; both alternative schemes are
 * `alternative_scheme`, as in their `field_too_long`: the line number in the
 * detail tells them apart.
 */
function lineField(i: number, lines: readonly string[]): string {
  const head = ['qr_type', 'version', 'coding', 'creditor_iban'];
  if (i < 4) return head[i]!;
  if (i >= 11 && i <= 17) return 'ultimate_creditor';
  const parties: Array<[number, string]> = [
    [4, 'creditor'],
    [20, 'ultimate_debtor'],
  ];
  for (const [start, label] of parties) {
    const k = i - start;
    if (k < 0 || k > 6) continue;
    const combined = (lines[start] ?? '').trim() === 'K';
    if (k === 2) return `${label}.${combined ? 'address_line_1' : 'street'}`;
    if (k === 3) return `${label}.${combined ? 'address_line_2' : 'building_number'}`;
    return `${label}.${PARTY_FIELDS[k]}`;
  }
  const tail: Record<number, string> = {
    18: 'amount',
    19: 'currency',
    27: 'reference_type',
    28: 'reference',
    29: 'unstructured_message',
    30: 'trailer',
    31: 'billing_information',
    32: 'alternative_scheme',
    33: 'alternative_scheme',
  };
  return tail[i] ?? 'payload';
}

/** How many offending code points a finding names before it summarises the rest. */
const CHARSET_LISTED = 5;

/**
 * One `character_not_permitted` error per line that carries a character outside
 * ch. 4.1.1, naming the field and each code point (never the character itself:
 * an invisible one would travel unseen in the detail).
 *
 * Read on the payload as received, split on its line breaks only: splitPayload
 * and trim() remove trailing white space, and with it U+FEFF, U+2028, U+3000
 * or a tab, which would then pass unseen. One byte-order mark at the very head
 * of the payload is tolerated, as an artefact of the encoding rather than a
 * character of the QR-bill; anywhere else it is reported. Lines 1 to 34 only:
 * what follows is already reported as ignored (payload_too_long).
 *
 * A letter in decomposed form ("u" followed by U+0308) is reported too: the
 * combining mark is outside the set, the precomposed letter is not, and the
 * detail says so.
 */
function characterFindings(payload: string): QrFinding[] {
  const body = payload.codePointAt(0) === 0xfeff ? payload.slice(1) : payload;
  const raw = body.replace(/\r\n?/g, '\n').split('\n');
  const out: QrFinding[] = [];
  for (let i = 0; i < Math.min(raw.length, 34); i++) {
    const seen = new Map<number, number>();
    let position = 0;
    for (const ch of raw[i]!) {
      position += 1;
      const cp = ch.codePointAt(0)!;
      if (!isQrBillCharacter(cp) && !seen.has(cp)) seen.set(cp, position);
    }
    if (seen.size === 0) continue;
    const field = lineField(i, raw);
    const named = [...seen]
      .slice(0, CHARSET_LISTED)
      .map(([cp, at]) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')} at position ${at}`);
    const more = seen.size > CHARSET_LISTED ? `, and ${seen.size - CHARSET_LISTED} more` : '';
    const combining = [...seen.keys()].some((cp) => cp >= 0x300 && cp <= 0x36f)
      ? ' U+0300 to U+036F are combining marks: the precomposed letter (Unicode NFC) is in the set.'
      : '';
    out.push({
      code: 'character_not_permitted',
      severity: 'error',
      field,
      detail:
        `Line ${i + 1} (${field}) carries ${seen.size === 1 ? 'a character' : `${seen.size} characters`} ` +
        `outside the character set of the Swiss QR Code: ${named.join(', ')}${more}. ` +
        'The set is Basic Latin, Latin-1 Supplement and Latin Extended-A, plus Ș, ș, Ț, ț and €.' +
        combining,
      source: QR_BILL_CHARSET_SOURCE,
    });
  }
  return out;
}

export function checkSwissQrBill(payload: string): SwissQrBillCheck {
  const lines = splitPayload(payload);
  // Strip trailing empty lines beyond the trailer, common when pasted.
  while (lines.length > 31 && lines[lines.length - 1] === '') lines.pop();
  const findings: QrFinding[] = [];
  const at = (i: number) => (lines[i] ?? '').trim();

  const qrType = at(0);
  const version = at(1);
  const coding = at(2);
  const ibanRaw = at(3).replace(/\s+/g, '').toUpperCase();

  if (lines.length < 31) {
    findings.push({
      code: 'payload_too_short',
      severity: 'error',
      field: 'payload',
      detail: `A Swiss QR Code payload has at least 31 lines up to the trailer "EPD"; got ${lines.length}.`,
      source: QR_BILL_SOURCE,
    });
  }
  if (qrType !== 'SPC') {
    findings.push({
      code: 'qr_type_invalid',
      severity: 'error',
      field: 'qr_type',
      detail: `Line 1 must be "SPC" (Swiss Payments Code), got "${qrType}".`,
      source: QR_BILL_SOURCE,
    });
  }
  if (version !== '0200') {
    findings.push({
      code: 'version_unsupported',
      severity: 'error',
      field: 'version',
      detail: `Line 2 must be "0200", got "${version}".`,
      source: QR_BILL_SOURCE,
    });
  }
  if (coding !== '1') {
    findings.push({
      code: 'coding_invalid',
      severity: 'error',
      field: 'coding',
      detail: `Line 3 (coding type) must be "1" (UTF-8), got "${coding}".`,
      source: QR_BILL_SOURCE,
    });
  }

  const ibanResult = validateIBAN(ibanRaw);
  const ibanCountry =
    ibanResult.country?.code ?? (ibanRaw.length >= 2 ? ibanRaw.slice(0, 2) : null);
  const iid =
    ibanResult.valid && (ibanCountry === 'CH' || ibanCountry === 'LI') ? ibanRaw.slice(4, 9) : null;
  const qrIban = iid !== null && isQrIidRange(iid);
  if (!ibanResult.valid) {
    findings.push({
      code: 'iban_invalid',
      severity: 'error',
      field: 'creditor_iban',
      detail: ibanResult.error_detail ?? ibanResult.error ?? 'The creditor IBAN does not validate.',
      source: QR_BILL_SOURCE,
    });
  } else if (ibanCountry !== 'CH' && ibanCountry !== 'LI') {
    findings.push({
      code: 'iban_not_ch_li',
      severity: 'error',
      field: 'creditor_iban',
      detail: `The creditor account must be a Swiss or Liechtenstein IBAN, got country ${ibanCountry}.`,
      source: QR_BILL_SOURCE,
    });
  }

  const creditor = reportParty('creditor', party(lines, 4), findings, true);

  const ultimateCreditor = party(lines, 11);
  const ultimateCreditorEmpty = isEmpty(ultimateCreditor);
  if (!ultimateCreditorEmpty) {
    findings.push({
      code: 'ultimate_creditor_not_allowed',
      severity: 'error',
      field: 'ultimate_creditor',
      detail: 'The ultimate creditor block must stay empty; the field is reserved for future use.',
      source: QR_BILL_SOURCE,
    });
  }

  const amount = at(18) || null;
  const currency = at(19).toUpperCase() || null;
  if (amount !== null && !/^\d{1,9}\.\d{2}$/.test(amount)) {
    findings.push({
      code: 'amount_invalid',
      severity: 'error',
      field: 'amount',
      detail: `Amount must be decimal with two places and a dot (e.g. 1949.75), got "${amount}".`,
      source: QR_BILL_SOURCE,
    });
  }
  if (currency !== 'CHF' && currency !== 'EUR') {
    findings.push({
      code: 'currency_invalid',
      severity: 'error',
      field: 'currency',
      detail: `Currency must be CHF or EUR, got "${currency ?? ''}".`,
      source: QR_BILL_SOURCE,
    });
  }

  const ultimateDebtor = reportParty('ultimate_debtor', party(lines, 20), findings, false);

  const refType = at(27).toUpperCase();
  const refValue = at(28).replace(/\s+/g, '');
  let refValid: boolean | null = null;
  let refNote = '';
  if (refType === 'QRR') {
    const r = validatePaymentReference(refValue, 'qrr');
    refValid = r.valid;
    refNote = r.note;
    if (refValue.length !== MAX.ref_qrr || r.valid !== true) {
      findings.push({
        code: 'qrr_reference_invalid',
        severity: 'error',
        field: 'reference',
        detail: `A QR reference is 27 digits with a modulo 10 recursive check digit; ${r.note}`,
        source: QR_BILL_SOURCE,
      });
    }
    if (ibanResult.valid && iid !== null && !qrIban) {
      findings.push({
        code: 'qrr_requires_qr_iban',
        severity: 'error',
        field: 'reference_type',
        detail: `Reference type QRR requires a QR-IBAN (IID 30000-31999); the creditor IBAN carries IID ${iid}.`,
        source: QR_BILL_SOURCE,
      });
    }
  } else if (refType === 'SCOR') {
    const r = validatePaymentReference(refValue, 'rf');
    refValid = r.valid;
    refNote = r.note;
    if (r.valid !== true) {
      findings.push({
        code: 'scor_reference_invalid',
        severity: 'error',
        field: 'reference',
        detail: `A SCOR reference is an RF creditor reference (ISO 11649); ${r.note}`,
        source: QR_BILL_SOURCE,
      });
    }
    if (refValue.length > MAX.ref_scor) {
      findings.push({
        code: 'field_too_long',
        severity: 'error',
        field: 'reference',
        detail: `Creditor reference has ${refValue.length} characters; maximum ${MAX.ref_scor}.`,
        source: QR_BILL_SOURCE,
      });
    }
    if (qrIban) {
      findings.push({
        code: 'qr_iban_requires_qrr',
        severity: 'error',
        field: 'reference_type',
        detail: 'A QR-IBAN (IID 30000-31999) requires reference type QRR.',
        source: QR_BILL_SOURCE,
      });
    }
  } else if (refType === 'NON') {
    refNote = 'No reference.';
    if (refValue !== '') {
      findings.push({
        code: 'non_reference_must_be_empty',
        severity: 'error',
        field: 'reference',
        detail: 'Reference type NON requires an empty reference line.',
        source: QR_BILL_SOURCE,
      });
    }
    if (qrIban) {
      findings.push({
        code: 'qr_iban_requires_qrr',
        severity: 'error',
        field: 'reference_type',
        detail: 'A QR-IBAN (IID 30000-31999) requires reference type QRR.',
        source: QR_BILL_SOURCE,
      });
    }
  } else {
    findings.push({
      code: 'reference_type_invalid',
      severity: 'error',
      field: 'reference_type',
      detail: `Reference type must be QRR, SCOR or NON, got "${refType}".`,
      source: QR_BILL_SOURCE,
    });
  }

  // Version 2.4 keeps the QR-IBAN and the QR reference for CHF; version 2.3,
  // which this check applies, admits them in EUR and stays valid until
  // November 2027. A warning, then: `valid` counts errors only, and
  // `ready_for_2026_11_14` keeps the meaning fixed on 24.09.2026.
  if (currency === 'EUR' && (qrIban || refType === 'QRR')) {
    findings.push({
      code: 'qr_iban_chf_only_ig24',
      severity: 'warning',
      field: 'currency',
      detail:
        'Under the SIX QR-bill guidelines version 2.4 (valid from 14.11.2026), a QR-IBAN and a QR reference (QRR) ' +
        'are for invoicing in CHF only, and an invoice in EUR carries an ordinary IBAN with an SCOR reference or ' +
        'without a reference. Version 2.3, against which this check is made, sets no such limit and remains ' +
        'valid until November 2027, so this is a warning and not an error.',
      source: QR_BILL_IG24_SOURCE,
    });
  }

  const message = at(29) || null;
  if (message && message.length > MAX.message) {
    findings.push({
      code: 'field_too_long',
      severity: 'error',
      field: 'unstructured_message',
      detail: `Unstructured message has ${message.length} characters; maximum ${MAX.message}.`,
      source: QR_BILL_SOURCE,
    });
  }
  const trailer = at(30);
  if (trailer !== 'EPD') {
    findings.push({
      code: 'trailer_missing',
      severity: 'error',
      field: 'trailer',
      detail: `Line 31 must be the trailer "EPD", got "${trailer}".`,
      source: QR_BILL_SOURCE,
    });
  }
  const billing = at(31) || null;
  if (billing) {
    if (!billing.startsWith('//')) {
      findings.push({
        code: 'billing_information_invalid',
        severity: 'error',
        field: 'billing_information',
        detail:
          'Billing information must start with "//" followed by the definition tag (e.g. //S1/...).',
        source: QR_BILL_SOURCE,
      });
    }
    if (billing.length > MAX.billing) {
      findings.push({
        code: 'field_too_long',
        severity: 'error',
        field: 'billing_information',
        detail: `Billing information has ${billing.length} characters; maximum ${MAX.billing}.`,
        source: QR_BILL_SOURCE,
      });
    }
  }
  if (message && billing && message.length + billing.length > MAX.message) {
    findings.push({
      code: 'additional_information_too_long',
      severity: 'error',
      field: 'unstructured_message',
      detail: `Unstructured message and billing information together have ${message.length + billing.length} characters; maximum ${MAX.message}.`,
      source: QR_BILL_SOURCE,
    });
  }
  const alt = [at(32), at(33)].filter((v) => v !== '');
  for (const a of alt) {
    if (a.length > MAX.alt) {
      findings.push({
        code: 'field_too_long',
        severity: 'error',
        field: 'alternative_scheme',
        detail: `Alternative scheme parameter has ${a.length} characters; maximum ${MAX.alt}.`,
        source: QR_BILL_SOURCE,
      });
    }
  }
  findings.push(...characterFindings(payload));
  if (lines.length > 34) {
    findings.push({
      code: 'payload_too_long',
      severity: 'warning',
      field: 'payload',
      detail: `${lines.length - 34} line(s) after the second alternative scheme are ignored.`,
      source: QR_BILL_SOURCE,
    });
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const valid = errors.length === 0;
  const addressesStructured =
    creditor.structured === true &&
    (ultimateDebtor.present ? ultimateDebtor.structured === true : true);
  const ready = valid && addressesStructured;

  const nextSteps: string[] = [];
  if (creditor.structured === false)
    nextSteps.push(
      'Reissue the QR-bill with the creditor address in type S: the banks guaranteed payment of a type K QR-bill only until the end of September 2026; see creditor.proposed_structured.',
    );
  if (ultimateDebtor.present && ultimateDebtor.structured === false)
    nextSteps.push(
      `Convert the ultimate debtor address to type S; see ultimate_debtor.proposed_structured.`,
    );
  if (!ibanResult.valid)
    nextSteps.push('Fix the creditor IBAN before anything else: the QR-bill cannot be paid.');
  if (valid && ibanResult.valid)
    nextSteps.push(
      'Structure and checksums pass. To learn the bank behind the IBAN and its payment-rail participation, call POST /v1/iban/validate (paid).',
    );

  return {
    valid,
    ready_for_2026_11_14: ready,
    qr_type: qrType,
    version,
    coding,
    creditor_iban: {
      value: ibanRaw,
      valid: ibanResult.valid,
      country: ibanCountry,
      qr_iban: qrIban,
      iid,
    },
    creditor,
    ultimate_creditor_empty: ultimateCreditorEmpty,
    amount,
    currency,
    ultimate_debtor: ultimateDebtor,
    reference: { type: refType, value: refValue, valid: refValid, note: refNote },
    unstructured_message: message,
    trailer,
    billing_information: billing,
    alternative_schemes: alt,
    findings,
    next_steps: nextSteps,
    source: QR_BILL_SOURCE,
  };
}

/**
 * IBANforge — Country data: IBAN lengths (ISO 13616), BBAN structures, and name resolution
 */

// ---------------------------------------------------------------------------
// IBAN lengths per country (ISO 13616)
// ---------------------------------------------------------------------------

export const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22,
  BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22,
  DJ: 27, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FK: 18,
  FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28,
  HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30,
  KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21,
  LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30,
  NI: 28, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29,
  RO: 24, RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19,
  SK: 24, SM: 27, SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26,
  UA: 29, VA: 22, VG: 24, XK: 20,
  // Registry countries added from the 2026-05 SWIFT IBAN Registry sync
  BI: 27, HN: 28, MN: 20, OM: 23, YE: 30,
};

// ---------------------------------------------------------------------------
// BBAN structures — [startIndex, length]
// ---------------------------------------------------------------------------

export interface BBANStructure {
  bankCode: [number, number];
  branchCode?: [number, number];
  accountNumber: [number, number];
}

export const BBAN_STRUCTURE: Record<string, BBANStructure> = {
  AD: { bankCode: [0, 4], branchCode: [4, 4], accountNumber: [8, 12] },
  AT: { bankCode: [0, 5], accountNumber: [5, 11] },
  BE: { bankCode: [0, 3], accountNumber: [3, 7] },
  CH: { bankCode: [0, 5], accountNumber: [5, 12] },
  CZ: { bankCode: [0, 4], accountNumber: [4, 16] },
  DE: { bankCode: [0, 8], accountNumber: [8, 10] },
  DK: { bankCode: [0, 4], accountNumber: [4, 10] },
  ES: { bankCode: [0, 4], branchCode: [4, 4], accountNumber: [8, 12] },
  FI: { bankCode: [0, 3], accountNumber: [3, 11] },
  FR: { bankCode: [0, 5], branchCode: [5, 5], accountNumber: [10, 13] },
  GB: { bankCode: [0, 4], branchCode: [4, 6], accountNumber: [10, 8] },
  GR: { bankCode: [0, 3], branchCode: [3, 4], accountNumber: [7, 16] },
  HR: { bankCode: [0, 7], accountNumber: [7, 10] },
  HU: { bankCode: [0, 3], branchCode: [3, 4], accountNumber: [7, 17] },
  IE: { bankCode: [0, 4], branchCode: [4, 6], accountNumber: [10, 8] },
  IT: { bankCode: [1, 5], branchCode: [6, 5], accountNumber: [11, 12] },
  LI: { bankCode: [0, 5], accountNumber: [5, 12] },
  LU: { bankCode: [0, 3], accountNumber: [3, 13] },
  MC: { bankCode: [0, 5], branchCode: [5, 5], accountNumber: [10, 13] },
  NL: { bankCode: [0, 4], accountNumber: [4, 10] },
  NO: { bankCode: [0, 4], accountNumber: [4, 7] },
  // PL: the full 8-digit national routing number is the bank identifier
  // (SWIFT registry). A shorter [0,3] never matched the bic_data.json keys.
  PL: { bankCode: [0, 8], accountNumber: [8, 16] },
  PT: { bankCode: [0, 4], branchCode: [4, 4], accountNumber: [8, 13] },
  SE: { bankCode: [0, 3], accountNumber: [3, 17] },
  // SI: the 5-digit code is the bank identifier (SWIFT registry); [0,2] was
  // too short to match the bic_data.json keys.
  SI: { bankCode: [0, 5], accountNumber: [5, 10] },
  // SK: 4-digit bank code, 6-digit account prefix (the SWIFT registry isolates
  // it as the branch field), then 10-digit account number. Folding the prefix
  // into accountNumber drops the branch and corrupts the decomposition.
  SK: { bankCode: [0, 4], branchCode: [4, 6], accountNumber: [10, 10] },
  SM: { bankCode: [1, 5], branchCode: [6, 5], accountNumber: [11, 12] },
  // Micro-states and territories
  FO: { bankCode: [0, 4], accountNumber: [4, 10] },         // Same as DK
  GL: { bankCode: [0, 4], accountNumber: [4, 10] },         // Same as DK
  ST: { bankCode: [0, 4], branchCode: [4, 4], accountNumber: [8, 13] },
  VA: { bankCode: [0, 3], accountNumber: [3, 15] },
  XK: { bankCode: [0, 2], branchCode: [2, 2], accountNumber: [4, 12] },
  // EU EMI / vIBAN hubs — these were missing a BBAN_STRUCTURE, which silently
  // disabled BIC/issuer/risk detection for them. LT especially is the European
  // EMI capital (Revolut, Paysera, Wise… are licensed there), so vIBAN/EMI
  // detection — a core compliance selling point — was dead exactly where it
  // matters most. Positions from the committed SWIFT IBAN Registry snapshot.
  LT: { bankCode: [0, 5], accountNumber: [5, 11] },
  EE: { bankCode: [0, 2], accountNumber: [2, 14] },
  LV: { bankCode: [0, 4], accountNumber: [4, 13] },
  MT: { bankCode: [0, 4], branchCode: [4, 5], accountNumber: [9, 18] },
  CY: { bankCode: [0, 3], branchCode: [3, 5], accountNumber: [8, 16] },
  // Registry countries added from the 2026-05 SWIFT IBAN Registry sync
  BI: { bankCode: [0, 5], branchCode: [5, 5], accountNumber: [10, 13] },
  HN: { bankCode: [0, 4], accountNumber: [4, 20] },
  MN: { bankCode: [0, 4], accountNumber: [4, 12] },
  OM: { bankCode: [0, 3], accountNumber: [3, 16] },
  YE: { bankCode: [0, 4], branchCode: [4, 4], accountNumber: [8, 18] },
  // ------------------------------------------------------------------------
  // 2026-07-10 full-coverage sync: the 47 countries below were supported in
  // IBAN_LENGTHS but had NO BBAN_STRUCTURE, so bank_code came back empty and
  // BIC lookup / issuer classification / risk_indicators were silently dead
  // for them (including SEPA members BG, RO, IS). Positions are taken from
  // the committed SWIFT IBAN Registry snapshot
  // (scripts/data/iban-registry-2026-05-22.json).
  // ------------------------------------------------------------------------
  AE: { bankCode: [0, 3], accountNumber: [3, 16] },
  AL: { bankCode: [0, 8], accountNumber: [8, 16] },
  AZ: { bankCode: [0, 4], accountNumber: [4, 20] },
  BA: { bankCode: [0, 3], branchCode: [3, 3], accountNumber: [6, 8] },
  BG: { bankCode: [0, 4], branchCode: [4, 4], accountNumber: [8, 10] },
  BH: { bankCode: [0, 4], accountNumber: [4, 14] },
  BR: { bankCode: [0, 8], branchCode: [8, 5], accountNumber: [13, 10] },
  BY: { bankCode: [0, 4], branchCode: [4, 4], accountNumber: [8, 16] },
  CR: { bankCode: [0, 4], accountNumber: [4, 14] },
  DJ: { bankCode: [0, 5], branchCode: [5, 5], accountNumber: [10, 11] },
  DO: { bankCode: [0, 4], accountNumber: [4, 20] },
  EG: { bankCode: [0, 4], branchCode: [4, 4], accountNumber: [8, 17] },
  FK: { bankCode: [0, 2], accountNumber: [2, 12] },
  GE: { bankCode: [0, 2], accountNumber: [2, 16] },
  GI: { bankCode: [0, 4], accountNumber: [4, 15] },
  GT: { bankCode: [0, 4], accountNumber: [4, 20] },
  IL: { bankCode: [0, 3], branchCode: [3, 3], accountNumber: [6, 13] },
  IQ: { bankCode: [0, 4], branchCode: [4, 3], accountNumber: [7, 12] },
  IS: { bankCode: [0, 4], branchCode: [4, 2], accountNumber: [6, 16] },
  JO: { bankCode: [0, 4], branchCode: [4, 4], accountNumber: [8, 18] },
  KW: { bankCode: [0, 4], accountNumber: [4, 22] },
  KZ: { bankCode: [0, 3], accountNumber: [3, 13] },
  LB: { bankCode: [0, 4], accountNumber: [4, 20] },
  LC: { bankCode: [0, 4], accountNumber: [4, 24] },
  LY: { bankCode: [0, 3], branchCode: [3, 3], accountNumber: [6, 15] },
  MD: { bankCode: [0, 2], accountNumber: [2, 18] },
  ME: { bankCode: [0, 3], accountNumber: [3, 13] },
  MK: { bankCode: [0, 3], accountNumber: [3, 10] },
  MR: { bankCode: [0, 5], branchCode: [5, 5], accountNumber: [10, 11] },
  MU: { bankCode: [0, 6], branchCode: [6, 2], accountNumber: [8, 12] },
  NI: { bankCode: [0, 4], accountNumber: [4, 20] },
  PK: { bankCode: [0, 4], accountNumber: [4, 16] },
  PS: { bankCode: [0, 4], accountNumber: [4, 21] },
  QA: { bankCode: [0, 4], accountNumber: [4, 21] },
  RO: { bankCode: [0, 4], accountNumber: [4, 16] },
  RS: { bankCode: [0, 3], accountNumber: [3, 13] },
  RU: { bankCode: [0, 9], branchCode: [9, 5], accountNumber: [14, 15] },
  SA: { bankCode: [0, 2], accountNumber: [2, 18] },
  SC: { bankCode: [0, 6], branchCode: [6, 2], accountNumber: [8, 16] },
  SD: { bankCode: [0, 2], accountNumber: [2, 12] },
  SO: { bankCode: [0, 4], branchCode: [4, 3], accountNumber: [7, 12] },
  SV: { bankCode: [0, 4], accountNumber: [4, 20] },
  TL: { bankCode: [0, 3], accountNumber: [3, 14] },
  TN: { bankCode: [0, 2], branchCode: [2, 3], accountNumber: [5, 13] },
  TR: { bankCode: [0, 5], accountNumber: [5, 17] },
  UA: { bankCode: [0, 6], accountNumber: [6, 19] },
  VG: { bankCode: [0, 4], accountNumber: [4, 16] },
};

// ---------------------------------------------------------------------------
// BBAN character structure per country — SWIFT IBAN Registry notation
// (<len>!<charset> groups: n = digits, a = uppercase letters, c = alphanumeric).
//
// Source of truth: SWIFT IBAN Registry Release 101 (via python-stdnum's
// iban.dat, a direct mirror of swift.com's iban-registry-v101.txt — the same
// source used for scripts/data/iban-registry-2026-05-22.json). Cross-checked
// 2026-07-10 against two independent open-source references:
//   - schwifty (mdomke/schwifty iban_registry/generated.json): 89/89 identical.
//   - ibantools (Simplify/ibantools countrySpecs): 81/89 identical; the 8
//     divergences (BY, DO, GE, IE, PK, PS, TR, VG) were resolved AGAINST
//     ibantools because the registry text and schwifty agree with each other
//     (e.g. ibantools narrows BY/DO bank codes to 4!a where the registry says
//     4!c, and widens GE/IE/PK/PS/VG bank codes to c where the registry says a).
//
// Validation is per-position (character class), so group boundaries that the
// registry itself aggregates across editions (e.g. CZ 4!n16!n vs 4!n6!n10!n)
// are equivalent here.
// ---------------------------------------------------------------------------

export const BBAN_SPECS: Record<string, string> = {
  AD: '4!n4!n12!c',
  AE: '3!n16!n',
  AL: '8!n16!c',
  AT: '5!n11!n',
  AZ: '4!a20!c',
  BA: '3!n3!n8!n2!n',
  BE: '3!n7!n2!n',
  BG: '4!a4!n2!n8!c',
  BH: '4!a14!c',
  BI: '5!n5!n11!n2!n',
  BR: '8!n5!n10!n1!a1!c',
  BY: '4!c4!n16!c',
  CH: '5!n12!c',
  CR: '4!n14!n',
  CY: '3!n5!n16!c',
  CZ: '4!n16!n',
  DE: '8!n10!n',
  DJ: '5!n5!n11!n2!n',
  DK: '4!n9!n1!n',
  DO: '4!c20!n',
  EE: '2!n14!n',
  EG: '4!n4!n17!n',
  ES: '4!n4!n1!n1!n10!n',
  FI: '3!n11!n',
  FK: '2!a12!n',
  FO: '4!n9!n1!n',
  FR: '5!n5!n11!c2!n',
  GB: '4!a6!n8!n',
  GE: '2!a16!n',
  GI: '4!a15!c',
  GL: '4!n9!n1!n',
  GR: '3!n4!n16!c',
  GT: '4!c20!c',
  HN: '4!a20!n',
  HR: '7!n10!n',
  HU: '3!n4!n1!n15!n1!n',
  IE: '4!a6!n8!n',
  IL: '3!n3!n13!n',
  IQ: '4!a3!n12!n',
  IS: '4!n2!n6!n10!n',
  IT: '1!a5!n5!n12!c',
  JO: '4!a4!n18!c',
  KW: '4!a22!c',
  KZ: '3!n13!c',
  LB: '4!n20!c',
  LC: '4!a24!c',
  LI: '5!n12!c',
  LT: '5!n11!n',
  LU: '3!n13!c',
  LV: '4!a13!c',
  LY: '3!n3!n15!n',
  MC: '5!n5!n11!c2!n',
  MD: '2!c18!c',
  ME: '3!n13!n2!n',
  MK: '3!n10!c2!n',
  MN: '4!n12!n',
  MR: '5!n5!n11!n2!n',
  MT: '4!a5!n18!c',
  MU: '4!a2!n2!n12!n3!n3!a',
  NI: '4!a20!n',
  NL: '4!a10!n',
  NO: '4!n6!n1!n',
  OM: '3!n16!c',
  PK: '4!a16!c',
  PL: '8!n16!n',
  PS: '4!a21!c',
  PT: '4!n4!n11!n2!n',
  QA: '4!a21!c',
  RO: '4!a16!c',
  RS: '3!n13!n2!n',
  RU: '9!n5!n15!c',
  SA: '2!n18!c',
  SC: '4!a2!n2!n16!n3!a',
  SD: '2!n12!n',
  SE: '3!n16!n1!n',
  SI: '5!n8!n2!n',
  SK: '4!n6!n10!n',
  SM: '1!a5!n5!n12!c',
  SO: '4!n3!n12!n',
  ST: '4!n4!n11!n2!n',
  SV: '4!a20!n',
  TL: '3!n14!n2!n',
  TN: '2!n3!n13!n2!n',
  TR: '5!n1!n16!c',
  UA: '6!n19!c',
  VA: '3!n15!n',
  VG: '4!a16!n',
  XK: '4!n10!n2!n',
  YE: '4!a4!n18!c',
};

// ---------------------------------------------------------------------------
// Official example IBAN per country, from the SWIFT IBAN Registry (via the
// php-iban registry transcription; FK/LY/RU/SD/SO/VA/MN/OM/NI/BI/YE
// supplemented from iban.com's registry reproduction — php-iban is missing or
// stale for those). Every entry is verified by test: length, mod-97, check
// digit range AND the BBAN_SPECS pattern above must all pass.
// ---------------------------------------------------------------------------

export const EXAMPLE_IBANS: Record<string, string> = {
  AD: 'AD1200012030200359100100',
  AE: 'AE070331234567890123456',
  AL: 'AL47212110090000000235698741',
  AT: 'AT611904300234573201',
  AZ: 'AZ21NABZ00000000137010001944',
  BA: 'BA391290079401028494',
  BE: 'BE68539007547034',
  BG: 'BG80BNBG96611020345678',
  BH: 'BH67BMAG00001299123456',
  BI: 'BI1320001100010000123456789',
  BR: 'BR9700360305000010009795493P1',
  BY: 'BY13NBRB3600900000002Z00AB00',
  CH: 'CH9300762011623852957',
  CR: 'CR05015202001026284066',
  CY: 'CY17002001280000001200527600',
  CZ: 'CZ6508000000192000145399',
  DE: 'DE89370400440532013000',
  DJ: 'DJ2110002010010409943020008',
  DK: 'DK5000400440116243',
  DO: 'DO28BAGR00000001212453611324',
  EE: 'EE382200221020145685',
  EG: 'EG380019000500000000263180002',
  ES: 'ES9121000418450200051332',
  FI: 'FI2112345600000785',
  FK: 'FK12SC987654321098',
  FO: 'FO2000400440116243',
  FR: 'FR1420041010050500013M02606',
  GB: 'GB29NWBK60161331926819',
  GE: 'GE29NB0000000101904917',
  GI: 'GI75NWBK000000007099453',
  GL: 'GL2000400440116243',
  GR: 'GR1601101250000000012300695',
  GT: 'GT82TRAJ01020000001210029690',
  HN: 'HN54PISA00000000000000123124',
  HR: 'HR1210010051863000160',
  HU: 'HU42117730161111101800000000',
  IE: 'IE29AIBK93115212345678',
  IL: 'IL620108000000099999999',
  IQ: 'IQ98NBIQ850123456789012',
  IS: 'IS140159260076545510730339',
  IT: 'IT60X0542811101000000123456',
  JO: 'JO94CBJO0010000000000131000302',
  KW: 'KW81CBKU0000000000001234560101',
  KZ: 'KZ86125KZT5004100100',
  LB: 'LB62099900000001001901229114',
  LC: 'LC55HEMM000100010012001200023015',
  LI: 'LI21088100002324013AA',
  LT: 'LT121000011101001000',
  LU: 'LU280019400644750000',
  LV: 'LV80BANK0000435195001',
  LY: 'LY38021001000000123456789',
  MC: 'MC5811222000010123456789030',
  MD: 'MD24AG000225100013104168',
  ME: 'ME25505000012345678951',
  MK: 'MK07250120000058984',
  MN: 'MN580050099123456789',
  MR: 'MR1300020001010000123456753',
  MT: 'MT84MALT011000012345MTLCAST001S',
  MU: 'MU17BOMM0101101030300200000MUR',
  NI: 'NI79BAMC00000000000003123123',
  NL: 'NL91ABNA0417164300',
  NO: 'NO9386011117947',
  OM: 'OM040280000012345678901',
  PK: 'PK36SCBL0000001123456702',
  PL: 'PL61109010140000071219812874',
  PS: 'PS92PALS000000000400123456702',
  PT: 'PT50000201231234567890154',
  QA: 'QA58DOHB00001234567890ABCDEFG',
  RO: 'RO49AAAA1B31007593840000',
  RS: 'RS35260005601001611379',
  RU: 'RU0204452560040702810412345678901',
  SA: 'SA0380000000608010167519',
  SC: 'SC18SSCB11010000000000001497USD',
  SD: 'SD8811123456789012',
  SE: 'SE4550000000058398257466',
  SI: 'SI56191000000123438',
  SK: 'SK3112000000198742637541',
  SM: 'SM86U0322509800000000270100',
  SO: 'SO061000001123123456789',
  ST: 'ST68000100010051845310112',
  SV: 'SV62CENR00000000000000700025',
  TL: 'TL380080012345678910157',
  TN: 'TN5910006035183598478831',
  TR: 'TR330006100519786457841326',
  UA: 'UA213996220000026007233566001',
  VA: 'VA59001123000012345678',
  VG: 'VG96VPVG0000012345678901',
  XK: 'XK051212012345678906',
  YE: 'YE15CBYE0001018861234567891234',
};

// ---------------------------------------------------------------------------
// BBAN structure validation — precompiled at module load (validation is the
// hot path, ~0.13 ms/call; compiling a RegExp per call would dominate it).
// ---------------------------------------------------------------------------

const CLASS_RE: Record<string, string> = { n: '[0-9]', a: '[A-Z]', c: '[A-Z0-9]' };
const CLASS_NAME: Record<string, [string, string]> = {
  n: ['a digit', 'digits'],
  a: ['an uppercase letter', 'uppercase letters'],
  c: ['an alphanumeric character', 'alphanumeric characters'],
};

interface CompiledBban {
  /** Anchored regex over the full BBAN. */
  regex: RegExp;
  /** Per-position character class of the BBAN: 'n' | 'a' | 'c'. */
  classes: string;
}

function compileBbanSpec(spec: string): CompiledBban {
  let classes = '';
  let pattern = '^';
  for (const m of spec.matchAll(/(\d+)!([nac])/g)) {
    const len = parseInt(m[1], 10);
    classes += m[2].repeat(len);
    pattern += `${CLASS_RE[m[2]]}{${len}}`;
  }
  return { regex: new RegExp(pattern + '$'), classes };
}

const COMPILED_BBAN: Record<string, CompiledBban> = {};
for (const [cc, spec] of Object.entries(BBAN_SPECS)) {
  COMPILED_BBAN[cc] = compileBbanSpec(spec);
}

/** Compress a per-position class slice back to SWIFT notation, e.g. 'aann' → '2!a2!n'. */
function classesToSpec(classes: string): string {
  let out = '';
  let i = 0;
  while (i < classes.length) {
    let j = i;
    while (j < classes.length && classes[j] === classes[i]) j++;
    out += `${j - i}!${classes[i]}`;
    i = j;
  }
  return out;
}

export interface BbanCheckResult {
  ok: boolean;
  /** Agent-friendly explanation of the first failing position (when !ok). */
  detail?: string;
}

/**
 * Validate a BBAN against the country's SWIFT-registry character structure.
 * Assumes length was already validated (IBAN_LENGTHS); reports the first
 * offending position with the logical field it belongs to.
 */
export function checkBBANStructure(countryCode: string, bban: string): BbanCheckResult {
  const compiled = COMPILED_BBAN[countryCode];
  if (!compiled) return { ok: true }; // defensive: unknown spec — never over-reject
  if (compiled.regex.test(bban)) return { ok: true };

  // Slow path (only on failure): locate the first bad position and name the field.
  const { classes } = compiled;
  let bad = -1;
  for (let i = 0; i < bban.length && i < classes.length; i++) {
    const cls = classes[i];
    const ch = bban.charCodeAt(i);
    const isDigit = ch >= 48 && ch <= 57;
    const isUpper = ch >= 65 && ch <= 90;
    const okChar = cls === 'n' ? isDigit : cls === 'a' ? isUpper : isDigit || isUpper;
    if (!okChar) { bad = i; break; }
  }
  const spec = BBAN_SPECS[countryCode];
  const suffix = ` Expected BBAN format for ${countryCode}: ${spec} (n=digits, a=uppercase letters, c=alphanumeric).`;
  if (bad === -1) {
    // Shouldn't happen when length is pre-validated; keep an honest generic message.
    return { ok: false, detail: `BBAN structure mismatch for ${countryCode}.${suffix}` };
  }

  // Name the logical field containing the bad position.
  const structure = BBAN_STRUCTURE[countryCode];
  let fieldName = `BBAN position ${bad + 1}`;
  let fieldRange: [number, number] | null = null;
  if (structure) {
    const fields: Array<[string, [number, number]]> = [
      ['bank code', structure.bankCode],
      ...(structure.branchCode ? [['branch code', structure.branchCode] as [string, [number, number]]] : []),
      ['account number', structure.accountNumber],
    ];
    for (const [name, [start, len]] of fields) {
      if (bad >= start && bad < start + len) {
        fieldName = name;
        fieldRange = [start, len];
        break;
      }
    }
  }

  const found = bban[bad];
  let expectation: string;
  if (fieldRange) {
    const segClasses = classes.slice(fieldRange[0], fieldRange[0] + fieldRange[1]);
    const uniform = segClasses.split('').every((c) => c === segClasses[0]);
    expectation = uniform
      ? `${fieldName} must be ${fieldRange[1]} ${CLASS_NAME[segClasses[0]][1]}`
      : `${fieldName} must match ${classesToSpec(segClasses)}`;
  } else {
    expectation = `${fieldName} must be ${CLASS_NAME[classes[bad]][0]}`;
  }
  return {
    ok: false,
    detail: `BBAN structure mismatch for ${countryCode}: ${expectation} (found '${found}' at BBAN position ${bad + 1}).${suffix}`,
  };
}

/**
 * SWIFT-notation charset of each logical BBAN field (for /v1/iban/structure),
 * e.g. DE bank_code → '8!n', MU bank_code → '4!a2!n'. Null when the country
 * has no compiled spec (never the case for supported countries).
 */
export function getBBANFieldSpec(countryCode: string, start: number, length: number): string | null {
  const compiled = COMPILED_BBAN[countryCode];
  if (!compiled) return null;
  return classesToSpec(compiled.classes.slice(start, start + length));
}

// ---------------------------------------------------------------------------
// Country names — hardcoded map for IBAN countries
// ---------------------------------------------------------------------------

export const COUNTRY_NAMES: Record<string, string> = {
  AD: 'Andorra', AE: 'United Arab Emirates', AL: 'Albania', AT: 'Austria',
  AZ: 'Azerbaijan', BA: 'Bosnia and Herzegovina', BE: 'Belgium', BG: 'Bulgaria',
  BH: 'Bahrain', BR: 'Brazil', BY: 'Belarus', CH: 'Switzerland',
  CR: 'Costa Rica', CY: 'Cyprus', CZ: 'Czech Republic', DE: 'Germany',
  DJ: 'Djibouti', DK: 'Denmark', DO: 'Dominican Republic', EE: 'Estonia',
  EG: 'Egypt', ES: 'Spain', FI: 'Finland', FK: 'Falkland Islands',
  FO: 'Faroe Islands', FR: 'France', GB: 'United Kingdom', GE: 'Georgia',
  GI: 'Gibraltar', GL: 'Greenland', GR: 'Greece', GT: 'Guatemala',
  HR: 'Croatia', HU: 'Hungary', IE: 'Ireland', IL: 'Israel',
  IQ: 'Iraq', IS: 'Iceland', IT: 'Italy', JO: 'Jordan',
  KW: 'Kuwait', KZ: 'Kazakhstan', LB: 'Lebanon', LC: 'Saint Lucia',
  LI: 'Liechtenstein', LT: 'Lithuania', LU: 'Luxembourg', LV: 'Latvia',
  LY: 'Libya', MC: 'Monaco', MD: 'Moldova', ME: 'Montenegro',
  MK: 'North Macedonia', MR: 'Mauritania', MT: 'Malta', MU: 'Mauritius',
  NI: 'Nicaragua', NL: 'Netherlands', NO: 'Norway', PK: 'Pakistan',
  PL: 'Poland', PS: 'Palestine', PT: 'Portugal', QA: 'Qatar',
  RO: 'Romania', RS: 'Serbia', RU: 'Russia', SA: 'Saudi Arabia',
  SC: 'Seychelles', SD: 'Sudan', SE: 'Sweden', SI: 'Slovenia',
  SK: 'Slovakia', SM: 'San Marino', SO: 'Somalia', ST: 'Sao Tome and Principe',
  SV: 'El Salvador', TL: 'East Timor', TN: 'Tunisia', TR: 'Türkiye',
  UA: 'Ukraine', VA: 'Vatican City', VG: 'British Virgin Islands', XK: 'Kosovo',
  BI: 'Burundi', HN: 'Honduras', MN: 'Mongolia', OM: 'Oman', YE: 'Yemen',
};

// ---------------------------------------------------------------------------
// SEPA zone data
// ---------------------------------------------------------------------------

/** Eurozone countries — SCT_INST mandatory since IPR Oct 2025 */
const EUROZONE = new Set([
  'AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR',
  'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK',
  // Microstates using EUR through monetary agreements
  'AD', 'MC', 'SM', 'VA',
]);

/** All SEPA member countries (EU27 + EEA + CH/GB + microstates + territories) */
const SEPA_MEMBERS = new Set([
  ...EUROZONE,
  // EU non-eurozone
  'BG', 'CZ', 'DK', 'HU', 'PL', 'RO', 'SE',
  // EEA non-EU
  'IS', 'LI', 'NO',
  // Other SEPA participants
  'CH', 'GB', 'GI',
  // Associated territories (through DK)
  'FO', 'GL',
]);

/** Non-eurozone EEA/EU states — VoP mandatory from July 2027 */
const VOP_DEFERRED = new Set([
  'BG', 'CZ', 'DK', 'HU', 'PL', 'RO', 'SE',
  'IS', 'LI', 'NO',
]);

export type SepaScheme = 'SCT' | 'SDD' | 'SCT_INST';

export interface SepaInfo {
  member: boolean;
  schemes: SepaScheme[];
  vop_required: boolean;
}

/**
 * Get SEPA membership, available schemes, and VoP status for a country code.
 *
 * VoP (Verification of Payee) timeline:
 * - Eurozone PSPs: mandatory since 9 Oct 2025
 * - Non-eurozone EEA: mandatory from July 2027
 * - Non-SEPA: not applicable
 * - CH, GB, GI: not covered by EU VoP regulation
 */
export function getSepaInfo(countryCode: string): SepaInfo {
  if (!SEPA_MEMBERS.has(countryCode)) {
    return { member: false, schemes: [], vop_required: false };
  }

  // CH, GB, GI are SEPA participants but not subject to EU VoP regulation
  const nonEuSepa = new Set(['CH', 'GB', 'GI']);

  if (EUROZONE.has(countryCode)) {
    return { member: true, schemes: ['SCT', 'SDD', 'SCT_INST'], vop_required: true };
  }
  if (VOP_DEFERRED.has(countryCode)) {
    // VoP mandatory from July 2027 for these — flag as required (regulation adopted)
    return { member: true, schemes: ['SCT', 'SDD'], vop_required: true };
  }
  // CH, GB, GI, FO, GL — SEPA but no EU VoP obligation
  return { member: true, schemes: ['SCT', 'SDD'], vop_required: !nonEuSepa.has(countryCode) };
}

// ---------------------------------------------------------------------------
// Country risk classification (AML/CFT perspective)
//
// ⚠️  This is a DELIBERATELY SEPARATE axis from the DB-backed FATF/sanctions
//     signal. `calculateRiskScore` already weights the live FATF list
//     (black +30 / grey +20) and sanctioned countries (+50) read from the
//     compliance DB. getCountryRisk's output is layered ON TOP as an
//     ADDITIONAL country_risk indicator (+20 high / +10 elevated). The two
//     are meant to STACK conservatively — do NOT re-derive these sets from
//     fatf_countries to "deduplicate", as that would DOWNGRADE the score of
//     sanctioned/grey-listed countries (e.g. RU would drop high→elevated).
//
//     This list captures the BROADER editorial AML picture that the FATF feed
//     alone misses: offshore financial centres (VG/MU/SC), conflict zones (UA),
//     and EBA-flagged jurisdictions. Recalibrate on the same cadence as the
//     FATF lists in compliance-static.ts (FATF_AS_OF — after each plenary,
//     3×/year) and whenever a jurisdiction's standing materially changes.
//     Any reclassification of a specific country is an EXPLICIT, dated edit
//     here — never folded into a "bug fix".
// ---------------------------------------------------------------------------

export type CountryRisk = 'standard' | 'elevated' | 'high';

/** FATF black list / EU high-risk third countries (updated periodically) */
const HIGH_RISK = new Set([
  'RU', // Russia — FATF countermeasures
  'BY', // Belarus — FATF countermeasures
  'LY', // Libya
  'SO', // Somalia
  'SD', // Sudan
]);

/**
 * FATF grey list (increased monitoring) and jurisdictions with
 * elevated AML risk per EBA opinions.
 */
const ELEVATED_RISK = new Set([
  'AL', // Albania
  'BA', // Bosnia and Herzegovina
  'EG', // Egypt
  'IQ', // Iraq
  'JO', // Jordan
  'KZ', // Kazakhstan
  'LB', // Lebanon
  'MR', // Mauritania
  'MU', // Mauritius
  'PK', // Pakistan
  'PS', // Palestine
  'SC', // Seychelles
  'TN', // Tunisia
  'TR', // Türkiye
  'UA', // Ukraine (conflict zone)
  'VG', // British Virgin Islands
]);

export function getCountryRisk(countryCode: string): CountryRisk {
  if (HIGH_RISK.has(countryCode)) return 'high';
  if (ELEVATED_RISK.has(countryCode)) return 'elevated';
  return 'standard';
}

// ---------------------------------------------------------------------------
// Dynamic country name resolution via Intl API (for BIC lookups with any code)
// ---------------------------------------------------------------------------

const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * Resolve a country name from an ISO 3166-1 alpha-2 code.
 * First checks the hardcoded IBAN map, then falls back to Intl.DisplayNames.
 */
export function getCountryName(code: string): string | null {
  if (!code || code.length !== 2) return null;
  const upper = code.toUpperCase();

  // Fast path: hardcoded IBAN country names
  if (COUNTRY_NAMES[upper]) return COUNTRY_NAMES[upper];

  // Fallback: Intl API covers all ISO 3166-1 codes
  try {
    const name = displayNames.of(upper);
    return name && name !== upper ? name : null;
  } catch {
    return null;
  }
}

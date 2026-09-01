/**
 * The conformity checker behind POST /v1/address/check — a rules engine over a
 * postal address the CALLER has already structured.
 *
 * ## Why there is a `scheme` parameter and no "CBPR+ compliant" boolean
 *
 * There is no honest one-word verdict here, and that is a finding, not a
 * limitation to be papered over. The three corpora that could be read diverge:
 *
 * - `TwnNm` + `Ctry` are unconditional in SPS and in Fedwire, but conditional
 *   in T2 / HVPS+, where they are required only when `AddressLine` is absent.
 * - `AdrLine` is capped at 2 by SPS and by Fedwire, is uncapped in the T2
 *   validation appendix, and is 0..7 in base ISO 20022.
 * - `AdrTp` is forbidden by SPS and unmentioned by the other two.
 *
 * A single boolean would therefore have to pick one rail and hide it. The
 * checker is parameterised instead, and each finding names the document it
 * comes from with its date.
 *
 * **`cbpr+` is not among the schemes**, and this is deliberate. The CBPR+ usage
 * guideline and the PMPG "November 2026 postal address guidance" both live on
 * swift.com, which was unreachable on 26/08/2026 (as was iso20022.org, and
 * europeanpaymentscouncil.eu returned 403 on its document library). We will not
 * ship rules we could not read. Every rule below is quoted from a document that
 * was actually fetched.
 */

/** The rails whose address rules could be read from a primary source. */
export type AddressScheme = 'sps' | 'hvps_plus' | 'fedwire';

export const ADDRESS_SCHEMES: readonly AddressScheme[] = ['sps', 'hvps_plus', 'fedwire'];

/** An ISO 20022 `PostalAddress` as the caller submits it, in ISO tag vocabulary. */
export interface AddressToCheck {
  twn_nm?: string;
  ctry?: string;
  pst_cd?: string;
  strt_nm?: string;
  bldg_nb?: string;
  adr_tp?: string;
  adr_line?: string[];
}

/**
 * `not_applicable` is a real answer and not a polite `pass`: it marks a rule
 * whose precondition is not met (an `AdrLine` rule on an address with no
 * `AdrLine`, or the T2 town/country rule on an address that has one). A caller
 * counting passes would otherwise credit itself with checks that never ran.
 */
export type AddressVerdict = 'pass' | 'fail' | 'not_applicable';

export interface AddressFinding {
  /** Stable identifier, safe to branch on. */
  rule: string;
  verdict: AddressVerdict;
  /** What was looked at and what was concluded, in one sentence. */
  detail: string;
  /** The document the rule comes from, with its date. */
  source: string;
}

export interface AddressCheckResult {
  scheme: AddressScheme;
  /** True when no finding failed. Rules that did not apply do not count against it. */
  conforms: boolean;
  findings: AddressFinding[];
  /** Why `cbpr+` is not on the menu. Served on every answer. */
  note: string;
}

// ---------------------------------------------------------------------------
// Sources — the exact documents, with their dates. Quoted, never paraphrased
// into something stronger than what they say.
// ---------------------------------------------------------------------------

const SRC_SPS_IG =
  'SIX, Swiss Implementation Guidelines for the ISO 20022 Payment Standard — Credit Transfer (pain.001), ' +
  'SPS 2026 v2.3, valid from 14 November 2026 (published 20.02.2026), ch. 3.11 table 9.';

const SRC_SPS_BR =
  'SIX, Swiss Business Rules for Payments and Cash Management for Customer-Bank Messages, ' +
  'SPS 2025 v3.2, valid from 22 November 2025 (published 24.02.2025), § 3.1.1.';

const SRC_FED =
  'Federal Reserve Financial Services, ISO 20022 implementation center — Fedwire Funds Service changes ' +
  'effective 16 November 2026: "remove the fully unstructured postal address option in favor of a single ' +
  'hybrid postal address format for all parties and agents across all message types ... require town name ' +
  'and country, and allow ... two free-text lines of up to 70 characters each" (frbservices.org, read 26.08.2026).';

const SRC_T2 =
  'European Central Bank, T2 RTGS User Detailed Functional Specifications R2026.NOV, 31 July 2026 — ' +
  '"Town Name And Country Rule".';

/**
 * The clause appended to `Ctry` findings on the two rails whose own document
 * states that a country is required without restating its format. Alpha-2 is
 * the ISO 20022 `CountryCode` data type, and the base schema could not be
 * fetched — saying so is cheaper than pretending the rail spelled it out.
 */
const ISO_CTRY_CLAUSE =
  ' Alpha-2 is the ISO 20022 CountryCode data type; the ISO 20022 base schema itself could not be ' +
  'fetched (iso20022.org unreachable, 26.08.2026).';

export const CBPR_NOTE =
  "No 'cbpr+' scheme is offered, on purpose. The CBPR+ usage guideline and the PMPG \"November 2026 postal " +
  'address guidance"' +
  ' are published on swift.com, which was unreachable on 26.08.2026 (iso20022.org likewise; ' +
  'europeanpaymentscouncil.eu returns 403 on its document library). Every rule applied here is quoted from a ' +
  'document that was actually read, and each finding names it. A boolean claiming CBPR+ conformity would be a ' +
  'guess dressed as a verdict.';

/** ISO 20022 `Max70Text` — the width of one `AdrLine`. */
const ADR_LINE_MAX_LENGTH = 70;
const ADR_LINE_MAX_COUNT = 2;

/**
 * The widths of the STRUCTURED elements, which nothing checked until the data
 * audit of 01/09/2026 (DATA-04): a `StrtNm` of 200 characters and a `TwnNm` of
 * 100 passed every rail, and the two length rules that existed
 * (`adr_line_max_length_70`, `adr_line_max_2`) only ever looked at `AdrLine`.
 * An address that overruns these is rejected by the receiving scheme, which is
 * precisely what a pre-flight is for.
 *
 * These are the ISO 20022 data types of the elements, as the SPS field table
 * assigns them (ch. 3.11 table 9 — the same table this file already quotes for
 * `AdrLine` being Max70Text and `Ctry` being ISO 3166 alpha-2). The T2 and
 * Fedwire documents do not restate widths, so on those two rails the rule is
 * sourced to the data type rather than to the rail, and says so.
 *
 * `Ctry` is absent on purpose: its width is two characters, and
 * `ctry_iso3166` already fails anything that is not exactly two uppercase
 * letters. A second rule would report the same defect twice.
 */
const STRUCTURED_MAX_LENGTHS = [
  { field: 'strt_nm', tag: 'StrtNm', type: 'Max70Text', max: 70 },
  { field: 'bldg_nb', tag: 'BldgNb', type: 'Max16Text', max: 16 },
  { field: 'pst_cd', tag: 'PstCd', type: 'Max16Text', max: 16 },
  { field: 'twn_nm', tag: 'TwnNm', type: 'Max35Text', max: 35 },
] as const satisfies ReadonlyArray<{
  field: keyof AddressToCheck;
  tag: string;
  type: string;
  max: number;
}>;

/**
 * What the two rails whose own document is silent on widths are told.
 *
 * Same honesty as ISO_CTRY_CLAUSE, and for the same reason: the width comes
 * from the ISO 20022 data type the element carries, read off the one field
 * table we could fetch (SIX SPS), not from the Federal Reserve page or the T2
 * UDFS, neither of which restates it.
 */
const ISO_WIDTH_CLAUSE =
  ' This rail\'s own fetched document does not restate element widths; the width applied is the ISO 20022 data ' +
  'type of the element, taken from the one field table that could be fetched (SIX, Swiss Implementation ' +
  'Guidelines SPS 2026 v2.3, published 20.02.2026, ch. 3.11 table 9). The ISO 20022 base schema itself was ' +
  'unreachable (iso20022.org, 26.08.2026).';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function present(value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? undefined : trimmed;
}

function lines(address: AddressToCheck): string[] {
  return (address.adr_line ?? []).map((l) => (l ?? '').trim()).filter((l) => l !== '');
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Whether a country code is an assigned ISO 3166-1 alpha-2 code.
 *
 * Resolved through ICU rather than a hardcoded table, the same way country
 * names are resolved elsewhere in this codebase: `Intl.DisplayNames` echoes the
 * input back unchanged for an unassigned code ('XX' -> 'XX') and returns a name
 * for an assigned one ('CH' -> 'Switzerland'). 'ZZ' is excluded by hand because
 * ICU names it "Unknown Region" — a name, but for the absence of a country.
 */
function isAssignedAlpha2(code: string): boolean {
  if (code === 'ZZ') return false;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) !== code;
  } catch {
    return false;
  }
}

/** Every string an `AdrLine` must not repeat, given the structured elements supplied. */
function structuredValues(address: AddressToCheck): Map<string, string> {
  const out = new Map<string, string>();
  const add = (label: string, value: string | undefined): void => {
    const v = present(value);
    if (v) out.set(norm(v), label);
  };

  add('StrtNm', address.strt_nm);
  add('BldgNb', address.bldg_nb);
  add('PstCd', address.pst_cd);
  add('TwnNm', address.twn_nm);
  add('Ctry', address.ctry);

  const pst = present(address.pst_cd);
  const twn = present(address.twn_nm);
  if (pst && twn) {
    out.set(norm(`${pst} ${twn}`), 'PstCd + TwnNm');
    out.set(norm(`${twn} ${pst}`), 'TwnNm + PstCd');
  }
  const strt = present(address.strt_nm);
  const bldg = present(address.bldg_nb);
  if (strt && bldg) {
    out.set(norm(`${strt} ${bldg}`), 'StrtNm + BldgNb');
    out.set(norm(`${bldg} ${strt}`), 'BldgNb + StrtNm');
  }

  return out;
}

// ---------------------------------------------------------------------------
// Individual rules
// ---------------------------------------------------------------------------

function ruleTwnNmRequired(address: AddressToCheck, source: string): AddressFinding {
  const twn = present(address.twn_nm);
  return {
    rule: 'twn_nm_required',
    verdict: twn ? 'pass' : 'fail',
    detail: twn
      ? `TwnNm is present ("${twn}").`
      : 'TwnNm is absent. It is mandatory in this scheme, unconditionally.',
    source,
  };
}

function ruleCtryRequired(address: AddressToCheck, source: string): AddressFinding {
  const ctry = present(address.ctry);
  return {
    rule: 'ctry_required',
    verdict: ctry ? 'pass' : 'fail',
    detail: ctry
      ? `Ctry is present ("${ctry}").`
      : 'Ctry is absent. It is mandatory in this scheme, unconditionally.',
    source,
  };
}

function ruleCtryIso3166(address: AddressToCheck, source: string): AddressFinding {
  const raw = address.ctry ?? '';
  const ctry = present(raw);

  if (!ctry) {
    return {
      rule: 'ctry_iso3166',
      verdict: 'not_applicable',
      detail: 'No Ctry supplied, so there is nothing to check the format of.',
      source,
    };
  }

  // The raw value, not an upper-cased copy: `Ctry` is a CountryCode, and
  // CountryCode is two UPPERCASE letters. Normalising here would hide exactly
  // the defect the rail will bounce.
  if (!/^[A-Z]{2}$/.test(ctry)) {
    return {
      rule: 'ctry_iso3166',
      verdict: 'fail',
      detail: `Ctry "${ctry}" is not two uppercase letters.`,
      source,
    };
  }

  if (!isAssignedAlpha2(ctry)) {
    return {
      rule: 'ctry_iso3166',
      verdict: 'fail',
      detail: `Ctry "${ctry}" is well-formed but is not an assigned ISO 3166-1 alpha-2 code.`,
      source,
    };
  }

  return {
    rule: 'ctry_iso3166',
    verdict: 'pass',
    detail: `Ctry "${ctry}" is an assigned ISO 3166-1 alpha-2 code.`,
    source,
  };
}

/**
 * One structured element against its ISO 20022 width.
 *
 * `not_applicable` when the element is absent, like every other conditional
 * rule here: a caller counting passes must not be credited with a check that
 * had nothing to look at. The length measured is the TRIMMED value, the same
 * one every other rule in this file reasons about.
 */
function ruleStructuredMaxLength(
  address: AddressToCheck,
  spec: (typeof STRUCTURED_MAX_LENGTHS)[number],
  source: string,
): AddressFinding {
  const rule = `${spec.field}_max_${spec.max}`;
  const value = present(address[spec.field] as string | undefined);

  if (!value) {
    return {
      rule,
      verdict: 'not_applicable',
      detail: `No ${spec.tag} supplied, so there is nothing to measure.`,
      source,
    };
  }

  return {
    rule,
    verdict: value.length <= spec.max ? 'pass' : 'fail',
    detail:
      value.length <= spec.max
        ? `${spec.tag} is ${value.length} characters, within the ${spec.type} maximum of ${spec.max}.`
        : `${spec.tag} is ${value.length} characters; ${spec.tag} is ${spec.type}, so ${spec.max} is the maximum.`,
    source,
  };
}

function ruleAdrTpForbidden(address: AddressToCheck): AddressFinding {
  const adrTp = present(address.adr_tp);
  return {
    rule: 'adr_tp_forbidden',
    verdict: adrTp ? 'fail' : 'pass',
    detail: adrTp
      ? `AdrTp "${adrTp}" was supplied. SPS marks Address Type "N — Must not be sent".`
      : 'No AdrTp supplied, as SPS requires ("N — Must not be sent").',
    source: SRC_SPS_IG,
  };
}

function ruleAdrLineMaxCount(address: AddressToCheck, source: string): AddressFinding {
  const ls = lines(address);
  if (ls.length === 0) {
    return {
      rule: 'adr_line_max_2',
      verdict: 'not_applicable',
      detail: 'No AdrLine supplied.',
      source,
    };
  }
  return {
    rule: 'adr_line_max_2',
    verdict: ls.length <= ADR_LINE_MAX_COUNT ? 'pass' : 'fail',
    detail:
      ls.length <= ADR_LINE_MAX_COUNT
        ? `${ls.length} AdrLine supplied, within the maximum of ${ADR_LINE_MAX_COUNT}.`
        : `${ls.length} AdrLine supplied; this scheme allows at most ${ADR_LINE_MAX_COUNT}.`,
    source,
  };
}

function ruleAdrLineMaxLength(address: AddressToCheck, source: string): AddressFinding {
  const ls = lines(address);
  if (ls.length === 0) {
    return {
      rule: 'adr_line_max_length_70',
      verdict: 'not_applicable',
      detail: 'No AdrLine supplied.',
      source,
    };
  }
  const over = ls.filter((l) => l.length > ADR_LINE_MAX_LENGTH);
  return {
    rule: 'adr_line_max_length_70',
    verdict: over.length === 0 ? 'pass' : 'fail',
    detail:
      over.length === 0
        ? `Every AdrLine is at most ${ADR_LINE_MAX_LENGTH} characters.`
        : `${over.length} AdrLine ${over.length === 1 ? 'exceeds' : 'exceed'} ${ADR_LINE_MAX_LENGTH} ` +
          `characters (longest: ${Math.max(...over.map((l) => l.length))}).`,
    source,
  };
}

/**
 * "Data already provided in another element must not be repeated."
 *
 * Scope, stated because it bounds what a `pass` means: we flag a line, or a
 * comma-separated segment of a line, that is EXACTLY a structured value already
 * supplied (or an exact pairing of two of them, such as "8001 Zurich"). We do
 * not flag paraphrase or partial overlap — catching "Bahnhofstrasse 45" as a
 * repetition of `StrtNm: Bahnhofstrasse` would also catch "Rue de Lausanne 5"
 * in Lausanne, and a checker that invents violations is worse than one that
 * misses subtle ones.
 */
function ruleAdrLineNoRepeat(address: AddressToCheck): AddressFinding {
  const ls = lines(address);
  const source = SRC_SPS_IG;

  if (ls.length === 0) {
    return { rule: 'adr_line_no_repeat', verdict: 'not_applicable', detail: 'No AdrLine supplied.', source };
  }

  const values = structuredValues(address);
  if (values.size === 0) {
    return {
      rule: 'adr_line_no_repeat',
      verdict: 'not_applicable',
      detail: 'No structured element supplied, so no AdrLine can repeat one.',
      source,
    };
  }

  const repeats: string[] = [];
  for (const line of ls) {
    const segments = line.split(',').map((s) => s.trim()).filter(Boolean);
    for (const segment of segments) {
      const label = values.get(norm(segment));
      if (label) repeats.push(`"${segment}" repeats ${label}`);
    }
  }

  return {
    rule: 'adr_line_no_repeat',
    verdict: repeats.length === 0 ? 'pass' : 'fail',
    detail:
      repeats.length === 0
        ? 'No AdrLine repeats a value already supplied in a structured element.'
        : `${repeats.join('; ')}. SPS: "Data already provided in another element must not be repeated."`,
    source,
  };
}

/**
 * The T2 / HVPS+ rule, and it is conditional — which is exactly why the checker
 * takes a `scheme`: "For each [.../PostalAddress a], IF the following
 * element(s) [PostalAddress/AddressLine b] is (are) absent, THEN at least one
 * occurrence of the following element(s) [PostalAddress/TownName c] and
 * [PostalAddress/Country d] must be present."
 *
 * An address made of `AddressLine` alone is therefore NOT rejected by this
 * corpus. Any prohibition would live in the MyStandards usage guideline, which
 * could not be fetched.
 */
function ruleTwnNmCtryConditional(address: AddressToCheck): AddressFinding {
  const rule = 'twn_nm_ctry_required_if_no_adr_line';
  const ls = lines(address);

  if (ls.length > 0) {
    return {
      rule,
      verdict: 'not_applicable',
      detail:
        'AddressLine is present, so the rule does not require TownName and Country. Note that the fetched T2 ' +
        'document does not forbid an AddressLine-only address; a prohibition, if any, lives in the ' +
        'MyStandards usage guideline, which could not be read.',
      source: SRC_T2,
    };
  }

  const twn = present(address.twn_nm);
  const ctry = present(address.ctry);
  const missing = [!twn ? 'TownName' : null, !ctry ? 'Country' : null].filter(Boolean);

  return {
    rule,
    verdict: missing.length === 0 ? 'pass' : 'fail',
    detail:
      missing.length === 0
        ? 'AddressLine is absent and both TownName and Country are present, as the rule requires.'
        : `AddressLine is absent, so TownName and Country are both required; missing: ${missing.join(', ')}.`,
    source: SRC_T2,
  };
}

// ---------------------------------------------------------------------------
// Scheme assembly
// ---------------------------------------------------------------------------

/**
 * Run the rules of one scheme over one address.
 *
 * Every rule of the scheme produces a finding, passing or failing, so a caller
 * can see what was checked and not only what broke. `conforms` is false as soon
 * as one finding fails.
 */
export function checkPostalAddress(scheme: AddressScheme, address: AddressToCheck): AddressCheckResult {
  const findings: AddressFinding[] = [];

  if (scheme === 'sps') {
    // TwnNm and Ctry are "M — Must be used" in the field table, and the
    // business rules restate it: "The specification of the places 'Town Name'
    // and 'Country' are mandatory in any case and are obligatory elements in
    // the message."
    findings.push(ruleTwnNmRequired(address, `${SRC_SPS_IG} Restated in ${SRC_SPS_BR}`));
    findings.push(ruleCtryRequired(address, `${SRC_SPS_IG} Restated in ${SRC_SPS_BR}`));
    findings.push(ruleCtryIso3166(address, `${SRC_SPS_IG} The table states Ctry as ISO 3166 alpha-2.`));
    findings.push(ruleAdrTpForbidden(address));
    findings.push(ruleAdrLineMaxCount(address, `${SRC_SPS_IG} "Maximum 2 lines allowed if offered as part of the hybrid address."`));
    findings.push(ruleAdrLineMaxLength(address, `${SRC_SPS_IG} AdrLine is Max70Text in the hybrid address.`));
    findings.push(ruleAdrLineNoRepeat(address));
    // The widths of the structured elements, from the same field table as the
    // rules above (DATA-04, 01/09/2026 — nothing measured them before).
    for (const spec of STRUCTURED_MAX_LENGTHS) {
      findings.push(
        ruleStructuredMaxLength(
          address,
          spec,
          `${SRC_SPS_IG} The table gives ${spec.tag} as ${spec.type}.`,
        ),
      );
    }
  } else if (scheme === 'fedwire') {
    findings.push(ruleTwnNmRequired(address, SRC_FED));
    findings.push(ruleCtryRequired(address, SRC_FED));
    findings.push(ruleCtryIso3166(address, SRC_FED + ISO_CTRY_CLAUSE));
    findings.push(ruleAdrLineMaxCount(address, SRC_FED));
    findings.push(ruleAdrLineMaxLength(address, SRC_FED));
    for (const spec of STRUCTURED_MAX_LENGTHS) {
      findings.push(ruleStructuredMaxLength(address, spec, SRC_FED + ISO_WIDTH_CLAUSE));
    }
    // No AdrTp rule and no non-repetition rule: the Federal Reserve page states
    // neither, and the upstream document it points to (PMPG, November 2026
    // postal address guidance) is on swift.com and could not be read. Silence
    // is reported as silence — we run no rule rather than borrow the Swiss one.
  } else {
    findings.push(ruleTwnNmCtryConditional(address));
    findings.push(ruleCtryIso3166(address, SRC_T2 + ISO_CTRY_CLAUSE));
    for (const spec of STRUCTURED_MAX_LENGTHS) {
      findings.push(ruleStructuredMaxLength(address, spec, SRC_T2 + ISO_WIDTH_CLAUSE));
    }
    // No AdrLine cap: the T2 validation appendix sets none, and importing the
    // SPS cap of 2 would fail addresses this rail accepts. The widths above are
    // a different matter: they are the element's own data type, which the rail
    // inherits whether or not its document repeats it.
  }

  return {
    scheme,
    conforms: findings.every((f) => f.verdict !== 'fail'),
    findings,
    note: CBPR_NOTE,
  };
}

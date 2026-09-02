/**
 * ISO 20022 `PostalAddress` — built from what this repository actually holds,
 * and never from what it would be convenient to claim.
 *
 * ## The deadline, in the words of the documents we could read
 *
 * Three payment corpora remove the fully unstructured postal address in
 * November 2026: SIX / Swiss Payment Standards (SPS 2026 in force 14 November
 * 2026, last SIC release accepting unstructured addresses 20 November 2026),
 * the Fedwire Funds Service (production 16 November 2026) and T2 / HVPS+
 * (release R2026.NOV). The CBPR+ rule itself is NOT cited anywhere in this
 * module: swift.com and iso20022.org were unreachable on 26/08/2026 and the
 * PMPG "November 2026 postal address guidance" lives there. We implement what
 * we can quote, and we say which document each rule comes from.
 *
 * ## The three principles this file exists to enforce
 *
 * 1. **A concatenated line can never become `StrtNm`.** GLEIF ships
 *    `addressLines` joined into one string (`gleif-address.ts`:
 *    `street = joinLines(la.addressLines)`), house number, floor and district
 *    mixed in. Splitting that into StrtNm + BldgNb would be guessing at the
 *    exact place where a payment rail will reject the guess. It goes out as
 *    `AdrLine` — the hybrid format, which the corpora explicitly allow — and
 *    the block says `format: 'hybrid'` so a reader knows why.
 * 2. **`StrtNm` / `BldgNb` only where the source really separates them.** In
 *    this repository that is the SIX BankMaster register alone, whose columns
 *    `street` and `building_number` are two distinct fields filled by the
 *    allocation authority itself.
 * 3. **Town + country are the core, and absent fields stay absent.** Measured
 *    26/08/2026: 120,906 of 121,716 directory rows (99.3%) carry a city, while
 *    only 36,636 carry any street at all. Town + country is also exactly — and
 *    only — what the three corpora require of an *agent* address. A block is
 *    therefore produced from a city-and-country row and is complete, not
 *    degraded.
 *
 * What this module does NOT do: parse or normalise a free-text address. That is
 * the trade of Loqate, Smarty and Google Address Validation, and it needs
 * postal reference data for 250 countries that we do not have.
 */

import { hasNonLatinScript } from './gleif-address.js';
import type { ChClearingSeatAddress } from './ch-clearing.js';

/**
 * How the address is expressed, derived from the block's own final shape —
 * never declared up front, so the label cannot disagree with the fields.
 *
 * - `structured` — every element served sits in its own ISO 20022 element. No
 *   `AdrLine` at all.
 * - `hybrid` — structured elements PLUS at most two `AdrLine`, which is the
 *   format SIX describes as supplementing the structured address ("It
 *   supplements the structured address with the option of providing information
 *   in two general elements 'Address Line'").
 */
export type PostalAddressFormat = 'structured' | 'hybrid';

/**
 * An ISO 20022 `PostalAddress` in the tag vocabulary of the standard, so a
 * caller can map it into a pain.001 / pacs.008 without a translation table.
 *
 * `twn_nm` and `ctry` are required BY THIS TYPE, not by convenience: an address
 * missing either is rejected by all three corpora and cannot be put in a
 * message. When we cannot fill them the builder returns `null` rather than a
 * block nobody can use.
 */
export interface Iso20022PostalAddress {
  /** `StrtNm`. Present only when the source publishes street and number apart. */
  strt_nm?: string;
  /** `BldgNb`. Same condition as `strt_nm` — never split out of a joined line. */
  bldg_nb?: string;
  /** `PstCd`. */
  pst_cd?: string;
  /** `TwnNm`. Mandatory in SPS and Fedwire; the reason this block exists. */
  twn_nm: string;
  /** `Ctry`, ISO 3166-1 alpha-2, upper-cased. */
  ctry: string;
  /**
   * `AdrLine`, at most 2 lines of at most 70 characters, and never repeating a
   * value already served in a structured element above — the SPS guideline is
   * explicit: "Data already provided in another element must not be repeated."
   *
   * Absent when there is nothing left to say after that rule is applied. When a
   * street line cannot be packed into 2 x 70 characters it is omitted here
   * rather than truncated; the untouched line always remains in the `address`
   * block served beside this one, so nothing is lost from the response.
   */
  adr_line?: string[];
  /** Derived from the fields above, after redundancy stripping. */
  format: PostalAddressFormat;
  /** The dataset this address came from, named as its publisher names it. */
  source: string;
  /**
   * When the SOURCE last stated this address — a SIX validity date, a GLEIF
   * registration date. Null when the dataset publishes none; never a clock
   * read, because an address dated today from a file published last year is a
   * false statement about the register.
   */
  as_of: string | null;
}

/**
 * The directory columns this builder reads. Deliberately a structural type
 * rather than an import of `BICRow`: the builder must be callable from a test
 * with a literal, and it must not acquire a dependency on the row shape beyond
 * the eight fields it actually consults.
 */
export interface DirectoryAddressRow {
  country_code: string;
  city: string | null;
  street: string | null;
  post_code: string | null;
  address_en: string | null;
  address_source: string | null;
  address_as_of: string | null;
  /** Which dataset the ROW came from, e.g. 'gleif', 'swiftcodes'. */
  source?: string | null;
}

/** ISO 20022 `Max70Text`, which is what an `AdrLine` is. */
const ADR_LINE_MAX_LENGTH = 70;

/**
 * Maximum `AdrLine` occurrences in the hybrid format. ISO 20022 itself allows
 * 0..7; SPS caps it at 2 ("Maximum 2 lines allowed if offered as part of the
 * hybrid address") and Fedwire describes the same two lines of up to 70
 * characters. We build to the tighter of the two so one block is valid on both.
 */
const ADR_LINE_MAX_COUNT = 2;

const SIX_SOURCE = 'SIX BankMaster (Swiss IID register)';

/** Human names of the datasets a directory row can come from. */
const ROW_SOURCE_NAMES: Record<string, string> = {
  gleif: 'GLEIF LEI-to-BIC mapping',
  swiftcodes: 'Redistributed SWIFT BIC directory (PeterNotenboom/SwiftCodes, MIT)',
  bundesbank: 'Deutsche Bundesbank Bankleitzahlendatei',
  six_group: SIX_SOURCE,
  nbp: 'Narodowy Bank Polski',
  eba_step2: 'EBA Clearing STEP2 SCT participant list',
};

function clean(value: string | null | undefined): string | undefined {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Case- and whitespace-insensitive comparison key for redundancy tests. */
function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The set of strings an `AdrLine` (or one of its segments) must not be, given
 * what the structured elements already carry.
 *
 * Both orders of "post code + town" are included because the two conventions
 * are geographic, not optional: "8001 Zurich" and "Zurich 8001" are the same
 * repetition of the same two elements.
 */
function redundantValues(parts: {
  strt_nm?: string;
  bldg_nb?: string;
  pst_cd?: string;
  twn_nm?: string;
  ctry?: string;
}): Set<string> {
  const out = new Set<string>();
  const add = (v: string | undefined): void => {
    if (v && v.trim() !== '') out.add(norm(v));
  };

  add(parts.strt_nm);
  add(parts.bldg_nb);
  add(parts.pst_cd);
  add(parts.twn_nm);
  add(parts.ctry);

  if (parts.pst_cd && parts.twn_nm) {
    add(`${parts.pst_cd} ${parts.twn_nm}`);
    add(`${parts.twn_nm} ${parts.pst_cd}`);
  }
  if (parts.strt_nm && parts.bldg_nb) {
    add(`${parts.strt_nm} ${parts.bldg_nb}`);
    add(`${parts.bldg_nb} ${parts.strt_nm}`);
  }

  return out;
}

/**
 * Drop the SEGMENTS of a joined line that merely repeat a structured element.
 *
 * Segment-level, never token-level, and that is the whole design. GLEIF joins
 * its address lines with ', ', so "FIRST CITY PLAZA, 44 MARINA, LAGOS" with
 * `TwnNm: LAGOS` loses its last segment and keeps the rest. A token-level strip
 * would have turned "Rue de Lausanne 5" in Lausanne into "Rue de 5" — mangling
 * a street name is a worse failure than leaving one redundant word standing.
 */
export function stripRedundantSegments(line: string, redundant: ReadonlySet<string>): string {
  const kept = line
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '' && !redundant.has(norm(s)));
  return kept.join(', ');
}

/**
 * Pack one line into at most `ADR_LINE_MAX_COUNT` lines of at most
 * `ADR_LINE_MAX_LENGTH` characters, splitting on a segment boundary first and
 * on a space second.
 *
 * Returns `[]` when the content cannot be expressed within that envelope. The
 * caller then omits `AdrLine` entirely: emitting a 279-character line (our
 * longest, measured 26/08/2026) would produce a block our own checker rejects,
 * and silently cutting an address at 70 characters would ship a wrong address
 * rather than an incomplete one.
 */
export function packAdrLines(line: string): string[] {
  const text = line.trim();
  if (text === '') return [];
  if (text.length <= ADR_LINE_MAX_LENGTH) return [text];

  // Segment boundaries first: they are where the source itself broke the
  // address, so a split there reproduces the original lines rather than
  // inventing a new one.
  const segments = text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const bySegments = greedyFill(segments, ', ');
  if (bySegments) return bySegments;

  const byWords = greedyFill(text.split(/\s+/), ' ');
  return byWords ?? [];
}

/** Fill up to ADR_LINE_MAX_COUNT lines with `pieces`, or null if they do not fit. */
function greedyFill(pieces: string[], joiner: string): string[] | null {
  const lines: string[] = [];
  let current = '';

  for (const piece of pieces) {
    if (piece.length > ADR_LINE_MAX_LENGTH) return null; // atom too long to place
    const candidate = current === '' ? piece : `${current}${joiner}${piece}`;
    if (candidate.length <= ADR_LINE_MAX_LENGTH) {
      current = candidate;
      continue;
    }
    lines.push(current);
    if (lines.length === ADR_LINE_MAX_COUNT) return null;
    current = piece;
  }

  if (current !== '') lines.push(current);
  return lines.length <= ADR_LINE_MAX_COUNT ? lines : null;
}

/**
 * Assemble the final block and derive `format` from what actually survived.
 *
 * One derivation, one place: a block that ends up with no `AdrLine` — because
 * the source had none, because every segment was redundant, or because the line
 * would not fit — is `structured`, and nothing else can say otherwise.
 */
function assemble(fields: {
  strt_nm?: string;
  bldg_nb?: string;
  pst_cd?: string;
  twn_nm: string;
  ctry: string;
  adr_line?: string[];
  source: string;
  as_of: string | null;
}): Iso20022PostalAddress {
  const hasLines = (fields.adr_line?.length ?? 0) > 0;
  return {
    ...(fields.strt_nm ? { strt_nm: fields.strt_nm } : {}),
    ...(fields.bldg_nb ? { bldg_nb: fields.bldg_nb } : {}),
    ...(fields.pst_cd ? { pst_cd: fields.pst_cd } : {}),
    twn_nm: fields.twn_nm,
    ctry: fields.ctry,
    ...(hasLines ? { adr_line: fields.adr_line } : {}),
    format: hasLines ? 'hybrid' : 'structured',
    source: fields.source,
    as_of: fields.as_of,
  };
}

/** The SIX branch: the only source in this repository with a real StrtNm/BldgNb split. */
function fromSix(seat: ChClearingSeatAddress): Iso20022PostalAddress | null {
  const twn_nm = clean(seat.town);
  const ctry = clean(seat.country)?.toUpperCase();
  if (!twn_nm || !ctry) return null;

  return assemble({
    strt_nm: clean(seat.street),
    bldg_nb: clean(seat.building_number),
    pst_cd: clean(seat.post_code),
    twn_nm,
    ctry,
    // No AdrLine at all: everything SIX publishes has its own element, so a
    // line here could only repeat one of them — which the guideline forbids.
    source: SIX_SOURCE,
    as_of: seat.valid_on,
  });
}

/** The directory branch: GLEIF and the BIC directories. Street, if any, becomes AdrLine. */
function fromDirectoryRow(row: DirectoryAddressRow): Iso20022PostalAddress | null {
  const twn_nm = clean(row.city);
  const ctry = clean(row.country_code)?.toUpperCase();
  if (!twn_nm || !ctry) return null;

  const pst_cd = clean(row.post_code);

  // Which form of the street line to serve. Same rule as `registeredAddress()`:
  // decided from the ACTUAL script of the stored line, never from the GLEIF
  // language tag, which marks Greek and Arabic entities 'el' / 'ar' even when
  // they filed an already-Latin address. When the line is non-Latin and GLEIF
  // ships no English alternative we serve no AdrLine at all — a transliteration
  // is never invented, here no more than anywhere else.
  const stored = clean(row.street);
  const latin =
    stored && hasNonLatinScript(stored) ? clean(row.address_en) : (stored ?? clean(row.address_en));

  const adr_line = latin
    ? packAdrLines(stripRedundantSegments(latin, redundantValues({ pst_cd, twn_nm, ctry })))
    : [];

  // The address dataset when there is one (GLEIF fills `address_source`), the
  // dataset that named the row otherwise. The 85,080 SwiftCodes rows carry a
  // city and no address block at all, and crediting GLEIF for their town would
  // be attributing data to a registry that never published it.
  const source =
    clean(row.address_source) ??
    (row.source ? (ROW_SOURCE_NAMES[row.source] ?? row.source) : undefined) ??
    'IBANforge BIC directory';

  return assemble({
    pst_cd,
    twn_nm,
    ctry,
    adr_line,
    source,
    // Null when the dataset publishes no filing date, which is the case for
    // every row without a GLEIF address block. Absent, not guessed.
    as_of: clean(row.address_as_of) ?? null,
  });
}

/**
 * Build the ISO 20022 `PostalAddress` for an institution, or `null` when we
 * cannot fill `TwnNm` and `Ctry`.
 *
 * Precedence — SIX first, and only for the reason that justifies it: for a
 * Swiss or Liechtenstein institution the BankMaster row comes from the
 * allocation authority AND is the one source with `StrtNm` and `BldgNb` truly
 * apart, so it yields a `structured` block where GLEIF could only ever yield a
 * `hybrid` one. Everywhere else the directory row is used.
 *
 * Not consulted, deliberately: the ECB / Banco de España MFI lists behind
 * `official_identity`. Their `address` is a single free-text line composed at
 * seed time ("ul. Sokolska 34, 40-086 Katowice") with no separated town or
 * country, so it can satisfy neither `TwnNm` nor `Ctry`, and as an `AdrLine`
 * beside a town we already serve it would repeat it.
 */
export function toIso20022PostalAddress(
  row: DirectoryAddressRow | null | undefined,
  seat?: ChClearingSeatAddress | null,
): Iso20022PostalAddress | null {
  if (seat) {
    const six = fromSix(seat);
    if (six) return six;
  }
  if (!row) return null;
  return fromDirectoryRow(row);
}

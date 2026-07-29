/**
 * Finnish monetary institution codes, transcribed from Finance Finland.
 *
 * Source: "Finnish monetary institution codes and BICs", Finanssiala ry
 * (Finance Finland), published 15.10.2025.
 * https://www.finanssiala.fi/wp-content/uploads/2025/10/finnish-monetary-institution-codes-and-bics_15102025.pdf
 *
 * WHY THIS IS A CHECKED-IN TABLE AND NOT A SEEDER
 *
 * Germany reseeds monthly from a 13,807-row CSV, and a row-count floor catches
 * a truncated download before it can replace good data. Finland publishes ~20
 * rows of prose in a PDF: ranges written as "470-479", groups written as "8 and
 * 34", and one bank's allocation wrapped across six lines of a table cell. No
 * floor is meaningful on 20 rows, so a parser that silently read fewer ranges
 * after a layout change would answer not_in_register with authoritative: true
 * on valid Finnish IBANs. That is a false hard denial telling a caller to stop
 * a real payment: strictly worse than the ambiguity this field exists to
 * remove. Transcribed by hand, reviewed when Finance Finland republishes.
 *
 * WHAT AN ALLOCATION IS WORTH HERE
 *
 * Finland allocates prefixes to banking GROUPS, not to individual institutions.
 * A hit confirms the group and its BIC; it does not identify a specific bank
 * the way an allocated Swiss IID or German BLZ does. The negative direction is
 * the strong one: a prefix in no published range is held by nobody.
 */

/** Publication date of the transcribed list, ISO. */
export const FI_REGISTER_AS_OF = '2025-10-15';

export interface FiHit {
  status: 'allocated' | 'not_allocated' | 'unknown';
  code?: string;
  bic?: string;
  institution?: string;
}

interface FiAllocation {
  /** Single code, or an inclusive range of equal-length codes. */
  codes: string[];
  ranges?: Array<[string, string]>;
  bic: string;
  institution: string;
}

/**
 * The published table, verbatim in content. Codes keep their published length:
 * that length is the data, not a formatting detail.
 */
const ALLOCATIONS: FiAllocation[] = [
  { codes: ['405', '497'], bic: 'HELSFIHH', institution: 'Aktia Bank' },
  { codes: ['714'], bic: 'EVSEFIHH', institution: 'Alisa Bank' },
  { codes: ['717'], bic: 'BIGKFIH1', institution: 'Bigbank' },
  { codes: ['713'], bic: 'CITIFIHX', institution: 'Citibank' },
  { codes: ['8', '34'], bic: 'DABAFIHH', institution: 'Danske Bank A/S, Finland Branch' },
  { codes: ['37'], bic: 'DNBAFIHX', institution: 'DNB Bank ASA, Finland Branch' },
  { codes: ['799'], bic: 'HOLVFIHH', institution: 'Holvi Payment Services' },
  { codes: ['796'], bic: 'NARYFIH2', institution: 'Narvi Payments' },
  { codes: ['1', '2'], bic: 'NDEAFIHH', institution: 'Nordea Bank' },
  { codes: ['5'], bic: 'OKOYFIHH', institution: 'OP Group' },
  { codes: ['794'], bic: 'PASXFIH2', institution: 'PaySaxas Oy' },
  {
    codes: [],
    ranges: [['470', '479']],
    bic: 'POPFFI22',
    institution: 'Local Co-operative Banks (POP) and Bonum Bank',
  },
  { codes: ['718'], bic: 'UASNFIH2', institution: 'Saldo Bank UAB Finland Branch' },
  { codes: ['33'], bic: 'ESSEFIHX', institution: 'Skandinaviska Enskilda Banken (SEB)' },
  { codes: ['36', '39'], bic: 'SBANFIHH', institution: 'S-Bank' },
  {
    codes: ['715', '400', '402', '403'],
    ranges: [
      ['406', '408'],
      ['410', '412'],
      ['414', '421'],
      ['423', '432'],
      ['435', '452'],
      ['454', '464'],
      ['483', '493'],
      ['495', '496'],
    ],
    bic: 'ITELFIHH',
    institution: 'Central Bank of Savings Banks Finland, Savings Banks (Sp) and Oma Säästöpankki',
  },
  { codes: ['793'], bic: 'TRYEFIH3', institution: 'TrueLayer (Ireland) Ltd, Finnish Branch' },
  { codes: ['797'], bic: 'TRYEFIH2', institution: 'TrueLayer (Ireland) Ltd, Finnish Branch' },
  { codes: ['795'], bic: 'WAMOFIH2', institution: 'Wamo Solutions Oy' },
  { codes: ['6'], bic: 'AABAFI22', institution: 'Bank of Åland' },
];

/** Flattened code -> holder, built once. Ranges expand to their members. */
const BY_CODE = new Map<string, { bic: string; institution: string }>();
for (const a of ALLOCATIONS) {
  const put = (c: string) => {
    if (!BY_CODE.has(c)) BY_CODE.set(c, { bic: a.bic, institution: a.institution });
  };
  for (const c of a.codes) put(c);
  for (const [lo, hi] of a.ranges ?? []) {
    const width = lo.length;
    for (let n = Number(lo); n <= Number(hi); n++) put(String(n).padStart(width, '0'));
  }
}

/**
 * The band the document defines but populates with nobody.
 *
 * "from the beginning of the year 2024 codes with '72-78' are four characters
 * long" — a length rule for codes the table does not list a holder for. Absence
 * from a table of holders is not proof the band is unallocated, so answering
 * not_allocated here would assert more than the source supports.
 */
function inReservedBand(bban: string): boolean {
  const two = Number(bban.slice(0, 2));
  return two >= 72 && two <= 78;
}

/**
 * Resolve a Finnish BBAN to its monetary institution by longest allocated
 * prefix.
 *
 * Lengths run 4 down to 1 because the code length varies by prefix and the
 * longest allocated match is the right one: '405' is Aktia while a bare '4' was
 * never allocated to anyone, so a shorter fallback would invent a holder.
 */
export function lookupFiInstitution(bban: string): FiHit | null {
  if (!/^\d{4,}$/.test(bban)) return null;

  for (let len = 4; len >= 1; len--) {
    const candidate = bban.slice(0, len);
    const hit = BY_CODE.get(candidate);
    if (hit) {
      return { status: 'allocated', code: candidate, bic: hit.bic, institution: hit.institution };
    }
  }

  if (inReservedBand(bban)) return { status: 'unknown' };
  return { status: 'not_allocated' };
}

/** Every allocated code, for pruning curated keys that contradict the register. */
export function allocatedFiCodes(): ReadonlySet<string> {
  return new Set(BY_CODE.keys());
}

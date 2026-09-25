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
 *
 * LA LISTE DE LA SURCOUCHE PRIVÉE (25/09/2026)
 *
 * Les conditions de réutilisation de cette liste ne sont pas établies : elle
 * quitte le dépôt public à l'étape du retrait, et la surcouche privée la porte
 * déjà (membre `register_fi`, table `fi_monetary_codes`,
 * src/lib/restricted-family.ts). Tant que ce fichier la porte aussi, la règle de
 * fraîcheur de la fusion (src/lib/restricted-overlay.ts) choisit : la liste de
 * la surcouche ne sert que si elle est STRICTEMENT plus récente que celle-ci ;
 * à date égale ou plus ancienne, celle-ci est gardée. La copie chargée au départ
 * dans la surcouche porte la même date : aucune réponse ne change. Le choix est
 * mémorisé avec la connexion de la base : `resetFiRegister()` est appelé à
 * chaque fermeture de la base BIC (src/lib/bic-lookup.ts, resetStatements), donc
 * à chaque rechargement de la surcouche.
 */
import { getBicDB } from './db.js';

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

/** Une liste lue : code -> titulaire, et sa date (AAAA-MM-JJ). */
interface FiList {
  byCode: ReadonlyMap<string, { bic: string; institution: string }>;
  asOf: string;
}

/** La liste de ce fichier. */
const PUBLIC_LIST: FiList = { byCode: BY_CODE, asOf: FI_REGISTER_AS_OF };

/** `undefined` : pas encore choisie depuis l'ouverture de la base. */
let served: FiList | undefined;

/** Une date de liste : AAAA-MM-JJ, et un vrai jour du calendrier ; sinon null. */
function listDay(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

/**
 * La liste de la surcouche privée, ou null : pas de table (base publique seule,
 * surcouche qui ne la porte pas), aucune ligne lisible, ou une date qui n'est pas
 * un jour AAAA-MM-JJ. Une seule date mal formée écarte toute la liste : comparée
 * en texte, elle pourrait passer pour plus récente et finir dans
 * `bank_code_check.as_of` (relecture de la PR 267, point 6).
 */
function overlayList(): FiList | null {
  let rows: Array<{ code: string; bic: string; institution: string; as_of: string | null }>;
  try {
    rows = getBicDB()
      .prepare('SELECT code, bic, institution, as_of FROM fi_monetary_codes ORDER BY code')
      .all() as typeof rows;
  } catch {
    return null;
  }
  const byCode = new Map<string, { bic: string; institution: string }>();
  let asOf: string | null = null;
  for (const row of rows) {
    if (!/^\d{1,4}$/.test(row.code)) continue;
    const day = listDay(row.as_of);
    if (!day) return null;
    byCode.set(row.code, { bic: row.bic, institution: row.institution });
    if (!asOf || day > asOf) asOf = day;
  }
  return byCode.size > 0 && asOf ? { byCode, asOf } : null;
}

/**
 * La liste servie, choisie par la règle de fraîcheur de la fusion : celle de la
 * surcouche si elle est strictement plus récente (b), sinon celle de ce fichier
 * (d, date égale comprise). Jamais un mélange des deux.
 */
function servedList(): FiList {
  if (served) return served;
  const overlay = overlayList();
  served = overlay && overlay.asOf > PUBLIC_LIST.asOf ? overlay : PUBLIC_LIST;
  return served;
}

/** La date de la liste servie (AAAA-MM-JJ). */
export function fiRegisterAsOf(): string {
  return servedList().asOf;
}

/** Oublie le choix de la liste : appelé à chaque fermeture de la base BIC. */
export function resetFiRegister(): void {
  served = undefined;
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

  const list = servedList();
  for (let len = 4; len >= 1; len--) {
    const candidate = bban.slice(0, len);
    const hit = list.byCode.get(candidate);
    if (hit) {
      return { status: 'allocated', code: candidate, bic: hit.bic, institution: hit.institution };
    }
  }

  if (inReservedBand(bban)) return { status: 'unknown' };
  return { status: 'not_allocated' };
}

/** Every allocated code, for pruning curated keys that contradict the register. */
export function allocatedFiCodes(): ReadonlySet<string> {
  return new Set(servedList().byCode.keys());
}

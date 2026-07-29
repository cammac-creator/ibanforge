import { getBicDB } from './db.js';

/**
 * National bank-code registers that share one shape: an authority allocates a
 * fixed-width numeric code to an institution and publishes the whole allocation.
 *
 * Austria (Oesterreichische Nationalbank, SEPA-Zahlungsverkehrs-Verzeichnis,
 * republished daily) and Belgium (Banque nationale de Belgique, Secrétariat du
 * Protocole, the body that allocates the codes) both fit. Neither carries the
 * retirement/successor pair the Bundesbank publishes, so neither needs the extra
 * columns de-blz.ts has; one table serves both rather than two near-identical
 * modules.
 *
 * As with CH, LI, DE and FI, being here is a claim that an absence means the
 * code is allocated to nobody. Seeded by scripts/seed-national.ts.
 */
export interface NationalCodeEntry {
  code: string;
  name: string;
  bic: string | null;
}

/** Width of the bank code as an IBAN of that country carries it. */
const CODE_WIDTH: Record<string, number> = { AT: 5, BE: 3 };

/**
 * Bring a published code to the width the IBAN uses.
 *
 * The OeNB writes the central bank as '100' while an Austrian IBAN carries
 * '00100'. Comparing the two unpadded answers "not allocated" for a real bank,
 * which is the same defect that made four Swiss codes stale in July.
 */
export function normaliseCode(cc: string, raw: string): string | null {
  const width = CODE_WIDTH[cc];
  if (!width) return null;
  const digits = (raw ?? '').trim();
  if (!/^\d+$/.test(digits) || digits.length > width) return null;
  return digits.padStart(width, '0');
}

let stmt: import('better-sqlite3').Statement | null = null;
let tableChecked = false;
let tablePresent = false;

/**
 * A database built before this seeder ran has no table. Answering "no register"
 * is the safe failure: the country degrades to the composite map it used
 * before, rather than every lookup throwing or, worse, every code reading as
 * unallocated.
 */
function ready(): boolean {
  if (!tableChecked) {
    tableChecked = true;
    try {
      const row = getBicDB()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='national_bank_codes'")
        .get();
      tablePresent = !!row;
    } catch {
      tablePresent = false;
    }
  }
  return tablePresent;
}

export function nationalRegisterAvailable(cc: string): boolean {
  if (!CODE_WIDTH[cc] || !ready()) return false;
  try {
    const row = getBicDB()
      .prepare('SELECT 1 AS ok FROM national_bank_codes WHERE country = ? LIMIT 1')
      .get(cc) as { ok: number } | undefined;
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Look up an allocated code. Returns null when the register does not carry it,
 * which for these two countries means no institution holds it.
 *
 * Belgium publishes all 1000 three-digit slots and writes 'VRIJ' in the BIC
 * column for the 210 it has not allocated. Those are dropped at seed time
 * rather than stored, so an explicit "nobody holds this" stays a miss here
 * instead of resolving to a bank named VRIJ.
 */
export function lookupNationalCode(cc: string, bankCode: string): NationalCodeEntry | null {
  if (!ready()) return null;
  const code = normaliseCode(cc, bankCode);
  if (!code) return null;
  try {
    if (!stmt) {
      stmt = getBicDB().prepare(
        'SELECT code, name, bic FROM national_bank_codes WHERE country = ? AND code = ?',
      );
    }
    const row = stmt.get(cc, code) as NationalCodeEntry | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

/** Every allocated code for a country, for pruning curated keys that contradict it. */
export function allocatedCodes(cc: string): ReadonlySet<string> {
  if (!ready()) return new Set();
  try {
    const rows = getBicDB()
      .prepare('SELECT code FROM national_bank_codes WHERE country = ?')
      .all(cc) as Array<{ code: string }>;
    return new Set(rows.map((r) => r.code));
  } catch {
    return new Set();
  }
}

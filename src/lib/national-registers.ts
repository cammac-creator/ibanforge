import { getBicDB } from './db.js';

/**
 * National bank-code registers that share one shape: an authority allocates a
 * fixed-width numeric code to an institution and publishes the whole allocation.
 *
 * Austria (Oesterreichische Nationalbank, SEPA-Zahlungsverkehrs-Verzeichnis,
 * republished daily), Belgium (Banque nationale de Belgique, Secrétariat du
 * Protocole, the body that allocates the codes) and Slovakia (Národná banka
 * Slovenska, the prevodník of identification codes for the domestic payment
 * system) all fit. None carries the retirement/successor pair the Bundesbank
 * publishes, so none needs the extra columns de-blz.ts has; one table serves
 * all three rather than three near-identical modules.
 *
 * As with CH, LI, DE and FI, being here is a claim that an absence means the
 * code is allocated to nobody. Seeded by scripts/seed-national.ts.
 */
export interface NationalCodeEntry {
  code: string;
  name: string;
  bic: string | null;
  /** One line, house number included (OeNB publishes it that way); null for BE and SK. */
  street: string | null;
  post_code: string | null;
  town: string | null;
  /** LEI where the register publishes one (OeNB, 99% filled); null for BE and SK. */
  lei: string | null;
  /**
   * The credit the register's own terms require, as the seeder read it.
   *
   * Null for AT and BE — neither publisher asks for one, and neither states an
   * edition of its own to name. Slovakia fills it because the NBS terms make
   * citing the source a condition of reuse, so it travels with the row rather
   * than being written beside it at each surface.
   */
  source: string | null;
  /**
   * Effective date the REGISTER states, 'YYYY-MM-DD'. Null for AT and BE, whose
   * answers are dated by the reference set's refresh month instead.
   */
  as_of: string | null;
}

/** Width of the bank code as an IBAN of that country carries it. */
const CODE_WIDTH: Record<string, number> = { AT: 5, BE: 3, SK: 4, SM: 5 };

/**
 * 🚨 Which of these registers EXHAUST their country's bank-code space.
 *
 * This table is the difference between "no institution holds this code" and "we
 * have not seen this code", and it is the whole reason San Marino may live in
 * the same table as the other three without inheriting their authority.
 *
 * AT, BE and SK are published by the authority that ALLOCATES the codes and
 * cover the space: an absence there is the allocation authority's own verdict.
 *
 * SM is not. The BCSM page is titled "operating banks" and lists banks; it
 * never claims to publish the ABI allocation, San Marino also licenses payment
 * and e-money institutions that are not banks (one holds a San Marino BIC and
 * settles through EBA STEP2), and the ISO 13616 registry's own San Marino
 * example IBAN carries an ABI absent from the page. So a hit names the holder
 * and a MISS means nothing.
 *
 * enrich.ts reads this rather than hardcoding a country list, and the only
 * place a non-exhaustive register may lead is `verified` — never
 * `not_in_register`, never `not_allocated`.
 */
const EXHAUSTIVE: Record<string, boolean> = { AT: true, BE: true, SK: true, SM: false };

/**
 * Does an absence in this country's register mean the code is unallocated?
 *
 * False for a country we hold no register for AND for one whose register does
 * not cover its code space — the caller cannot tell those apart from here, and
 * must not need to: both mean "do not turn a miss into a denial".
 */
export function nationalRegisterIsExhaustive(cc: string): boolean {
  return EXHAUSTIVE[cc] === true;
}

/**
 * Bring a published code to the width the IBAN uses.
 *
 * The OeNB writes the central bank as '100' while an Austrian IBAN carries
 * '00100'; the NBS writes Slovakia's largest bank as '200' while a Slovak IBAN
 * carries '0200'. Comparing the two unpadded answers "not allocated" for a real
 * bank, which is the same defect that made four Swiss codes stale in July.
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
 * Same lifecycle discipline as resetStatements() in bic-lookup.ts, and wired
 * into closeAll() the same way. Without it, a statement prepared on a closed
 * connection kept throwing, the catch lookupNationalCode carried at the time
 * ate the throw and answered null — which enrich turned into `not_in_register` with
 * `authoritative: true`: real AT/BE banks denied with full confidence, from a
 * plumbing failure. The table-presence memo resets with it: it describes the
 * same database.
 */
export function resetNationalRegisterStatements(): void {
  stmt = null;
  tableChecked = false;
  tablePresent = false;
}

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
 * which for these three countries means no institution holds it.
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
  // No catch around the query, and that is the point: these three countries are
  // authoritative, so a null out of here becomes not_in_register with reason
  // not_allocated — "do not send". A catch { return null } made a corrupt page
  // or a schema drift produce that sentence about real AT/BE/SK banks with full
  // confidence (the resetNationalRegisterStatements() docstring above records
  // the first bite; the 29/08/2026 adversarial review reproduced the class on
  // Bulgaria). A query failure now escapes, like lookupBlz: every caller sits
  // under a guard that converts it into status unavailable / reason
  // lookup_failed, authority dropped. Schema drift stays harmless a different
  // way — SELECT * with defensive mapping degrades missing columns to nulls
  // instead of raising.
  if (!stmt) {
    stmt = getBicDB().prepare('SELECT * FROM national_bank_codes WHERE country = ? AND code = ?');
  }
  const row = stmt.get(cc, code) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    code: String(row.code),
    name: String(row.name),
    bic: (row.bic as string | null | undefined) ?? null,
    street: (row.street as string | null | undefined) ?? null,
    post_code: (row.post_code as string | null | undefined) ?? null,
    town: (row.town as string | null | undefined) ?? null,
    lei: (row.lei as string | null | undefined) ?? null,
    // Defensive, like every field above: a database seeded before these two
    // columns existed has no `source` and no `as_of`, and `?? null` degrades
    // that to "no credit stated" instead of raising. The credit is a licence
    // condition, so the surfaces are built to omit it rather than to print a
    // half of it — see nationalRegisterCredit() below.
    source: (row.source as string | null | undefined) ?? null,
    as_of: (row.as_of as string | null | undefined) ?? null,
  };
}

/**
 * What the loaded register says about itself: the credit it requires and the
 * date that credit is about.
 *
 * Read from the rows, never from a clock or a constant. Slovakia is the country
 * this exists for — the NBS terms make citing the source a condition of reuse,
 * and its page states an effective date that our monthly refresh month would
 * misreport. Austria and Belgium store neither and get `null` for both, which
 * is what keeps their answers on `getReferenceAsOf()` with no special case.
 *
 * Both fields are read in ONE query so a caller can never print a version from
 * one edition beside a date from another.
 */
export function nationalRegisterEdition(cc: string): {
  source: string | null;
  as_of: string | null;
} {
  if (!CODE_WIDTH[cc] || !ready()) return { source: null, as_of: null };
  try {
    const row = getBicDB()
      .prepare(
        // MAX(as_of) and the source that goes with it. The seeder writes one
        // edition per country in a single transaction, so every row of a
        // country agrees; ordering makes that explicit rather than assumed.
        `SELECT source, as_of FROM national_bank_codes
          WHERE country = ? AND as_of IS NOT NULL
          ORDER BY as_of DESC LIMIT 1`,
      )
      .get(cc) as { source: string | null; as_of: string | null } | undefined;
    return { source: row?.source ?? null, as_of: row?.as_of ?? null };
  } catch {
    // A credit that cannot be read is omitted, never guessed: printing the
    // authority's name beside a date we do not hold is the one failure the
    // licence discipline exists to prevent.
    return { source: null, as_of: null };
  }
}

/**
 * How each register's credit is worded, and — the part that matters — WHOSE
 * date it is.
 *
 * Slovakia's is the register's own effective date, so it reads as a plain
 * parenthesis, in the publisher's own word for "source" (`Zdroj`), which is
 * what its terms ask to be named.
 *
 * San Marino's is the day WE read the page: the BCSM publishes no edition and
 * no revision date. "read on" is not decoration — a bare `(2026-09-06)` there
 * would read as the source's date and quietly overstate it, which is the exact
 * failure getBgAsOf() was written to avoid one register over.
 */
const CREDIT_FORMAT: Record<string, (source: string, asOf: string) => string> = {
  SK: (source, asOf) => `Zdroj: ${source} (${asOf})`,
  SM: (source, asOf) => `Source: ${source} (read on ${asOf})`,
};

/**
 * The one-line credit every surface must carry, built from the loaded data.
 *
 * Null when the register states no edition (AT, BE) or when nothing is loaded —
 * better no credit line than one naming a date we do not hold. Same shape and
 * same reasoning as bgAttribution() in bg-bae.ts.
 */
export function nationalRegisterCredit(cc: string): string | null {
  const { source, as_of } = nationalRegisterEdition(cc);
  const format = CREDIT_FORMAT[cc];
  if (!source || !as_of || !format) return null;
  return format(source, as_of);
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

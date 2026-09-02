import { getBicDB } from './db.js';

/**
 * EBA register of payment and electronic money institutions — the PSD2
 * "golden copy" the European Banking Authority republishes daily.
 *
 * ## The licence
 *
 * "Reproduction of all EBA material on this site is authorised, provided the
 * source is acknowledged" (https://www.eba.europa.eu/legal-notice). Every
 * surface that serves this data carries `source` and `as_of`, read from the
 * database rather than written by hand.
 *
 * ## The file has no BIC and no LEI. At all.
 *
 * Measured exhaustively over the whole 217 MB copy of 2026-08-25: the entity
 * records carry thirteen property keys and not one of them is an identifier
 * this API already joins on. There is no BIC, no LEI, no SWIFT code. The only
 * candidate join to an IBAN is therefore **country + national reference code**,
 * and that code is whatever the national competent authority happens to file
 * an authorisation under — which is usually *not* the code the country's IBAN
 * carries.
 *
 * ## Which is why only Spain is served
 *
 * The join was measured country by country against the bank codes we already
 * hold (the curated map, the Bundesbank BLZ file, the Austrian and Belgian
 * registers). Thirty countries were tested. In twenty-nine the register files
 * authorisations under a company or tax identifier from an entirely different
 * code space:
 *
 * - Company/tax registration numbers — PL files under the 10-digit NIP against
 *   an 8-digit IBAN bank code; CZ and SK under the 8-digit IČO against 4; FR
 *   under the 9-digit SIREN against a 5-digit code banque; BE, FI, DK, HU, EE,
 *   BG, LV, SI, NO, SE, IS, IT (codice fiscale), GR (AFM) likewise.
 * - Authority-internal references — NL `R203521`, IE `C58301`, MT `C106255`,
 *   LU `Z00000035`, LT `LB000237`, HR `IPP420`, RO `IP_RO_0010`, CY `115.1.2.5`,
 *   AT `481488x`.
 * - DE files under the 6-digit BaFin Institutsnummer; the IBAN carries the
 *   8-digit Bankleitzahl. Different register, different number.
 *
 * **Spain is the exception, and it is demonstrated rather than assumed:**
 *
 * 1. Every one of the 112 Spanish codes is exactly 4 numeric digits — the width
 *    an ES IBAN carries in positions 1-4.
 * 2. The ranges track the entity types with no exceptions: 67xx holds all 12
 *    `PSD_EMI`, 68xx/69xx hold the payment institutions and AISPs, and 86xx-88xx
 *    hold entities whose own published names all end in "E.F.C."
 *    (Establecimiento Financiero de Crédito). That last one is decisive because
 *    it is confirmed by the register's own text, with no reference to our data:
 *    the Banco de España código de entidad is what is being published here.
 * 3. Spanish *banks* live in 0xxx-3xxx. Zero of the 112 PSD codes collide with
 *    a bank code we hold — the ranges are disjoint, so this cannot hand a bank
 *    the description of a payment institution.
 * 4. The one code present in both this register and our independently curated
 *    bank-code map agrees: 6717 is "BNEXT ELECTRONIC ISSUER, E.D.E." here and
 *    BNXTESM2 there. The only other non-bank Spanish key we hold, 6723
 *    (Modulr Finance B.V. Sucursal en España), is absent for a structural
 *    reason rather than a contradictory one: it is a *branch*, and branches are
 *    `PSD_BR` rows, 0 of whose 244 carry a national reference code at all.
 *
 * Portugal is the closest thing to a second candidate — 4 numeric digits, the
 * right width — and it is still declined: 17 entities, zero overlap with
 * anything we hold, and codes scattered over 1800/32xx/75xx/81xx/82xx/87xx
 * rather than the single reserved range Spain shows. Plausible is not
 * demonstrated. Malta is declined for a sharper reason: a Maltese IBAN bank
 * code is a 4-letter abbreviation of the institution's name, so the two `MFSA`
 * entity abbreviations that "match" are the exact name-shaped coincidence
 * pra-banks.ts refuses to join on.
 *
 * ## No negative branch, ever
 *
 * The register's own disclaimer says it "has no legal significance and confers
 * no rights in law", and that an omitted institution's authorisation is
 * unaffected. So a code that is absent produces **no block at all**, never
 * `registered: false`. Same discipline as `pra_authorisation` and
 * `iban_issuer: 'not_listed'`: silence is not a denial.
 *
 * Seeded by scripts/seed-eba-psd.ts.
 */
export type PsdEntityType =
  'payment_institution' | 'emi' | 'aisp' | 'exempted_emi' | 'exempted_payment_institution';

export interface PsdRegistration {
  /** Always true. There is no negative form of this block — see the file note. */
  registered: true;
  entity_type: PsdEntityType;
  name: string;
  /** Country of residence as the register publishes it. */
  country: string;
  /** The national competent authority that filed the authorisation, e.g. 'ES_BE'. */
  competent_authority: string;
  /** The attribution the licence requires, verbatim. */
  source: 'European Banking Authority, payment institutions register';
  /** Date of the golden copy this row came from, 'YYYY-MM-DD'. */
  as_of: string;
}

/**
 * Countries whose national reference code is demonstrably the bank code their
 * IBAN carries. Adding one is a claim backed by measurement, not by coverage:
 * see the file note for what "demonstrated" had to mean for Spain.
 */
export const PSD_SERVED_COUNTRIES: readonly string[] = ['ES'];

/**
 * Spanish bank codes belong to credit institutions, and nothing in this
 * register may describe one.
 *
 * The disjointness of the ranges is the safety property the whole Spanish join
 * rests on, so it is enforced here at read time as well as measured in the
 * tests. If a future golden copy ever files a payment institution under a
 * 0xxx-3xxx code, this declines instead of telling a caller their bank is an
 * e-money institution.
 */
const ES_BANK_CODE_RANGE = /^[0-3]/;

/**
 * Which authorisation to describe when an institution holds more than one.
 *
 * 64 (country, code) pairs in the register repeat, almost all of them one firm
 * holding both a payment and an e-money authorisation. The e-money one is
 * reported first because it is the stronger statement about who can hold client
 * funds behind an IBAN, and it is the one a virtual-IBAN check is looking for.
 */
const TYPE_RANK: Record<PsdEntityType, number> = {
  emi: 0,
  payment_institution: 1,
  aisp: 2,
  exempted_emi: 3,
  exempted_payment_institution: 4,
};

interface PsdRow {
  entity_type: string;
  name: string;
  country: string;
  competent_authority: string;
  as_of: string;
}

let byCodeStmt: import('better-sqlite3').Statement | null = null;
let tableChecked = false;
let tablePresent = false;

/**
 * Same lifecycle discipline as resetPraBanksStatements() and
 * resetNationalRegisterStatements(), and wired into closeAll() the same way. A
 * statement prepared on a closed connection throws forever after; the
 * table-presence memo must reset with it because it describes the same database.
 */
export function resetPsdRegisterStatements(): void {
  byCodeStmt = null;
  tableChecked = false;
  tablePresent = false;
}

/**
 * A database built before this seeder ran has no table. Answering "nothing
 * known" is the safe failure: no block is served, which is exactly what an
 * unmatched code already produces. It must never throw.
 */
function ready(): boolean {
  if (!tableChecked) {
    tableChecked = true;
    try {
      const row = getBicDB()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='psd_entities'")
        .get();
      tablePresent = !!row;
    } catch {
      tablePresent = false;
    }
  }
  return tablePresent;
}

/**
 * Number of authorised entities currently loaded from the register.
 *
 * Self-description only, never a lookup path — the same role getPraBanksCount()
 * plays for the PRA list. Served surfaces call this instead of carrying a
 * literal: the copy is republished daily.
 */
export function getPsdEntityCount(): number {
  if (!ready()) return 0;
  try {
    return (getBicDB().prepare('SELECT COUNT(*) AS cnt FROM psd_entities').get() as { cnt: number })
      .cnt;
  } catch {
    return 0;
  }
}

/**
 * How many countries the loaded copy covers.
 *
 * Live, like getPsdEntityCount(), and for the same reason: /llms.txt is a file
 * that promises its numbers are generated from the serving database, and a
 * literal "30 countries" there would be the exact defect that was found in that
 * file twice already — a hardcoded figure sitting inside a sentence claiming to
 * be measured.
 */
export function getPsdCountryCount(): number {
  if (!ready()) return 0;
  try {
    return (
      getBicDB().prepare('SELECT COUNT(DISTINCT country) AS cnt FROM psd_entities').get() as {
        cnt: number;
      }
    ).cnt;
  } catch {
    return 0;
  }
}

/**
 * Date of the loaded golden copy, 'YYYY-MM-DD'. Null when nothing is loaded.
 * Read from the rows, never from a clock.
 */
export function getPsdAsOf(): string | null {
  if (!ready()) return null;
  try {
    const row = getBicDB().prepare('SELECT MAX(as_of) AS d FROM psd_entities').get() as
      { d: string | null } | undefined;
    return row?.d ?? null;
  } catch {
    return null;
  }
}

/**
 * The attribution string every surface must carry, built from the loaded data.
 * Null when no copy is loaded — better no credit line than one naming a date we
 * do not hold.
 */
export function psdAttribution(): string | null {
  const asOf = getPsdAsOf();
  return asOf ? `European Banking Authority, payment institutions register (${asOf})` : null;
}

function isPsdType(value: string): value is PsdEntityType {
  return value in TYPE_RANK;
}

/**
 * Does the EBA register name the holder of this bank code as an authorised
 * payment or e-money institution?
 *
 * @param country   ISO country of the IBAN. Only PSD_SERVED_COUNTRIES answer;
 *                  everywhere else the national reference code is not a bank
 *                  code and joining on it would be a fabrication.
 * @param bankCode  The bank code parsed out of the BBAN.
 */
export function psdRegistrationByBankCode(
  country: string | null | undefined,
  bankCode: string | null | undefined,
): PsdRegistration | null {
  if (!country || !bankCode || !ready()) return null;
  const cc = country.trim().toUpperCase();
  const code = bankCode.trim();
  if (!PSD_SERVED_COUNTRIES.includes(cc) || !code) return null;

  // Spain is the only served country today, and its credit-institution range is
  // the one thing that must never be described from this register.
  if (cc === 'ES' && (!/^\d{4}$/.test(code) || ES_BANK_CODE_RANGE.test(code))) return null;

  let rows: PsdRow[];
  try {
    if (!byCodeStmt) {
      byCodeStmt = getBicDB().prepare(
        'SELECT entity_type, name, country, competent_authority, as_of FROM psd_entities ' +
          'WHERE country = ? AND national_reference_code = ?',
      );
    }
    rows = byCodeStmt.all(cc, code) as PsdRow[];
  } catch {
    // Same safe failure as the national registers: a plumbing fault must not be
    // reported as a fact about an institution.
    return null;
  }

  const hit = rows
    .filter((r): r is PsdRow & { entity_type: PsdEntityType } => isPsdType(r.entity_type))
    .sort((a, b) => TYPE_RANK[a.entity_type] - TYPE_RANK[b.entity_type])[0];
  if (!hit) return null;

  return {
    registered: true,
    entity_type: hit.entity_type,
    name: hit.name,
    country: hit.country,
    competent_authority: hit.competent_authority,
    source: 'European Banking Authority, payment institutions register',
    as_of: hit.as_of,
  };
}

/**
 * IBANforge — Swiss BC-Nummer (Bank Clearing Number / IID) lookup
 *
 * Queries the ch_clearing table in bic.sqlite to resolve Swiss bank
 * institutions from their IID (BC-Nummer).
 */

import { getBicDB } from './db.js';
import type Database from 'better-sqlite3';
import type { ChClearingEntry, ChInstitutionType, ChIidType } from '../types.js';

// ---------------------------------------------------------------------------
// Cached prepared statements
// ---------------------------------------------------------------------------

let _stmtByIid: Database.Statement | null = null;
let _stmtCount: Database.Statement | null = null;
let _qrByMaster: Map<string, string[]> | null = null;

function stmtByIid() {
  if (!_stmtByIid) {
    _stmtByIid = getBicDB().prepare('SELECT * FROM ch_clearing WHERE iid = ? LIMIT 1');
  }
  return _stmtByIid;
}

/**
 * The QR-IID index, read backwards: institution IID -> its QR-IID(s).
 *
 * ## Why this exists
 *
 * SIX publishes the pairing in one direction only. A BankMaster row in the
 * QR range (30000–31999) names the institution's standard IID in its `qr_iid`
 * column; no standard row carries a QR-IID. Verified over the whole table on
 * 20/08/2026: 226 QR rows point at a master, and `qr_iid` is empty on 100 % of
 * the 1,165 standard rows.
 *
 * The consequence was that an ordinary Swiss IBAN always answered
 * `qr_iid: null`, even when its bank holds one two rows away — on the product's
 * headline claim ("the deepest Swiss clearing data"), and on the exact question
 * a customer issuing a QR-bill has to answer. Reading the same column in the
 * other direction fixes it with no new source: 224 institutions and 885 rows
 * gain a QR-IID.
 *
 * ## What this index does NOT do
 *
 * It maps masters only. Head-office inheritance for the 659 branches is applied
 * at read time and labelled `headquarters`, never folded in here — the two are
 * different claims and must not arrive at the caller looking alike.
 */
function qrByMaster(): Map<string, string[]> {
  if (_qrByMaster) return _qrByMaster;
  const index = new Map<string, string[]>();
  try {
    const rows = getBicDB()
      .prepare("SELECT iid, qr_iid FROM ch_clearing WHERE qr_iid IS NOT NULL AND TRIM(qr_iid) <> ''")
      .all() as Array<{ iid: string; qr_iid: string }>;
    for (const row of rows) {
      // Only rows in the QR range describe a QR-IID. Anything else is a
      // standard row that already carries its own value, handled at read time.
      if (!isQrIidRange(row.iid)) continue;
      const master = normalizeIid(row.qr_iid);
      // Two rows in the range point at themselves (institutions whose only IID
      // is a QR-IID). Indexing those would map a QR-IID onto itself and make a
      // QR row look like a standard one holding a QR-IID.
      if (master === row.iid) continue;
      const list = index.get(master);
      if (list) list.push(row.iid);
      else index.set(master, [row.iid]);
    }
    // Sorted so the scalar `qr_iid` served from a multi-valued entry is stable
    // across runs rather than dependent on row order.
    for (const list of index.values()) list.sort();
  } catch {
    // No clearing table means no index. An empty map degrades to the previous
    // behaviour (qr_iid stays null) instead of throwing on every lookup.
    return (_qrByMaster = new Map());
  }
  return (_qrByMaster = index);
}

/**
 * Zero-pad an IID string to 5 digits.
 */
export function normalizeIid(iid: string): string {
  return iid.padStart(5, '0');
}

/**
 * Map DB iid_type integer to ChIidType string.
 */
function mapIidType(iidType: number | null): ChIidType {
  switch (iidType) {
    case 1:
      return 'headquarters';
    case 2:
      return 'branch';
    case 4:
      return 'other';
    default:
      return 'other';
  }
}

/**
 * Detect institution type from entry data.
 * Priority order (first match wins):
 * 1. PostFinance — name contains "PostFinance"
 * 2. Central bank — iid='00100' or name contains "Nationalbank"
 * 3. Cantonal bank — name matches cantonal bank patterns
 * 4. Raiffeisen — name starts with "Raiffeisen"
 * 5. Foreign participant — country != 'CH' and country != 'LI'
 * 6. Default — 'bank'
 */
export function detectInstitutionType(
  name: string,
  iid: string,
  country: string | null,
): ChInstitutionType {
  const nameLower = name.toLowerCase();

  // 1. PostFinance
  if (nameLower.includes('postfinance')) {
    return 'postfinance';
  }

  // 2. Central bank
  if (iid === '00100' || nameLower.includes('nationalbank')) {
    return 'central_bank';
  }

  // 3. Cantonal bank
  if (
    /kantonalbank/i.test(name) ||
    /banque cantonale/i.test(name) ||
    /banca dello stato/i.test(name) ||
    /banca cantonale/i.test(name)
  ) {
    return 'cantonal_bank';
  }

  // 4. Raiffeisen — match the word anywhere, case-insensitive, multilingual.
  //    Romandy/Ticino branches are named "Banque Raiffeisen …" / "Banca
  //    Raiffeisen …", so startsWith('raiffeisen') misclassified them as 'bank'.
  if (/\braiffeisen\b/i.test(name)) {
    return 'raiffeisen';
  }

  // 5. Foreign participant (covers LI, DE, GB, etc.)
  if (country && country !== 'CH') {
    return 'foreign_participant';
  }

  // 6. Default
  return 'bank';
}

// Raw row type from SQLite
interface ChClearingRow {
  iid: string;
  valid_on: string | null;
  concatenation: number;
  redirect_iid: string | null;
  sic_iid: string | null;
  headquarters_iid: string | null;
  iid_type: number | null;
  qr_iid: string | null;
  name: string;
  street: string | null;
  building_number: string | null;
  post_code: string | null;
  town: string | null;
  country: string | null;
  bic: string | null;
  sic_participation: number;
  rtgs_chf: number;
  ip_chf: number;
  eurosic_participation: number;
  lsv_bdd_chf: number;
  lsv_bdd_eur: number;
  updated_at: string | null;
}

/**
 * True when an IID belongs to the SIX QR-IID allocation range (30000–31999),
 * reserved for QR-IBAN issuance.
 */
export function isQrIidRange(iid: string): boolean {
  const n = parseInt(iid, 10);
  return n >= 30000 && n <= 31999;
}

/**
 * Convert a raw DB row to a ChClearingEntry.
 *
 * QR-IID rows (BankMaster range 30000–31999) need a semantic swap: for those
 * rows the file's "QR-IID" column carries the institution's STANDARD IID (the
 * master record), while the row's own `iid` IS the QR-IID being described.
 * Echoing the raw columns made `GET /v1/ch/clearing/30000` answer
 * `iid: "30000", qr_iid: "9000"` — inverted. We present: `iid` = the standard
 * IID, `qr_iid` = the QR-IID, plus `is_qr_iid: true`.
 */
function rowToEntry(row: ChClearingRow): ChClearingEntry {
  if (isQrIidRange(row.iid)) {
    // A handful of QR-range rows are placeholders without a master reference —
    // fall back to the row's own IID rather than inventing one.
    const masterIid = row.qr_iid ? row.qr_iid.padStart(5, '0') : row.iid;
    return {
      ...buildEntry(row, masterIid, row.iid, 'register'),
      is_qr_iid: true,
      headquarters_iid: masterIid,
    };
  }

  // Standard rows. SIX populates the qr_iid column on QR rows only — it is
  // empty on all 1,165 standard rows (verified over the full BankMaster,
  // 20/08/2026) — so the value is resolved through the reverse index instead.
  // The column is still read first, in case SIX ever starts shipping it.
  if (row.qr_iid && row.qr_iid.trim() !== '') {
    return buildEntry(row, row.iid, row.qr_iid.padStart(5, '0'), 'register');
  }

  const index = qrByMaster();

  // Published: a QR row names this exact IID as its institution.
  const own = index.get(row.iid);
  if (own?.length) return withQrIids(buildEntry(row, row.iid, own[0], 'register'), own);

  // Inferred: this IID is a branch and its head office holds the QR-IID. SIX
  // allocates QR-IIDs per institution, so the branch is reachable under it —
  // but this is a deduction, not a published pairing, and `qr_iid_source` says
  // so. Serving it unlabelled would hold two inferences of different strength
  // to the same standard.
  const hq = row.headquarters_iid ? normalizeIid(row.headquarters_iid) : null;
  if (hq && hq !== row.iid) {
    const inherited = index.get(hq);
    if (inherited?.length) return withQrIids(buildEntry(row, row.iid, inherited[0], 'headquarters'), inherited);
  }

  return buildEntry(row, row.iid, null, null);
}

/**
 * Attach the full QR-IID set when SIX has allocated more than one to the same
 * institution (2 of 224, measured 20/08/2026). The scalar keeps the lowest, so
 * a caller reading only `qr_iid` still gets a real published value rather than
 * a silent truncation of the set.
 */
function withQrIids(entry: ChClearingEntry, all: string[]): ChClearingEntry {
  return all.length > 1 ? { ...entry, qr_iids: all } : entry;
}

function buildEntry(
  row: ChClearingRow,
  iid: string,
  qrIid: string | null,
  qrIidSource: 'register' | 'headquarters' | null,
): ChClearingEntry {
  return {
    iid,
    name: row.name,
    institution_type: detectInstitutionType(row.name, row.iid, row.country),
    iid_type: mapIidType(row.iid_type),
    headquarters_iid: row.headquarters_iid ?? row.iid,
    address: {
      street: row.street,
      building_number: row.building_number,
      post_code: row.post_code,
      town: row.town,
      country: row.country ?? 'CH',
    },
    bic: row.bic,
    payment_services: {
      sic: row.sic_participation === 1,
      rtgs_chf: row.rtgs_chf === 1,
      instant_payments_chf: row.ip_chf === 1,
      eurosic: row.eurosic_participation === 1,
      lsv_bdd_chf: row.lsv_bdd_chf === 1,
      lsv_bdd_eur: row.lsv_bdd_eur === 1,
    },
    sic_iid: row.sic_iid,
    qr_iid: qrIid,
    qr_iid_source: qrIid ? qrIidSource : null,
    is_qr_iid: false,
    valid_on: row.valid_on ?? '',
    concatenation: row.concatenation === 1,
    redirect_iid: row.redirect_iid,
  };
}

/**
 * Look up a single clearing entry by IID.
 * Accepts both padded ('00230') and unpadded ('230') IIDs.
 * Does NOT follow concatenation redirects.
 */
export function lookupClearing(iid: string): ChClearingEntry | null {
  const normalized = normalizeIid(iid);
  const row = stmtByIid().get(normalized) as ChClearingRow | undefined;
  if (!row) return null;
  return rowToEntry(row);
}

/**
 * Look up a clearing entry by BBAN bank_code (already 5-digit padded).
 * Follows concatenation redirects (max 1 hop).
 * Returns the entry and optionally the original IID if redirected.
 */
export function lookupClearingByBankCode(
  bankCode: string,
): (ChClearingEntry & { redirected_from?: string }) | null {
  const row = stmtByIid().get(bankCode) as ChClearingRow | undefined;
  if (!row) return null;

  // Follow concatenation redirect (max 1 hop)
  if (row.concatenation === 1 && row.redirect_iid) {
    const targetRow = stmtByIid().get(row.redirect_iid) as ChClearingRow | undefined;
    if (targetRow) {
      const entry = rowToEntry(targetRow);
      return { ...entry, redirected_from: bankCode };
    }
  }

  return rowToEntry(row);
}

/**
 * The seat address of a SIX BankMaster row, with `street` and `building_number`
 * still SEPARATED — which is the whole point of this lookup.
 *
 * SIX is the only register this repository embeds that publishes a real
 * StrtNm / BldgNb split. Every other address we hold (GLEIF above all) is a
 * concatenated line, and turning such a line into StrtNm would be an invention.
 * See src/lib/postal-address.ts, which is the only consumer.
 */
export interface ChClearingSeatAddress {
  /** The IID of the row the address was read from — provenance, not decoration. */
  iid: string;
  street: string | null;
  building_number: string | null;
  post_code: string | null;
  town: string | null;
  country: string;
  /** SIX validity date of that BankMaster row ('YYYY-MM-DD'). */
  valid_on: string | null;
}

let _stmtByBic: Database.Statement | null = null;

function stmtByBic() {
  if (!_stmtByBic) {
    // idx_ch_clearing_bic exists; the column stores BIC11 on all 1,125 rows
    // that carry one (verified 26/08/2026).
    _stmtByBic = getBicDB().prepare('SELECT * FROM ch_clearing WHERE bic = ?');
  }
  return _stmtByBic;
}

function addressKey(r: ChClearingRow): string {
  return [r.street, r.building_number, r.post_code, r.town, r.country].map((v) => v ?? '').join('|');
}

/**
 * Resolve a BIC to the SIX seat address — and decline in the three cases where
 * BankMaster cannot honestly answer.
 *
 * **1. Swiss and Liechtenstein institutions only.** BankMaster is the register
 * of the Swiss payment system, not a world directory, and it carries 75 rows
 * for foreign euroSIC/correspondent participants (measured 26/08/2026: 18 DE,
 * 10 AT, 7 LU, 6 GB, and a handful more). For those, SIX is not the allocation
 * authority — it holds a counterparty record. The failure this guard prevents
 * was measured, not imagined: NDEAFIHH resolved to a BankMaster row whose town
 * column reads "Nordea-Helsinki", a postal designation, which would have gone
 * out as a Finnish bank's `TwnNm` in preference to what GLEIF publishes. The
 * BIC's own country (ISO 9362 characters 5-6) must agree too — same reasoning
 * as `addressMatchesBic()` in gleif-address.ts, and the same failure mode.
 *
 * **2. A BIC11 is not a key in BankMaster.** 225 of the 626 BIC11s in the table
 * appear on several rows, because a cantonal bank registers every branch under
 * the same BIC (ZKBKCHZZ80A: 59 rows). When any row is a head office
 * (`iid_type = 1`), only head-office rows are considered.
 *
 * **3. If the surviving rows still disagree on the address, return null.** We
 * hold the data, we simply cannot name ONE seat — the same refusal
 * `/v1/bic/:code` already makes for a shared BIC8. Serving the first row would
 * be picking an address by row order. The case is real: HELNCH22XXX carries
 * three head-office rows across St. Gallen and Basel.
 */
export function lookupClearingSeatByBic(bic: string): ChClearingSeatAddress | null {
  const normalized = bic.trim().toUpperCase();
  const bic11 = normalized.length === 8 ? `${normalized}XXX` : normalized;
  if (bic11.length !== 11) return null;

  const bicCountry = bic11.slice(4, 6);
  if (bicCountry !== 'CH' && bicCountry !== 'LI') return null;

  const rows = (stmtByBic().all(bic11) as ChClearingRow[]).filter((r) => {
    // Null means Switzerland here, the same default the column carries and
    // `rowToEntry` applies — 26 rows, all domestic.
    const country = r.country ?? 'CH';
    return country === bicCountry;
  });
  if (rows.length === 0) return null;

  const hq = rows.filter((r) => r.iid_type === 1);
  const candidates = hq.length > 0 ? hq : rows;

  const distinct = new Set(candidates.map(addressKey));
  if (distinct.size > 1) return null;

  const row = candidates[0]!;
  return {
    iid: row.iid,
    street: row.street,
    building_number: row.building_number,
    post_code: row.post_code,
    town: row.town,
    country: row.country ?? 'CH',
    valid_on: row.valid_on,
  };
}

/**
 * Get the headquarters entry for a given clearing entry.
 */
export function getHeadquarters(entry: ChClearingEntry): ChClearingEntry | null {
  if (entry.headquarters_iid === entry.iid) return entry;
  return lookupClearing(entry.headquarters_iid);
}

/**
 * Get the total count of ch_clearing entries.
 */
export function getChClearingCount(): number {
  if (!_stmtCount) {
    _stmtCount = getBicDB().prepare('SELECT COUNT(*) as cnt FROM ch_clearing');
  }
  return (_stmtCount.get() as { cnt: number }).cnt;
}

/**
 * Reset cached prepared statements (call when closing DB).
 */
export function resetChClearingStatements(): void {
  _stmtByIid = null;
  _stmtCount = null;
  _stmtByBic = null;
  _qrByMaster = null;
}

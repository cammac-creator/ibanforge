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

function stmtByIid() {
  if (!_stmtByIid) {
    _stmtByIid = getBicDB().prepare('SELECT * FROM ch_clearing WHERE iid = ? LIMIT 1');
  }
  return _stmtByIid;
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
 * Convert a raw DB row to a ChClearingEntry.
 */
function rowToEntry(row: ChClearingRow): ChClearingEntry {
  // Strip leading zeros from qr_iid for display (e.g. '09000' -> '9000')
  const qrIid = row.qr_iid ? String(parseInt(row.qr_iid, 10)) : null;

  return {
    iid: row.iid,
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
}

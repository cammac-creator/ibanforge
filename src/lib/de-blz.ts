import { getBicDB } from './db.js';

/**
 * The German Bankleitzahlen register, as published by the Bundesbank.
 *
 * Same role as ch-clearing.ts plays for Switzerland: it is the national
 * register, so an absence from it is evidence that the code is not allocated,
 * which is the whole difference between `authoritative: true` and false.
 *
 * Seeded by scripts/seed-blz.ts and refreshed by the monthly workflow.
 */
export interface BlzEntry {
  blz: string;
  name: string;
  bic: string | null;
  town: string | null;
  /** The register marks the code for deletion: the institution is being retired. */
  retired: boolean;
  /** The BLZ that takes over, when the register names one. */
  successor: string | null;
}

interface BlzRow {
  blz: string;
  name: string;
  bic: string | null;
  town: string | null;
  retired: number;
  successor_blz: string | null;
}

let stmt: import('better-sqlite3').Statement | null = null;
let tableChecked = false;
let tablePresent = false;

/**
 * The table may be missing on a database built before this seeder existed.
 * Answering "no register" is the safe failure: Germany degrades to the composite
 * map it used before, rather than every German lookup throwing.
 */
function hasTable(): boolean {
  if (tableChecked) return tablePresent;
  tableChecked = true;
  try {
    const row = getBicDB()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='de_blz'")
      .get();
    tablePresent = !!row;
  } catch {
    tablePresent = false;
  }
  return tablePresent;
}

export function lookupBlz(bankCode: string): BlzEntry | null {
  if (!hasTable()) return null;
  if (!/^\d{8}$/.test(bankCode)) return null;
  if (!stmt) {
    stmt = getBicDB().prepare('SELECT blz, name, bic, town, retired, successor_blz FROM de_blz WHERE blz = ?');
  }
  const row = stmt.get(bankCode) as BlzRow | undefined;
  if (!row) return null;
  return {
    blz: row.blz,
    name: row.name,
    bic: row.bic,
    town: row.town,
    retired: row.retired === 1,
    successor: row.successor_blz,
  };
}

/** Whether the register is loaded at all, so callers can decline to claim authority. */
export function blzRegisterAvailable(): boolean {
  return hasTable();
}

/** Number of BLZ held, for truthful self-description surfaces. */
export function getBlzCount(): number {
  if (!hasTable()) return 0;
  return (getBicDB().prepare('SELECT COUNT(*) c FROM de_blz').get() as { c: number }).c;
}

/** Reset cached state (tests, or when the DB is closed). */
export function resetBlzStatements(): void {
  stmt = null;
  tableChecked = false;
  tablePresent = false;
}

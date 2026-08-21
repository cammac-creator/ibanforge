import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBicDB } from './db.js';
import { LRUCache } from './cache.js';
import type Database from 'better-sqlite3';
import { lookupFiInstitution } from './fi-register.js';
import { allocatedCodes, nationalRegisterAvailable, normaliseCode } from './national-registers.js';
import { nlPspEntries } from './nl-psp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// bic_data.json — static bank_code → BIC mapping (6907 entries, 40+ countries)
// Format: { "COUNTRY:bank_code": { bic, bank_name?, city? } }
// ---------------------------------------------------------------------------

interface BicDataEntry {
  bic: string;
  bank_name?: string;
  city?: string;
}

let bicDataCache: Record<string, BicDataEntry> | null = null;

/**
 * Swiss bank codes the curated map claims but the authoritative source no
 * longer lists are dropped at load time.
 *
 * ## What was happening
 *
 * bic_data.json is a curated bank-code-to-BIC map; ch_clearing is the SIX
 * BankMaster, the official Swiss register, refreshed monthly by workflow. The
 * first is hand-maintained, the second is authoritative, and nothing compared
 * them. Audited 28/07/2026, four CH codes were asserting a live institution
 * that the register does not contain:
 *
 *   00762 -> "UBS Switzerland AG"
 *   31100 -> "radicant bank ag"
 *   83015 -> "++MBaer Merchant Bank AG in Liquidation"
 *   83036 -> "radicant bank ag"
 *
 * 00762 is the bank code of the canonical Swiss example IBAN
 * (CH93 0076 2011 6238 5295 7, the one in every documentation). It is not an
 * allocated IID: a fixture that leaked into production data and was handed a
 * real bank's name. The others are institutions wound up or absorbed, plus a
 * literal `++` parsing artifact served to customers inside a bank_name field.
 *
 * ## Why a load-time filter rather than editing the JSON
 *
 * An edit fixes today's four. The filter fixes every future one: the next
 * monthly BankMaster refresh removes another bank and the map goes stale again
 * on its own. This makes the authoritative source authoritative.
 *
 * Dropping a key means the lookup falls through to the strategy-2 prefix
 * search, which cannot resurrect it: no CH bic8 begins with a digit, so a
 * numeric Swiss bank code matches nothing there. The customer gets `bic: null`,
 * which is the honest answer for a bank code that is not allocated.
 */
function pruneStaleSwissCodes(data: Record<string, BicDataEntry>): Record<string, BicDataEntry> {
  let known: Set<string>;
  try {
    const rows = getBicDB().prepare('SELECT iid FROM ch_clearing').all() as Array<{ iid: string }>;
    known = new Set(rows.map((r) => r.iid));
  } catch {
    // No clearing table means no ground truth to prune against. Leaving the map
    // untouched is the safe failure: it degrades to the old behaviour rather
    // than emptying every Swiss lookup.
    return data;
  }
  if (known.size === 0) return data;

  for (const key of Object.keys(data)) {
    if (!key.startsWith('CH:')) continue;
    const raw = key.slice(3);
    if (!/^\d{1,5}$/.test(raw)) continue;
    // The map holds both padded and unpadded forms of the same IID (100 and
    // 00100); the register holds the padded one only.
    if (!known.has(raw.padStart(5, '0'))) delete data[key];
  }
  return data;
}

/**
 * German bank codes the curated map claims and the Bundesbank register does not
 * list are dropped at load time.
 *
 * Exactly the Swiss story one country over. bic_data.json is hand-assembled from
 * BIC directories; de_blz is the Bundesbank Bankleitzahlendatei, reseeded monthly
 * by the same workflow. Nothing compared them until Germany was promoted to an
 * authoritative answer, and measured 29/07/2026, 52 of our 3,552 German keys
 * asserted an institution the register does not carry, including several
 * Landesbanken and Volksbanken absorbed years ago.
 *
 * A load-time filter rather than an edit to the JSON, for the same reason as the
 * Swiss one: an edit fixes today's 52, the filter fixes every future one. It also
 * keeps the two answers consistent, since it would otherwise be possible to
 * resolve a BIC for a code that bank_code_check calls not_in_register in the same
 * response.
 *
 * Dropping a key means the lookup falls through to the prefix search, which
 * cannot resurrect it: a German bank code is eight digits and no BIC8 begins with
 * one, so the customer gets `bic: null`, which is the honest answer.
 */
function pruneStaleGermanCodes(data: Record<string, BicDataEntry>): Record<string, BicDataEntry> {
  let known: Set<string>;
  try {
    const rows = getBicDB().prepare('SELECT blz FROM de_blz').all() as Array<{ blz: string }>;
    known = new Set(rows.map((r) => r.blz));
  } catch {
    // No register means no ground truth to prune against. Leaving the map alone
    // is the safe failure: it degrades to the old behaviour rather than emptying
    // every German lookup.
    return data;
  }
  if (known.size === 0) return data;

  for (const key of Object.keys(data)) {
    if (!key.startsWith('DE:')) continue;
    const raw = key.slice(3);
    if (!/^\d{8}$/.test(raw)) continue;
    if (!known.has(raw)) delete data[key];
  }
  return data;
}

/**
 * Finnish prefixes the curated map claims and Finance Finland allocates to
 * nobody are dropped at load time.
 *
 * The Swiss and German story a third time, with one twist: Finland allocates
 * variable-length codes, so a curated 3-digit key must be resolved the same way
 * a real BBAN is, by longest allocated prefix. Measured 29/07/2026, 21 of our
 * 656 Finnish keys asserted an institution the published list does not carry,
 * led by Handelsbanken (31x) and Swedbank (38x), both of which left Finnish
 * retail banking.
 *
 * Without this the same response could resolve a BIC for a code its own
 * bank_code_check called not_in_register with authoritative: true.
 */
function pruneStaleFinnishCodes(data: Record<string, BicDataEntry>): Record<string, BicDataEntry> {
  for (const key of Object.keys(data)) {
    if (!key.startsWith('FI:')) continue;
    const raw = key.slice(3);
    if (!/^\d{3}$/.test(raw)) continue;
    // Pad to a BBAN-shaped string: the resolver reads a prefix, and the tail
    // never participates in the decision.
    const hit = lookupFiInstitution(raw.padEnd(14, '0'));
    if (hit?.status === 'not_allocated') delete data[key];
  }
  return data;
}

/**
 * Austrian and Belgian codes the curated map claims and the national register
 * does not allocate are dropped at load time.
 *
 * The fourth and fifth countries on this pattern. Measured 29/07/2026, 8 of our
 * 870 Austrian keys and 23 of our 781 Belgian ones asserted an institution the
 * register does not carry.
 *
 * Belgium is the interesting half. The NBB publishes all 1000 three-digit slots
 * and writes 'VRIJ' in the BIC column for the 210 it has not allocated, so those
 * 23 keys are not merely absent from the register: the register is explicitly
 * saying nobody holds them. Serving a bank there contradicted the source in the
 * strongest terms available.
 */
function pruneStaleNationalCodes(data: Record<string, BicDataEntry>): Record<string, BicDataEntry> {
  for (const cc of ['AT', 'BE'] as const) {
    if (!nationalRegisterAvailable(cc)) continue;
    const known = allocatedCodes(cc);
    if (known.size === 0) continue;
    for (const key of Object.keys(data)) {
      if (!key.startsWith(`${cc}:`)) continue;
      const code = normaliseCode(cc, key.slice(3));
      // A key we cannot normalise is not a bank code of that country's shape;
      // leave it alone rather than guess.
      if (code && !known.has(code)) delete data[key];
    }
  }
  return data;
}

/**
 * Add the Dutch providers the curated map does not carry.
 *
 * The other direction of the same finding: our Dutch keys are derived from the
 * BIC directory, so a provider we hold no BIC for is simply missing. Measured
 * 29/07/2026 on production, HLGT and PYNL are on Betaalvereniging's published
 * list and came back not_in_register with no BIC. We were turning away two real
 * Dutch banks.
 *
 * Existing entries win: the list is a supplement here, and 90 of the 90 codes
 * the two sources share already agree on the BIC, so there is nothing to
 * arbitrate.
 */
function addListedDutchProviders(data: Record<string, BicDataEntry>): Record<string, BicDataEntry> {
  for (const [code, provider] of nlPspEntries()) {
    const key = `NL:${code}`;
    if (!data[key]) data[key] = { bic: provider.bic, bank_name: provider.name };
  }
  return data;
}

function getBicData(): Record<string, BicDataEntry> {
  if (!bicDataCache) {
    const require = createRequire(import.meta.url);
    const raw = require(resolve(__dirname, '../db/bic_data.json')) as Record<string, BicDataEntry>;
    bicDataCache = addListedDutchProviders(
      pruneStaleNationalCodes(
        pruneStaleFinnishCodes(pruneStaleGermanCodes(pruneStaleSwissCodes({ ...raw }))),
      ),
    );
  }
  return bicDataCache;
}

export interface BICRow {
  bic8: string;
  bic11: string;
  institution: string | null;
  country_code: string;
  country_name: string | null;
  city: string | null;
  branch_code: string | null;
  branch_info: string | null;
  lei: string | null;
  lei_status: string | null;
  is_test_bic: number;
  source: string;
  street: string | null;
  post_code: string | null;
  region: string | null;
  address_en: string | null;
  address_source: string | null;
  address_lang: string | null;
  address_as_of: string | null;
}

/**
 * A resolved bank code, carrying how it was resolved.
 *
 * The provenance is not decoration. Strategy 1 is an exact key; strategy 2 is a
 * prefix search that can only fire where a bank code may open on a letter, and
 * that may match several institutions at once.
 */
export interface BankLookupHit {
  code: string;
  bank_name: string | null;
  city: string | null;
  match: 'register' | 'prefix';
  candidates?: number;
  /** Human name of the dataset the row naming this institution came from. */
  source: string | null;
  /** Year-month that dataset was last refreshed. */
  as_of: string | null;
}

/**
 * Human names for the `source` column of bic_entries.
 *
 * The BIC block was the only served field with no provenance at all, while
 * `bank_code_check` carries `register` / `authoritative` / `as_of` and
 * `modulus_check` carries `source` / `table_fetched_on`. That mattered because
 * the sources are not equivalent: measured 20/08/2026, 67.4 % of rows come from
 * a redistributed SWIFT directory scrape and 32.3 % from GLEIF, and telling
 * those apart is exactly what an auditor or an agent weighing an answer wants.
 *
 * Names, not codes: `swiftcodes` means nothing to a caller, and shortening it
 * to "SWIFT" would claim a direct feed from SWIFT that we do not have.
 */
const SOURCE_NAMES: Record<string, string> = {
  gleif: 'GLEIF LEI-to-BIC mapping',
  swiftcodes: 'Redistributed SWIFT BIC directory (PeterNotenboom/SwiftCodes, MIT)',
  bundesbank: 'Deutsche Bundesbank Bankleitzahlendatei',
  six_group: 'SIX BankMaster (Swiss IID register)',
  nbp: 'Narodowy Bank Polski',
  eba_step2: 'EBA Clearing STEP2 SCT participant list',
};

/** The curated map is our own assembly, and says so rather than borrowing a registry's name. */
const CURATED_MAP_SOURCE = 'IBANforge curated bank-code map';

function sourceName(source: string | null | undefined): string | null {
  if (!source) return null;
  return SOURCE_NAMES[source] ?? source;
}

const bicCache = new LRUCache<BICRow | null>(2000);

let stmtByBic11: Database.Statement | null = null;
let stmtByBic8: Database.Statement | null = null;

export function lookupByBic11(bic11: string): BICRow | null {
  if (!stmtByBic11) {
    stmtByBic11 = getBicDB().prepare('SELECT * FROM bic_entries WHERE bic11 = ? LIMIT 1');
  }
  return (stmtByBic11.get(bic11) as BICRow) ?? null;
}

export function lookupByBic8(bic8: string): BICRow[] {
  if (!stmtByBic8) {
    stmtByBic8 = getBicDB().prepare('SELECT * FROM bic_entries WHERE bic8 = ?');
  }
  return stmtByBic8.all(bic8) as BICRow[];
}

export function lookup(bic: string): BICRow | null {
  const cached = bicCache.get(bic);
  if (cached !== undefined) return cached;

  let result: BICRow | null = null;
  if (bic.length === 11) {
    result = lookupByBic11(bic);
  } else if (bic.length === 8) {
    // Try XXX branch first (head office), then any match
    const hq = lookupByBic11(bic + 'XXX');
    if (hq) {
      result = hq;
    } else {
      const rows = lookupByBic8(bic);
      result = rows[0] ?? null;
    }
  }

  bicCache.set(bic, result);
  return result;
}

export function getEntryCount(): number {
  return (getBicDB().prepare('SELECT COUNT(*) as cnt FROM bic_entries').get() as { cnt: number }).cnt;
}

/**
 * Number of Swiss clearing (BC-Nummer / IID) entries currently loaded.
 * Lives here rather than in ch-clearing.ts because it reads the same
 * bic.sqlite database and is only used for truthful self-description
 * surfaces (llms.txt, discovery) — not for lookups.
 */
export function getChClearingCount(): number {
  return (getBicDB().prepare('SELECT COUNT(*) as cnt FROM ch_clearing').get() as { cnt: number }).cnt;
}

/** Number of BIC entries carrying an LEI (GLEIF-enriched). Same self-description purpose. */
export function getLeiEnrichedCount(): number {
  return (
    getBicDB().prepare("SELECT COUNT(*) as cnt FROM bic_entries WHERE lei IS NOT NULL AND lei != ''").get() as {
      cnt: number;
    }
  ).cnt;
}

export function getLastUpdated(): string | null {
  const row = getBicDB().prepare('SELECT MAX(updated_at) as last_updated FROM bic_entries').get() as { last_updated: string | null };
  return row.last_updated;
}

/**
 * Look up a BIC by country code and BBAN bank code.
 *
 * Strategy:
 * 1. Direct key lookup in bic_data.json using "COUNTRY:bank_code" (O(1), most accurate)
 * 2. Fallback: SQLite query on bic_entries WHERE bic8 LIKE bank_code% (covers GLEIF-only entries)
 *
 * Returns a simplified object suitable for IBAN validation enrichment, or null.
 */
export function lookupByCountryBank(
  countryCode: string,
  bankCode: string,
): BankLookupHit | null {
  // Strategy 1: exact key lookup in bic_data.json
  const data = getBicData();
  const key = `${countryCode}:${bankCode}`;
  const entry = data[key];

  if (entry) {
    // Normalize BIC to 8 chars (strip branch suffix if present)
    const bic8 = entry.bic.length > 8 ? entry.bic.substring(0, 8) : entry.bic;
    let bankName = entry.bank_name ?? null;
    let cityName = entry.city ?? null;

    // The row is now read unconditionally rather than only to fill a missing
    // name or city, because it is also where the provenance comes from. The
    // lookup is LRU-cached, so the extra reads collapse onto the hot BIC8s.
    const dbRow = lookup(bic8);
    if (dbRow) {
      bankName = bankName || dbRow.institution;
      cityName = cityName || dbRow.city;
    }

    return {
      code: bic8,
      bank_name: bankName,
      city: cityName,
      match: 'register',
      // The curated map decided WHICH institution this bank code belongs to; a
      // directory row only supplied its details. Crediting GLEIF for a pairing
      // the map made would overstate what the registry actually says.
      source: CURATED_MAP_SOURCE,
      as_of: getReferenceAsOf() || null,
    };
  }

  // Strategy 2: SQLite fallback — bic8 starts with bank code (works for some countries)
  const db = getBicDB();
  const row = db
    .prepare(
      // ORDER BY is load-bearing, not tidiness. Without it SQLite is free to
      // return any matching row, and 1,858 (country, prefix) pairs in this
      // table match more than one BIC8. GLEIF first because it is the
      // registry-grade source (39k rows, LEI-backed) against the bulk
      // swiftcodes import; then bic8 so the answer is fully determined.
      // Measured 28/07/2026 over the 308 prefixes actually reachable through
      // this fallback: gleif-first changes zero answers versus today, so this
      // pins current behaviour rather than altering it.
      "SELECT bic8, institution, city, source, updated_at FROM bic_entries WHERE country_code = ? AND bic8 LIKE ? ORDER BY (source = 'gleif') DESC, bic8 LIMIT 1",
    )
    .get(countryCode, bankCode + '%') as
    | { bic8: string; institution: string | null; city: string | null; source: string | null; updated_at: string | null }
    | undefined;

  if (!row) return null;

  // How many institutions does this prefix actually match? The ORDER BY above
  // makes the pick deterministic, not correct: 1,858 (country, prefix) pairs in
  // this table match more than one BIC8, and in 65 British and 24 Dutch cases
  // those BIC8 belong to different institutions (measured 29/07/2026). Returning
  // the count lets a caller running a payment pre-flight downgrade the answer
  // instead of trusting a coin flip.
  const { n } = db
    .prepare('SELECT COUNT(DISTINCT bic8) AS n FROM bic_entries WHERE country_code = ? AND bic8 LIKE ?')
    .get(countryCode, bankCode + '%') as { n: number };

  return {
    code: row.bic8,
    bank_name: row.institution,
    city: row.city,
    match: 'prefix',
    candidates: n,
    // Here the directory really is the source: the prefix search read this row
    // out of it, with no curated pairing involved.
    source: sourceName(row.source),
    as_of: (row.updated_at ?? '').slice(0, 7) || null,
  };
}

/**
 * Whether we hold any reference data at all for a country.
 *
 * This is what separates `not_in_register` from `unavailable`: the first says we
 * looked and did not find, the second says we have nothing to look in. Collapsing
 * them is the same mistake as collapsing everything into `bic: null`.
 */
const referenceDataCache = new Map<string, boolean>();

export function countryHasReferenceData(countryCode: string): boolean {
  const cached = referenceDataCache.get(countryCode);
  if (cached !== undefined) return cached;

  const prefix = `${countryCode}:`;
  let has = Object.keys(getBicData()).some((k) => k.startsWith(prefix));
  if (!has) {
    const row = getBicDB()
      .prepare('SELECT 1 AS hit FROM bic_entries WHERE country_code = ? LIMIT 1')
      .get(countryCode) as { hit: number } | undefined;
    has = !!row;
  }
  referenceDataCache.set(countryCode, has);
  return has;
}

/**
 * Year-month the BIC reference set was last refreshed, for dating the answer.
 * Falls back to the empty string rather than inventing a date.
 */
export function getReferenceAsOf(): string {
  return (getLastUpdated() ?? '').slice(0, 7);
}

/**
 * Reset cached prepared statements and LRU cache (call when closing DB)
 */
export function resetStatements(): void {
  stmtByBic11 = null;
  stmtByBic8 = null;
  bicCache.clear();
}

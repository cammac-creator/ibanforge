import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBicDB } from './db.js';
import { LRUCache } from './cache.js';
import type Database from 'better-sqlite3';
import { lookupFiInstitution } from './fi-register.js';
import { hasNonLatinScript } from './gleif-address.js';
import { allocatedCodes, nationalRegisterAvailable, normaliseCode } from './national-registers.js';
import { nlPspEntries } from './nl-psp.js';
import { bgBaeRegisterAvailable, lookupBgBankCode } from './bg-bae.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// bic_data.json — static bank_code → BIC mapping. Recounted 23/08/2026:
// 24,069 entries across 75 countries, not the "6907 entries, 40+ countries"
// this line claimed — stale by a factor of three, and the kind of number that
// gets quoted outward. scripts/audit/curated-map-consistency.test.ts now pins
// a floor so the prose cannot drift that far from the file again.
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
  /**
   * The code actually consulted, when it is not the caller's positional slice.
   * Iceland is the one case today: the curated key is the two-digit bank grain
   * of the four-digit bank+branch field, and the verdict must name the code it
   * is really about — the Finnish `value` motif, one layer down.
   */
  checked?: string;
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

/**
 * What we hold under a BIC8 when no single institution can be named for it.
 *
 * ## Why this exists
 *
 * `GET /v1/bic/:code` normalises a BIC8 to `bic8 + 'XXX'` and looks that up.
 * When the head-office row is absent the answer was `found: false` plus
 * "coverage may be partial" — while the directory held the code perfectly well.
 * Measured 21/08/2026: 352 BIC8 are in that position, covering 11,422 rows.
 * `GENODEF1` alone holds 1,018 rows for 777 distinct German cooperative banks.
 *
 * Telling a caller we know nothing about a code we hold a thousand rows for is
 * the same shape of defect as answering "clean" for a bank we never screened:
 * information we have, reported as information we lack.
 *
 * ## Why it returns counts and never a name
 *
 * A shared BIC8 identifies the clearing institution, not the account holder —
 * that finesse lives in the branch code. Picking any one row would name a bank
 * chosen by row order, which is a coin flip dressed as an answer. So the
 * aggregate says HOW MANY and stops there; naming requires the 11-character
 * BIC. This holds even when the group has a single institution: one uniform
 * contract beats a special case that sometimes names and sometimes does not.
 */
export interface SharedBic8Stats {
  /** Distinct institution names under this BIC8, compared case- and space-insensitively. */
  institutions: number;
  /** Rows held under this BIC8, branches included. */
  entries: number;
}

let stmtBic8Stats: Database.Statement | null = null;

export function sharedBic8Stats(bic8: string): SharedBic8Stats | null {
  if (!stmtBic8Stats) {
    stmtBic8Stats = getBicDB().prepare(
      `SELECT COUNT(*) AS entries,
              COUNT(DISTINCT UPPER(TRIM(COALESCE(institution, '')))) AS institutions
       FROM bic_entries WHERE bic8 = ?`,
    );
  }
  const row = stmtBic8Stats.get(bic8) as { entries: number; institutions: number } | undefined;
  if (!row || row.entries === 0) return null;
  return { institutions: row.institutions, entries: row.entries };
}

let stmtPrefixCount: Database.Statement | null = null;

/**
 * How many distinct BIC8 in this country begin with `prefix`.
 *
 * Only used where a national authority PUBLISHES that the IBAN's bank-code
 * positions are the BIC's first four characters (LV, GI — see
 * STRUCTURAL_BIC_PREFIX_RULE in enrich.ts). The rule says how to read the IBAN;
 * it does not promise the reading lands on exactly one institution. `RBOS` in
 * Gibraltar matches both RBOSGI21 and RBOSGIGI, so a caller told "this is the
 * bank" deserves to know the rule alone did not single it out.
 */
export function bic8CountForPrefix(countryCode: string, prefix: string): number {
  if (!stmtPrefixCount) {
    stmtPrefixCount = getBicDB().prepare(
      'SELECT COUNT(DISTINCT bic8) AS cnt FROM bic_entries WHERE country_code = ? AND bic8 LIKE ?',
    );
  }
  return (stmtPrefixCount.get(countryCode, prefix + '%') as { cnt: number }).cnt;
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
  return (getBicDB().prepare('SELECT COUNT(*) as cnt FROM bic_entries').get() as { cnt: number })
    .cnt;
}

/**
 * Number of Swiss clearing (BC-Nummer / IID) entries currently loaded.
 * Lives here rather than in ch-clearing.ts because it reads the same
 * bic.sqlite database and is only used for truthful self-description
 * surfaces (llms.txt, discovery) — not for lookups.
 */
export function getChClearingCount(): number {
  return (getBicDB().prepare('SELECT COUNT(*) as cnt FROM ch_clearing').get() as { cnt: number })
    .cnt;
}

/**
 * Every distinct BIC8 in the directory, for counting what the issuer
 * classifier actually covers.
 *
 * Self-description only, never a lookup path: it returns ~48k rows and is read
 * once at module load by datasetFacts().
 */
export function allBic8(): Array<{ bic8: string; institution: string | null }> {
  return getBicDB().prepare('SELECT DISTINCT bic8, institution FROM bic_entries').all() as Array<{
    bic8: string;
    institution: string | null;
  }>;
}

/** Number of BIC entries carrying an LEI (GLEIF-enriched). Same self-description purpose. */
export function getLeiEnrichedCount(): number {
  return (
    getBicDB()
      .prepare("SELECT COUNT(*) as cnt FROM bic_entries WHERE lei IS NOT NULL AND lei != ''")
      .get() as {
      cnt: number;
    }
  ).cnt;
}

/**
 * Cached because the query behind it is a full table scan and the answer
 * changes once a month.
 *
 * `MAX(updated_at)` has no index to walk — the only indexes on bic_entries are
 * bic8, bic11, lei and country_code — so SQLite reads all ~121k rows. Measured
 * 23/08/2026: **12.6 ms per call**, and enrichResult() called it TWICE per
 * validation, so 25 of the 28 ms an enrichment cost were spent re-deriving the
 * string "2026-08". It is the single most expensive thing in the hot path, and
 * it is a constant.
 *
 * ⚠️ Safe only because bic.sqlite is READ-ONLY at runtime (see CLAUDE.md): the
 * monthly refresh ships a new database and a new deployment. If that ever
 * changes to an in-place refresh, this cache goes stale silently — which is why
 * resetStatements() clears it alongside the prepared statements.
 *
 * `undefined` means "not read yet"; `null` is a real answer (empty table), and
 * conflating the two would make an empty database re-scan on every call.
 */
let lastUpdatedCache: string | null | undefined;

export function getLastUpdated(): string | null {
  if (lastUpdatedCache === undefined) {
    const row = getBicDB()
      .prepare('SELECT MAX(updated_at) as last_updated FROM bic_entries')
      .get() as { last_updated: string | null };
    lastUpdatedCache = row.last_updated;
  }
  return lastUpdatedCache;
}

export interface SourceFreshness {
  source: string;
  entries: number;
  last_updated: string | null;
  /** True once this source's newest row is older than the refresh cadence allows. */
  stale: boolean;
}

/**
 * Days a source's newest row may age before /health calls it stale. The
 * refresh is monthly (1st of the month, ~03:15 UTC); 40 days is one cadence
 * plus enough slack that a long month with a late run never false-alarms.
 */
const SOURCE_STALE_DAYS = 40;

/**
 * ⚠️ Same safety argument as lastUpdatedCache directly above — read-only
 * database, monthly refresh ships a new file and a new process — and the same
 * reset discharges it.
 */
let sourceFreshnessCache: SourceFreshness[] | undefined;

/**
 * Per-source freshness, for /health's living-tool block.
 *
 * The global MAX(updated_at) above answers "did the refresh run"; it cannot
 * answer "did every source survive it". The monthly workflow rebuilds nine
 * registers with individual sanity floors, and a source whose fetch step was
 * skipped or emptied would rot invisibly behind a green global date — the
 * newest GLEIF row would keep the headline fresh while, say, the Austrian
 * register aged out. One GROUP BY over the source column, memoised for the
 * life of the process (one ~120k-row scan at first ask, then a constant),
 * makes each register answer for its own age.
 *
 * `stale` is computed at READ time from the cached date, not cached itself:
 * a process that lives past the threshold must start saying so, and a cached
 * boolean would keep saying what was true at boot.
 */
export function getSourceFreshness(): SourceFreshness[] {
  if (sourceFreshnessCache === undefined) {
    sourceFreshnessCache = getBicDB()
      .prepare(
        `SELECT COALESCE(source, 'unknown') AS source, COUNT(*) AS entries, MAX(updated_at) AS last_updated
         FROM bic_entries GROUP BY COALESCE(source, 'unknown') ORDER BY entries DESC`,
      )
      .all()
      .map((r) => {
        const row = r as { source: string; entries: number; last_updated: string | null };
        return {
          source: row.source,
          entries: row.entries,
          last_updated: row.last_updated,
          stale: false,
        };
      });
  }
  const cutoff = Date.now() - SOURCE_STALE_DAYS * 86_400_000;
  return sourceFreshnessCache.map((s) => ({
    ...s,
    // A source with no readable date cannot prove freshness: stale, not benefit
    // of the doubt — the flag exists to be seen, and "unknown" ages too.
    stale: s.last_updated === null || new Date(s.last_updated + 'Z').getTime() < cutoff,
  }));
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
export function lookupByCountryBank(countryCode: string, bankCode: string): BankLookupHit | null {
  // Bulgaria: a bank code the BAE register allocates to nobody resolves to
  // nothing, whichever strategy would have answered.
  //
  // Guarded here rather than pruned at load time like CH, DE, FI, AT and BE,
  // because a Bulgarian bank code is four LETTERS. Dropping a curated key would
  // not settle it: `bic8 LIKE 'RZBB%'` resurrects the same institution through
  // strategy 2, which is exactly why the numeric-code countries could be fixed
  // with a filter and this one cannot. One guard covers both strategies.
  //
  // What it prevents is a single response contradicting itself — bank_code_check
  // saying the register allocates this code to nobody while the `bic` block
  // beside it names a bank. RZBB is that case today: Raiffeisenbank left
  // Bulgaria, the curated map still carries it, the register does not.
  if (countryCode === 'BG' && bgBaeRegisterAvailable() && !lookupBgBankCode(bankCode)) return null;

  // Strategy 1: exact key lookup in bic_data.json
  const data = getBicData();
  const key = `${countryCode}:${bankCode}`;
  let entry = data[key];

  // Iceland allocates the two LEADING digits of the four-digit bank code to
  // the institution and the trailing two to the branch, and the curated map
  // keys its four commercial banks at that two-digit grain. Without the
  // truncation no Icelandic key is reachable from any IBAN at all — measured
  // at 0% over the entire code space on 29/08/2026, while the four banks sat
  // correctly named in the map. Exact key first, so a future branch-grain key
  // wins over the bank-grain one. Strategy 2 cannot rescue Iceland either:
  // a bic8 never opens on a digit, so the prefix search is structurally empty
  // for every numeric-code country.
  let checkedCode: string | undefined;
  if (!entry && countryCode === 'IS') {
    const bankGrain = bankCode.slice(0, 2);
    entry = data[`IS:${bankGrain}`];
    if (entry) checkedCode = bankGrain;
  }

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
      ...(checkedCode ? { checked: checkedCode } : {}),
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
    | {
        bic8: string;
        institution: string | null;
        city: string | null;
        source: string | null;
        updated_at: string | null;
      }
    | undefined;

  if (!row) return null;

  // How many institutions does this prefix actually match? The ORDER BY above
  // makes the pick deterministic, not correct: 1,858 (country, prefix) pairs in
  // this table match more than one BIC8, and in 65 British and 24 Dutch cases
  // those BIC8 belong to different institutions (measured 29/07/2026). Returning
  // the count lets a caller running a payment pre-flight downgrade the answer
  // instead of trusting a coin flip.
  const { n } = db
    .prepare(
      'SELECT COUNT(DISTINCT bic8) AS n FROM bic_entries WHERE country_code = ? AND bic8 LIKE ?',
    )
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

/** The registered-address block, exactly as `/v1/bic/:code` has always built it. */
export interface RegisteredAddress {
  type: 'registered';
  street: string | null;
  post_code: string | null;
  region: string | null;
  city: string | null;
  country: string;
  romanized: string | null;
  romanization: 'original_latin' | 'gleif_english' | 'unavailable';
  source: string;
  language: string | null;
  as_of: string | null;
}

/**
 * Build the registered-address block from a `bic_entries` row.
 *
 * Extracted from the route rather than copied into the second caller. Two
 * endpoints reading the same table through two hand-written mappings is how
 * they drift, and the drift shows up as one endpoint quietly claiming a
 * romanization the other refuses.
 *
 * No branch guard here on purpose: the guard is applied at SEED time
 * (`addressMatchesBic` in src/db/seed.ts), so a row that reaches this function
 * has already earned its address. Adding a second guard at serve time would
 * either duplicate that rule or, worse, disagree with it.
 */
export function registeredAddress(
  row: Pick<
    BICRow,
    | 'country_code'
    | 'street'
    | 'address_en'
    | 'post_code'
    | 'region'
    | 'city'
    | 'address_source'
    | 'address_lang'
    | 'address_as_of'
  > | null,
): RegisteredAddress | null {
  if (!row || !(row.street || row.address_en)) return null;
  // Decided from the ACTUAL script of the stored street, not the GLEIF language
  // tag, which marks Greek/Arabic entities 'el'/'ar' even when they filed an
  // already-Latin address.
  const nonLatin = hasNonLatinScript(row.street);
  return {
    type: 'registered',
    street: row.street,
    post_code: row.post_code,
    region: row.region,
    city: row.city,
    // The ROW's country, never the caller's. The validate route used to pass
    // the IBAN's country here, and for the curated pairings that cross a
    // border (FR bank codes resolving to Monaco BICs, e.g. FR:11668 ->
    // BERLMCMC) the Monegasque seat address went out stamped country:'FR' —
    // while /v1/bic/:code labelled the SAME row 'MC'. An address block must
    // locate the address it carries.
    country: row.country_code,
    romanized: nonLatin ? (row.address_en ?? null) : (row.street ?? row.address_en ?? null),
    romanization: !nonLatin ? 'original_latin' : row.address_en ? 'gleif_english' : 'unavailable',
    source: row.address_source ?? 'GLEIF',
    language: row.address_lang,
    as_of: row.address_as_of,
  };
}

/**
 * Reset cached prepared statements and LRU cache (call when closing DB)
 */
export function resetStatements(): void {
  stmtByBic11 = null;
  stmtByBic8 = null;
  stmtBic8Stats = null;
  stmtPrefixCount = null;
  bicCache.clear();
  // Cleared with the statements: it is derived from the same database, so a
  // caller swapping databases must not keep the previous one's refresh date.
  lastUpdatedCache = undefined;
  sourceFreshnessCache = undefined;
}

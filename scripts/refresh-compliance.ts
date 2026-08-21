/**
 * Compliance data refresh script.
 * Downloads primary-source sanctions lists (OFAC/EU/UN/SECO) + EPC SEPA
 * registers and builds compliance.sqlite. Uses the official, freely
 * redistributable lists directly — no OpenSanctions (CC-BY-NC) dependency.
 *
 * Run with: npm run compliance:refresh  (or: npx tsx scripts/refresh-compliance.ts)
 */

import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync, renameSync, existsSync, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  FATF_AS_OF,
  FATF_BLACK_LIST,
  FATF_GREY_LIST,
  FATF_MEMBERS,
  FATF_SUSPENDED,
  SANCTIONED_COUNTRIES_COMPREHENSIVE,
  SANCTIONED_COUNTRIES_SECTORAL,
} from '../src/lib/compliance-static.js';
import { validateBIC } from '../src/lib/bic-validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../data');
const TMP_DIR = resolve(__dirname, '../.tmp-compliance');
const TMP_DB_PATH = resolve(TMP_DIR, 'compliance.sqlite');
const FINAL_DB_PATH = resolve(DATA_DIR, 'compliance.sqlite');

// ---------------------------------------------------------------------------
// Static compliance data — FATF lists & sanctioned countries are maintained
// and dated in src/lib/compliance-static.ts (imported above). See FATF_AS_OF.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// EPC SEPA register URLs
// ---------------------------------------------------------------------------

const EPC_REGISTERS: { scheme: string; url: string }[] = [
  {
    scheme: 'SCT',
    url: 'https://www.europeanpaymentscouncil.eu/sites/default/files/participants_export/sct/sct.csv',
  },
  {
    scheme: 'SDD',
    url: 'https://www.europeanpaymentscouncil.eu/sites/default/files/participants_export/sdd_core/sdd_core.csv',
  },
  {
    scheme: 'SCT_INST',
    url: 'https://www.europeanpaymentscouncil.eu/sites/default/files/participants_export/sct_inst/sct_inst.csv',
  },
];

// ---------------------------------------------------------------------------
// Helper: fetch with timeout
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url: string, timeoutMs = 60_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Helper: download file to disk
// ---------------------------------------------------------------------------

async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetchWithTimeout(url, 120_000);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  if (!response.body) {
    throw new Error(`No response body for ${url}`);
  }
  const fileStream = createWriteStream(dest);
  await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), fileStream);
}

// ---------------------------------------------------------------------------
// Schema creation
// ---------------------------------------------------------------------------

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sanctioned_entities (
      bic8        TEXT NOT NULL,
      entity_name TEXT,
      source_list TEXT NOT NULL,
      country_code TEXT,
      -- 1 when our own BIC directory also carries this BIC8, 0 when the list
      -- names a bank we cannot otherwise name. See fetchPrimarySanctions().
      -- A sanctioned bank we cannot name is still a sanctioned bank; the marker
      -- is what lets a reader tell an enriched hit from a bare one.
      directory_match INTEGER NOT NULL DEFAULT 1,
      UNIQUE(bic8, source_list)
    );

    CREATE TABLE IF NOT EXISTS sanctioned_countries (
      country_code TEXT PRIMARY KEY,
      sanction_type TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fatf_countries (
      country_code TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sepa_participants (
      bic8   TEXT NOT NULL,
      scheme TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      PRIMARY KEY (bic8, scheme)
    );

    CREATE TABLE IF NOT EXISTS vop_participants (
      bic8   TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS metadata (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// ---------------------------------------------------------------------------
// Static data insertion
// ---------------------------------------------------------------------------

function insertStaticData(db: Database.Database): void {
  console.log('\n[1/5] Inserting static sanctions & FATF data...');

  const insertSanctionedCountry = db.prepare(
    `INSERT OR REPLACE INTO sanctioned_countries (country_code, sanction_type) VALUES (?, ?)`
  );
  const insertFatf = db.prepare(
    `INSERT OR REPLACE INTO fatf_countries (country_code, status) VALUES (?, ?)`
  );

  const runStatic = db.transaction(() => {
    for (const cc of SANCTIONED_COUNTRIES_COMPREHENSIVE) {
      insertSanctionedCountry.run(cc, 'comprehensive');
    }
    for (const cc of SANCTIONED_COUNTRIES_SECTORAL) {
      insertSanctionedCountry.run(cc, 'sectoral');
    }
    for (const cc of FATF_BLACK_LIST) {
      insertFatf.run(cc, 'black_list');
    }
    for (const cc of FATF_GREY_LIST) {
      insertFatf.run(cc, 'grey_list');
    }
    for (const cc of FATF_MEMBERS) {
      insertFatf.run(cc, 'member');
    }
    // Suspended memberships (RU since Feb 2023) — inserted AFTER members so a
    // code accidentally present in both lists ends up 'suspended', never
    // silently 'member'.
    for (const cc of FATF_SUSPENDED) {
      insertFatf.run(cc, 'suspended');
    }
  });

  runStatic();

  const sanctionedCount = (db.prepare(`SELECT COUNT(*) as n FROM sanctioned_countries`).get() as { n: number }).n;
  const fatfCount = (db.prepare(`SELECT COUNT(*) as n FROM fatf_countries`).get() as { n: number }).n;
  console.log(`  sanctioned_countries: ${sanctionedCount} rows`);
  console.log(`  fatf_countries:       ${fatfCount} rows`);
}

// ---------------------------------------------------------------------------
// Primary-source sanctions download & parse
//
// We ingest the official, freely-redistributable consolidated lists directly —
// OFAC (US public domain), the EU consolidated list, the UN SC consolidated XML
// and SECO (CH) — instead of OpenSanctions, whose dataset is CC-BY-NC
// (non-commercial) and cannot be used in a paid product. OFAC is the spine:
// its SDN remarks field carries "SWIFT/BIC <code>" tokens for sanctioned banks.
// The other three rarely expose a BIC in their raw exports (measured: EU≈3,
// SECO≈1, UN≈0 — OpenSanctions wasn't enriching them either), but we keep them
// wired, best-effort, so the OFAC/EU/UN/SECO claim stays honest.
// ---------------------------------------------------------------------------

// "SWIFT/BIC HAVIGB2L" or "SWIFT HAVIGB2L" inside free-text remarks.
const SWIFT_REMARK_REGEX = /SWIFT(?:\/BIC)?[:\s]+([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)/gi;

/**
 * Candidates found and entities kept, per source and overall.
 *
 * The two used to be the same number and the difference was invisible. They are
 * counted separately because they fail for opposite reasons: `candidates`
 * falling means the SANCTIONS SOURCE degraded, `directoryMatches` falling means
 * OUR DIRECTORY degraded. A floor placed on the kept rows only would fire on
 * the second and stay silent on the first.
 */
interface SanctionsTally {
  candidates: number;
  kept: number;
  directoryMatches: number;
  unresolved: string[];
}

async function fetchPrimarySanctions(db: Database.Database): Promise<SanctionsTally> {
  console.log('\n[2/5] Downloading primary-source sanctions (OFAC/EU/UN/SECO)...');

  // Our own BIC directory, read-only. It used to be a FILTER: a listed BIC was
  // dropped unless we already held it. That inverted the point of the check.
  //
  // Measured 20/08/2026: the EU consolidated list exposes exactly two BICs,
  // AGRULYLT (Agricultural Bank of Libya) and REFAIRTH (Bank Refah Kargaran).
  // AGRULYLT is absent from bic_entries, so the filter dropped it — HALF of the
  // EU coverage, silently, on the endpoint sold as a compliance tool. On OFAC
  // the same filter dropped 27 of 223 candidates (KP 11, RU 8, KH 3, BY 1,
  // IR 1, UA 1, VE 1).
  //
  // The directory is now used to ENRICH, never to reject: a bank a sanctions
  // authority has designated is sanctioned whether or not we can name it, and
  // "we have never heard of this bank" is precisely the dangerous case, not a
  // reason for silence. What we cannot resolve is marked, not discarded.
  const bicDB = new Database(resolve(DATA_DIR, 'bic.sqlite'), { readonly: true });
  const bicLookup = bicDB.prepare('SELECT 1 FROM bic_entries WHERE bic8 = ? LIMIT 1');

  const insertEntity = db.prepare(
    `INSERT OR IGNORE INTO sanctioned_entities (bic8, entity_name, source_list, country_code, directory_match)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertBatch = db.transaction((rows: Array<[string, string, string, string, number]>) => {
    for (const row of rows) insertEntity.run(...row);
  });

  const tally: SanctionsTally = { candidates: 0, kept: 0, directoryMatches: 0, unresolved: [] };

  // Extract every "SWIFT/BIC <code>" from a blob of text and keep the ones that
  // are well-formed BICs (dedup via `seen`). The ONLY rejection left is a
  // malformed code, which is a parsing artefact rather than a bank.
  const extractBics = (text: string, seen: Set<string>): Array<{ bic8: string; inDirectory: boolean }> => {
    const out: Array<{ bic8: string; inDirectory: boolean }> = [];
    let m: RegExpExecArray | null;
    SWIFT_REMARK_REGEX.lastIndex = 0;
    while ((m = SWIFT_REMARK_REGEX.exec(text)) !== null) {
      const bic8 = m[1].toUpperCase().substring(0, 8);
      if (seen.has(bic8)) continue;
      if (!validateBIC(bic8).valid) continue;
      seen.add(bic8);
      tally.candidates++;
      const inDirectory = !!bicLookup.get(bic8);
      if (inDirectory) tally.directoryMatches++;
      else tally.unresolved.push(bic8);
      out.push({ bic8, inDirectory });
    }
    return out;
  };

  try {
    // ---- OFAC SDN (US public domain) — the spine ----
    try {
      const csvPath = resolve(TMP_DIR, 'ofac_sdn.csv');
      console.log('  Fetching OFAC SDN: https://www.treasury.gov/ofac/downloads/sdn.csv');
      await downloadFile('https://www.treasury.gov/ofac/downloads/sdn.csv', csvPath);
      const { createReadStream } = await import('node:fs');
      const rl = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });
      const seen = new Set<string>();
      const batch: Array<[string, string, string, string, number]> = [];
      let lines = 0;
      let unresolved = 0;
      // SDN.csv columns (no header): 0=ent_num,1=SDN_Name,2=SDN_Type,3=Program,
      // 4=Title,... last meaningful free-text field = remarks (col 11).
      for await (const line of rl) {
        lines++;
        const cols = parseCsvLine(line);
        const name = (cols[1] ?? '').replace(/^-0-\s*$/, '').substring(0, 200);
        const remarks = cols[11] ?? cols[cols.length - 1] ?? '';
        if (!/SWIFT/i.test(remarks)) continue;
        for (const { bic8, inDirectory } of extractBics(remarks, seen)) {
          if (!inDirectory) unresolved++;
          batch.push([bic8, name, 'OFAC', '', inDirectory ? 1 : 0]);
        }
      }
      if (batch.length) insertBatch(batch);
      tally.kept += batch.length;
      console.log(`  OFAC: ${lines} rows, ${batch.length} bank BICs kept (${unresolved} not in our directory)`);
    } catch (err) {
      console.warn(`  WARNING: OFAC download/parse failed: ${(err as Error).message}`);
    }

    // ---- EU consolidated list (best-effort; rarely carries BICs) ----
    try {
      const csvPath = resolve(TMP_DIR, 'eu_fsf.csv');
      const euUrl =
        'https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw';
      console.log('  Fetching EU consolidated list...');
      await downloadFile(euUrl, csvPath);
      const { readFileSync } = await import('node:fs');
      const text = readFileSync(csvPath, 'utf-8');
      const seen = new Set<string>();
      const batch: Array<[string, string, string, string, number]> = [];
      let unresolved = 0;
      for (const { bic8, inDirectory } of extractBics(text, seen)) {
        if (!inDirectory) unresolved++;
        batch.push([bic8, 'EU-listed entity', 'EU', '', inDirectory ? 1 : 0]);
      }
      if (batch.length) insertBatch(batch);
      tally.kept += batch.length;
      console.log(`  EU: ${batch.length} bank BICs kept (${unresolved} not in our directory)`);
    } catch (err) {
      console.warn(`  WARNING: EU download/parse failed: ${(err as Error).message}`);
    }

    // ---- UN SC consolidated XML (best-effort) ----
    try {
      const xmlPath = resolve(TMP_DIR, 'un_consolidated.xml');
      console.log('  Fetching UN consolidated list...');
      await downloadFile('https://scsanctions.un.org/resources/xml/en/consolidated.xml', xmlPath);
      const { readFileSync } = await import('node:fs');
      const text = readFileSync(xmlPath, 'utf-8');
      const seen = new Set<string>();
      const batch: Array<[string, string, string, string, number]> = [];
      let unresolved = 0;
      for (const { bic8, inDirectory } of extractBics(text, seen)) {
        if (!inDirectory) unresolved++;
        batch.push([bic8, 'UN-listed entity', 'UN', '', inDirectory ? 1 : 0]);
      }
      if (batch.length) insertBatch(batch);
      tally.kept += batch.length;
      console.log(`  UN: ${batch.length} bank BICs kept (${unresolved} not in our directory)`);
    } catch (err) {
      console.warn(`  WARNING: UN download/parse failed: ${(err as Error).message}`);
    }

    // ---- SECO (CH) consolidated list — XML (best-effort) ----
    try {
      const xmlPath = resolve(TMP_DIR, 'seco.xml');
      console.log('  Fetching SECO (CH) list...');
      await downloadFile('https://www.sesam.search.admin.ch/sesam-search-web/pages/search/searchSanctionWithExport.xhtml?lang=en&action=exportXml', xmlPath);
      const { readFileSync } = await import('node:fs');
      const text = readFileSync(xmlPath, 'utf-8');
      const seen = new Set<string>();
      const batch: Array<[string, string, string, string, number]> = [];
      let unresolved = 0;
      for (const { bic8, inDirectory } of extractBics(text, seen)) {
        if (!inDirectory) unresolved++;
        batch.push([bic8, 'SECO-listed entity', 'SECO', '', inDirectory ? 1 : 0]);
      }
      if (batch.length) insertBatch(batch);
      tally.kept += batch.length;
      console.log(`  SECO: ${batch.length} bank BICs kept (${unresolved} not in our directory)`);
    } catch (err) {
      console.warn(`  WARNING: SECO download/parse failed: ${(err as Error).message}`);
    }
  } finally {
    bicDB.close();
  }

  const entityCount = (db.prepare(`SELECT COUNT(*) as n FROM sanctioned_entities`).get() as { n: number }).n;
  console.log(`  sanctioned_entities total: ${entityCount} rows (deduped across sources)`);
  // Both counters, every run. The gap between them is the directory's coverage
  // of the sanctions lists, and it is the number that moves when our BIC base
  // degrades rather than when a sanctions source does.
  console.log(
    `  candidates seen: ${tally.candidates} | in our BIC directory: ${tally.directoryMatches} | ` +
      `named by a list only: ${tally.unresolved.length}`,
  );
  if (tally.unresolved.length) {
    console.log(`  sanctioned BICs we cannot name: ${tally.unresolved.slice(0, 30).join(' ')}${tally.unresolved.length > 30 ? ' …' : ''}`);
  }
  return tally;
}

// ---------------------------------------------------------------------------
// Minimal CSV line parser (handles quoted fields)
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ---------------------------------------------------------------------------
// EPC SEPA register download & parse
// ---------------------------------------------------------------------------

async function fetchSepaRegisters(db: Database.Database): Promise<void> {
  console.log('\n[3/5] Downloading EPC SEPA registers (CSV)...');

  const insertSepa = db.prepare(
    `INSERT OR IGNORE INTO sepa_participants (bic8, scheme, status) VALUES (?, ?, 'active')`
  );

  for (const register of EPC_REGISTERS) {
    try {
      const csvPath = resolve(TMP_DIR, `sepa_${register.scheme}.csv`);
      console.log(`  Fetching ${register.scheme}: ${register.url}`);
      await downloadFile(register.url, csvPath);

      const { createReadStream } = await import('node:fs');
      const rl = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });

      const bics = new Set<string>();
      let headerParsed = false;
      let bicIdx = -1;

      for await (const line of rl) {
        const cols = parseCsvLine(line);
        if (!headerParsed) {
          bicIdx = cols.findIndex(c => c.toUpperCase() === 'BIC');
          headerParsed = true;
          continue;
        }
        const bic = cols[bicIdx]?.trim();
        if (bic && bic.length >= 8) {
          bics.add(bic.substring(0, 8));
        }
      }

      const insertBatch = db.transaction((bicsArr: string[]) => {
        for (const bic8 of bicsArr) insertSepa.run(bic8, register.scheme);
      });
      insertBatch([...bics]);
      console.log(`  ${register.scheme}: ${bics.size} BICs inserted`);
    } catch (err) {
      console.warn(`  WARNING: ${register.scheme} register download failed: ${(err as Error).message}`);
      console.warn(`  Skipping ${register.scheme} — continuing.`);
    }
  }

  const sepaCount = (db.prepare(`SELECT COUNT(*) as n FROM sepa_participants`).get() as { n: number }).n;
  console.log(`  sepa_participants total: ${sepaCount} rows`);
}

// ---------------------------------------------------------------------------
// VoP participants (derived from SCT)
// ---------------------------------------------------------------------------

async function fetchVopRegister(db: Database.Database): Promise<void> {
  console.log('\n[4/5] Downloading EPC VoP register (CSV)...');

  const vopUrl = 'https://www.europeanpaymentscouncil.eu/sites/default/files/participants_export/vop/vop.csv';
  const insertVop = db.prepare(
    `INSERT OR IGNORE INTO vop_participants (bic8, status) VALUES (?, ?)`
  );

  try {
    const csvPath = resolve(TMP_DIR, 'vop.csv');
    console.log(`  Fetching: ${vopUrl}`);
    await downloadFile(vopUrl, csvPath);

    const { createReadStream } = await import('node:fs');
    const rl = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });

    // Every participant, carrying the status the register actually publishes.
    //
    // This loop used to keep only "Ready for operations" and drop the rest on
    // the floor. Measured against the live export on 21/08/2026: 2,827 rows,
    // 1,276 distinct BIC8, of which 1,232 ready and 44 "Pending EDS
    // registration" (FR 8, BG 6, CY 4, LT 4, BE 3, ES 3 …). Those 44 were the
    // whole of a reported "44 missing participants", which had been read as a
    // staleness gap; the register had not moved at all, the parser was
    // discarding a status.
    //
    // Neither dropping them nor storing them as 'active' is right. A pending
    // bank does not answer VoP requests yet, so calling it active would be a
    // false positive on a field a payer relies on before a payout — the exact
    // opposite direction of harm from the sanctions defect fixed above, and the
    // more dangerous one on this endpoint. It is stored as 'pending', a value
    // VopCheck['status'] has always declared and this pipeline never produced.
    const byBic = new Map<string, string>();
    let headerParsed = false;
    let bicIdx = -1;
    let statusIdx = -1;
    let rows = 0;

    for await (const line of rl) {
      const cols = parseCsvLine(line);
      if (!headerParsed) {
        bicIdx = cols.findIndex(c => c.toUpperCase() === 'BIC');
        statusIdx = cols.findIndex(c => c.toUpperCase() === 'STATUS');
        headerParsed = true;
        continue;
      }
      const bic = cols[bicIdx]?.trim();
      const status = cols[statusIdx]?.trim().toLowerCase() ?? '';
      if (!bic || bic.length < 8) continue;
      rows++;
      const bic8 = bic.substring(0, 8);
      const mapped = status.includes('ready') ? 'active' : 'pending';
      // An institution can appear on several rows. 'active' wins: one branch
      // ready for operations makes the BIC8 answerable, and demoting it to
      // pending because another row lags would understate real coverage.
      if (mapped === 'active' || !byBic.has(bic8)) byBic.set(bic8, mapped);
    }

    const insertBatch = db.transaction((entries: Array<[string, string]>) => {
      for (const [bic8, status] of entries) insertVop.run(bic8, status);
    });
    insertBatch([...byBic]);
    const active = [...byBic.values()].filter(s => s === 'active').length;
    console.log(
      `  VoP: ${rows} rows, ${byBic.size} participants (${active} active, ${byBic.size - active} pending EDS registration)`,
    );
  } catch (err) {
    console.warn(`  WARNING: VoP register download failed: ${(err as Error).message}`);
    console.warn('  Falling back to SCT participants as VoP baseline...');
    db.exec(`
      INSERT OR IGNORE INTO vop_participants (bic8, status)
      SELECT bic8, 'active' FROM sepa_participants WHERE scheme = 'SCT'
    `);
  }

  const vopCount = (db.prepare(`SELECT COUNT(*) as n FROM vop_participants`).get() as { n: number }).n;
  console.log(`  vop_participants: ${vopCount} rows`);
}

// ---------------------------------------------------------------------------
// EMI BIC aliases — documented overrides
//
// Some institutions joined the EPC schemes under a different BIC8 than the
// one their customer IBANs resolve to. The reachability/VoP lookup keys on
// the IBAN-derived BIC8, so without an alias the answer is a false
// "sct:false / no_vop" for live, SEPA-reachable banks.
//
// Only add entries here with a verified source. Each alias COPIES the
// registered BIC's sepa_participants + vop_participants rows onto the alias.
// ---------------------------------------------------------------------------

const EMI_BIC_ALIASES: Array<{ alias: string; registered: string; reason: string }> = [
  {
    alias: 'REVOLT21',
    registered: 'RVUALT2V',
    reason:
      'Revolut Bank UAB (LT) participates in EPC SCT/SCT_INST/SDD/VoP under ' +
      'RVUALT2V (EPC registers, verified 2026-07-10) while customer IBANs ' +
      'carry BIC REVOLT21. Same legal entity.',
  },
  // Verified present under their IBAN-facing BIC8 already (no alias needed):
  // Wise TRWIBEB1 / TRWIGB22, N26 NTSBDEB1, Bunq BUNQNL2A.
];

function applyEmiAliases(db: Database.Database): void {
  console.log('\n[5b] Applying documented EMI BIC aliases...');
  const copySepa = db.prepare(
    `INSERT OR IGNORE INTO sepa_participants (bic8, scheme, status)
     SELECT ?, scheme, status FROM sepa_participants WHERE bic8 = ?`
  );
  const copyVop = db.prepare(
    `INSERT OR IGNORE INTO vop_participants (bic8, status)
     SELECT ?, status FROM vop_participants WHERE bic8 = ?`
  );
  for (const { alias, registered, reason } of EMI_BIC_ALIASES) {
    const sepa = copySepa.run(alias, registered).changes;
    const vop = copyVop.run(alias, registered).changes;
    console.log(`  ${alias} ← ${registered}: +${sepa} sepa rows, +${vop} vop rows (${reason.slice(0, 60)}…)`);
    if (sepa === 0) {
      console.warn(`  WARNING: registered BIC ${registered} carried no sepa_participants rows — alias ${alias} is a no-op; re-verify the EPC registers.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

function insertMetadata(db: Database.Database): void {
  console.log('\n[5/5] Writing metadata...');

  const insertMeta = db.prepare(
    `INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)`
  );

  // This string is served verbatim in meta.sources on every paid
  // /v1/iban/compliance response — it is the provenance field, the one an
  // auditor reads. Only sources that actually put rows in this database belong
  // here (audit 2026-07-26, which removed a hardcoded UN and SECO that
  // contributed nothing).
  //
  // It is now READ FROM THE DATABASE instead of being retyped. A hand-written
  // list is a claim maintained by memory: it went stale in both directions
  // within a month — naming feeds that shipped no rows, and then, once the
  // directory filter was lifted and the UN list started contributing, omitting
  // one that did. Deriving it means the claim cannot drift from the data it
  // describes.
  const sanctionSources = (
    db.prepare('SELECT DISTINCT source_list FROM sanctioned_entities ORDER BY source_list').all() as Array<{ source_list: string }>
  ).map((r) => r.source_list);
  const sepaSchemes = (
    db.prepare('SELECT DISTINCT scheme FROM sepa_participants ORDER BY scheme').all() as Array<{ scheme: string }>
  ).map((r) => `EPC-${r.scheme}`);
  const sources = [...sanctionSources, 'FATF', ...sepaSchemes].join(',');

  const runMeta = db.transaction(() => {
    insertMeta.run('last_refresh', new Date().toISOString());
    insertMeta.run('version', '1.0.0');
    insertMeta.run('sources', sources);
    insertMeta.run('fatf_as_of', FATF_AS_OF);
  });

  runMeta();
  console.log('  Metadata written.');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function printSummary(db: Database.Database): void {
  console.log('\n========== compliance.sqlite summary ==========');
  const tables = [
    'sanctioned_entities',
    'sanctioned_countries',
    'fatf_countries',
    'sepa_participants',
    'vop_participants',
    'metadata',
  ];
  for (const table of tables) {
    const row = db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get() as { n: number };
    console.log(`  ${table.padEnd(25)} ${row.n} rows`);
  }
  const lastRefresh = (
    db.prepare(`SELECT value FROM metadata WHERE key = 'last_refresh'`).get() as { value: string } | undefined
  )?.value;
  console.log(`  last_refresh:             ${lastRefresh ?? 'N/A'}`);
  console.log('===============================================\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== IBANforge compliance:refresh ===');
  console.log(`Output: ${FINAL_DB_PATH}`);

  // Staleness guard — FATF lists are hand-maintained (src/lib/compliance-static.ts).
  const fatfAgeMonths =
    (Date.now() - new Date(`${FATF_AS_OF}-01T00:00:00Z`).getTime()) / (1000 * 60 * 60 * 24 * 30.4);
  if (fatfAgeMonths > 5) {
    console.warn(
      `[compliance] WARNING: FATF lists are stale (as of ${FATF_AS_OF}, ~${Math.round(fatfAgeMonths)} months old) — recalibrate src/lib/compliance-static.ts after the latest FATF plenary.`,
    );
  }

  // 1. Prepare temp directory
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true, force: true });
  }
  mkdirSync(TMP_DIR, { recursive: true });

  // 2. Create DB and schema
  const db = new Database(TMP_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  createSchema(db);

  // 3. Insert static data
  insertStaticData(db);

  // 4. Primary-source sanctions (OFAC/EU/UN/SECO, BIC-level)
  const sanctionsTally = await fetchPrimarySanctions(db);

  // 5. EPC SEPA registers
  await fetchSepaRegisters(db);

  // 6. VoP register (real data)
  await fetchVopRegister(db);

  // 6b. Documented EMI BIC aliases (EPC membership under a different BIC8)
  applyEmiAliases(db);

  // 7. Metadata
  insertMetadata(db);

  // 8. Summary
  printSummary(db);

  // 8b. Sanity floor — refuse to ship a database that screens nothing.
  // OFAC carries ~98% of our BIC coverage, so an OFAC fetch failure can fail
  // with only a WARNING and otherwise leave a DB that screens almost nothing —
  // the live API would answer "clean" for every BIC, a systemic false-negative.
  // Abort and keep the previous compliance.sqlite instead.
  //
  // The floor is on CANDIDATES — what the sanctions sources published, counted
  // before anything is cross-referenced — not on the rows that survived. Those
  // two were the same number while the directory acted as a filter, and putting
  // the floor on survivors had the alarm wired backwards: it fired when OUR BIC
  // base shrank and stayed silent when a SANCTIONS SOURCE returned a truncated
  // file. Since the filter is gone, `kept` tracks `candidates`, and the floor is
  // stated on the quantity that actually describes the sources.
  const SANCTIONS_FLOOR = 50; // well below the normal ~190 OFAC bank BICs
  const shippedEntities = (
    db.prepare('SELECT COUNT(*) AS n FROM sanctioned_entities').get() as { n: number }
  ).n;
  if (sanctionsTally.candidates < SANCTIONS_FLOOR) {
    db.close();
    throw new Error(
      `Refusing to ship compliance.sqlite: the sanctions sources yielded only ` +
        `${sanctionsTally.candidates} candidate bank BICs (floor is ${SANCTIONS_FLOOR}; ` +
        `${shippedEntities} rows would have shipped). Likely an OFAC download failure — ` +
        `keeping the existing database. Re-run once the sources are reachable.`,
    );
  }

  // 9. Close DB and atomically replace final file
  db.close();

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  renameSync(TMP_DB_PATH, FINAL_DB_PATH);
  console.log(`compliance.sqlite written to: ${FINAL_DB_PATH}`);

  // 10. Clean up temp dir
  rmSync(TMP_DIR, { recursive: true, force: true });
  console.log('Temp directory cleaned up.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  // Attempt cleanup
  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
  process.exit(1);
});

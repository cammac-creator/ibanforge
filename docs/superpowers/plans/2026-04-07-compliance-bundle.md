# IBANforge Compliance Bundle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /v1/iban/compliance` endpoint ($0.02/call) that returns IBAN validation + sanctions screening + SEPA Instant reachability + VoP participant check + risk score in a single call.

**Architecture:** New `compliance.sqlite` database (read-only at runtime) with sanctions, FATF, SEPA participants, and VoP data. Populated by a refresh script that downloads OpenSanctions bulk export + EPC registers. New route handler composes existing IBAN validation with compliance lookups and a risk score calculator.

**Tech Stack:** Node.js 20, TypeScript, better-sqlite3, Hono, vitest. Data sources: OpenSanctions (JSON lines), EPC registers (XML/CSV), FATF lists (static + periodic update).

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `scripts/refresh-compliance.ts` | Download OpenSanctions + EPC data, build compliance.sqlite |
| `src/lib/compliance-db.ts` | Open compliance.sqlite, expose cached prepared statements |
| `src/lib/compliance.ts` | Lookup functions: sanctions, reachability, VoP, risk score |
| `src/routes/iban-compliance.ts` | POST /v1/iban/compliance route handler |
| `src/lib/compliance.test.ts` | Tests for compliance lookup + risk score |
| `data/compliance.sqlite` | Generated database (committed to git) |
| `.github/workflows/refresh-compliance.yml` | Weekly cron to refresh data |

### Modified files

| File | Changes |
|------|---------|
| `src/types.ts` | Add ComplianceResult type, add 'iban_compliance' to OperationType |
| `src/index.ts` | Mount compliance route, add x402 pricing |
| `src/middleware/x402.ts` | Add $0.02 pricing for POST /v1/iban/compliance |
| `src/mcp/server.ts` | Add compliance_check tool |
| `package.json` | Add compliance:refresh script |

---

## Task 1: Compliance database schema and connection

**Files:**
- Create: `src/lib/compliance-db.ts`

- [ ] **Step 1: Create compliance-db.ts**

```typescript
import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPLIANCE_DB_PATH = process.env.COMPLIANCE_DB_PATH ?? resolve(__dirname, '../../data/compliance.sqlite');

let complianceDB: Database.Database | null = null;

export function getComplianceDB(): Database.Database {
  if (!complianceDB) {
    complianceDB = new Database(COMPLIANCE_DB_PATH, { readonly: true });
  }
  return complianceDB;
}

export function closeComplianceDB(): void {
  if (complianceDB) {
    complianceDB.close();
    complianceDB = null;
  }
}
```

- [ ] **Step 2: Update src/lib/db.ts to close compliance DB on shutdown**

In `src/lib/db.ts`, import `closeComplianceDB` and call it in `closeAll()`:

```typescript
import { closeComplianceDB } from './compliance-db.js';
```

Add at the end of `closeAll()`:

```typescript
closeComplianceDB();
```

- [ ] **Step 3: Build and verify**

Run: `cd /Users/claude-alainmartin/ibanforge && npm run build`
Expected: Clean compilation.

- [ ] **Step 4: Commit**

```bash
git add src/lib/compliance-db.ts src/lib/db.ts
git commit -m "feat(compliance): add compliance database connection module"
```

---

## Task 2: Refresh script — download and build compliance.sqlite

**Files:**
- Create: `scripts/refresh-compliance.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the refresh script**

```typescript
import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream, renameSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../data');
const TMP_DIR = resolve(__dirname, '../.tmp-compliance');
const OUTPUT_PATH = resolve(DATA_DIR, 'compliance.sqlite');

// --- FATF lists (relatively static, updated ~3x/year) ---
const FATF_BLACK_LIST = ['KP', 'IR', 'MM']; // North Korea, Iran, Myanmar
const FATF_GREY_LIST = [
  'BF', 'CM', 'HR', 'CD', 'HT', 'KE', 'ML', 'MZ', 'NA', 'NG',
  'PH', 'SN', 'SS', 'SY', 'TZ', 'VE', 'VN', 'YE',
]; // As of Feb 2026 FATF plenary — update when FATF publishes new list
const FATF_MEMBERS = [
  'AR', 'AU', 'AT', 'BE', 'BR', 'CA', 'CN', 'DK', 'FI', 'FR',
  'DE', 'GR', 'HK', 'IS', 'IN', 'IE', 'IL', 'IT', 'JP', 'KR',
  'LU', 'MY', 'MX', 'NL', 'NZ', 'NO', 'PT', 'RU', 'SA', 'SG',
  'ZA', 'ES', 'SE', 'CH', 'TR', 'GB', 'US',
];

// --- Sanctioned countries (comprehensive sanctions regimes) ---
const SANCTIONED_COUNTRIES_COMPREHENSIVE = ['CU', 'IR', 'KP', 'SY', 'RU'];
const SANCTIONED_COUNTRIES_SECTORAL = ['BY', 'VE', 'ZW', 'MM', 'SD', 'CF', 'SO', 'LY', 'YE'];

async function downloadFile(url: string, dest: string): Promise<void> {
  console.log(`  Downloading ${url}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const fileStream = createWriteStream(dest);
  await pipeline(Readable.fromWeb(res.body as any), fileStream);
  console.log(`  Saved to ${dest}`);
}

async function importSanctionedBICs(db: Database.Database): Promise<number> {
  const url = 'https://data.opensanctions.org/datasets/latest/sanctions/targets.simple.csv';
  const csvPath = resolve(TMP_DIR, 'sanctions.csv');
  await downloadFile(url, csvPath);

  // Parse CSV for entities with BIC/SWIFT codes
  const rl = createInterface({ input: createReadStream(csvPath) });
  let headerParsed = false;
  let idIdx = -1, schemaIdx = -1, nameIdx = -1, countriesIdx = -1, datasetsIdx = -1, identifiersIdx = -1;
  let count = 0;

  const insert = db.prepare(
    'INSERT OR IGNORE INTO sanctioned_entities (bic8, entity_name, source_list, country_code) VALUES (?, ?, ?, ?)'
  );

  for await (const line of rl) {
    if (!headerParsed) {
      const headers = line.split(',');
      idIdx = headers.indexOf('id');
      schemaIdx = headers.indexOf('schema');
      nameIdx = headers.indexOf('name');
      countriesIdx = headers.indexOf('countries');
      datasetsIdx = headers.indexOf('datasets');
      identifiersIdx = headers.indexOf('identifiers');
      headerParsed = true;
      continue;
    }

    // Simple CSV parsing (fields may contain semicolons but not commas in this dataset)
    const fields = line.split(',');
    const identifiers = fields[identifiersIdx] ?? '';
    const datasets = fields[datasetsIdx] ?? '';
    const name = fields[nameIdx] ?? '';
    const countries = fields[countriesIdx] ?? '';

    // Look for BIC/SWIFT codes in identifiers (8 or 11 alphanumeric chars)
    const bicMatches = identifiers.match(/\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?\b/g);
    if (bicMatches) {
      for (const bic of bicMatches) {
        const bic8 = bic.slice(0, 8);
        const country = countries.split(';')[0] || bic.slice(4, 6);
        const sourceList = datasets.includes('us_') ? 'OFAC' : datasets.includes('eu_') ? 'EU' : 'UN';
        insert.run(bic8, name.slice(0, 200), sourceList, country);
        count++;
      }
    }
  }
  return count;
}

async function importEPCRegister(db: Database.Database, scheme: string, url: string): Promise<number> {
  const csvPath = resolve(TMP_DIR, `epc_${scheme}.xml`);
  await downloadFile(url, csvPath);

  // EPC registers are XML; extract BICs with a simple regex approach
  const content = await (await import('node:fs/promises')).readFile(csvPath, 'utf-8');
  const bicPattern = /<BIC>([A-Z0-9]{8,11})<\/BIC>/g;
  const insert = db.prepare(
    'INSERT OR IGNORE INTO sepa_participants (bic8, scheme, status) VALUES (?, ?, ?)'
  );

  let count = 0;
  let match;
  while ((match = bicPattern.exec(content)) !== null) {
    const bic8 = match[1].slice(0, 8);
    insert.run(bic8, scheme, 'active');
    count++;
  }
  return count;
}

async function main() {
  console.log('=== IBANforge Compliance Data Refresh ===\n');

  // Setup
  if (existsSync(TMP_DIR)) {
    const { rmSync } = await import('node:fs');
    rmSync(TMP_DIR, { recursive: true });
  }
  mkdirSync(TMP_DIR, { recursive: true });

  const tmpDbPath = resolve(TMP_DIR, 'compliance.sqlite');
  const db = new Database(tmpDbPath);

  // Create schema
  db.exec(`
    CREATE TABLE sanctioned_entities (
      bic8 TEXT NOT NULL,
      entity_name TEXT,
      source_list TEXT,
      country_code TEXT,
      UNIQUE(bic8, source_list)
    );
    CREATE INDEX idx_sanctioned_bic8 ON sanctioned_entities(bic8);

    CREATE TABLE sanctioned_countries (
      country_code TEXT PRIMARY KEY,
      sanction_type TEXT NOT NULL
    );

    CREATE TABLE fatf_countries (
      country_code TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );

    CREATE TABLE sepa_participants (
      bic8 TEXT NOT NULL,
      scheme TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      PRIMARY KEY (bic8, scheme)
    );

    CREATE TABLE vop_participants (
      bic8 TEXT PRIMARY KEY,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // 1. Sanctioned countries
  console.log('1. Importing sanctioned countries...');
  const insertCountry = db.prepare('INSERT OR REPLACE INTO sanctioned_countries (country_code, sanction_type) VALUES (?, ?)');
  for (const cc of SANCTIONED_COUNTRIES_COMPREHENSIVE) insertCountry.run(cc, 'comprehensive');
  for (const cc of SANCTIONED_COUNTRIES_SECTORAL) insertCountry.run(cc, 'sectoral');
  console.log(`   ${SANCTIONED_COUNTRIES_COMPREHENSIVE.length + SANCTIONED_COUNTRIES_SECTORAL.length} countries\n`);

  // 2. FATF
  console.log('2. Importing FATF lists...');
  const insertFatf = db.prepare('INSERT OR REPLACE INTO fatf_countries (country_code, status) VALUES (?, ?)');
  for (const cc of FATF_BLACK_LIST) insertFatf.run(cc, 'black');
  for (const cc of FATF_GREY_LIST) insertFatf.run(cc, 'grey');
  for (const cc of FATF_MEMBERS) insertFatf.run(cc, 'member');
  console.log(`   ${FATF_BLACK_LIST.length} black + ${FATF_GREY_LIST.length} grey + ${FATF_MEMBERS.length} members\n`);

  // 3. OpenSanctions BICs
  console.log('3. Importing sanctioned BICs from OpenSanctions...');
  try {
    const bicCount = await importSanctionedBICs(db);
    console.log(`   ${bicCount} sanctioned BIC entries\n`);
  } catch (err) {
    console.error('   WARNING: Failed to import OpenSanctions data:', (err as Error).message);
    console.log('   Continuing with country-level sanctions only.\n');
  }

  // 4. EPC Registers
  console.log('4. Importing EPC SEPA registers...');
  const epcBaseUrl = 'https://www.europeanpaymentscouncil.eu/sites/default/files/participants';
  try {
    const sctCount = await importEPCRegister(db, 'SCT', `${epcBaseUrl}/SCT/EPC_Register_SCT.xml`);
    console.log(`   SCT: ${sctCount} participants`);
  } catch (err) {
    console.error('   WARNING: Failed to import SCT register:', (err as Error).message);
  }
  try {
    const sddCount = await importEPCRegister(db, 'SDD', `${epcBaseUrl}/SDD/EPC_Register_SDD.xml`);
    console.log(`   SDD: ${sddCount} participants`);
  } catch (err) {
    console.error('   WARNING: Failed to import SDD register:', (err as Error).message);
  }
  try {
    const instCount = await importEPCRegister(db, 'SCT_INST', `${epcBaseUrl}/SCT_INST/EPC_Register_SCTinst.xml`);
    console.log(`   SCT_INST: ${instCount} participants`);
  } catch (err) {
    console.error('   WARNING: Failed to import SCT Inst register:', (err as Error).message);
  }

  // 5. VoP — use SCT participants as baseline (VoP is mandatory for all SCT participants in eurozone)
  console.log('\n5. Populating VoP participants (from SCT eurozone participants)...');
  const eurozoneBics = db.prepare("SELECT DISTINCT bic8 FROM sepa_participants WHERE scheme = 'SCT'").all() as { bic8: string }[];
  const insertVop = db.prepare('INSERT OR IGNORE INTO vop_participants (bic8, status) VALUES (?, ?)');
  for (const { bic8 } of eurozoneBics) insertVop.run(bic8, 'active');
  console.log(`   ${eurozoneBics.length} VoP participants\n`);

  // 6. Metadata
  db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('last_refresh', new Date().toISOString());
  db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('version', '1.0.0');

  db.close();

  // Atomic replace
  if (existsSync(OUTPUT_PATH)) unlinkSync(OUTPUT_PATH);
  renameSync(tmpDbPath, OUTPUT_PATH);

  // Cleanup
  const { rmSync } = await import('node:fs');
  rmSync(TMP_DIR, { recursive: true });

  console.log(`=== Done! compliance.sqlite written to ${OUTPUT_PATH} ===`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script to package.json**

Add to `"scripts"` in `package.json`:

```json
"compliance:refresh": "npx tsx scripts/refresh-compliance.ts"
```

- [ ] **Step 3: Run the refresh script**

Run: `cd /Users/claude-alainmartin/ibanforge && npm run compliance:refresh`
Expected: Script downloads data, creates `data/compliance.sqlite`, prints counts.

- [ ] **Step 4: Commit**

```bash
git add scripts/refresh-compliance.ts package.json data/compliance.sqlite
git commit -m "feat(compliance): add refresh script for sanctions, FATF, SEPA, VoP data"
```

---

## Task 3: Compliance types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add compliance types and update OperationType**

Append to `src/types.ts`:

```typescript
// --- Compliance Bundle ---

export type OperationType = 'iban_validate' | 'iban_batch' | 'bic_lookup' | 'iban_compliance';

export interface SanctionsCheck {
  country_sanctioned: boolean;
  bank_sanctioned: boolean;
  matched_lists: string[];
  fatf_status: 'member' | 'grey_list' | 'black_list' | 'non_member';
}

export interface ReachabilityCheck {
  sepa_instant: boolean;
  sct: boolean;
  sdd: boolean;
}

export interface VopCheck {
  participant: boolean;
  status: 'active' | 'pending' | 'inactive' | 'not_found';
}

export type RiskLevel = 'low' | 'medium' | 'elevated' | 'high' | 'critical';

export interface ComplianceResult {
  sanctions: SanctionsCheck;
  reachability: ReachabilityCheck;
  vop: VopCheck;
  risk_score: number;
  risk_level: RiskLevel;
  flags: string[];
}
```

Also update the existing `OperationType` line (remove the old one and keep the new one with `iban_compliance`).

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Clean compilation.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(compliance): add ComplianceResult types and iban_compliance operation type"
```

---

## Task 4: Compliance lookup functions + risk score

**Files:**
- Create: `src/lib/compliance.ts`
- Create: `src/lib/compliance.test.ts`

- [ ] **Step 1: Create compliance.ts**

```typescript
import { getComplianceDB } from './compliance-db.js';
import type { SanctionsCheck, ReachabilityCheck, VopCheck, ComplianceResult, RiskLevel } from '../types.js';

// Cached prepared statements
let _checkSanctionedCountry: ReturnType<typeof getComplianceDB.prototype.prepare> | null = null;
let _checkSanctionedBank: ReturnType<typeof getComplianceDB.prototype.prepare> | null = null;
let _checkFatf: ReturnType<typeof getComplianceDB.prototype.prepare> | null = null;
let _checkReachability: ReturnType<typeof getComplianceDB.prototype.prepare> | null = null;
let _checkVop: ReturnType<typeof getComplianceDB.prototype.prepare> | null = null;

export function checkSanctions(countryCode: string, bic8: string | null): SanctionsCheck {
  const db = getComplianceDB();

  if (!_checkSanctionedCountry) {
    _checkSanctionedCountry = db.prepare('SELECT sanction_type FROM sanctioned_countries WHERE country_code = ?');
  }
  if (!_checkSanctionedBank) {
    _checkSanctionedBank = db.prepare('SELECT source_list FROM sanctioned_entities WHERE bic8 = ?');
  }
  if (!_checkFatf) {
    _checkFatf = db.prepare('SELECT status FROM fatf_countries WHERE country_code = ?');
  }

  const countrySanction = _checkSanctionedCountry.get(countryCode) as { sanction_type: string } | undefined;
  const bankSanctions = bic8 ? _checkSanctionedBank.all(bic8) as { source_list: string }[] : [];
  const fatfRow = _checkFatf.get(countryCode) as { status: string } | undefined;

  return {
    country_sanctioned: !!countrySanction,
    bank_sanctioned: bankSanctions.length > 0,
    matched_lists: bankSanctions.map(r => r.source_list),
    fatf_status: (fatfRow?.status as SanctionsCheck['fatf_status']) ?? 'non_member',
  };
}

export function checkReachability(bic8: string | null): ReachabilityCheck {
  if (!bic8) return { sepa_instant: false, sct: false, sdd: false };

  const db = getComplianceDB();
  if (!_checkReachability) {
    _checkReachability = db.prepare('SELECT scheme FROM sepa_participants WHERE bic8 = ?');
  }

  const rows = _checkReachability.all(bic8) as { scheme: string }[];
  const schemes = new Set(rows.map(r => r.scheme));

  return {
    sepa_instant: schemes.has('SCT_INST'),
    sct: schemes.has('SCT'),
    sdd: schemes.has('SDD'),
  };
}

export function checkVop(bic8: string | null): VopCheck {
  if (!bic8) return { participant: false, status: 'not_found' };

  const db = getComplianceDB();
  if (!_checkVop) {
    _checkVop = db.prepare('SELECT status FROM vop_participants WHERE bic8 = ?');
  }

  const row = _checkVop.get(bic8) as { status: string } | undefined;
  return {
    participant: !!row,
    status: (row?.status as VopCheck['status']) ?? 'not_found',
  };
}

export function calculateRiskScore(
  sanctions: SanctionsCheck,
  reachability: ReachabilityCheck,
  vop: VopCheck,
  issuerType: string,
  countryRisk: string,
  isTestBic: boolean,
): { risk_score: number; risk_level: RiskLevel; flags: string[] } {
  let score = 0;
  const flags: string[] = [];

  if (sanctions.country_sanctioned) { score += 50; flags.push('sanctioned_country'); }
  if (sanctions.bank_sanctioned) { score += 50; flags.push('sanctioned_bank'); }
  if (sanctions.fatf_status === 'black_list') { score += 30; flags.push('fatf_black_list'); }
  if (sanctions.fatf_status === 'grey_list') { score += 20; flags.push('fatf_grey_list'); }
  if (sanctions.fatf_status === 'non_member') { score += 10; flags.push('fatf_non_member'); }
  if (issuerType === 'payment_institution') { score += 15; flags.push('payment_institution_issuer'); }
  if (issuerType === 'emi') { score += 10; flags.push('emi_issuer'); }
  if (countryRisk === 'high') { score += 20; flags.push('high_risk_country'); }
  if (countryRisk === 'elevated') { score += 10; flags.push('elevated_risk_country'); }
  if (isTestBic) { score += 30; flags.push('test_bic'); }
  if (!reachability.sepa_instant) { score += 5; flags.push('no_sepa_instant'); }
  if (!vop.participant) { score += 5; flags.push('no_vop'); }

  score = Math.min(score, 100);

  const risk_level: RiskLevel =
    score >= 80 ? 'critical' :
    score >= 60 ? 'high' :
    score >= 40 ? 'elevated' :
    score >= 20 ? 'medium' : 'low';

  return { risk_score: score, risk_level, flags };
}

export function buildComplianceResult(
  countryCode: string,
  bic8: string | null,
  issuerType: string,
  countryRisk: string,
  isTestBic: boolean,
): ComplianceResult {
  const sanctions = checkSanctions(countryCode, bic8);
  const reachability = checkReachability(bic8);
  const vop = checkVop(bic8);
  const { risk_score, risk_level, flags } = calculateRiskScore(
    sanctions, reachability, vop, issuerType, countryRisk, isTestBic,
  );

  return { sanctions, reachability, vop, risk_score, risk_level, flags };
}

export function resetComplianceStatements(): void {
  _checkSanctionedCountry = null;
  _checkSanctionedBank = null;
  _checkFatf = null;
  _checkReachability = null;
  _checkVop = null;
}
```

- [ ] **Step 2: Create compliance.test.ts**

```typescript
import { describe, it, expect } from 'vitest';
import { calculateRiskScore } from './compliance.js';
import type { SanctionsCheck, ReachabilityCheck, VopCheck } from '../types.js';

describe('calculateRiskScore', () => {
  const cleanSanctions: SanctionsCheck = { country_sanctioned: false, bank_sanctioned: false, matched_lists: [], fatf_status: 'member' };
  const goodReachability: ReachabilityCheck = { sepa_instant: true, sct: true, sdd: true };
  const goodVop: VopCheck = { participant: true, status: 'active' };

  it('returns low risk for standard bank in FATF member country', () => {
    const result = calculateRiskScore(cleanSanctions, goodReachability, goodVop, 'bank', 'standard', false);
    expect(result.risk_score).toBe(0);
    expect(result.risk_level).toBe('low');
    expect(result.flags).toEqual([]);
  });

  it('returns critical risk for sanctioned country + bank', () => {
    const sanctions: SanctionsCheck = { country_sanctioned: true, bank_sanctioned: true, matched_lists: ['OFAC'], fatf_status: 'black_list' };
    const noReach: ReachabilityCheck = { sepa_instant: false, sct: false, sdd: false };
    const noVop: VopCheck = { participant: false, status: 'not_found' };
    const result = calculateRiskScore(sanctions, noReach, noVop, 'bank', 'high', false);
    expect(result.risk_score).toBe(100); // 50+50+30+20+5+5 = 160, capped at 100
    expect(result.risk_level).toBe('critical');
    expect(result.flags).toContain('sanctioned_country');
    expect(result.flags).toContain('sanctioned_bank');
    expect(result.flags).toContain('fatf_black_list');
  });

  it('returns elevated risk for EMI in grey list country', () => {
    const sanctions: SanctionsCheck = { country_sanctioned: false, bank_sanctioned: false, matched_lists: [], fatf_status: 'grey_list' };
    const noInst: ReachabilityCheck = { sepa_instant: false, sct: true, sdd: false };
    const noVop: VopCheck = { participant: false, status: 'not_found' };
    const result = calculateRiskScore(sanctions, noInst, noVop, 'emi', 'standard', false);
    // 20 (grey) + 10 (emi) + 5 (no instant) + 5 (no vop) = 40
    expect(result.risk_score).toBe(40);
    expect(result.risk_level).toBe('elevated');
    expect(result.flags).toContain('fatf_grey_list');
    expect(result.flags).toContain('emi_issuer');
  });

  it('caps score at 100', () => {
    const sanctions: SanctionsCheck = { country_sanctioned: true, bank_sanctioned: true, matched_lists: ['OFAC', 'EU'], fatf_status: 'black_list' };
    const noReach: ReachabilityCheck = { sepa_instant: false, sct: false, sdd: false };
    const noVop: VopCheck = { participant: false, status: 'not_found' };
    const result = calculateRiskScore(sanctions, noReach, noVop, 'payment_institution', 'high', true);
    expect(result.risk_score).toBe(100);
  });

  it('adds test_bic flag', () => {
    const result = calculateRiskScore(cleanSanctions, goodReachability, goodVop, 'bank', 'standard', true);
    expect(result.risk_score).toBe(30);
    expect(result.flags).toContain('test_bic');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass (existing 101 + new compliance tests).

- [ ] **Step 4: Commit**

```bash
git add src/lib/compliance.ts src/lib/compliance.test.ts
git commit -m "feat(compliance): add sanctions, reachability, VoP lookups and risk score calculator"
```

---

## Task 5: Compliance route handler

**Files:**
- Create: `src/routes/iban-compliance.ts`

- [ ] **Step 1: Create the route**

```typescript
import { Hono } from 'hono';
import { validateIBAN } from '../lib/iban.js';
import { enrichResult } from '../lib/enrich.js';
import { buildComplianceResult } from '../lib/compliance.js';
import { recordOperation } from '../lib/stats.js';
import type { IBANValidationResult, ComplianceResult } from '../types.js';

const ibanCompliance = new Hono();

ibanCompliance.post('/v1/iban/compliance', async (c) => {
  const start = performance.now();

  let body: { iban?: unknown };
  try {
    body = await c.req.json<{ iban?: unknown }>();
  } catch {
    return c.json(
      { error: 'invalid_json', message: 'Request body must be valid JSON' },
      400,
    );
  }

  if (!body.iban || typeof body.iban !== 'string' || body.iban.trim() === '') {
    return c.json(
      { error: 'invalid_request', message: "Request body must include an 'iban' field (string)" },
      400,
    );
  }

  const result: IBANValidationResult = validateIBAN(body.iban as string);
  enrichResult(result);

  // Build compliance layer
  const countryCode = result.country?.code ?? '';
  const bic8 = result.bic?.code?.slice(0, 8) ?? null;
  const issuerType = result.issuer?.type ?? 'bank';
  const countryRisk = result.risk_indicators?.country_risk ?? 'standard';
  const isTestBic = result.risk_indicators?.test_bic ?? false;

  let compliance: ComplianceResult;
  try {
    compliance = buildComplianceResult(countryCode, bic8, issuerType, countryRisk, isTestBic);
  } catch {
    // Compliance DB might not exist yet — return result without compliance
    compliance = {
      sanctions: { country_sanctioned: false, bank_sanctioned: false, matched_lists: [], fatf_status: 'non_member' },
      reachability: { sepa_instant: false, sct: false, sdd: false },
      vop: { participant: false, status: 'not_found' },
      risk_score: 0,
      risk_level: 'low',
      flags: ['compliance_data_unavailable'],
    };
  }

  const processingMs = Math.round((performance.now() - start) * 100) / 100;

  const errorDetail = result.valid ? undefined : result.iban.slice(0, 4);
  recordOperation('iban_compliance', countryCode || null, result.valid, 0.02, errorDetail);

  return c.json({
    ...result,
    compliance,
    cost_usdc: 0.02,
    processing_ms: processingMs,
  });
});

export { ibanCompliance };
```

- [ ] **Step 2: Mount route in src/index.ts**

Add import and route:

```typescript
import { ibanCompliance } from './routes/iban-compliance.js';
```

Add after the existing x402 middleware line (`app.use('/v1/*', createX402Middleware())`):

```typescript
app.route('/', ibanCompliance);
```

Place it with the other paid routes (after bicLookup).

- [ ] **Step 3: Add x402 pricing in src/middleware/x402.ts**

Add this route to the `routes` object inside `createX402Middleware()`:

```typescript
'POST /v1/iban/compliance': {
  accepts: {
    scheme: 'exact',
    network: 'eip155:8453' as const,
    price: '$0.02',
    payTo: walletAddress,
    maxTimeoutSeconds: 60,
  },
  description: 'IBAN compliance check: validation + sanctions + SEPA reachability + VoP + risk score',
},
```

- [ ] **Step 4: Build and test**

Run: `npm run build && npm test`
Expected: Clean compilation, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/iban-compliance.ts src/index.ts src/middleware/x402.ts
git commit -m "feat(compliance): add POST /v1/iban/compliance endpoint at $0.02/call"
```

---

## Task 6: MCP tool

**Files:**
- Modify: `src/mcp/server.ts`

- [ ] **Step 1: Add compliance_check tool**

Add after the existing `lookup_bic` tool in `src/mcp/server.ts`:

```typescript
import { buildComplianceResult } from '../lib/compliance.js';

server.tool(
  'compliance_check',
  `Validate an IBAN and return comprehensive compliance data: sanctions screening (OFAC/EU/UN), FATF status, SEPA Instant reachability, VoP participant status, issuer classification, and a composite risk score (0-100).

Use this tool when you need to assess whether a payment to a given IBAN is safe from a compliance perspective — for example, before initiating a wire transfer, during KYC onboarding, or when screening a list of beneficiaries.

Returns everything validate_iban returns, plus a full compliance layer with:
- sanctions.country_sanctioned / bank_sanctioned / matched_lists / fatf_status
- reachability.sepa_instant / sct / sdd
- vop.participant / status
- risk_score (0-100) and risk_level (low/medium/elevated/high/critical)
- flags array with specific risk indicators

Cost: $0.02 USDC per call via x402 micropayment on Base L2.
For simple validation without compliance data, use validate_iban ($0.005).`,
  {
    iban: z.string().describe("IBAN to check. Spaces accepted. Example: 'DE89 3704 0044 0532 0130 00'"),
  },
  async ({ iban }) => {
    const result = validateIBAN(iban);
    enrichResult(result);

    const countryCode = result.country?.code ?? '';
    const bic8 = result.bic?.code?.slice(0, 8) ?? null;
    const issuerType = result.issuer?.type ?? 'bank';
    const countryRisk = result.risk_indicators?.country_risk ?? 'standard';
    const isTestBic = result.risk_indicators?.test_bic ?? false;

    let compliance;
    try {
      compliance = buildComplianceResult(countryCode, bic8, issuerType, countryRisk, isTestBic);
    } catch {
      compliance = { sanctions: { country_sanctioned: false, bank_sanctioned: false, matched_lists: [], fatf_status: 'non_member' }, reachability: { sepa_instant: false, sct: false, sdd: false }, vop: { participant: false, status: 'not_found' }, risk_score: 0, risk_level: 'low', flags: ['compliance_data_unavailable'] };
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ ...result, compliance }, null, 2) }],
    };
  },
);
```

- [ ] **Step 2: Build and test**

Run: `npm run build && npm test`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat(compliance): add compliance_check MCP tool"
```

---

## Task 7: GitHub Actions cron for weekly refresh

**Files:**
- Create: `.github/workflows/refresh-compliance.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: Refresh Compliance Data

on:
  schedule:
    - cron: '0 3 * * 0'  # Every Sunday at 3:00 UTC
  workflow_dispatch: {}    # Allow manual trigger

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - name: Refresh compliance data
        run: npm run compliance:refresh

      - name: Check for changes
        id: changes
        run: |
          if git diff --quiet data/compliance.sqlite; then
            echo "changed=false" >> $GITHUB_OUTPUT
          else
            echo "changed=true" >> $GITHUB_OUTPUT
          fi

      - name: Commit and push
        if: steps.changes.outputs.changed == 'true'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/compliance.sqlite
          git commit -m "chore(compliance): weekly data refresh [automated]"
          git push
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/refresh-compliance.yml
git commit -m "ci: add weekly compliance data refresh cron (Sundays 3:00 UTC)"
```

---

## Task 8: Final build, test, push

- [ ] **Step 1: Full check**

Run: `npm run check` (typecheck + lint + test)
Expected: All pass.

- [ ] **Step 2: Push everything**

```bash
git push
```

- [ ] **Step 3: Verify on production**

After Railway redeploy, test:

```bash
curl -s -w "\nHTTP: %{http_code}" -X POST https://api.ibanforge.com/v1/iban/compliance \
  -H "Content-Type: application/json" \
  -d '{"iban":"DE89370400440532013000"}'
```

Expected: HTTP 402 (x402 payment required) — confirming the endpoint exists and is priced.

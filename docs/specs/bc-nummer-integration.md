# BC-Nummer Integration Spec — Swiss SIX Bank Clearing Numbers

**Status:** Draft
**Date:** 2026-04-10
**Author:** Claude + Alain

---

## 1. Overview

Integrate the Swiss SIX BankMaster dataset (Bank Clearing Numbers / BC-Nummer / IID) into IBANforge to provide Swiss-specific bank resolution when validating CH IBANs, and expose a standalone clearing code lookup endpoint.

### Goals

- Resolve the institution behind any Swiss IBAN from the 5-digit BC-Nummer in the BBAN
- Provide SIC/euroSIC payment infrastructure participation details
- Detect PostFinance, cantonal banks, and Raiffeisen cooperatives
- Expose QR-IID allocation data (relevant for QR-bill ecosystem)
- New standalone API route: `GET /v1/ch/clearing/:iid`
- New MCP tool: `lookup_ch_clearing`
- Automatic enrichment of existing `POST /v1/iban/validate` for CH IBANs

---

## 2. Data Source

### Primary source: SIX BankMaster CSV V3

**URL:** `https://api.six-group.com/api/epcd/bankmaster/v3/bankmaster_V3.csv`

The CSV version is preferred over the JSON API (`bankmaster.json`) because:
- The JSON API returns only ~126 entries (appears truncated/paginated)
- The CSV contains **all 1190 entries** including PostFinance, Raiffeisen branches, and foreign participants
- The CSV includes fields absent from the JSON: `QR-IID allocation`, `Concatenation`, `New IID/QR-IID`

**Format:** Semicolon-delimited CSV, UTF-8, updated daily by SIX.

### CSV columns (verbatim header)

```
IID/QR-IID;Valid on;Concatenation;New IID/QR-IID;SIC IID;Headquarters;IID type;QR-IID allocation;Name of bank/institution;Street Name;Building Number;Post Code;Town Name;Country;BIC;SIC participation;RTGS customer payments, CHF;IP customer payments, CHF;euroSIC participation;LSV+/BDD, CHF;LSV+/BDD, EUR;{timestamp}
```

| Column | Type | Description |
|--------|------|-------------|
| `IID/QR-IID` | integer | Institution Identification number (= BC-Nummer). Range: 100 to 81998 |
| `Valid on` | date | Validity date (YYYY-MM-DD) |
| `Concatenation` | Y/N | If Y, this IID is merged into another (see `New IID/QR-IID`) |
| `New IID/QR-IID` | integer? | Target IID when Concatenation=Y (redirect) |
| `SIC IID` | string | SIC system identifier (6 digits) |
| `Headquarters` | integer | IID of the headquarters (self-referencing if this IS the HQ) |
| `IID type` | 1/2/4 | 1=headquarters, 2=branch, 4=other institution |
| `QR-IID allocation` | integer? | QR-IID for QR-bill processing (e.g. 9000 for PostFinance) |
| `Name of bank/institution` | string | Official name |
| `Street Name` | string | Street |
| `Building Number` | string? | Building number (optional) |
| `Post Code` | string | Postal code |
| `Town Name` | string | City |
| `Country` | string | ISO 3166-1 alpha-2 (CH, LI, DE, GB) |
| `BIC` | string | BIC/SWIFT code (11 chars) |
| `SIC participation` | Y/N | SIC interbank clearing participant |
| `RTGS customer payments, CHF` | Y/N | RTGS (Real-Time Gross Settlement) for CHF customer payments |
| `IP customer payments, CHF` | Y/N | Instant Payments for CHF customer payments |
| `euroSIC participation` | Y/N | euroSIC clearing participant (EUR payments) |
| `LSV+/BDD, CHF` | Y/N | Direct debit (Lastschriftverfahren) in CHF |
| `LSV+/BDD, EUR` | Y/N | Direct debit in EUR |

### Key entries

| IID | Name | Type | Notes |
|-----|------|------|-------|
| 100 | Schweizerische Nationalbank | HQ | Central bank |
| 230 | UBS Switzerland AG | HQ | Major bank |
| 315 | UBS AG | HQ | Investment banking entity |
| 700 | Zürcher Kantonalbank | HQ | Cantonal bank |
| 30000 | PostFinance AG | Other (4) | QR-IID allocation = 9000 |
| 80000 | Raiffeisen Schweiz | HQ | Cooperative banking group |

**Important correction:** PostFinance's IID is **30000**, not in the 9xxx range. The value `9000` appears in the `QR-IID allocation` column. The task's assumption that "BC-Nummer 9xxx = PostFinance" is incorrect.

### Concatenation (IID redirects)

~33 entries have `Concatenation=Y`, meaning the IID has been merged into another institution. Example:
- IID 30025 → redirects to IID 30024
- IID 30183 → redirects to IID 30248

The lookup must follow these redirects transparently.

---

## 3. Architecture

### 3.1 Database: new `ch_clearing` table in `bic.sqlite`

Store in the existing `bic.sqlite` database (not a separate file). Rationale:
- Related reference data (bank identification), same lifecycle as BIC data
- Keeps the Docker image simple (no additional volume/file)
- Read-only at runtime, same access pattern as `bic_entries`

#### Schema

```sql
CREATE TABLE IF NOT EXISTS ch_clearing (
  iid              TEXT PRIMARY KEY,    -- 5-digit zero-padded (e.g. '00230', '30000', '81998')
  valid_on         TEXT,                -- YYYY-MM-DD
  concatenation    INTEGER DEFAULT 0,   -- 1 if merged into another IID
  redirect_iid     TEXT,                -- target IID when concatenation=1
  sic_iid          TEXT,                -- 6-digit SIC identifier
  headquarters_iid TEXT,                -- IID of the headquarters
  iid_type         INTEGER,            -- 1=HQ, 2=branch, 4=other
  qr_iid           TEXT,                -- QR-IID allocation (for QR-bill)
  name             TEXT NOT NULL,       -- Bank/institution name
  street           TEXT,
  building_number  TEXT,
  post_code        TEXT,
  town             TEXT,
  country          TEXT DEFAULT 'CH',   -- ISO alpha-2
  bic              TEXT,                -- BIC/SWIFT (11 chars)
  sic_participation       INTEGER DEFAULT 0,
  rtgs_chf               INTEGER DEFAULT 0,
  ip_chf                 INTEGER DEFAULT 0,  -- Instant Payments CHF
  eurosic_participation  INTEGER DEFAULT 0,
  lsv_bdd_chf           INTEGER DEFAULT 0,
  lsv_bdd_eur           INTEGER DEFAULT 0,
  updated_at       TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ch_clearing_bic ON ch_clearing(bic);
CREATE INDEX IF NOT EXISTS idx_ch_clearing_hq ON ch_clearing(headquarters_iid);
CREATE INDEX IF NOT EXISTS idx_ch_clearing_name ON ch_clearing(name);
```

#### Why zero-padded 5-digit IID?

The Swiss BBAN structure in `countries.ts` is:
```ts
CH: { bankCode: [0, 5], accountNumber: [5, 12] }
```

The bank_code extracted from a CH IBAN is already a 5-character string (e.g. `'00230'` for UBS). Storing IIDs as 5-digit zero-padded strings allows direct lookup by `bban.bank_code` without any conversion.

Examples:
- IBAN `CH56 0483 5012 3456 7800 9` → bank_code = `'04835'` → lookup IID `'04835'`
- IID 230 (UBS HQ) → stored as `'00230'`
- IID 81998 (Raiffeisen branch) → stored as `'81998'`

### 3.2 New library: `src/lib/ch-clearing.ts`

```
Functions:
  lookupClearing(iid: string): ChClearingEntry | null
  lookupClearingByBankCode(bankCode: string): ChClearingEntry | null  // follows redirects
  detectInstitutionType(entry: ChClearingEntry): ChInstitutionType
  getHeadquarters(entry: ChClearingEntry): ChClearingEntry | null
```

Institution type detection logic:
- **PostFinance:** `name` contains "PostFinance"
- **Cantonal bank:** `name` matches /Kantonalbank|Banque Cantonale|Banca dello Stato|Banca cantonale/i
- **Raiffeisen:** `name` starts with "Raiffeisen"
- **Central bank:** IID = '00100' (SNB)
- **Foreign participant:** `country` != 'CH'
- **Default:** 'bank'

### 3.3 New route: `src/routes/ch-clearing.ts`

`GET /v1/ch/clearing/:iid`

Paid route (x402), same tier as BIC lookup: **0.003 USDC**.

### 3.4 Enrichment enhancement: `src/lib/enrich.ts`

When `country === 'CH'` and `bban.bank_code` is available, call `lookupClearingByBankCode()` and attach a `clearing` object to the result.

### 3.5 New MCP tool: `lookup_ch_clearing`

Register in `src/mcp/server.ts` alongside existing tools.

### 3.6 Seed script: `scripts/seed-bc-nummer.ts`

Download CSV, parse, zero-pad, insert into `ch_clearing` table in `bic.sqlite`.

---

## 4. API Design

### 4.1 Standalone route: `GET /v1/ch/clearing/:iid`

**Cost:** 0.003 USDC

**Input:** IID as URL parameter. Accepts both raw (e.g. `230`) and zero-padded (e.g. `00230`).

**Response (200):**

```json
{
  "iid": "00230",
  "found": true,
  "institution": {
    "name": "UBS Switzerland AG",
    "type": "bank",
    "iid_type": "headquarters",
    "headquarters_iid": "00230"
  },
  "address": {
    "street": "Bahnhofstrasse",
    "building_number": "45",
    "post_code": "8098",
    "town": "Zürich",
    "country": "CH"
  },
  "bic": "UBSWCHZH80A",
  "payment_services": {
    "sic": true,
    "rtgs_chf": true,
    "instant_payments_chf": true,
    "eurosic": true,
    "lsv_bdd_chf": true,
    "lsv_bdd_eur": true
  },
  "sic_iid": "002301",
  "qr_iid": null,
  "valid_on": "2026-04-15",
  "cost_usdc": 0.003,
  "processing_ms": 0.42
}
```

**Response for PostFinance (IID 30000):**

```json
{
  "iid": "30000",
  "found": true,
  "institution": {
    "name": "PostFinance AG",
    "type": "postfinance",
    "iid_type": "other",
    "headquarters_iid": "30000"
  },
  "address": {
    "street": "Mingerstrasse",
    "building_number": "20",
    "post_code": "3030",
    "town": "Bern",
    "country": "CH"
  },
  "bic": "POFICHBEXXX",
  "payment_services": {
    "sic": true,
    "rtgs_chf": true,
    "instant_payments_chf": true,
    "eurosic": true,
    "lsv_bdd_chf": false,
    "lsv_bdd_eur": false
  },
  "sic_iid": "300005",
  "qr_iid": "9000",
  "valid_on": "2026-04-15",
  "cost_usdc": 0.003,
  "processing_ms": 0.31
}
```

**Response for cantonal bank (IID 700):**

```json
{
  "iid": "00700",
  "found": true,
  "institution": {
    "name": "Zürcher Kantonalbank",
    "type": "cantonal_bank",
    "iid_type": "headquarters",
    "headquarters_iid": "00700"
  },
  "address": {
    "street": "Postfach",
    "building_number": null,
    "post_code": "8010",
    "town": "Zürich",
    "country": "CH"
  },
  "bic": "ZKBKCHZZ80A",
  "payment_services": {
    "sic": true,
    "rtgs_chf": true,
    "instant_payments_chf": true,
    "eurosic": true,
    "lsv_bdd_chf": true,
    "lsv_bdd_eur": true
  },
  "sic_iid": "007005",
  "qr_iid": null,
  "valid_on": "2026-04-15",
  "cost_usdc": 0.003,
  "processing_ms": 0.28
}
```

**Response for concatenated/merged IID (e.g. 30025 → 30024):**

```json
{
  "iid": "30025",
  "found": true,
  "redirected_from": "30025",
  "institution": {
    "name": "...",
    "type": "bank",
    "iid_type": "...",
    "headquarters_iid": "..."
  },
  "note": "IID 30025 has been merged into IID 30024."
}
```

**Response (404) — not found:**

```json
{
  "iid": "99999",
  "found": false,
  "error": "clearing_not_found",
  "message": "IID 99999 not found in Swiss BankMaster database.",
  "cost_usdc": 0.003,
  "processing_ms": 0.12
}
```

**Response (400) — invalid format:**

```json
{
  "error": "invalid_iid_format",
  "message": "IID must be a 1-5 digit number."
}
```

### 4.2 IBAN validate enrichment for CH IBANs

When `POST /v1/iban/validate` processes a CH IBAN, the response gains a new `clearing` field:

```json
{
  "iban": "CH5604835012345678009",
  "valid": true,
  "country": { "code": "CH", "name": "Switzerland" },
  "check_digits": "56",
  "bban": {
    "bank_code": "04835",
    "account_number": "012345678009"
  },
  "bic": {
    "code": "CRESCHZZ",
    "bank_name": "Credit Suisse (Schweiz) AG",
    "city": "Zürich"
  },
  "clearing": {
    "iid": "04835",
    "name": "Credit Suisse (Schweiz) AG",
    "type": "bank",
    "town": "Zürich",
    "sic": true,
    "instant_payments_chf": true,
    "eurosic": true,
    "qr_iid": null
  },
  "sepa": { "member": true, "schemes": ["SCT", "SDD"], "vop_required": false },
  "issuer": { "type": "bank", "name": "Credit Suisse (Schweiz) AG" },
  "risk_indicators": { ... },
  "formatted": "CH56 0483 5012 3456 7800 9",
  "cost_usdc": 0.005,
  "processing_ms": 1.23
}
```

The `clearing` field is a compact subset of the full clearing response — just enough for payment routing decisions without duplicating the full address data.

### 4.3 MCP tool: `lookup_ch_clearing`

Same input/output as the API route, registered in `src/mcp/server.ts`:

```ts
server.registerTool('lookup_ch_clearing', {
  title: 'Lookup Swiss Bank Clearing Number',
  description: `Look up a Swiss BC-Nummer (Bank Clearing Number / IID) and return institution details, payment infrastructure participation (SIC, euroSIC, Instant Payments), and QR-bill data.

When to use: resolving the bank behind a Swiss IBAN, checking SIC/euroSIC participation, verifying QR-bill IID allocation, or identifying PostFinance/cantonal bank accounts.
When NOT to use: for non-Swiss IBANs, use validate_iban instead.

Input: IID as string, 1-5 digits (e.g. '230', '00230', '30000', '80000').
Returns: institution name and type, address, BIC, payment service participation, QR-IID.

Cost: $0.003 USDC per call.`,
  inputSchema: {
    iid: z.string().describe("Swiss BC-Nummer / IID. 1-5 digits, e.g. '230' or '00230'.")
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
});
```

---

## 5. Types

### New types in `src/types.ts`

```ts
// --- Swiss Clearing (BC-Nummer) ---

export type ChInstitutionType =
  | 'bank'
  | 'cantonal_bank'
  | 'postfinance'
  | 'raiffeisen'
  | 'central_bank'
  | 'foreign_participant';

export type ChIidType = 'headquarters' | 'branch' | 'other';

export interface ChClearingEntry {
  iid: string;
  name: string;
  institution_type: ChInstitutionType;
  iid_type: ChIidType;
  headquarters_iid: string;
  address: {
    street: string | null;
    building_number: string | null;
    post_code: string | null;
    town: string | null;
    country: string;
  };
  bic: string | null;
  payment_services: {
    sic: boolean;
    rtgs_chf: boolean;
    instant_payments_chf: boolean;
    eurosic: boolean;
    lsv_bdd_chf: boolean;
    lsv_bdd_eur: boolean;
  };
  sic_iid: string | null;
  qr_iid: string | null;
  valid_on: string;
  concatenation: boolean;
  redirect_iid: string | null;
}

export interface ChClearingLookupResult {
  iid: string;
  found: boolean;
  redirected_from?: string;
  institution?: {
    name: string;
    type: ChInstitutionType;
    iid_type: ChIidType;
    headquarters_iid: string;
  };
  address?: {
    street: string | null;
    building_number: string | null;
    post_code: string | null;
    town: string | null;
    country: string;
  };
  bic?: string | null;
  payment_services?: {
    sic: boolean;
    rtgs_chf: boolean;
    instant_payments_chf: boolean;
    eurosic: boolean;
    lsv_bdd_chf: boolean;
    lsv_bdd_eur: boolean;
  };
  sic_iid?: string | null;
  qr_iid?: string | null;
  valid_on?: string;
  note?: string;
  error?: string;
  message?: string;
  cost_usdc: number;
  processing_ms?: number;
}

// Compact clearing info for IBAN validate enrichment
export interface ChClearingSummary {
  iid: string;
  name: string;
  type: ChInstitutionType;
  town: string | null;
  sic: boolean;
  instant_payments_chf: boolean;
  eurosic: boolean;
  qr_iid: string | null;
}
```

### Extension to `IBANValidationResult`

Add optional field:

```ts
export interface IBANValidationResult {
  // ... existing fields ...
  clearing?: ChClearingSummary;   // <-- NEW: present when country=CH
}
```

---

## 6. Seed Script

### File: `scripts/seed-bc-nummer.ts`

#### Algorithm

1. Download `bankmaster_V3.csv` from SIX API
2. Parse semicolon-delimited CSV (skip header row; last column is a timestamp — ignore it)
3. For each row:
   a. Zero-pad `IID/QR-IID` to 5 digits → this becomes the primary key
   b. Parse `Concatenation` (Y→1, N→0)
   c. Zero-pad `New IID/QR-IID` to 5 digits if present
   d. Zero-pad `Headquarters` to 5 digits
   e. Map `IID type`: 1→headquarters, 2→branch, 4→other
   f. Convert participation flags (Y→1, N→0)
   g. Skip rows where `Concatenation=Y` and all data fields are empty (pure redirects still need a row, but only iid + redirect_iid)
4. Insert into `ch_clearing` table in `bic.sqlite` (drop and recreate table)
5. Log statistics: total entries, HQ count, branch count, cantonal banks detected, etc.

#### npm script

Add to `package.json`:

```json
{
  "scripts": {
    "db:seed-ch": "tsx scripts/seed-bc-nummer.ts"
  }
}
```

#### Concatenation handling

Rows with `Concatenation=Y` may have empty data fields (just the IID and redirect target). These rows must still be stored so that lookups on old IIDs can follow the redirect:

```
30025;2026-04-15;Y;30024;;;;;;;;;;;;;;;;;
```

Stored as: `iid='30025', concatenation=1, redirect_iid='30024'`, all other fields NULL.

---

## 7. Integration Points

### 7.1 Enrichment (`src/lib/enrich.ts`)

```ts
import { lookupClearingByBankCode } from './ch-clearing.js';

export function enrichResult(result: IBANValidationResult): void {
  // ... existing BIC lookup, issuer classification, risk indicators ...

  // Swiss clearing enrichment
  if (result.valid && cc === 'CH' && result.bban?.bank_code) {
    const clearing = lookupClearingByBankCode(result.bban.bank_code);
    if (clearing) {
      result.clearing = {
        iid: clearing.iid,
        name: clearing.name,
        type: clearing.institution_type,
        town: clearing.address.town,
        sic: clearing.payment_services.sic,
        instant_payments_chf: clearing.payment_services.instant_payments_chf,
        eurosic: clearing.payment_services.eurosic,
        qr_iid: clearing.qr_iid,
      };
    }
  }
}
```

### 7.2 Index.ts registration

```ts
import { chClearing } from './routes/ch-clearing.js';

// Pre-validate
app.get('/v1/ch/clearing/:iid', async (c, next) => {
  const iid = c.req.param('iid');
  if (!/^\d{1,5}$/.test(iid)) {
    return c.json({ error: 'invalid_iid_format', message: 'IID must be a 1-5 digit number.' }, 400);
  }
  await next();
});

// In paid routes section
app.route('/', chClearing);
```

### 7.3 Operations tracking

Add `'ch_clearing_lookup'` to the `OperationType` union in `types.ts`:

```ts
export type OperationType = 'iban_validate' | 'iban_batch' | 'bic_lookup' | 'iban_compliance' | 'ch_clearing_lookup';
```

### 7.4 Stats and health

Update the health endpoint and stats to include `ch_clearing_lookup` counts. Add a `ch_clearing_entries` count to the health check to confirm the database is populated.

### 7.5 OpenAPI spec

Add the `GET /v1/ch/clearing/:iid` endpoint to `docs/openapi.yaml` with full request/response schemas.

### 7.6 Landing page

Add the new endpoint to the API endpoints table on the landing page.

### 7.7 Docker

The seed script must run **before** `docker build` (or during the build stage), so that `bic.sqlite` includes the `ch_clearing` table in the Docker image. Update the `Dockerfile` builder stage if the seed is not already part of the build.

Alternatively, since the BIC database is pre-built and tracked in git, the simplest approach is:
1. Run `npm run db:seed-ch` locally
2. Commit the updated `data/bic.sqlite`
3. The Docker image picks it up automatically

---

## 8. Institution Type Detection

### Algorithm for `detectInstitutionType()`

Priority order (first match wins):

1. **PostFinance:** `name` includes "PostFinance" (case-insensitive)
2. **Central bank:** `iid === '00100'` OR `name` includes "Nationalbank"
3. **Cantonal bank:** `name` matches one of:
   - /Kantonalbank/i
   - /Banque Cantonale/i
   - /Banca dello Stato/i
   - /Banca cantonale/i
4. **Raiffeisen:** `name` starts with "Raiffeisen" (case-insensitive)
5. **Foreign participant:** `country !== 'CH'` (covers LI, DE, GB entries)
6. **Default:** `'bank'`

### Known cantonal banks from dataset (24 headquarters)

IIDs: 700 (ZKB), 761 (AG), 763 (AR), 764 (TI), 765 (VS), 766 (NE), 767 (VD), 768 (FR), 769 (BL), 770 (BS), 773 (GL), 774 (GR), 777 (SZ), 778 (LU), 779 (NW), 780, 781, 782, 784, 785, 787, 788, 789, 790

---

## 9. Test Plan

### File: `src/lib/ch-clearing.test.ts`

#### 9.1 Database lookup tests

These tests require the seeded database. Use `beforeAll` to verify the table exists.

```
✓ lookupClearing('00230') returns UBS Switzerland AG
✓ lookupClearing('30000') returns PostFinance AG
✓ lookupClearing('00700') returns Zürcher Kantonalbank
✓ lookupClearing('80000') returns Raiffeisen Schweiz
✓ lookupClearing('99999') returns null (not found)
✓ lookupClearing('00100') returns Schweizerische Nationalbank
```

#### 9.2 Zero-padding / normalization

```
✓ lookupClearing('230') → normalizes to '00230' and finds UBS
✓ lookupClearing('100') → normalizes to '00100' and finds SNB
✓ lookupClearingByBankCode('04835') → direct lookup, no padding needed
```

#### 9.3 Concatenation / redirect following

```
✓ lookupClearingByBankCode('30025') follows redirect to '30024'
✓ redirect result includes 'redirected_from' field
✓ redirect does not loop (max 1 hop)
```

#### 9.4 Institution type detection

```
✓ detectInstitutionType(PostFinance entry) → 'postfinance'
✓ detectInstitutionType(ZKB entry) → 'cantonal_bank'
✓ detectInstitutionType(Raiffeisen entry) → 'raiffeisen'
✓ detectInstitutionType(SNB entry) → 'central_bank'
✓ detectInstitutionType(UBS entry) → 'bank'
✓ detectInstitutionType(LI entry) → 'foreign_participant'
```

#### 9.5 Payment services parsing

```
✓ PostFinance: sic=true, instant_payments_chf=true, lsv_bdd_chf=false
✓ UBS: all payment services = true
✓ SNB: lsv_bdd_eur=false
```

### File: `src/lib/iban.test.ts` (additions)

#### 9.6 Swiss IBAN enrichment

```
✓ CH IBAN gets clearing field in enrichResult()
✓ clearing.type is 'cantonal_bank' for ZKB IBAN
✓ clearing.type is 'postfinance' for PostFinance IBAN
✓ DE IBAN does NOT get clearing field
✓ Invalid CH IBAN does NOT get clearing field
```

### File: `src/routes/ch-clearing.test.ts`

#### 9.7 Route tests

```
✓ GET /v1/ch/clearing/230 → 200, found=true
✓ GET /v1/ch/clearing/00230 → 200, found=true, same result
✓ GET /v1/ch/clearing/99999 → 200, found=false
✓ GET /v1/ch/clearing/abc → 400, invalid_iid_format
✓ GET /v1/ch/clearing/123456 → 400, invalid_iid_format (too long)
```

### Swiss IBAN test vectors

| IBAN | BC-Nummer | Expected institution |
|------|-----------|---------------------|
| CH56 0483 5012 3456 7800 9 | 04835 | Credit Suisse (branch) |
| CH93 0076 2011 6238 5295 7 | 00762 | ZKB (branch, HQ=700) |
| CH43 0023 0230 0000 0000 0 | 00230 | UBS |
| CH09 3000 0001 2345 6789 0 | 30000 | PostFinance |

Note: These IBANs are illustrative. Real test IBANs with valid mod-97 checksums must be computed or sourced from test IBAN generators.

---

## 10. Pricing

| Endpoint | Cost (USDC) | Rationale |
|----------|-------------|-----------|
| GET /v1/ch/clearing/:iid | 0.003 | Same as BIC lookup — similar scope (single record, local DB) |
| POST /v1/iban/validate (CH enrichment) | 0.005 | No price change — clearing is bundled into existing IBAN validation |
| POST /v1/iban/compliance (CH enrichment) | 0.020 | No price change — clearing is bundled into compliance check |

---

## 11. Files to Create/Modify

### New files

| File | Description |
|------|-------------|
| `src/lib/ch-clearing.ts` | Clearing lookup, institution detection, DB queries |
| `src/routes/ch-clearing.ts` | GET /v1/ch/clearing/:iid route handler |
| `src/lib/ch-clearing.test.ts` | Unit tests for clearing logic |
| `src/routes/ch-clearing.test.ts` | Route integration tests |
| `scripts/seed-bc-nummer.ts` | Download + seed SIX BankMaster CSV into SQLite |

### Modified files

| File | Change |
|------|--------|
| `src/types.ts` | Add `ChClearingEntry`, `ChClearingLookupResult`, `ChClearingSummary`, `ChInstitutionType`, `ChIidType`; extend `IBANValidationResult` with `clearing?`; extend `OperationType` |
| `src/lib/enrich.ts` | Add CH clearing lookup when country=CH |
| `src/lib/db.ts` | No change needed (bic.sqlite already opened read-only; ch_clearing is in same file) |
| `src/mcp/server.ts` | Register `lookup_ch_clearing` tool |
| `src/index.ts` | Import and mount ch-clearing route; add pre-validation middleware |
| `src/routes/health.ts` | Add ch_clearing entry count to health response |
| `src/db/schema.sql` | Add ch_clearing CREATE TABLE for documentation |
| `package.json` | Add `"db:seed-ch"` script |
| `docs/openapi.yaml` | Add GET /v1/ch/clearing/:iid endpoint spec |
| `CLAUDE.md` | Add ch-clearing to architecture diagram and API table |

---

## 12. Implementation Order

1. **Schema + types** — Add types to `types.ts`, add schema to `schema.sql`
2. **Seed script** — Create `scripts/seed-bc-nummer.ts`, run it to populate `bic.sqlite`
3. **Library** — Create `src/lib/ch-clearing.ts` with lookup and detection logic
4. **Unit tests** — Create `src/lib/ch-clearing.test.ts`, verify all lookups work
5. **Route** — Create `src/routes/ch-clearing.ts`
6. **Index registration** — Wire route into `src/index.ts`
7. **Enrichment** — Update `src/lib/enrich.ts` for CH IBAN enrichment
8. **MCP tool** — Register `lookup_ch_clearing` in `src/mcp/server.ts`
9. **Route tests** — Create `src/routes/ch-clearing.test.ts`
10. **Documentation** — Update OpenAPI spec, CLAUDE.md, landing page
11. **Full test run** — `npm run check` (typecheck + lint + test)
12. **Commit + deploy**

---

## 13. Open Questions

1. **Data refresh frequency:** Should the seed script be run as a cron job (weekly/monthly) or only manually? The SIX BankMaster is updated daily, but bank changes are infrequent. Monthly refresh seems sufficient.

2. **Liechtenstein IBANs (LI):** LI shares the same BBAN structure as CH (`bankCode: [0, 5]`) and some LI banks appear in the SIX BankMaster. Should we also enrich LI IBANs with clearing data? The LI entries in the dataset have `country=LI`.

3. **QR-IID standalone lookup:** Should `GET /v1/ch/clearing/:iid` also accept QR-IIDs (e.g. `9000` for PostFinance) and resolve them, or only accept standard BC-Nummern?

4. **Branch vs headquarters in enrichment:** When a CH IBAN's bank_code maps to a branch (iid_type=2), should the enrichment response include the headquarters info as well, or just the branch?

# API Keys + Free Tier + npm SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add API key system with 200 req/month free tier + publish `@ibanforge/sdk` npm package.

**Architecture:** API keys stored as SHA-256 hashes in stats.sqlite. New middleware checks key before x402. SDK is a zero-dependency TypeScript wrapper in `packages/sdk/`.

**Tech Stack:** Node.js 20, crypto (built-in), better-sqlite3, tsup (SDK build), npm publish.

---

## File Map

### Backend (API Keys)

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/db.ts` | Modify | Add api_keys + api_usage tables |
| `src/lib/api-keys.ts` | Create | Generate, validate, quota check, increment |
| `src/lib/api-keys.test.ts` | Create | Unit tests |
| `src/middleware/api-key.ts` | Create | Hono middleware: check key → skip x402 or pass through |
| `src/routes/api-keys.ts` | Create | POST /v1/keys/generate + GET /v1/keys/usage |
| `src/middleware/x402.ts` | Modify | Skip if `c.get('apiKeyAuthenticated')` is true |
| `src/index.ts` | Modify | Mount routes + middleware |

### SDK

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/sdk/src/index.ts` | Create | IBANforge class |
| `packages/sdk/src/types.ts` | Create | Exported response types |
| `packages/sdk/package.json` | Create | @ibanforge/sdk package config |
| `packages/sdk/tsconfig.json` | Create | TypeScript config |
| `packages/sdk/README.md` | Create | npm documentation |

---

## Task 1: DB schema + API key functions

**Files:**
- Modify: `src/lib/db.ts`
- Create: `src/lib/api-keys.ts`
- Create: `src/lib/api-keys.test.ts`

- [ ] **Step 1: Add tables to stats.sqlite schema**

In `src/lib/db.ts`, add these tables inside the `getStatsDB()` exec block, after the existing `hourly_stats` table:

```sql
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT UNIQUE NOT NULL,
  key_prefix TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  active INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_email ON api_keys(email);

CREATE TABLE IF NOT EXISTS api_usage (
  key_hash TEXT NOT NULL,
  month TEXT NOT NULL,
  count INTEGER DEFAULT 0,
  PRIMARY KEY (key_hash, month)
);
```

- [ ] **Step 2: Create api-keys.ts**

```typescript
import { createHash, randomBytes } from 'node:crypto';
import { getStatsDB } from './db.js';

const MONTHLY_LIMIT = 200;
const KEY_PREFIX = 'ifk_';

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(email: string): { api_key: string; key_prefix: string; already_exists: boolean } | null {
  const db = getStatsDB();

  // Rate limit: 1 key per email per day
  const existing = db.prepare(
    "SELECT id FROM api_keys WHERE email = ? AND created_at >= datetime('now', '-1 day')"
  ).get(email) as { id: number } | undefined;

  if (existing) return null;

  const rawKey = KEY_PREFIX + randomBytes(32).toString('hex');
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12);

  db.prepare(
    'INSERT INTO api_keys (key_hash, key_prefix, email) VALUES (?, ?, ?)'
  ).run(keyHash, keyPrefix, email);

  return { api_key: rawKey, key_prefix: keyPrefix, already_exists: false };
}

export function validateApiKey(key: string): { valid: boolean; keyHash: string; email?: string } {
  if (!key.startsWith(KEY_PREFIX)) return { valid: false, keyHash: '' };

  const keyHash = hashKey(key);
  const row = getStatsDB().prepare(
    'SELECT email FROM api_keys WHERE key_hash = ? AND active = 1'
  ).get(keyHash) as { email: string } | undefined;

  return row ? { valid: true, keyHash, email: row.email } : { valid: false, keyHash };
}

export function checkAndIncrementQuota(keyHash: string): { allowed: boolean; used: number; limit: number; remaining: number; month: string } {
  const db = getStatsDB();
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM

  // Upsert usage
  db.prepare(`
    INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, 0)
    ON CONFLICT(key_hash, month) DO NOTHING
  `).run(keyHash, month);

  const row = db.prepare(
    'SELECT count FROM api_usage WHERE key_hash = ? AND month = ?'
  ).get(keyHash, month) as { count: number };

  const used = row.count;

  if (used >= MONTHLY_LIMIT) {
    return { allowed: false, used, limit: MONTHLY_LIMIT, remaining: 0, month };
  }

  // Increment
  db.prepare(
    'UPDATE api_usage SET count = count + 1 WHERE key_hash = ? AND month = ?'
  ).run(keyHash, month);

  return { allowed: true, used: used + 1, limit: MONTHLY_LIMIT, remaining: MONTHLY_LIMIT - used - 1, month };
}

export function getUsage(keyHash: string): { used: number; limit: number; remaining: number; month: string } {
  const db = getStatsDB();
  const month = new Date().toISOString().slice(0, 7);

  const row = db.prepare(
    'SELECT count FROM api_usage WHERE key_hash = ? AND month = ?'
  ).get(keyHash, month) as { count: number } | undefined;

  const used = row?.count ?? 0;
  return { used, limit: MONTHLY_LIMIT, remaining: MONTHLY_LIMIT - used, month };
}
```

- [ ] **Step 3: Create tests**

```typescript
import { describe, it, expect } from 'vitest';
import { generateApiKey, validateApiKey, checkAndIncrementQuota, getUsage } from './api-keys.js';

describe('API Keys', () => {
  it('generates a key with ifk_ prefix', () => {
    const result = generateApiKey('test@example.com');
    expect(result).not.toBeNull();
    expect(result!.api_key).toMatch(/^ifk_[a-f0-9]{64}$/);
    expect(result!.key_prefix).toMatch(/^ifk_[a-f0-9]{4}/);
  });

  it('validates a generated key', () => {
    const result = generateApiKey('validate@example.com');
    const validation = validateApiKey(result!.api_key);
    expect(validation.valid).toBe(true);
    expect(validation.email).toBe('validate@example.com');
  });

  it('rejects invalid key', () => {
    const validation = validateApiKey('ifk_invalid');
    expect(validation.valid).toBe(false);
  });

  it('rejects non-ifk key', () => {
    const validation = validateApiKey('sk_something');
    expect(validation.valid).toBe(false);
  });

  it('tracks usage and enforces quota', () => {
    const result = generateApiKey('quota@example.com');
    const validation = validateApiKey(result!.api_key);
    const quota = checkAndIncrementQuota(validation.keyHash);
    expect(quota.allowed).toBe(true);
    expect(quota.used).toBe(1);
    expect(quota.remaining).toBe(199);
  });

  it('returns usage stats', () => {
    const result = generateApiKey('usage@example.com');
    const validation = validateApiKey(result!.api_key);
    checkAndIncrementQuota(validation.keyHash);
    checkAndIncrementQuota(validation.keyHash);
    const usage = getUsage(validation.keyHash);
    expect(usage.used).toBe(2);
    expect(usage.remaining).toBe(198);
  });
});
```

- [ ] **Step 4: Build and test**

Run: `npm run build && npm test`

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts src/lib/api-keys.ts src/lib/api-keys.test.ts
git commit -m "feat(api-keys): add key generation, validation, and quota management"
```

---

## Task 2: API key middleware + x402 integration

**Files:**
- Create: `src/middleware/api-key.ts`
- Modify: `src/middleware/x402.ts`

- [ ] **Step 1: Create api-key middleware**

```typescript
import type { MiddlewareHandler } from 'hono';
import { validateApiKey, checkAndIncrementQuota } from '../lib/api-keys.js';

export function apiKeyMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ifk_')) {
      // No API key — pass through to x402
      await next();
      return;
    }

    const key = authHeader.slice(7); // Remove "Bearer "
    const { valid, keyHash } = validateApiKey(key);

    if (!valid) {
      // Invalid key — pass through to x402 (don't block)
      await next();
      return;
    }

    const quota = checkAndIncrementQuota(keyHash);

    if (!quota.allowed) {
      return c.json({
        error: 'quota_exceeded',
        message: 'Monthly limit of 200 requests reached. Use x402 payment for additional requests.',
        used: quota.used,
        limit: quota.limit,
        month: quota.month,
      }, 429);
    }

    // Mark as authenticated — x402 will skip
    c.set('apiKeyAuthenticated', true);
    await next();
  };
}
```

- [ ] **Step 2: Modify x402 middleware to skip when API key authenticated**

In `src/middleware/x402.ts`, add this check at the beginning of the returned middleware function, right after the dev bypass and x402 disabled checks:

```typescript
// Skip x402 if authenticated via API key
if (c.get('apiKeyAuthenticated')) {
  await next();
  return;
}
```

Add it after the `if (!walletAddress)` block.

- [ ] **Step 3: Build and test**

Run: `npm run build && npm test`

- [ ] **Step 4: Commit**

```bash
git add src/middleware/api-key.ts src/middleware/x402.ts
git commit -m "feat(api-keys): add API key middleware with x402 bypass"
```

---

## Task 3: Key generation + usage routes

**Files:**
- Create: `src/routes/api-keys.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create routes**

```typescript
import { Hono } from 'hono';
import { generateApiKey, validateApiKey, getUsage } from '../lib/api-keys.js';

const apiKeys = new Hono();

apiKeys.post('/v1/keys/generate', async (c) => {
  let body: { email?: unknown };
  try {
    body = await c.req.json<{ email?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }

  const email = body.email;
  if (!email || typeof email !== 'string' || !email.includes('@') || email.length > 255) {
    return c.json({ error: 'invalid_email', message: 'A valid email address is required' }, 400);
  }

  const result = generateApiKey(email.trim().toLowerCase());

  if (!result) {
    return c.json({
      error: 'rate_limited',
      message: 'Only one API key can be generated per email per day. Check your email or try again tomorrow.',
    }, 429);
  }

  return c.json({
    api_key: result.api_key,
    key_prefix: result.key_prefix,
    email: email.trim().toLowerCase(),
    monthly_limit: 200,
    message: 'Save this key — it will not be shown again.',
  }, 201);
});

apiKeys.get('/v1/keys/usage', (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ifk_')) {
    return c.json({ error: 'missing_key', message: 'Provide your API key via Authorization: Bearer ifk_xxx' }, 401);
  }

  const key = authHeader.slice(7);
  const { valid, keyHash } = validateApiKey(key);

  if (!valid) {
    return c.json({ error: 'invalid_key', message: 'API key not found or inactive' }, 401);
  }

  const usage = getUsage(keyHash);

  return c.json({
    ...usage,
    key_prefix: key.slice(0, 12),
  });
});

export { apiKeys };
```

- [ ] **Step 2: Mount in index.ts**

Import and mount the routes + middleware. In `src/index.ts`:

1. Add import: `import { apiKeys } from './routes/api-keys.js';`
2. Add import: `import { apiKeyMiddleware } from './middleware/api-key.js';`
3. Add API key middleware AFTER pre-validation, BEFORE x402: `app.use('/v1/*', apiKeyMiddleware());`
4. Add key routes as free routes (BEFORE the x402 middleware, alongside demo): mount `app.route('/', apiKeys);` in the free routes section.

The order in index.ts should be:
```
Pre-validation → API key middleware → x402 middleware → Routes
```

And `/v1/keys/generate` + `/v1/keys/usage` must be accessible WITHOUT x402 (they're free endpoints).

- [ ] **Step 3: Add /v1/keys/* to SKIP_TRACKING set**

In `src/index.ts`, the `SKIP_TRACKING` set should also include key management endpoints to avoid polluting request stats. Add key routes there or handle separately.

Actually, key routes should be tracked (they're real API usage). But they should NOT go through x402. The simplest way: mount apiKeys routes BEFORE the x402 middleware line.

- [ ] **Step 4: Build and test**

Run: `npm run build && npm test`

- [ ] **Step 5: Commit and push**

```bash
git add src/routes/api-keys.ts src/index.ts
git commit -m "feat(api-keys): add POST /v1/keys/generate and GET /v1/keys/usage endpoints"
git push
```

---

## Task 4: SDK npm package

**Files:**
- Create: `packages/sdk/src/index.ts`
- Create: `packages/sdk/src/types.ts`
- Create: `packages/sdk/package.json`
- Create: `packages/sdk/tsconfig.json`
- Create: `packages/sdk/README.md`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@ibanforge/sdk",
  "version": "1.0.0",
  "description": "Official SDK for the IBANforge API — IBAN validation, BIC/SWIFT lookup, compliance checks",
  "main": "dist/index.cjs",
  "module": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts --clean",
    "prepublishOnly": "npm run build"
  },
  "keywords": ["iban", "bic", "swift", "sepa", "validation", "compliance", "x402", "mcp", "fintech"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/cammac-creator/ibanforge"
  },
  "homepage": "https://ibanforge.com",
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create types.ts**

```typescript
export interface Country {
  code: string;
  name: string;
}

export interface BBAN {
  bank_code: string;
  branch_code?: string;
  account_number: string;
}

export interface BICInfo {
  code: string;
  bank_name: string | null;
  city: string | null;
}

export interface SEPAInfo {
  member: boolean;
  schemes: Array<'SCT' | 'SDD' | 'SCT_INST'>;
  vop_required: boolean;
}

export interface IssuerInfo {
  type: 'bank' | 'digital_bank' | 'emi' | 'payment_institution';
  name: string;
}

export interface RiskIndicators {
  issuer_type: string;
  country_risk: 'standard' | 'elevated' | 'high';
  test_bic: boolean;
  sepa_reachable: boolean;
  vop_coverage: boolean;
}

export interface IBANValidationResult {
  iban: string;
  valid: boolean;
  country?: Country;
  check_digits?: string;
  bban?: BBAN;
  bic?: BICInfo | null;
  sepa?: SEPAInfo;
  issuer?: IssuerInfo;
  risk_indicators?: RiskIndicators;
  formatted?: string;
  error?: string;
  error_detail?: string;
  cost_usdc: number;
  processing_ms?: number;
}

export interface BatchValidationResult {
  results: IBANValidationResult[];
  count: number;
  valid_count: number;
  cost_usdc: number;
  processing_ms?: number;
}

export interface BICLookupResult {
  bic: string;
  bic8: string;
  bic11: string;
  found: boolean;
  valid_format: boolean;
  institution: string | null;
  country: Country;
  city: string | null;
  branch_code: string;
  branch_info: string | null;
  lei: string | null;
  lei_status: string | null;
  is_test_bic: boolean;
  source: string | null;
  cost_usdc: number;
  processing_ms?: number;
}

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

export interface ComplianceData {
  sanctions: SanctionsCheck;
  reachability: ReachabilityCheck;
  vop: VopCheck;
  risk_score: number;
  risk_level: 'low' | 'medium' | 'elevated' | 'high' | 'critical';
  flags: string[];
}

export interface ComplianceCheckResult extends IBANValidationResult {
  compliance: ComplianceData;
}

export interface UsageResult {
  used: number;
  limit: number;
  remaining: number;
  month: string;
  key_prefix: string;
}

export class IBANforgeError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'IBANforgeError';
    this.status = status;
    this.code = code;
  }
}
```

- [ ] **Step 4: Create index.ts**

```typescript
import type {
  IBANValidationResult,
  BatchValidationResult,
  BICLookupResult,
  ComplianceCheckResult,
  UsageResult,
} from './types.js';
import { IBANforgeError } from './types.js';

export type {
  IBANValidationResult,
  BatchValidationResult,
  BICLookupResult,
  ComplianceCheckResult,
  UsageResult,
  ComplianceData,
  SanctionsCheck,
  ReachabilityCheck,
  VopCheck,
  IssuerInfo,
  SEPAInfo,
  RiskIndicators,
  Country,
  BBAN,
  BICInfo,
} from './types.js';
export { IBANforgeError } from './types.js';

interface IBANforgeOptions {
  baseUrl?: string;
}

export class IBANforge {
  private apiKey?: string;
  private baseUrl: string;

  constructor(apiKey?: string, options?: IBANforgeOptions) {
    this.apiKey = apiKey;
    this.baseUrl = (options?.baseUrl ?? 'https://api.ibanforge.com').replace(/\/+$/, '');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let errBody: { error?: string; message?: string } = {};
      try { errBody = await res.json(); } catch {}
      throw new IBANforgeError(
        res.status,
        errBody.error ?? 'unknown',
        errBody.message ?? `HTTP ${res.status}`,
      );
    }

    return res.json() as Promise<T>;
  }

  async validate(iban: string): Promise<IBANValidationResult> {
    return this.request('POST', '/v1/iban/validate', { iban });
  }

  async validateBatch(ibans: string[]): Promise<BatchValidationResult> {
    return this.request('POST', '/v1/iban/batch', { ibans });
  }

  async lookupBIC(code: string): Promise<BICLookupResult> {
    return this.request('GET', `/v1/bic/${encodeURIComponent(code)}`);
  }

  async compliance(iban: string): Promise<ComplianceCheckResult> {
    return this.request('POST', '/v1/iban/compliance', { iban });
  }

  async usage(): Promise<UsageResult> {
    return this.request('GET', '/v1/keys/usage');
  }
}

export default IBANforge;
```

- [ ] **Step 5: Create README.md**

```markdown
# @ibanforge/sdk

Official TypeScript SDK for the [IBANforge API](https://ibanforge.com) — IBAN validation, BIC/SWIFT lookup, and compliance checks.

## Install

```bash
npm install @ibanforge/sdk
```

## Quick Start

```typescript
import { IBANforge } from '@ibanforge/sdk';

const client = new IBANforge('ifk_your_api_key');

// Validate an IBAN
const result = await client.validate('CH9300762011623852957');
console.log(result.valid, result.bic?.code);

// BIC/SWIFT lookup
const bic = await client.lookupBIC('UBSWCHZH');
console.log(bic.institution, bic.city);

// Compliance check (sanctions + SEPA + VoP + risk score)
const check = await client.compliance('DE89370400440532013000');
console.log(check.compliance.risk_score, check.compliance.risk_level);

// Batch validation (up to 100 IBANs)
const batch = await client.validateBatch(['CH93...', 'DE89...']);
console.log(batch.valid_count, '/', batch.count);

// Check API key usage
const usage = await client.usage();
console.log(usage.remaining, 'requests left this month');
```

## Get an API Key

```bash
curl -X POST https://api.ibanforge.com/v1/keys/generate \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'
```

Free tier: 200 requests/month. For higher volumes, use [x402 USDC micropayments](https://ibanforge.com/pricing).

## API Reference

| Method | Description | Cost |
|--------|-------------|------|
| `validate(iban)` | Validate IBAN + BIC + SEPA + issuer | $0.005 or free tier |
| `validateBatch(ibans)` | Validate up to 100 IBANs | $0.002/IBAN or free tier |
| `lookupBIC(code)` | BIC/SWIFT lookup with LEI | $0.003 or free tier |
| `compliance(iban)` | Full compliance check + risk score | $0.02 or free tier |
| `usage()` | Check remaining free requests | Free |

## Links

- [Documentation](https://ibanforge.com/docs)
- [Pricing](https://ibanforge.com/pricing)
- [OpenAPI Spec](https://api.ibanforge.com/openapi.json)
- [GitHub](https://github.com/cammac-creator/ibanforge)
```

- [ ] **Step 6: Install tsup and build**

```bash
cd packages/sdk
npm install
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/
git commit -m "feat(sdk): create @ibanforge/sdk npm package with TypeScript types"
```

---

## Task 5: Build, test, push, publish

- [ ] **Step 1: Full backend check**

```bash
cd /Users/claude-alainmartin/ibanforge
npm run build && npm test && npm run lint
```

- [ ] **Step 2: Push backend**

```bash
git push
```

- [ ] **Step 3: Build and publish SDK**

```bash
cd packages/sdk
npm run build
npm publish --access public
```

Note: requires npm login with access to `@ibanforge` scope. If scope not claimed, publish as `ibanforge-sdk` instead.

- [ ] **Step 4: Verify endpoints in production**

After Railway redeploy:

```bash
# Generate a key
curl -s -X POST https://api.ibanforge.com/v1/keys/generate \
  -H "Content-Type: application/json" \
  -d '{"email":"test@ibanforge.com"}'

# Use the key
curl -s -X POST https://api.ibanforge.com/v1/iban/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ifk_xxx" \
  -d '{"iban":"CH9300762011623852957"}'

# Check usage
curl -s https://api.ibanforge.com/v1/keys/usage \
  -H "Authorization: Bearer ifk_xxx"
```

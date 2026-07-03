/**
 * IBANforge — official TypeScript/JavaScript SDK.
 *
 * Mirrors the Python SDK: API-key auth, typed error hierarchy, and full
 * endpoint coverage (validate, batch, bic, ch-clearing, compliance, format,
 * usage, key generation). Response shapes are kept in lock-step with the
 * server's src/types.ts.
 *
 *   import { IBANforge } from '@ibanforge/sdk';
 *
 *   // Free format check (no key needed)
 *   const out = await new IBANforge().formatIban('CH9300762011623852957');
 *
 *   // Authenticated calls (required for paid endpoints unless you go x402)
 *   const client = new IBANforge({ apiKey: 'ifk_...' });
 *   const r = await client.validateIban('CH9300762011623852957');
 *
 *   // Generate a free key in 1 line
 *   const key = await IBANforge.generateApiKey('you@example.com');
 */

const VERSION = '1.3.3';
const DEFAULT_BASE_URL = 'https://api.ibanforge.com';

// ─── Config ──────────────────────────────────────────────────────────────────

export interface IBANforgeConfig {
  /** ifk_* API key. Required for paid endpoints (unless paying per-call via x402). */
  apiKey?: string;
  /** Override the API base URL (default https://api.ibanforge.com). */
  baseUrl?: string;
  /** Per-request timeout in ms (default 30000). */
  timeoutMs?: number;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class IBANforgeError extends Error {
  readonly status?: number;
  readonly body?: unknown;
  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = 'IBANforgeError';
    this.status = status;
    this.body = body;
  }
}
/** 401 / 403 — missing or invalid API key. */
export class AuthError extends IBANforgeError {
  constructor(m: string, s?: number, b?: unknown) { super(m, s, b); this.name = 'AuthError'; }
}
/**
 * 402 — payment required. `accepts` carries the x402 challenge so an
 * x402-capable caller can pay and retry instead of dead-ending.
 */
export class PaymentRequiredError extends IBANforgeError {
  readonly accepts?: unknown;
  constructor(m: string, s?: number, b?: unknown) {
    super(m, s, b);
    this.name = 'PaymentRequiredError';
    this.accepts = (b && typeof b === 'object' ? (b as Record<string, unknown>).accepts : undefined);
  }
}
/** 429 — monthly key quota exhausted (the API usually falls through to 402 instead). */
export class QuotaExhaustedError extends IBANforgeError {
  constructor(m: string, s?: number, b?: unknown) { super(m, s, b); this.name = 'QuotaExhaustedError'; }
}
/** 429 — IP/transport rate limit. */
export class RateLimitError extends IBANforgeError {
  constructor(m: string, s?: number, b?: unknown) { super(m, s, b); this.name = 'RateLimitError'; }
}
/** Other 4xx — malformed input. */
export class InvalidInputError extends IBANforgeError {
  constructor(m: string, s?: number, b?: unknown) { super(m, s, b); this.name = 'InvalidInputError'; }
}
/** 5xx — server-side failure. */
export class APIError extends IBANforgeError {
  constructor(m: string, s?: number, b?: unknown) { super(m, s, b); this.name = 'APIError'; }
}

// ─── Response types (mirror src/types.ts) ────────────────────────────────────

export interface Country { code: string; name: string }
export interface BBAN { bank_code: string; branch_code?: string; account_number: string }
export interface BIC { code: string; bank_name: string | null; city: string | null }
export interface Issuer { type: 'bank' | 'digital_bank' | 'emi' | 'payment_institution'; name: string }
export interface SEPA { member: boolean; schemes: Array<'SCT' | 'SDD' | 'SCT_INST'>; vop_required: boolean }
export interface RiskIndicators {
  issuer_type: string;
  country_risk: 'standard' | 'elevated' | 'high';
  test_bic: boolean;
  sepa_reachable: boolean;
  vop_coverage: boolean;
}
export interface Clearing {
  iid: string;
  name: string;
  type: string;
  town: string | null;
  sic: boolean;
  instant_payments_chf: boolean;
  eurosic: boolean;
  qr_iid: string | null;
}

export interface IBANValidationResult {
  iban: string;
  valid: boolean;
  formatted?: string;
  country?: Country;
  check_digits?: string;
  bban?: BBAN;
  bic?: BIC | null;
  issuer?: Issuer;
  sepa?: SEPA;
  risk_indicators?: RiskIndicators;
  clearing?: Clearing | null;
  error?: string;
  error_detail?: string;
  cost_usdc: number;
  processing_ms?: number;
}

export interface IBANFormatResult {
  iban: string;
  formatted?: string;
  valid: boolean;
  country?: Country;
  check_digits?: string;
  bban?: BBAN;
  error?: string;
  error_detail?: string;
  upgrade_to_full_validation?: string;
}

export interface IBANBatchResult {
  results: IBANValidationResult[];
  count: number;
  valid_count: number;
  cost_usdc: number;
  processing_ms?: number;
}

export interface BICLookupResult {
  bic: string;
  bic8?: string;
  bic11?: string;
  found: boolean;
  valid_format: boolean;
  institution: string | null;
  country?: Country;
  city: string | null;
  branch_code?: string;
  branch_info?: string | null;
  lei: string | null;
  lei_status?: string | null;
  is_test_bic?: boolean;
  cost_usdc?: number;
  processing_ms?: number;
}

export interface CHClearingResult {
  iid: string;
  found: boolean;
  redirected_from?: string;
  institution?: { name: string; type: string; iid_type: string; headquarters_iid: string };
  address?: Record<string, string | null>;
  bic?: string | null;
  payment_services?: {
    sic: boolean; rtgs_chf: boolean; instant_payments_chf: boolean;
    eurosic: boolean; lsv_bdd_chf: boolean; lsv_bdd_eur: boolean;
  };
  sic_iid?: string | null;
  qr_iid?: string | null;
  valid_on?: string;
  note?: string;
  error?: string;
  message?: string;
  cost_usdc?: number;
}

export interface Compliance {
  sanctions: { country_sanctioned: boolean; bank_sanctioned: boolean; matched_lists: string[]; fatf_status: string };
  reachability: { sepa_instant: boolean; sct: boolean; sdd: boolean };
  vop: { participant: boolean; status: string };
  risk_score: number;
  risk_level: 'low' | 'medium' | 'elevated' | 'high' | 'critical';
  flags: string[];
}

export interface ComplianceMeta {
  /** Always 'bank_bic_only' — screening is at the bank BIC, never the beneficiary. */
  scope: 'bank_bic_only';
  disclaimer: string;
  sanctions_as_of: string | null;
  fatf_as_of: string | null;
  sources: string | null;
}

/**
 * POST /v1/iban/compliance — the validate result PLUS a nested `compliance`
 * block. There is no top-level `risk_score`; read it at `result.compliance.risk_score`.
 * Scope: sanctions screening is BANK-level (BIC8) only, not beneficiary-name —
 * see `meta.scope` / `meta.disclaimer`.
 */
export interface ComplianceResult extends IBANValidationResult {
  compliance: Compliance;
  meta?: ComplianceMeta;
}

export interface APIKey {
  api_key: string;
  key_prefix: string;
  email?: string;
  monthly_limit?: number;
  message?: string;
}

export interface APIKeyUsage {
  key_prefix: string;
  email?: string;
  monthly_limit: number;
  used_this_month: number;
  remaining: number;
  month: string;
}

export interface HealthInfo {
  status: string;
  version: string;
  uptime_seconds?: number;
  bic_database_entries: number;
  ch_clearing_entries?: number;
  bic_data_last_updated?: string;
}

// ─── Internal: map HTTP status → typed error ─────────────────────────────────

async function raiseForStatus(res: Response): Promise<void> {
  if (res.ok) return;
  let body: unknown;
  const text = await res.text();
  try { body = JSON.parse(text); } catch { body = text; }
  const o = (body && typeof body === 'object' ? body as Record<string, unknown> : {});
  const msg = String(o.message ?? o.error_detail ?? o.error ?? res.statusText ?? 'Unknown error');
  const s = res.status;
  if (s === 401 || s === 403) throw new AuthError(msg, s, body);
  if (s === 402) throw new PaymentRequiredError(msg, s, body);
  if (s === 429) {
    if (o.error === 'quota_exceeded') throw new QuotaExhaustedError(msg, s, body);
    throw new RateLimitError(msg, s, body);
  }
  if (s >= 400 && s < 500) throw new InvalidInputError(msg, s, body);
  if (s >= 500) throw new APIError(msg, s, body);
  throw new IBANforgeError(msg, s, body);
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class IBANforge {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(config: IBANforgeConfig = {}) {
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { 'User-Agent': `ibanforge-ts/${VERSION}`, ...extra };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { ...init, signal: ctrl.signal });
      await raiseForStatus(res);
      return res.json() as Promise<T>;
    } catch (err) {
      if (err instanceof IBANforgeError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new IBANforgeError(`Request timed out after ${this.timeoutMs}ms`);
      }
      throw new IBANforgeError(`Network error: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET', headers: this.headers() });
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
  }

  // ---- IBAN ----

  /** FREE pre-flight check (mod-97 + structure). No API key required. */
  formatIban(iban: string): Promise<IBANFormatResult> {
    return this.get(`/v1/iban/format?iban=${encodeURIComponent(iban)}`);
  }

  /** Validate one IBAN with full enrichment ($0.005 / call with API key). */
  validateIban(iban: string): Promise<IBANValidationResult> {
    return this.post('/v1/iban/validate', { iban });
  }

  /** Validate up to 100 IBANs in one call ($0.002 / IBAN with API key). */
  validateBatch(ibans: string[]): Promise<IBANBatchResult> {
    if (ibans.length === 0) throw new InvalidInputError('ibans must contain at least one IBAN');
    if (ibans.length > 100) throw new InvalidInputError(`ibans must be at most 100 entries (got ${ibans.length})`);
    return this.post('/v1/iban/batch', { ibans });
  }

  /**
   * Pre-flight compliance triage on an IBAN ($0.02 / call with API key).
   * Read the score at `result.compliance.risk_score`. Informational, not a
   * regulated AML/CFT product; sanctions screening is BANK-level (BIC8) only.
   */
  checkCompliance(iban: string): Promise<ComplianceResult> {
    return this.post('/v1/iban/compliance', { iban });
  }

  // ---- BIC / SWIFT ----

  /** Resolve a BIC/SWIFT code into bank, country, city, LEI ($0.003 / call). */
  lookupBic(code: string): Promise<BICLookupResult> {
    return this.get(`/v1/bic/${encodeURIComponent(code)}`);
  }

  // ---- Swiss clearing ----

  /** Resolve a Swiss BC-Nummer / IID into institution data ($0.003 / call). */
  lookupChClearing(iid: string | number): Promise<CHClearingResult> {
    return this.get(`/v1/ch/clearing/${encodeURIComponent(String(iid))}`);
  }

  // ---- API keys ----

  /** Create a free API key (200 requests/month). The key is shown ONCE. */
  static async generateApiKey(email: string, config: { baseUrl?: string; timeoutMs?: number } = {}): Promise<APIKey> {
    return new IBANforge(config).post('/v1/keys/generate', { email });
  }

  /** Current month's quota usage for the configured API key. */
  usage(): Promise<APIKeyUsage> {
    if (!this.apiKey) throw new AuthError("usage() requires an API key — pass { apiKey: 'ifk_...' } to the constructor");
    return this.get('/v1/keys/usage');
  }

  // ---- Misc ----

  /** Public health endpoint — version, BIC count, uptime. */
  health(): Promise<HealthInfo> {
    return this.get('/health');
  }
}

export default IBANforge;

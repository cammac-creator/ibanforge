/**
 * IBANforge — official TypeScript/JavaScript SDK.
 *
 * Mirrors the Python SDK: API-key auth, typed error hierarchy, and coverage of
 * every public endpoint (validate, batch, bic, ch-clearing, compliance, format,
 * structures, test IBANs, demo, credit bundles, usage, key generation).
 * Response shapes are kept in lock-step with the server's src/types.ts.
 *
 *   import { IBANforge } from '@ibanforge/sdk';
 *
 *   // Free format check (no key needed)
 *   const out = await new IBANforge().formatIban('CH1000230000000012345');
 *
 *   // Authenticated calls (required for paid endpoints unless you go x402)
 *   const client = new IBANforge({ apiKey: 'ifk_...' });
 *   const r = await client.validateIban('CH1000230000000012345');
 *
 *   // Generate a free key in 1 line
 *   const key = await IBANforge.generateApiKey('you@company.com');
 *
 * ⚠️ The IBAN above is not decoration. `CH9300762011623852957` — the SWIFT
 * registry's illustration, which every quickstart reaches for — carries a bank
 * code no institution holds, so it comes back with `bic: null` and
 * `clearing: null`. Demonstrating BIC or Swiss clearing on it prints
 * `undefined`, which is exactly how the 1.3.3 README shipped for six weeks.
 * Use a register-allocated code, or GET /v1/test-iban, which mints one.
 */

const VERSION = '1.5.0';
const DEFAULT_BASE_URL = 'https://api.ibanforge.com';

/**
 * Read an env var without assuming there is an environment: this package runs
 * in browsers and edge runtimes where `process` is simply not defined, and an
 * unguarded read there throws at import time.
 */
function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface IBANforgeConfig {
  /**
   * ifk_* API key. Required for paid endpoints (unless paying per-call via
   * x402). Falls back to the `IBANFORGE_API_KEY` environment variable — the
   * same name the MCP server reads, so one variable configures both.
   */
  apiKey?: string;
  /**
   * Override the API base URL (default https://api.ibanforge.com). Falls back
   * to `IBANFORGE_API_BASE`, which is what points the SDK at a local server in
   * tests and at a staging deployment in CI.
   */
  baseUrl?: string;
  /** Per-request timeout in ms (default 30000). */
  timeoutMs?: number;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class IBANforgeError extends Error {
  readonly status?: number;
  readonly body?: unknown;
  /**
   * The API's machine-readable error slug (`invalid_key`, `disposable_email`,
   * `verification_required`, `rate_limited`, …), lifted out of the response
   * body. `body` stays `unknown` on purpose — it is caller-supplied JSON — so
   * without this an agent had to cast before it could branch, and every
   * documented example was a type assertion that no copy-paste survives.
   */
  readonly code?: string;
  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = 'IBANforgeError';
    this.status = status;
    this.body = body;
    const slug = body && typeof body === 'object' ? (body as Record<string, unknown>).error : undefined;
    this.code = typeof slug === 'string' ? slug : undefined;
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
/**
 * 413 — the request body is over the API's limit (1 MB, and a batch is capped
 * at 100 IBANs before that).
 *
 * Broken out of `InvalidInputError` on 2026-09-01 (audit DX-09): 413 is a
 * distinct, reproducible answer with a distinct remedy — split the payload —
 * and a caller that catches "malformed input" retries the same body forever.
 */
export class PayloadTooLargeError extends IBANforgeError {
  constructor(m: string, s?: number, b?: unknown) { super(m, s, b); this.name = 'PayloadTooLargeError'; }
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
/**
 * Registered / head-office address as GLEIF files it.
 *
 * Was typed `Record<string, string | null>` on the lookup result, which type
 * checks but tells a caller nothing: neither `type` nor `romanization` is a
 * free string, and no field name was discoverable. Spelled out here and shared
 * by both results, because the API builds it from one helper.
 */
export interface RegisteredAddress {
  type: 'registered';
  street: string | null;
  post_code: string | null;
  region: string | null;
  city: string | null;
  country: string;
  /**
   * Latin reading: GLEIF's official English form for a non-Latin entity, or the
   * address itself when already Latin. Null when the entity is non-Latin and
   * GLEIF ships no Latin form — a transliteration is never invented.
   */
  romanized: string | null;
  romanization: 'original_latin' | 'gleif_english' | 'unavailable';
  source: string;
  language: string | null;
  /**
   * When the entity last filed this address. Frequently a year old, and NOT the
   * `as_of` on the BIC beside it — that one dates the monthly directory refresh.
   */
  as_of: string | null;
}

export interface BIC {
  code: string;
  bank_name: string | null;
  /**
   * Where the consulted register places THIS bank code. May legitimately differ
   * from `address.city`, which is the legal seat: German BLZ 37040044 resolves
   * to Commerzbank in Köln while the entity is registered in Frankfurt. Both
   * true, different questions.
   */
  city: string | null;
  /** Which directory this row came from (GLEIF, SIX, a curated map, …). */
  source?: string;
  /** Month the source was last refreshed. */
  as_of?: string;
  /**
   * Where the bank code → BIC pairing came from. `source` names the dataset;
   * this says what KIND of source it is, which is the half a payment engine can
   * branch on. Only `national_register` is settlement-grade.
   */
  basis?: 'national_register' | 'curated_map' | 'directory_prefix';
  /**
   * Whether this BIC may be stored and settled against. Derived from `basis`.
   * NOT `bank_code_check.authoritative`, which answers whether a register was
   * consulted about the BANK CODE — in Switzerland it confirms the code while
   * this BIC still comes from the curated map.
   */
  authoritative?: boolean;
  /**
   * Legal Entity Identifier of the resolved institution.
   *
   * Served by `/v1/iban/validate` since 1.4.4 — before that it lived only on
   * `/v1/bic/:code`, so callers paid a second lookup for a field the first call
   * had already read. Null means GLEIF publishes no LEI for this BIC, never
   * that the institution has none.
   */
  lei?: string | null;
  lei_status?: string | null;
  /** Null for a branch BIC: only head-office rows carry a registered address. */
  address?: RegisteredAddress | null;
}
export interface Issuer {
  type: 'bank' | 'digital_bank' | 'emi' | 'payment_institution';
  name: string;
  classification?: string;
}
export interface SEPA {
  member: boolean;
  schemes: Array<'SCT' | 'SDD' | 'SCT_INST'>;
  vop_required: boolean;
  /** null when the institution is unknown — absence of data, not a "no". */
  vop_participant?: boolean | null;
}
export interface RiskIndicators {
  issuer_type: string | null;
  country_risk: 'standard' | 'elevated' | 'high';
  test_bic: boolean;
  sepa_reachable: boolean;
  /** 'country' when reachability is inferred from the zone, not the institution. */
  sepa_reachable_scope?: string;
  vop_coverage: boolean;
}

/**
 * Is this bank code actually allocated in the national register?
 *
 * The product's sharpest answer, and the one competitors get wrong: an IBAN can
 * pass mod-97 and still name a bank that does not exist. `status:
 * 'not_in_register'` with `authoritative: true` means do not send — openiban
 * calls the same IBAN outright invalid, which is a different (and wrong) claim.
 */
export interface BankCodeCheck {
  value: string;
  /**
   * `unknown` and `no_register` were in this union and have never been served
   * by the API: the third state has always been `unavailable`. A typed client
   * switching on the documented values fell through on every real one.
   */
  status: 'verified' | 'not_in_register' | 'unavailable';
  /**
   * Why the verdict is not `verified`, present on every other status. The one
   * value that licenses stopping a payment is `not_allocated`, and it only ever
   * comes with `authoritative: true`. `national_register_unavailable` and
   * `lookup_failed` describe IBANforge, not the beneficiary.
   */
  reason?:
    | 'not_allocated'
    | 'absent_from_reference_data'
    | 'no_reference_data_for_country'
    | 'register_names_no_holder'
    | 'national_register_unavailable'
    | 'lookup_failed';
  match: string | null;
  register: string | null;
  /** true only when the register is the country's official one. */
  authoritative: boolean;
  institution?: Record<string, string | null>;
  as_of?: string;
}

/** What the API suggests doing next, given this exact verdict. */
export interface NextStep {
  code: string;
  do: string;
  because: string;
  action?: string;
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
  qr_iid_source?: string;
  /** An institution can hold several QR-IIDs; `qr_iid` is the first. */
  qr_iids?: string[];
}

export interface IBANValidationResult {
  iban: string;
  valid: boolean;
  formatted?: string;
  country?: Country;
  check_digits?: string;
  bban?: BBAN;
  /** null when no directory knows the bank code — check `bank_code_check`. */
  bic?: BIC | null;
  issuer?: Issuer;
  sepa?: SEPA;
  risk_indicators?: RiskIndicators;
  bank_code_check?: BankCodeCheck;
  /** Swiss/Liechtenstein IBANs only, and only when the IID is allocated. */
  clearing?: Clearing | null;
  next_steps?: NextStep[];
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
  /** The bank's name. Named `institution` here, `bic.bank_name` on validate. */
  institution: string | null;
  country?: Country;
  city: string | null;
  /** Registered address, when GLEIF carries one. @see RegisteredAddress */
  address?: RegisteredAddress | null;
  address_available?: boolean;
  branch_code?: string;
  branch_info?: string | null;
  lei: string | null;
  lei_status?: string | null;
  is_test_bic?: boolean;
  source?: string;
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
  qr_iid_source?: string;
  qr_iids?: string[];
  valid_on?: string;
  note?: string;
  error?: string;
  message?: string;
  cost_usdc?: number;
  processing_ms?: number;
}

export interface Compliance {
  /**
   * `bank_screened: false` means the screening did not run (no bank could be
   * identified), never that the bank came back clean. Same for the other
   * `screened` flags: absence of a verdict, not a favourable one.
   */
  sanctions: {
    country_sanctioned: boolean;
    bank_sanctioned: boolean;
    matched_lists: string[];
    fatf_status: string;
    bank_screened?: boolean;
  };
  reachability: { sepa_instant: boolean; sct: boolean; sdd: boolean; screened?: boolean };
  vop: { participant: boolean; status: string; screened?: boolean };
  /** null when the IBAN did not validate: there was nothing to score. */
  risk_score: number | null;
  /**
   * 'unassessable' means the IBAN itself failed validation, so no screening was
   * possible. It is the absence of a verdict, never a favourable one: do not
   * fold it into a "safe to pay" branch.
   */
  risk_level: 'low' | 'medium' | 'elevated' | 'high' | 'critical' | 'unassessable';
  flags: string[];
}

export interface ComplianceMeta {
  /** Always 'bank_bic_only' — screening is at the bank BIC, never the beneficiary. */
  scope: 'bank_bic_only';
  disclaimer: string;
  sanctions_as_of: string | null;
  fatf_as_of: string | null;
  sources: string | null;
  country_risk_as_of?: string | null;
  /** Says in prose why `risk_indicators.country_risk` and `fatf_status` can disagree. */
  country_risk_scope?: string;
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
  /** Shown once, never again. Store it before the process exits. */
  api_key: string;
  key_prefix: string;
  email?: string;
  monthly_limit?: number;
  message?: string;
  terms_url?: string;
}

/**
 * GET /v1/keys/usage.
 *
 * ⚠️ Renamed in 1.4.3, because 1.3.3 declared fields the API has never sent:
 * `monthly_limit` / `used_this_month` were `limit` / `used` on the wire.
 * TypeScript could not catch it — the shape was simply invented — so the code
 * compiled and printed `undefined`.
 */
export interface APIKeyUsage {
  key_prefix: string;
  /** Calls consumed this calendar month. */
  used: number;
  /** Monthly quota for this key (200 on the free tier). */
  limit: number;
  remaining: number;
  /** 'YYYY-MM' of the quota window. */
  month: string;
}

export interface HealthInfo {
  status: string;
  version: string;
  uptime_seconds?: number;
  bic_database_entries: number;
  ch_clearing_entries?: number;
  bic_data_last_updated?: string;
  databases?: Record<string, string>;
}

/** GET /v1/iban/structure — every country the API can parse. Free. */
export interface IBANStructureList {
  total: number;
  countries: Array<{
    code: string;
    name: string;
    iban_length: number;
    sepa_member: boolean;
    has_bban_structure: boolean;
    has_example: boolean;
  }>;
  endpoint_per_country: string;
  cost_usdc?: number;
}

/** GET /v1/iban/structure/:country — one country's BBAN template. Free. */
export interface IBANStructure {
  country: Country;
  iban_length: number;
  bban_length: number;
  bban: Record<string, { start: number; length: number; charset: string }>;
  bban_pattern: string;
  sepa?: SEPA;
  example_iban?: string;
  /** Warns that the registry's example may carry an unallocated bank code. */
  example_iban_note?: string;
  notes?: string;
  upgrade_hint?: string;
  cost_usdc?: number;
}

/**
 * GET /v1/test-iban — structurally valid IBANs whose BANK CODE is real
 * (drawn from the national register we serve) and whose account digits are
 * random. The `proof` block carries the register row, so a reviewer can check
 * the claim instead of believing it.
 */
export interface TestIbanResult {
  test_ibans: Array<{
    iban: string;
    formatted: string;
    country: string;
    proof: { bank_code_check: BankCodeCheck; bic?: BIC | null };
    note: string;
  }>;
  disclaimer: string;
  docs?: string;
  cost_usdc?: number;
}

/** GET /v1/credits/bundles — prepaid packs, free to list. */
export interface CreditBundleList {
  bundles: Array<{
    slug: string;
    credits: number;
    price_usdc: number;
    price_per_call_usdc: number;
    buy_endpoint: string;
  }>;
  payment_method: string;
  documentation?: string;
}

/**
 * GET|POST /v1/reference/validate — a QR-bill (QRR) or ISO 11649 (RF) payment
 * reference, checked against its published check-digit rule. FREE.
 */
export interface ReferenceValidationResult {
  /** Uppercased, separators removed: what was actually judged. */
  reference: string;
  /** Null when nothing recognised the string. */
  scheme: string | null;
  /**
   * Null is a real answer, not a missing one: Norwegian KID and Swedish OCR are
   * configured per creditor account by the beneficiary's bank, so `false` there
   * would reject perfectly good references.
   */
  valid: boolean | null;
  status: string;
  /** A STRING, because an OGM remainder can legitimately start with a zero. */
  check_digit_expected?: string;
  /** The dated document the rule was read from. Keep it when relaying. */
  source: string | null;
  as_of?: string;
  note: string;
  /** Set when the same digits also satisfy another country's length rule. */
  also_valid_as?: { scheme: string; valid: boolean; note?: string };
  /** What the paid pairing check adds, and what it costs. */
  pairing_verdict?: string;
}

/** One rule applied by POST /v1/address/check, with the guideline it comes from. */
export interface AddressFinding {
  rule: string;
  verdict: 'pass' | 'fail' | 'not_applicable' | string;
  detail: string;
  source: string;
}

/**
 * POST /v1/address/check — a structured ISO 20022 postal address measured
 * against a payment scheme's rules. FREE.
 */
export interface AddressCheckResult {
  scheme: string;
  conforms: boolean;
  findings: AddressFinding[];
  note?: string;
}

/** The ISO 20022 address tags the checker reads. */
export interface PostalAddress {
  twn_nm?: string;
  ctry?: string;
  pst_cd?: string;
  strt_nm?: string;
  bldg_nb?: string;
  adr_tp?: string;
  adr_line?: string[];
  [tag: string]: unknown;
}

/** GET /v1/demo — worked examples, no key, no payment. */
export interface DemoResult {
  message: string;
  iban_examples?: IBANValidationResult[];
  bic_examples?: BICLookupResult[];
  compliance_example?: unknown;
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
  if (s === 413) throw new PayloadTooLargeError(msg, s, body);
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
    // Explicit config wins, then the environment, then production. Resolved per
    // instance rather than at module load so a test (or a process that sets the
    // variable late) is not fighting an import-time snapshot.
    this.baseUrl = (config.baseUrl || readEnv('IBANFORGE_API_BASE') || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.apiKey = config.apiKey ?? readEnv('IBANFORGE_API_KEY');
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

  // ---- Reference data (all FREE, no key needed) ----

  /** Every country the API can parse, with its IBAN length. FREE. */
  ibanStructures(): Promise<IBANStructureList> {
    return this.get('/v1/iban/structure');
  }

  /** One country's BBAN template — field offsets, lengths, charsets. FREE. */
  ibanStructure(country: string): Promise<IBANStructure> {
    return this.get(`/v1/iban/structure/${encodeURIComponent(country)}`);
  }

  /**
   * Test IBANs whose bank code is REALLY allocated, with the register row that
   * proves it. FREE.
   *
   * Use this instead of the SWIFT registry's illustration for fixtures and
   * demos: that one's bank code belongs to nobody, so every enrichment field
   * comes back null and your test looks like the API failed.
   */
  testIban(options: { country?: string; count?: number } = {}): Promise<TestIbanResult> {
    const q = new URLSearchParams();
    if (options.country) q.set('country', options.country);
    if (options.count !== undefined) q.set('count', String(options.count));
    const suffix = q.toString();
    return this.get(`/v1/test-iban${suffix ? `?${suffix}` : ''}`);
  }

  /**
   * Check a QR-bill (QRR), ISO 11649 (RF/SCOR), Belgian OGM/VCS or Finnish
   * payment reference against the dated document that publishes its rule. FREE.
   *
   * This checks the reference ALONE. The pairing verdict — whether that
   * reference may legally travel with a given account under the Swiss Payment
   * Standards — is the paid half: send a `reference` field to
   * POST /v1/iban/validate and read `reference_check.pairing`.
   *
   * The route also answers POST with the same body fields; GET is used here
   * because a reference is short enough to travel in a query string and a GET
   * is cacheable.
   */
  validateReference(
    reference: string,
    options: { referenceType?: string } = {},
  ): Promise<ReferenceValidationResult> {
    const q = new URLSearchParams({ reference });
    if (options.referenceType) q.set('reference_type', options.referenceType);
    return this.get(`/v1/reference/validate?${q.toString()}`);
  }

  /**
   * Check a structured ISO 20022 postal address against a scheme's rules
   * (`sps`, `hvps_plus`, `fedwire`). FREE.
   *
   * Every finding names the guideline it was read from: relay `source` with the
   * verdict rather than the boolean alone.
   */
  checkAddress(scheme: string, address: PostalAddress): Promise<AddressCheckResult> {
    return this.post('/v1/address/check', { scheme, address });
  }

  /** Prepaid credit packs and their per-call price. FREE to list. */
  creditBundles(): Promise<CreditBundleList> {
    return this.get('/v1/credits/bundles');
  }

  /** Worked examples of every endpoint, no key and no payment. FREE. */
  demo(): Promise<DemoResult> {
    return this.get('/v1/demo');
  }

  // ---- API keys ----

  /**
   * Create a free API key (200 requests/month). The key is shown ONCE.
   *
   * Use a real mailbox: fictional and disposable domains (`example.com`,
   * `mailinator`, …) are refused with `disposable_email`. A second key from the
   * same network within seven days answers 403 `verification_required` and
   * mails a six-digit code — repeat the call as `{ email, code }` to claim it.
   */
  static async generateApiKey(
    email: string,
    config: { baseUrl?: string; timeoutMs?: number; code?: string } = {},
  ): Promise<APIKey> {
    const { code, ...clientConfig } = config;
    const body: { email: string; code?: string } = { email };
    if (code) body.code = code;
    return new IBANforge(clientConfig).post('/v1/keys/generate', body);
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

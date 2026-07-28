/**
 * IBANforge — Unified types for IBAN validation + BIC lookup
 */

// --- Hono context variables ---

/**
 * Why a request is about to fall through to the 402 paywall. Set by the
 * api-key middleware, injected into the 402 body by enrich-402 — so a client
 * whose key is exhausted or invalid is told the actual cause instead of a
 * generic "payment required" (which reads as "anonymous" to MCP clients).
 */
export interface PaywallCause {
  reason:
    | 'monthly_quota_exhausted'
    | 'monthly_quota_insufficient'
    | 'credits_exhausted'
    | 'credits_insufficient'
    | 'invalid_api_key';
  detail: string;
  // required/remaining: batch billing (1 unit per IBAN) can refuse a request
  // all-or-nothing while some allowance is left — these say how much.
  quota?: { used: number; limit: number; month: string; resets: string; required?: number; remaining?: number };
  credits?: { required?: number; remaining?: number; total: number; topup: string };
}

type HonoEnv = {
  Variables: {
    apiKeyAuthenticated: boolean;
    apiKeyPrefix: string | null;
    paywallCause?: PaywallCause;
  };
};

export type { HonoEnv };

// --- Operation tracking ---

export type OperationType = 'iban_validate' | 'iban_batch' | 'bic_lookup' | 'iban_compliance' | 'ch_clearing_lookup' | 'iban_format';

// --- IBAN Validation ---

export interface IBANValidationResult {
  iban: string;
  valid: boolean;
  country?: {
    code: string;
    name: string;
  };
  check_digits?: string;
  bban?: {
    bank_code: string;
    branch_code?: string;
    account_number: string;
  };
  bic?: {
    code: string;
    bank_name: string | null;
    city: string | null;
  } | null;
  sepa?: {
    member: boolean;
    schemes: Array<'SCT' | 'SDD' | 'SCT_INST'>;
    vop_required: boolean;
  };
  issuer?: {
    type: 'bank' | 'digital_bank' | 'emi' | 'payment_institution';
    name: string;
  };
  risk_indicators?: {
    issuer_type: 'bank' | 'digital_bank' | 'emi' | 'payment_institution';
    country_risk: 'standard' | 'elevated' | 'high';
    test_bic: boolean;
    sepa_reachable: boolean;
    vop_coverage: boolean;
  };
  clearing?: ChClearingSummary | null;
  formatted?: string;
  error?: 'invalid_format' | 'unsupported_country' | 'wrong_length' | 'checksum_failed' | 'invalid_check_digits' | 'invalid_bban_structure';
  error_detail?: string;
  cost_usdc: number;
  processing_ms?: number;
}

export interface BatchValidationRequest {
  ibans: string[];
}

// --- BIC Validation & Lookup ---

export interface BICValidationResult {
  bic: string;
  valid: boolean;
  bic8?: string;
  bic11?: string;
  institution_code?: string;
  country_code?: string;
  location_code?: string;
  branch_code?: string;
  is_test_bic?: boolean;
  error?: string;
}

export interface BICLookupResult {
  bic: string;
  bic8: string;
  bic11: string;
  found: boolean;
  valid_format: boolean;
  institution: string | null;
  country: {
    code: string;
    name: string;
  };
  city: string | null;
  /**
   * Registered / head-office address (GLEIF, CC0). Entity-level, NOT per-branch:
   * a branch (non-XXX) BIC returns its head-office address. Null when the BIC
   * carries no LEI/address or is a foreign branch (suppressed by the
   * same-country guard).
   */
  address: {
    type: 'registered';
    street: string | null;
    post_code: string | null;
    region: string | null;
    city: string | null;
    country: string;
    /**
     * Latin reading of the address: GLEIF's official English alternative for
     * non-Latin entities, or the address itself when already Latin. Null when
     * the entity is non-Latin and GLEIF ships no official Latin form — we never
     * fabricate a transliteration (see `romanization`).
     */
    romanized: string | null;
    /**
     * Provenance of the Latin reading, so a consumer knows whether to trust it
     * and why it may be absent:
     *  - 'original_latin' — the registered address is itself in Latin script.
     *  - 'gleif_english'  — `romanized` is GLEIF's official English address.
     *  - 'unavailable'    — non-Latin entity with no official Latin form; not
     *                       fabricated, so `romanized` is null.
     */
    romanization: 'original_latin' | 'gleif_english' | 'unavailable';
    source: string;
    language: string | null;
    as_of: string | null;
  } | null;
  address_available: boolean;
  branch_code: string;
  branch_info: string | null;
  lei: string | null;
  lei_status: string | null;
  is_test_bic: boolean;
  source: string | null;
  note?: string;
  cost_usdc: number;
  processing_ms?: number;
}

// --- Health / Stats ---

export interface HealthResponse {
  status: 'ok';
  version: string;
  uptime_seconds: number;
  stats: {
    total_operations: number;
    iban_validations: number;
    bic_lookups: number;
    success_rate: number;
  };
}

export interface StatsOverview {
  total_requests: number;
  requests_today: number;
  requests_by_path: Array<{ path: string; count: number; avg_ms: number }>;
  requests_by_status: Array<{ status_group: string; count: number }>;
  total_operations: number;
  by_type: {
    iban_validate: { total: number; valid_count: number; success_rate: number };
    iban_batch: { total: number; valid_count: number; success_rate: number };
    bic_lookup: { total: number; found_count: number; hit_rate: number };
  };
  /** @deprecated use total_revenue_attempted_usdc + /admin/revenue (on-chain source of truth) */
  total_revenue_usdc: number;
  /** Sum of `revenue_usdc` recorded in daily_stats — represents x402 calls that PASSED the payment middleware verify step, NOT necessarily settled on-chain. For settled USDC see /admin/revenue. */
  total_revenue_attempted_usdc: number;
  revenue_note: string;
  top_countries: Array<{ country: string; count: number }>;
  last_7_days: Array<{ date: string; total: number; revenue: number }>;
}

// --- Dashboard v2: Hourly / Error / Pattern stats ---

export interface HourlyHeatmapEntry { day: number; hour: number; total: number; }
export interface HourlyStatsResponse {
  heatmap: HourlyHeatmapEntry[];
  peak_hours: { start: number; end: number; days: number[] };
  weekend_drop_pct: number;
}

export interface ErrorStatsResponse {
  error_rate: {
    iban_validate: { rate: number; trend: number[] };
    bic_lookup: { rate: number; trend: number[] };
  };
  top_invalid_ibans: Array<{ prefix: string; country: string; count: number; error_type: string }>;
  top_missing_bics: Array<{ bic: string; count: number; country: string }>;
  errors_by_country: Array<{ country: string; count: number }>;
}

export interface PatternStatsResponse {
  endpoint_share_trend: Array<{ date: string; iban_validate: number; iban_batch: number; bic_lookup: number }>;
  geo_trend: Array<Record<string, number | string>>;
  top_countries_list: string[];
}

// --- Compliance Bundle ---

export interface SanctionsCheck {
  country_sanctioned: boolean;
  bank_sanctioned: boolean;
  matched_lists: string[];
  fatf_status: 'member' | 'suspended' | 'grey_list' | 'black_list' | 'non_member';
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

/**
 * 'unassessable' is not a point on the scale, it is the absence of one.
 *
 * Until 28/07/2026 an IBAN that failed validation still received a score, and
 * that score was 10 / 'low': the two "we know nothing" penalties (no SEPA
 * Instant, no VoP) added up to just under the 20-point 'medium' threshold. So
 * the less the API could establish, the more reassuring its verdict. Measured
 * on production, a one-character typo took a Russian IBAN from 90 / 'critical'
 * with a sanctioned_country flag down to 10 / 'low'.
 *
 * On a pre-payout screening product the direction of the error matters more
 * than its frequency: a reassuring false negative costs a transfer, an alarming
 * false positive costs a second look. So an unvalidatable IBAN now says so.
 */
export type RiskLevel = 'low' | 'medium' | 'elevated' | 'high' | 'critical' | 'unassessable';

/** The levels the scorer can actually emit. 'unassessable' never comes from a score. */
export type ScoredRiskLevel = Exclude<RiskLevel, 'unassessable'>;

export interface ComplianceResult {
  sanctions: SanctionsCheck;
  reachability: ReachabilityCheck;
  vop: VopCheck;
  /** null when the IBAN could not be validated: there was nothing to score. */
  risk_score: number | null;
  risk_level: RiskLevel;
  flags: string[];
}

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
  /** True when the looked-up IID is a QR-IID (SIX QR-bill range 30000–31999). */
  is_qr_iid: boolean;
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
  /** Present (true) only when the looked-up IID is a QR-IID (30000–31999). */
  is_qr_iid?: boolean;
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
  /** Present (true) only for QR-IBANs (bank code in the QR-IID range 30000–31999). */
  is_qr_iid?: boolean;
}

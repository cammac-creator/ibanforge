/**
 * IBANforge — Unified types for IBAN validation + BIC lookup
 */

// --- Operation tracking ---

export type OperationType = 'iban_validate' | 'iban_batch' | 'bic_lookup';

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
  formatted?: string;
  error?: 'invalid_format' | 'unsupported_country' | 'wrong_length' | 'checksum_failed';
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
  total_operations: number;
  by_type: {
    iban_validate: { total: number; valid_count: number; success_rate: number };
    iban_batch: { total: number; valid_count: number; success_rate: number };
    bic_lookup: { total: number; found_count: number; hit_rate: number };
  };
  total_revenue_usdc: number;
  top_countries: Array<{ country: string; count: number }>;
  last_7_days: Array<{ date: string; total: number; revenue: number }>;
}

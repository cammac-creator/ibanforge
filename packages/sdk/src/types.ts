/**
 * @ibanforge/sdk — Exported types aligned with the IBANforge API responses
 */

// --- Country ---

export interface Country {
  code: string;
  name: string;
}

// --- BBAN ---

export interface BBAN {
  bank_code: string;
  branch_code?: string;
  account_number: string;
}

// --- BIC info (embedded in IBAN validation result) ---

export interface BICInfo {
  code: string;
  bank_name: string | null;
  city: string | null;
}

// --- SEPA info ---

export interface SEPAInfo {
  member: boolean;
  schemes: Array<'SCT' | 'SDD' | 'SCT_INST'>;
  vop_required: boolean;
}

// --- Issuer info ---

export interface IssuerInfo {
  type: 'bank' | 'digital_bank' | 'emi' | 'payment_institution';
  name: string;
}

// --- Risk indicators ---

export interface RiskIndicators {
  issuer_type: 'bank' | 'digital_bank' | 'emi' | 'payment_institution';
  country_risk: 'standard' | 'elevated' | 'high';
  test_bic: boolean;
  sepa_reachable: boolean;
  vop_coverage: boolean;
}

// --- IBAN Validation ---

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
  error?: 'invalid_format' | 'unsupported_country' | 'wrong_length' | 'checksum_failed';
  error_detail?: string;
  cost_usdc: number;
  processing_ms?: number;
}

// --- Batch Validation ---

export interface BatchValidationResult {
  results: IBANValidationResult[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
  };
  cost_usdc: number;
  processing_ms?: number;
}

// --- BIC Lookup ---

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
  note?: string;
  cost_usdc: number;
  processing_ms?: number;
}

// --- Compliance ---

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

export interface ComplianceData {
  sanctions: SanctionsCheck;
  reachability: ReachabilityCheck;
  vop: VopCheck;
  risk_score: number;
  risk_level: RiskLevel;
  flags: string[];
}

export interface ComplianceCheckResult extends IBANValidationResult {
  compliance: ComplianceData;
}

// --- Usage ---

export interface UsageResult {
  used: number;
  limit: number;
  remaining: number;
  month: string;
  key_prefix: string;
}

// --- Error ---

export class IBANforgeError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'IBANforgeError';
    this.status = status;
    this.code = code;
  }
}

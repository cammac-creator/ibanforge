/**
 * IBANforge — Unified types for IBAN validation + BIC lookup
 */
import type { UkModulusResult } from './lib/uk-modulus.js';

export type { UkModulusResult };

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
    /** Set by the MCP route when the request carries tools/call invocations, so the stats middleware can split real usage from discovery handshakes. */
    mcpToolCall?: boolean;
  };
};

export type { HonoEnv };

// --- Operation tracking ---

export type OperationType = 'iban_validate' | 'iban_batch' | 'bic_lookup' | 'iban_compliance' | 'ch_clearing_lookup' | 'iban_format';

// --- IBAN Validation ---

/**
 * A separate verdict on the BBAN bank code, so that `bic: null` stops carrying
 * three different meanings at once.
 *
 * `valid` answers ISO 13616 — structure and mod-97 arithmetic. It says nothing
 * about whether the bank code inside the BBAN identifies anything. A payee
 * pre-flight needs that second answer, and needs to know how much weight it may
 * put on it, which is what `authoritative` and `match` are for.
 *
 * The status values are deliberately not `found` / `not_found`. For 87 of the 89
 * IBAN countries our reference data is a composite map assembled from BIC
 * directories, not the national bank-code register, so an absence there is
 * evidence of nothing more than absence. Switzerland and Liechtenstein are
 * checked against the register itself (SIX BankMaster) and Germany against the
 * Bundesbank Bankleitzahlendatei, and only there does `not_in_register` mean
 * the code is not allocated. That is what `authoritative`
 * marks, and it is the flag to branch on.
 */
export interface BankCodeCheck {
  /** The bank code taken from the BBAN, echoed so the caller can log it. */
  value: string;
  /**
   * - `verified` — the bank code resolves to an institution we can name.
   * - `not_in_register` — it does not, in reference data we do hold for this
   *   country. Actionable as non-existence only when `authoritative` is true.
   * - `unavailable` — we hold no reference data for this country. No opinion.
   */
  status: 'verified' | 'not_in_register' | 'unavailable';
  /**
   * How the answer was obtained, when there is one.
   * - `register` — exact key in the reference set. Deterministic.
   * - `prefix` — the fallback `bic8 LIKE bank_code%` search. Only reachable in
   *   the 30 countries whose bank code may open on a letter, since a BIC8 always
   *   does; see `candidates` for how many institutions the prefix matched.
   */
  match: 'register' | 'prefix' | null;
  /** Human name of the reference set that was consulted. */
  register: string | null;
  /** True only where that reference set is the national register. */
  authoritative: boolean;
  /**
   * Number of BIC8 the prefix search matched. Present only for `match: 'prefix'`.
   * Greater than 1 means the returned BIC is one of several and may belong to a
   * different institution than the account does.
   */
  candidates?: number;
  /**
   * The register marks the code for deletion: the institution is being retired.
   * Present only when true, and only from an authoritative register. A retired
   * code WAS allocated, so answering `not_in_register` for it would be a worse
   * lie than answering `verified` without qualification.
   */
  retired?: true;
  /** The bank code that takes over, when the register names one. */
  superseded_by?: string;
  /**
   * What the national register publishes about the allocated institution.
   * Present only on an authoritative answer: a composite-map hit stays bare
   * on purpose (naming a BIC holder is the `bic` block's job, and promoting
   * its address here would imply a register we did not consult). Depth varies
   * by register — SIX and the OeNB publish full street addresses, the
   * Bundesbank publishes postal code and town only, the BNB publishes names
   * alone. Absent fields are null, never guessed. Finland stays without this
   * block entirely: its codes are allocated to banking groups, and a group
   * has no branch address to publish.
   */
  institution?: RegisterInstitution;
  /** Year-month the consulted reference set was last refreshed. */
  as_of: string;
}

/**
 * Registered / head-office address as GLEIF files it (CC0).
 *
 * Entity-level, never per-branch: the branch guard runs at seed time
 * (`addressMatchesBic`), so a directory row that carries an address has already
 * earned it. Shared verbatim by `/v1/bic/:code` and `/v1/iban/validate` — one
 * shape from one builder, so the two endpoints cannot drift apart on the same
 * row.
 */
export interface RegisteredAddressBlock {
  type: 'registered';
  street: string | null;
  post_code: string | null;
  region: string | null;
  city: string | null;
  country: string;
  /**
   * Latin reading: GLEIF's official English alternative for non-Latin entities,
   * or the address itself when already Latin. Null when the entity is non-Latin
   * and GLEIF ships no official Latin form — a transliteration is never invented.
   */
  romanized: string | null;
  romanization: 'original_latin' | 'gleif_english' | 'unavailable';
  source: string;
  language: string | null;
  /** When the entity last filed this address. Often much older than the BIC set. */
  as_of: string | null;
}

/** What a national bank-code register publishes about an allocated institution. */
export interface RegisterInstitution {
  name: string;
  /** One line, house number included, matching the GLEIF shape. */
  street: string | null;
  post_code: string | null;
  town: string | null;
  country: string;
  /** Legal Entity Identifier, where the register publishes one (OeNB does). */
  lei?: string | null;
}

import type { NextStep } from './lib/next-steps.js';

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
  /** @see RegisteredAddressBlock */
  bic?: {
    code: string;
    bank_name: string | null;
    city: string | null;
    /**
     * Which dataset named this institution, in the same spirit as
     * `bank_code_check.register` and `modulus_check.source`. This block was the
     * only served field carrying no provenance at all, while two thirds of the
     * directory comes from a redistributed SWIFT scrape and one third from
     * GLEIF — a distinction an auditor weighing the answer needs.
     */
    source?: string | null;
    /** Year-month that dataset was last refreshed. Null rather than invented. */
    as_of?: string | null;
    /**
     * Legal Entity Identifier of the resolved institution, and whether GLEIF
     * still considers it active.
     *
     * The directory has carried these since the first GLEIF seed, and
     * `/v1/bic/:code` has always served them, while this block stopped at the
     * city — so a caller who validated an IBAN had to pay a second lookup for a
     * field already read out of the same row. Measured 22/08/2026: of the 89
     * countries whose example resolves a BIC, 55 reach a directory row and 47
     * of those rows carry a LEI. Density is very uneven by country (GB 78 % of
     * rows, IT 9 %), so absence here is normal and means exactly "GLEIF has no
     * LEI on this BIC", never "this institution has none".
     */
    lei?: string | null;
    lei_status?: string | null;
    /**
     * Registered / head-office address, entity-level and NOT per-branch, built
     * by the same helper `/v1/bic/:code` uses.
     *
     * ⚠️ Always carries its own `source` and `as_of`, and they are not the
     * `as_of` above: the BIC reference set is refreshed monthly, while a GLEIF
     * address is only as fresh as the entity's last filing — commonly a year
     * old. Serving the address without its date would make it look as current
     * as the bank name beside it.
     *
     * ⚠️ `address.city` may legitimately differ from `city` above, and the
     * difference is information rather than a defect. `city` is where the
     * consulted register places THIS bank code; `address.city` is where the
     * legal entity is registered. German BLZ 37040044 resolves to Commerzbank
     * in Köln while the entity's registered seat is Frankfurt am Main — both
     * true, one per bank code, the other per legal entity. A consumer picking
     * one should pick by which question it is answering, not by which looks
     * more precise.
     */
    address?: RegisteredAddressBlock | null;
  } | null;
  sepa?: {
    member: boolean;
    schemes: Array<'SCT' | 'SDD' | 'SCT_INST'>;
    vop_required: boolean;
    /**
     * Bank-level VoP readiness: true when the resolved institution is listed
     * as "ready" in the EPC Verification of Payee scheme register; false when
     * it is not; null when no institution was resolved (no subject, no claim).
     * Listing means the bank answers VoP requests — it does not run the name
     * check for you and says nothing about a specific account.
     */
    vop_participant?: boolean | null;
  };
  issuer?: {
    /**
     * Null when we hold no support for a type. Falling back to 'bank' would be
     * an assertion, and a payee pre-flight must not be handed one.
     */
    type: 'bank' | 'digital_bank' | 'emi' | 'payment_institution' | null;
    name: string;
    /**
     * Whether the country's own list of IBAN-issuing providers names the holder
     * of this bank code. Present only where such a list exists (today NL).
     *
     * - `confirmed` — the identifier belongs to a provider that issues IBANs.
     * - `not_listed` — it resolves to a BIC, but the holder is not among the
     *   known issuers, so it may issue no IBANs at all. NOT a denial: the Dutch
     *   list is explicitly not exhaustive.
     */
    iban_issuer?: 'confirmed' | 'not_listed';
    /**
     * Whether the type was established or assumed.
     * - `curated` — the BIC8 is in the issuer set; this is an identification.
     * - `default` — nothing is on file, so 'bank' is what we fall back to. True
     *   most of the time and never established. Count only `curated` when
     *   sizing exposure to virtual IBANs.
     */
    classification: 'curated' | 'default';
  };
  risk_indicators?: {
    /**
     * Null when no institution resolved. It used to default to 'bank', which
     * asserted a type for an institution we had not found — the one reading a
     * payee pre-flight must never be given.
     */
    issuer_type: 'bank' | 'digital_bank' | 'emi' | 'payment_institution' | null;
    country_risk: 'standard' | 'elevated' | 'high';
    test_bic: boolean;
    sepa_reachable: boolean;
    /**
     * The scope `sepa_reachable` is true at. It is derived from the country, not
     * from the account, and the name alone invited an account-level reading.
     */
    sepa_reachable_scope: 'country';
    vop_coverage: boolean;
  };
  bank_code_check?: BankCodeCheck;
  /**
   * UK modulus check on the sorting code and account number a GB IBAN carries.
   * Present for GB only, and only while the reference table is loaded.
   *
   * A second checksum, independent of mod97: the IBAN check digits prove correct
   * transcription, this proves the pair is one the owning institution could have
   * issued. `passed: false` means the account cannot exist; it never makes the
   * IBAN itself invalid, so `valid` is untouched.
   */
  modulus_check?: UkModulusResult;
  /**
   * What to do next, derived from this result. Ordered: what blocks a payment
   * comes before what merely enriches it. See lib/next-steps.ts.
   */
  next_steps?: NextStep[];
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
  /**
   * Bank-level sanctions screen on this BIC8.
   *
   * Present on every answer, including `found: false`. That combination is the
   * reason the block exists: a bank a sanctions authority has designated but
   * our directory cannot name used to come back as a plain "not found", which
   * is the most reassuring answer this endpoint can give about the least
   * reassuring institution it knows. Measured 21/08/2026, 33 designated BICs
   * were in exactly that position.
   *
   * This is a WARNING, not a compliance report: it says nothing about the
   * country, FATF, or a beneficiary. Full screening is /v1/iban/compliance.
   */
  sanctions: {
    /** False when the sanctions database could not be read; `listed` is then null. */
    screened: boolean;
    /** Null when not screened — never `false`, which would be a claim we cannot make. */
    listed: boolean | null;
    /** Which lists matched, e.g. ["OFAC"], ["EU"]. Empty when clean or unscreened. */
    matched_lists: string[];
  };
  note?: string;
  cost_usdc: number;
  processing_ms?: number;
}

/**
 * Compliance screening keyed on a BIC instead of an IBAN.
 *
 * Why this exists: the IBAN path resolves a bank code to a BIC, and in the
 * countries whose bank code is purely numeric and whose curated map is empty
 * that resolution CANNOT happen — 19 such countries, Libya among them. So a
 * bank the EU has designated (AGRULYLT, Agricultural Bank of Libya) was
 * present in the sanctions table, correct, and unreachable: no Libyan IBAN
 * could ever produce its BIC. Inventing a bank-code map for those countries
 * would be fabricating a register; accepting the BIC the caller already holds
 * costs nothing and is honest.
 *
 * It is also a better input than an IBAN for this endpoint: a BIC carries its
 * own country in positions 5-6, so every axis answers without any resolution
 * step at all.
 */
export interface BicComplianceResponse {
  bic: string;
  bic8: string;
  valid_format: boolean;
  /**
   * Whether our BIC directory can name this institution. **Independent of the
   * screening result** — `found: false` with `bank_sanctioned: true` is a real
   * and important combination, not a contradiction.
   */
  found: boolean;
  institution: string | null;
  country: { code: string; name: string };
  compliance: ComplianceResult;
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
  /** MAX(created_at) of request_log — the dashboard's collection-freshness witness. Null on an empty log. */
  last_write_at: string | null;
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
  /** Attempted x402 revenue counted from 2026-04-18 only — excludes the early-rollout drift where verify passed but settlement never landed. */
  total_revenue_usdc_clean: number;
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
  /**
   * Whether a bank was actually screened.
   *
   * `bank_sanctioned: false` used to mean two different things: "we looked this
   * institution up on the lists and it is clean" and "no institution resolved
   * from this IBAN, so nothing was looked up at all". Only the first is
   * reassuring, and the payload was identical. This field separates them.
   *
   * Named `bank_screened` rather than `screened` on purpose: the country and
   * FATF axes of this same object ARE screened without a BIC, so a bare
   * `screened: false` here would itself be a false statement.
   *
   * When false, `bank_sanctioned` and `matched_lists` carry no information —
   * do not branch on them.
   */
  bank_screened: boolean;
}

export interface ReachabilityCheck {
  sepa_instant: boolean;
  sct: boolean;
  sdd: boolean;
  /**
   * False when no institution resolved, so the three booleans above are
   * defaults rather than findings. The EPC registers are keyed by BIC8; with no
   * BIC there is no key and no lookup happened.
   */
  screened: boolean;
}

export interface VopCheck {
  participant: boolean;
  status: 'active' | 'pending' | 'inactive' | 'not_found';
  /**
   * False when no institution resolved. `status: 'not_found'` then describes
   * the absence of a query, not the absence of a registration.
   */
  screened: boolean;
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
  /**
   * Where a non-null `qr_iid` comes from. Two inferences of different strength
   * must not be served at the same standard.
   *
   * - `register` — SIX publishes this exact pairing: a BankMaster row in the
   *   QR range names this IID as its institution. A fact.
   * - `headquarters` — inferred. The IID is a branch, and the QR-IID belongs to
   *   its head office (`headquarters_iid`). SIX allocates QR-IIDs per
   *   institution, so this is sound, but it is a deduction and it says so.
   *
   * Null whenever `qr_iid` is null.
   */
  qr_iid_source: 'register' | 'headquarters' | null;
  /**
   * Every QR-IID of the institution, when SIX has allocated more than one.
   * Present only in that case; `qr_iid` then carries the lowest of them, so a
   * caller reading only the scalar still gets a real, published QR-IID rather
   * than a silently truncated set. Measured 20/08/2026: 2 institutions of 224.
   */
  qr_iids?: string[];
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
  /**
   * Where `qr_iid` comes from — `register` when SIX publishes the pairing,
   * `headquarters` when it is inherited from the institution's head office.
   * Null when `qr_iid` is null. See ChClearingEntry for the full note.
   */
  qr_iid_source?: 'register' | 'headquarters' | null;
  /** Every QR-IID of the institution, when SIX allocated more than one. */
  qr_iids?: string[];
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
  /**
   * Where `qr_iid` comes from — `register` when SIX publishes the pairing,
   * `headquarters` when it is inherited from the institution's head office.
   * Null when `qr_iid` is null. See ChClearingEntry for the full note.
   */
  qr_iid_source: 'register' | 'headquarters' | null;
  /** Every QR-IID of the institution, when SIX allocated more than one. */
  qr_iids?: string[];
  /** Present (true) only for QR-IBANs (bank code in the QR-IID range 30000–31999). */
  is_qr_iid?: boolean;
}

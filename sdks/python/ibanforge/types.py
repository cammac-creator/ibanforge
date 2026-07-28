"""Typed dicts mirroring the IBANforge REST API response shapes.

These are duck-typed (TypedDict, not dataclass) so they accept the raw JSON
returned by the API without an extra parsing step. If you want strict
validation, wrap them in pydantic models on your end.

The shapes here are kept in lock-step with the server's `src/types.ts`. If the
API changes, update both. (A future improvement is to generate these from the
OpenAPI document the API serves at /openapi.json.)
"""

from __future__ import annotations

from typing import Any, List, Optional, TypedDict


class Country(TypedDict, total=False):
    code: str
    name: str


class BBAN(TypedDict, total=False):
    bank_code: str
    branch_code: str
    account_number: str


class BIC(TypedDict, total=False):
    # /v1/iban/validate returns the compact form below. The richer fields
    # (lei, address, branch_info) are only on the dedicated /v1/bic/:code
    # endpoint — see BICLookupResult.
    code: str
    bank_name: Optional[str]
    city: Optional[str]


class Issuer(TypedDict, total=False):
    type: str  # "bank" | "digital_bank" | "emi" | "payment_institution"
    name: str


class SEPA(TypedDict, total=False):
    member: bool
    schemes: List[str]  # subset of "SCT" | "SDD" | "SCT_INST"
    vop_required: bool


class RiskIndicators(TypedDict, total=False):
    issuer_type: str  # "bank" | "digital_bank" | "emi" | "payment_institution"
    country_risk: str  # "standard" | "elevated" | "high"
    test_bic: bool
    sepa_reachable: bool
    vop_coverage: bool


class Clearing(TypedDict, total=False):
    """Swiss clearing enrichment, present on validate for CH/LI IBANs only."""

    iid: str
    name: str
    type: str  # bank | cantonal_bank | postfinance | raiffeisen | central_bank | foreign_participant
    town: Optional[str]
    sic: bool
    instant_payments_chf: bool
    eurosic: bool
    qr_iid: Optional[str]


class IBANValidationResult(TypedDict, total=False):
    iban: str
    formatted: str
    valid: bool
    country: Country
    check_digits: str
    bban: BBAN
    bic: Optional[BIC]
    issuer: Issuer
    sepa: SEPA
    risk_indicators: RiskIndicators
    clearing: Optional[Clearing]
    cost_usdc: float
    processing_ms: int
    error: str
    error_detail: str


class IBANFormatResult(TypedDict, total=False):
    """Free /v1/iban/format response — pure mod-97 + structure check, no DB lookups."""

    iban: str
    formatted: str
    valid: bool
    country: Country
    check_digits: str
    bban: BBAN
    error: str
    error_detail: str
    upgrade_to_full_validation: str


class IBANBatchResult(TypedDict, total=False):
    results: List[IBANValidationResult]
    count: int
    valid_count: int
    cost_usdc: float
    processing_ms: int


class BICLookupResult(TypedDict, total=False):
    bic: str
    bic8: str
    bic11: str
    found: bool
    valid_format: bool
    institution: Optional[str]
    country: Country
    city: Optional[str]
    branch_code: str
    branch_info: Optional[str]
    lei: Optional[str]
    lei_status: Optional[str]
    is_test_bic: bool
    source: Optional[str]
    cost_usdc: float
    processing_ms: int


class CHInstitution(TypedDict, total=False):
    name: str
    type: str
    iid_type: str  # headquarters | branch | other
    headquarters_iid: str


class CHPaymentServices(TypedDict, total=False):
    sic: bool
    rtgs_chf: bool
    instant_payments_chf: bool
    eurosic: bool
    lsv_bdd_chf: bool
    lsv_bdd_eur: bool


class CHClearingResult(TypedDict, total=False):
    iid: str
    found: bool
    redirected_from: str
    institution: CHInstitution
    address: Any
    bic: Optional[str]
    payment_services: CHPaymentServices
    sic_iid: Optional[str]
    qr_iid: Optional[str]
    valid_on: str
    note: str
    cost_usdc: float
    processing_ms: int


class Sanctions(TypedDict, total=False):
    country_sanctioned: bool
    bank_sanctioned: bool
    matched_lists: List[str]
    fatf_status: str  # member | grey_list | black_list | non_member


class Reachability(TypedDict, total=False):
    sepa_instant: bool
    sct: bool
    sdd: bool


class VoP(TypedDict, total=False):
    participant: bool
    status: str  # active | pending | inactive | not_found


class Compliance(TypedDict, total=False):
    sanctions: Sanctions
    reachability: Reachability
    vop: VoP
    # None when the IBAN did not validate: there was nothing to score.
    risk_score: Optional[float]  # 0 (safest) .. 100, or None
    # low | medium | elevated | high | critical | unassessable
    # 'unassessable' = the IBAN failed validation, no screening was possible.
    # It is the absence of a verdict, never a favourable one.
    risk_level: str
    flags: List[str]


class ComplianceMeta(TypedDict, total=False):
    """Scope + freshness disclosure attached to every compliance response."""

    scope: str  # always 'bank_bic_only' — screening is at the bank BIC, not the beneficiary
    disclaimer: str
    sanctions_as_of: Optional[str]
    fatf_as_of: Optional[str]
    sources: Optional[str]


class ComplianceResult(TypedDict, total=False):
    """POST /v1/iban/compliance — the validate result PLUS a nested `compliance`
    block. There is no top-level `risk_score` or `recommended_action`; read the
    score at result['compliance']['risk_score'] / ['risk_level'].

    Scope note: sanctions screening is at the BANK (BIC8) level only and does
    NOT screen the beneficiary/account-holder name.
    """

    iban: str
    valid: bool
    country: Country
    bban: BBAN
    bic: Optional[BIC]
    issuer: Issuer
    sepa: SEPA
    risk_indicators: RiskIndicators
    clearing: Optional[Clearing]
    compliance: Compliance
    meta: ComplianceMeta
    cost_usdc: float
    processing_ms: int
    error: str
    error_detail: str


class APIKey(TypedDict, total=False):
    api_key: str
    key_prefix: str
    email: str
    monthly_limit: int
    message: str


class APIKeyUsage(TypedDict, total=False):
    key_prefix: str
    email: str
    monthly_limit: int
    used_this_month: int
    remaining: int
    month: str


class HealthInfo(TypedDict, total=False):
    status: str
    version: str
    uptime_seconds: float
    bic_database_entries: int
    ch_clearing_entries: int
    bic_data_last_updated: str

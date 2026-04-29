"""Typed dicts mirroring the IBANforge REST API response shapes.

These are duck-typed (TypedDict, not dataclass) so they accept the raw JSON
returned by the API without an extra parsing step. If you want strict
validation, wrap them in pydantic models on your end.
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
    bic: str
    bankName: str
    city: str
    lei: str


class Issuer(TypedDict, total=False):
    type: str  # "bank" | "emi" | "viban" | "neobank" | "unknown"
    name: str


class SEPA(TypedDict, total=False):
    reachable: bool
    instant: bool


class VoP(TypedDict, total=False):
    participant: bool


class CHClearing(TypedDict, total=False):
    bc_nummer: str
    sic: bool
    qr_iid: bool


class IBANValidationResult(TypedDict, total=False):
    iban: str
    formatted: str
    valid: bool
    country: Country
    check_digits: str
    bban: BBAN
    bic: BIC
    issuer: Issuer
    sepa: SEPA
    vop: VoP
    ch_clearing: CHClearing
    risk_score: float
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
    summary: Any
    cost_usdc: float


class BICLookupResult(TypedDict, total=False):
    bic: str
    bic8: str
    bic11: str
    found: bool
    valid_format: bool
    institution: str
    country: Country
    city: str
    lei: str
    address: str
    cost_usdc: float


class CHClearingResult(TypedDict, total=False):
    iid: str
    found: bool
    institution: Any
    participation: Any
    bic: str
    cost_usdc: float


class ComplianceResult(TypedDict, total=False):
    iban: str
    valid: bool
    risk_score: float
    recommended_action: str  # "allow" | "review" | "block"
    sanctions: Any
    fatf: Any
    sepa: SEPA
    vop: VoP
    flags: Any
    cost_usdc: float


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
    stats: Any

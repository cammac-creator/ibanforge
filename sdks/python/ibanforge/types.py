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


class RegisteredAddress(TypedDict, total=False):
    """Registered / head-office address as GLEIF files it.

    Was ``Any`` on every result that carried it, so no field name was
    discoverable and no reader could tell ``romanization`` was a closed set.
    Spelled out once and shared, because the API builds it from one helper.
    """

    type: str  # always "registered"
    street: Optional[str]
    post_code: Optional[str]
    region: Optional[str]
    city: Optional[str]
    country: str
    # Latin reading: GLEIF's official English form for a non-Latin entity, or
    # the address itself when already Latin. None when the entity is non-Latin
    # and GLEIF ships no Latin form — a transliteration is never invented.
    romanized: Optional[str]
    romanization: str  # original_latin | gleif_english | unavailable
    source: str
    language: Optional[str]
    # When the entity last filed this address. Frequently a year old, and NOT
    # the `as_of` on the BIC beside it, which dates the monthly refresh.
    as_of: Optional[str]


class BIC(TypedDict, total=False):
    # ⚠️ `bank_name`, not `bankName`. The 1.3.3 README published the camelCase
    # spelling; every reader who copy-pasted it got a KeyError on line 3.
    code: str
    bank_name: Optional[str]
    # Where the consulted register places THIS bank code. May legitimately
    # differ from address["city"], the legal seat: German BLZ 37040044 resolves
    # to Commerzbank in Köln while the entity is registered in Frankfurt. Both
    # true, different questions.
    city: Optional[str]
    source: str  # which directory this row came from
    as_of: str  # month the source was last refreshed
    # Served by /v1/iban/validate since 1.4.4. Before that these lived only on
    # /v1/bic/:code, so a caller paid a second lookup for fields the first call
    # had already read. None means GLEIF publishes no LEI for this BIC, never
    # that the institution has none.
    lei: Optional[str]
    lei_status: Optional[str]
    # None for a branch BIC: only head-office rows carry a registered address.
    address: Optional[RegisteredAddress]


class Issuer(TypedDict, total=False):
    type: str  # "bank" | "digital_bank" | "emi" | "payment_institution"
    name: str
    classification: str


class SEPA(TypedDict, total=False):
    member: bool
    schemes: List[str]  # subset of "SCT" | "SDD" | "SCT_INST"
    vop_required: bool
    # None when the institution is unknown — absence of data, not a "no".
    vop_participant: Optional[bool]


class RiskIndicators(TypedDict, total=False):
    issuer_type: Optional[str]  # "bank" | "digital_bank" | "emi" | "payment_institution"
    country_risk: str  # "standard" | "elevated" | "high"
    test_bic: bool
    sepa_reachable: bool
    sepa_reachable_scope: str  # "country" when inferred from the zone, not the bank
    vop_coverage: bool


class BankCodeCheck(TypedDict, total=False):
    """Is this bank code actually allocated in the national register?

    The product's sharpest answer, and the one competitors get wrong: an IBAN
    can pass mod-97 and still name a bank that does not exist.
    ``status == "not_in_register"`` with ``authoritative is True`` means do not
    send — openiban calls the same IBAN outright invalid, a different (and
    wrong) claim.
    """

    value: str
    status: str  # verified | not_in_register | unknown | no_register
    match: Optional[str]
    register: Optional[str]
    authoritative: bool  # True only when the register is the country's official one
    institution: Any
    as_of: str


class NextStep(TypedDict, total=False):
    """What the API suggests doing next, given this exact verdict."""

    code: str
    do: str
    because: str
    action: str


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
    qr_iid_source: str
    qr_iids: List[str]  # an institution can hold several; qr_iid is the first


class IBANValidationResult(TypedDict, total=False):
    iban: str
    formatted: str
    valid: bool
    country: Country
    check_digits: str
    bban: BBAN
    # None when no directory knows the bank code — read bank_code_check.
    bic: Optional[BIC]
    issuer: Issuer
    sepa: SEPA
    risk_indicators: RiskIndicators
    bank_code_check: BankCodeCheck
    # CH/LI only, and only when the IID is allocated.
    clearing: Optional[Clearing]
    next_steps: List[NextStep]
    cost_usdc: float
    processing_ms: float
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
    # The bank's name. Called `institution` here, `bic.bank_name` on validate.
    institution: Optional[str]
    country: Country
    city: Optional[str]
    address: Optional[RegisteredAddress]
    address_available: bool
    branch_code: str
    branch_info: Optional[str]
    lei: Optional[str]
    lei_status: Optional[str]
    is_test_bic: bool
    source: Optional[str]
    cost_usdc: float
    processing_ms: float


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
    qr_iid_source: str
    qr_iids: List[str]
    valid_on: str
    note: str
    error: str
    message: str
    cost_usdc: float
    processing_ms: float


class Sanctions(TypedDict, total=False):
    country_sanctioned: bool
    bank_sanctioned: bool
    matched_lists: List[str]
    fatf_status: str  # member | grey_list | black_list | suspended | non_member
    # False means the screening did NOT run (no bank could be identified),
    # never that the bank came back clean.
    bank_screened: bool


class Reachability(TypedDict, total=False):
    sepa_instant: bool
    sct: bool
    sdd: bool
    screened: bool


class VoP(TypedDict, total=False):
    participant: bool
    status: str  # active | pending | inactive | not_found
    screened: bool


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
    country_risk_as_of: Optional[str]
    # Says in prose why risk_indicators.country_risk and fatf_status can disagree.
    country_risk_scope: str


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
    bank_code_check: BankCodeCheck
    clearing: Optional[Clearing]
    next_steps: List[NextStep]
    compliance: Compliance
    meta: ComplianceMeta
    cost_usdc: float
    processing_ms: float
    error: str
    error_detail: str


class APIKey(TypedDict, total=False):
    api_key: str  # shown once, never again
    key_prefix: str
    email: str
    monthly_limit: int
    message: str
    terms_url: str


class APIKeyUsage(TypedDict, total=False):
    """GET /v1/keys/usage.

    ⚠️ Renamed in 1.4.3, because 1.3.3 declared fields the API has never sent:
    ``monthly_limit`` / ``used_this_month`` are ``limit`` / ``used`` on the
    wire. A TypedDict is not checked at runtime, so the wrong names read as
    silently absent — the classic way a typed SDK lies.
    """

    key_prefix: str
    used: int  # calls consumed this calendar month
    limit: int  # monthly quota (200 on the free tier)
    remaining: int
    month: str  # 'YYYY-MM'


class HealthInfo(TypedDict, total=False):
    status: str
    version: str
    uptime_seconds: float
    bic_database_entries: int
    ch_clearing_entries: int
    bic_data_last_updated: str
    databases: Any


class IBANStructureList(TypedDict, total=False):
    """GET /v1/iban/structure — every country the API can parse. Free."""

    total: int
    countries: List[Any]
    endpoint_per_country: str
    cost_usdc: float


class IBANStructure(TypedDict, total=False):
    """GET /v1/iban/structure/:country — one country's BBAN template. Free."""

    country: Country
    iban_length: int
    bban_length: int
    bban: Any
    bban_pattern: str
    sepa: SEPA
    example_iban: str
    # Warns that the registry's example may carry an unallocated bank code.
    example_iban_note: str
    notes: str
    upgrade_hint: str
    cost_usdc: float


class TestIbanResult(TypedDict, total=False):
    """GET /v1/test-iban — structurally valid IBANs whose BANK CODE is real
    (drawn from the national register we serve) and whose account digits are
    random. The ``proof`` block carries the register row, so a reviewer can
    check the claim instead of believing it."""

    test_ibans: List[Any]
    disclaimer: str
    docs: str
    cost_usdc: float


class CreditBundleList(TypedDict, total=False):
    """GET /v1/credits/bundles — prepaid packs, free to list."""

    bundles: List[Any]
    payment_method: str
    documentation: str


class DemoResult(TypedDict, total=False):
    """GET /v1/demo — worked examples, no key, no payment."""

    message: str
    iban_examples: Any
    bic_examples: Any
    compliance_example: Any

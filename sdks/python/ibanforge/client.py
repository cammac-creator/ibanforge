"""Synchronous IBANforge API client.

Usage:

    from ibanforge import IBANforge

    # Free format check (no key needed)
    client = IBANforge()
    out = client.format_iban("CH1000230000000012345")

    # Authenticated calls (required for paid endpoints unless you go x402)
    client = IBANforge(api_key="ifk_...")
    out = client.validate_iban("CH1000230000000012345")

    # Generate a free key in 1 line
    key = IBANforge.generate_api_key("you@company.com")
    client = IBANforge(api_key=key["api_key"])

⚠️ The IBAN above is not decoration. ``CH9300762011623852957`` — the SWIFT
registry's illustration, which every quickstart reaches for — carries a bank
code no institution holds, so it comes back with ``bic: None`` and
``clearing: None``. Reading ``out["bic"]["bank_name"]`` on it raises
``TypeError``, which is precisely how the 1.3.3 quickstart shipped. Use a
register-allocated code, or ``test_iban()``, which mints one with its proof.

The client raises typed exceptions from `ibanforge.exceptions` — catch the
specific class you care about (PaymentRequiredError, QuotaExhaustedError,
InvalidInputError, AuthError, RateLimitError, APIError) or the base
IBANforgeError to catch them all. Each carries ``.status``, ``.code`` (the
API's error slug) and the parsed ``.body``.

Note: a malformed IBAN is NOT an exception. It comes back 200 with
``{"valid": False, "error": "checksum_failed"}`` — exceptions are for transport
and authorization failures.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Iterable, Optional, Union

import httpx

from .exceptions import (
    APIError,
    AuthError,
    IBANforgeError,
    InvalidInputError,
    PaymentRequiredError,
    QuotaExhaustedError,
    RateLimitError,
)
from .types import (
    APIKey,
    APIKeyUsage,
    BICLookupResult,
    CreditBundleList,
    CHClearingResult,
    ComplianceResult,
    DemoResult,
    HealthInfo,
    IBANBatchResult,
    IBANFormatResult,
    IBANStructure,
    IBANStructureList,
    IBANValidationResult,
    TestIbanResult,
)

from ._version import __version__

DEFAULT_BASE_URL = "https://api.ibanforge.com"
DEFAULT_TIMEOUT = 30.0
USER_AGENT = f"ibanforge-python/{__version__}"


def resolve_base_url(base_url: Optional[str] = None) -> str:
    """Explicit argument, then ``IBANFORGE_API_BASE``, then production.

    Read at call time, never bound as a default argument: Python evaluates
    defaults once at import, so ``base_url=DEFAULT_BASE_URL`` would freeze the
    environment as it stood when the module was first imported — and no test,
    and no process that configures itself late, could move it afterwards.
    """
    return (base_url or os.environ.get("IBANFORGE_API_BASE") or DEFAULT_BASE_URL).rstrip("/")


def resolve_api_key(api_key: Optional[str] = None) -> Optional[str]:
    """Explicit argument, then ``IBANFORGE_API_KEY`` — the same variable the
    MCP server reads, so one setting configures both."""
    return api_key or os.environ.get("IBANFORGE_API_KEY") or None


def _raise_for_status(res: httpx.Response) -> None:
    """Map HTTP status codes to typed exceptions."""
    if res.is_success:
        return

    body: Any
    try:
        body = res.json()
    except Exception:
        body = res.text

    msg_obj = body if isinstance(body, dict) else {}
    msg = (
        msg_obj.get("message")
        or msg_obj.get("error_detail")
        or msg_obj.get("error")
        or res.reason_phrase
        or "Unknown error"
    )

    if res.status_code == 401:
        raise AuthError(msg, status=401, body=body)
    if res.status_code == 402:
        raise PaymentRequiredError(msg, status=402, body=body)
    if res.status_code == 403:
        raise AuthError(msg, status=403, body=body)
    if res.status_code == 429:
        # IBANforge usually falls through to 402 instead of 429 when an api-key's
        # quota is exhausted, but we still distinguish here.
        if msg_obj.get("error") == "quota_exceeded":
            raise QuotaExhaustedError(msg, status=429, body=body)
        raise RateLimitError(msg, status=429, body=body)
    if 400 <= res.status_code < 500:
        raise InvalidInputError(msg, status=res.status_code, body=body)
    if res.status_code >= 500:
        raise APIError(msg, status=res.status_code, body=body)
    raise IBANforgeError(msg, status=res.status_code, body=body)


class IBANforge:
    """Synchronous client for the IBANforge REST API."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        user_agent: str = USER_AGENT,
    ) -> None:
        self.base_url = resolve_base_url(base_url)
        self.api_key = resolve_api_key(api_key)
        headers = {"User-Agent": user_agent}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        self._client = httpx.Client(base_url=self.base_url, timeout=timeout, headers=headers)

    # ---- context manager ----

    def __enter__(self) -> "IBANforge":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    # ---- IBAN ----

    def format_iban(self, iban: str) -> IBANFormatResult:
        """FREE pre-flight check (mod-97 + structure). No API key required.

        Use this to filter malformed IBANs before paying for full enrichment.
        Returns valid/invalid + error code + bban breakdown only — no BIC,
        no SEPA, no compliance data.
        """
        res = self._client.get("/v1/iban/format", params={"iban": iban})
        _raise_for_status(res)
        return res.json()

    def validate_iban(self, iban: str) -> IBANValidationResult:
        """Validate one IBAN with full enrichment ($0.005 / call with API key).

        Returns BIC, country, EMI/vIBAN classification, SEPA + VoP flags,
        risk score, Swiss BC-Nummer for CH/LI accounts.
        """
        res = self._client.post("/v1/iban/validate", json={"iban": iban})
        _raise_for_status(res)
        return res.json()

    def validate_batch(self, ibans: Iterable[str]) -> IBANBatchResult:
        """Validate up to 100 IBANs in one call ($0.002 / IBAN with API key)."""
        ibans_list = list(ibans)
        if not ibans_list:
            raise InvalidInputError("ibans must contain at least one IBAN")
        if len(ibans_list) > 100:
            raise InvalidInputError(
                "ibans must be at most 100 entries (got {})".format(len(ibans_list))
            )
        res = self._client.post("/v1/iban/batch", json={"ibans": ibans_list})
        _raise_for_status(res)
        return res.json()

    def check_compliance(self, iban: str) -> ComplianceResult:
        """Pre-flight compliance triage on an IBAN ($0.02 / call with API key).

        Returns the validate result plus a nested ``compliance`` block:
        sanctions screening (OFAC), FATF jurisdiction flag, SEPA Instant
        reachability, VoP participant status, and a risk score 0-100. Read it at
        ``out["compliance"]["risk_score"]`` / ``["risk_level"]`` — there is no
        top-level ``risk_score`` or ``recommended_action`` field.

        Informational, not a regulated AML/CFT product. Sanctions screening is
        at the BANK (BIC8) level only and does not screen the beneficiary name.
        """
        res = self._client.post("/v1/iban/compliance", json={"iban": iban})
        _raise_for_status(res)
        return res.json()

    # ---- BIC / SWIFT ----

    def lookup_bic(self, code: str) -> BICLookupResult:
        """Resolve a BIC/SWIFT code into bank, country, city, LEI ($0.003 / call)."""
        res = self._client.get(f"/v1/bic/{code}")
        _raise_for_status(res)
        return res.json()

    # ---- Swiss clearing ----

    def lookup_ch_clearing(self, iid: Union[str, int]) -> CHClearingResult:
        """Resolve a Swiss BC-Nummer / IID into institution data ($0.003 / call).

        Backed by ~1,200 SIX BankMaster entries (refreshed monthly) — the
        deepest Swiss clearing data in any public API: full payment-rail
        participation (SIC, euroSIC, CHF instant) plus QR-IID.
        """
        res = self._client.get(f"/v1/ch/clearing/{iid}")
        _raise_for_status(res)
        return res.json()

    # ---- Reference data (all FREE, no key needed) ----

    def iban_structures(self) -> IBANStructureList:
        """Every country the API can parse, with its IBAN length. FREE."""
        res = self._client.get("/v1/iban/structure")
        _raise_for_status(res)
        return res.json()

    def iban_structure(self, country: str) -> IBANStructure:
        """One country's BBAN template — field offsets, lengths, charsets. FREE."""
        res = self._client.get(f"/v1/iban/structure/{country}")
        _raise_for_status(res)
        return res.json()

    def test_iban(
        self, country: Optional[str] = None, count: Optional[int] = None
    ) -> TestIbanResult:
        """Test IBANs whose bank code is REALLY allocated, with the register row
        that proves it. FREE.

        Use this instead of the SWIFT registry's illustration for fixtures and
        demos: that one's bank code belongs to nobody, so every enrichment field
        comes back None and your test looks like the API failed.
        """
        params: Dict[str, Any] = {}
        if country is not None:
            params["country"] = country
        if count is not None:
            params["count"] = count
        res = self._client.get("/v1/test-iban", params=params)
        _raise_for_status(res)
        return res.json()

    def credit_bundles(self) -> CreditBundleList:
        """Prepaid credit packs and their per-call price. FREE to list."""
        res = self._client.get("/v1/credits/bundles")
        _raise_for_status(res)
        return res.json()

    def demo(self) -> DemoResult:
        """Worked examples of every endpoint, no key and no payment. FREE."""
        res = self._client.get("/v1/demo")
        _raise_for_status(res)
        return res.json()

    # ---- API keys ----

    @staticmethod
    def generate_api_key(
        email: str,
        *,
        base_url: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        code: Optional[str] = None,
    ) -> APIKey:
        """Create a free API key (200 requests/month).

        The key is shown ONCE — store it securely. After the monthly quota the
        IBANforge API falls back to advertising x402 payment requirements; the
        same key continues to work next month.

        Use a mailbox you can read: fictional and disposable domains
        (``example.com``, ``mailinator``…) are refused with ``disposable_email``.
        A SECOND key from the same network within seven days answers 403
        ``verification_required`` and mails a six-digit code — call again with
        ``code=`` to claim it.
        """
        payload: Dict[str, Any] = {"email": email}
        if code:
            payload["code"] = code
        with httpx.Client(base_url=resolve_base_url(base_url), timeout=timeout) as cl:
            res = cl.post("/v1/keys/generate", json=payload)
            _raise_for_status(res)
            return res.json()

    def usage(self) -> APIKeyUsage:
        """Get the current month's quota usage for the configured API key."""
        if not self.api_key:
            raise AuthError("usage() requires an API key — pass api_key='ifk_...' to the constructor")
        res = self._client.get("/v1/keys/usage")
        _raise_for_status(res)
        return res.json()

    # ---- Misc ----

    def health(self) -> HealthInfo:
        """Public health endpoint — version, BIC count, uptime, basic stats."""
        res = self._client.get("/health")
        _raise_for_status(res)
        return res.json()

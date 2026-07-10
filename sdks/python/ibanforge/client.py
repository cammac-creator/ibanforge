"""Synchronous IBANforge API client.

Usage:

    from ibanforge import IBANforge

    # Free format check (no key needed)
    client = IBANforge()
    out = client.format_iban("CH9300762011623852957")

    # Authenticated calls (required for paid endpoints unless you go x402)
    client = IBANforge(api_key="ifk_...")
    out = client.validate_iban("CH9300762011623852957")

    # Generate a free key in 1 line
    key = IBANforge.generate_api_key("you@example.com")
    client = IBANforge(api_key=key["api_key"])

The client raises typed exceptions from `ibanforge.exceptions` — catch the
specific class you care about (PaymentRequiredError, QuotaExhaustedError,
InvalidInputError, AuthError, RateLimitError, APIError) or the base
IBANforgeError to catch them all.
"""

from __future__ import annotations

from typing import Any, Iterable, Optional, Union

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
    CHClearingResult,
    ComplianceResult,
    HealthInfo,
    IBANBatchResult,
    IBANFormatResult,
    IBANValidationResult,
)

from ._version import __version__

DEFAULT_BASE_URL = "https://api.ibanforge.com"
DEFAULT_TIMEOUT = 30.0
USER_AGENT = f"ibanforge-python/{__version__}"


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
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        user_agent: str = USER_AGENT,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        headers = {"User-Agent": user_agent}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
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
        sanctions screening (OFAC/EU/UN), FATF jurisdiction flag, SEPA Instant
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

    # ---- API keys ----

    @staticmethod
    def generate_api_key(
        email: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> APIKey:
        """Create a free API key (200 requests/month).

        The key is shown ONCE — store it securely. After the monthly quota the
        IBANforge API falls back to advertising x402 payment requirements; the
        same key continues to work next month.
        """
        with httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout) as cl:
            res = cl.post("/v1/keys/generate", json={"email": email})
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

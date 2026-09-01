"""Asynchronous IBANforge API client (asyncio-friendly).

Mirrors the sync `IBANforge` API one-for-one but returns awaitables and uses
`httpx.AsyncClient` under the hood — pick this when you're calling the API
from inside an async framework (FastAPI, aiohttp, langchain async tools, etc.)
or when you need to fan-out 100s of validations concurrently.

Usage:

    import asyncio
    from ibanforge import AsyncIBANforge

    async def main():
        async with AsyncIBANforge(api_key="ifk_...") as ibanforge:
            out = await ibanforge.validate_iban("CH1000230000000012345")
            print(out["valid"])

    asyncio.run(main())

Configuration falls back to the environment exactly like the sync client:
``IBANFORGE_API_KEY`` and ``IBANFORGE_API_BASE``.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, Optional, Union

import httpx

from .exceptions import (
    APIError,
    AuthError,
    IBANforgeError,
    InvalidInputError,
    PaymentRequiredError,
    PayloadTooLargeError,
    QuotaExhaustedError,
    RateLimitError,
)
from .client import DEFAULT_BASE_URL, DEFAULT_TIMEOUT, resolve_api_key, resolve_base_url
from .types import (
    AddressCheckResult,
    AddressFinding,
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
    ReferenceValidationResult,
    TestIbanResult,
)

from ._version import __version__

__all__ = ["AsyncIBANforge", "DEFAULT_BASE_URL", "DEFAULT_TIMEOUT"]

USER_AGENT = f"ibanforge-python/{__version__}"


def _raise_for_status(res: httpx.Response) -> None:
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
    # 413 has its own remedy — split the payload — and used to fall into the
    # `InvalidInputError` catch-all, which tells a caller to fix a body that is
    # not malformed, only too big. Audit DX-09, 2026-09-01.
    if res.status_code == 413:
        raise PayloadTooLargeError(msg, status=413, body=body)
    if res.status_code == 429:
        if msg_obj.get("error") == "quota_exceeded":
            raise QuotaExhaustedError(msg, status=429, body=body)
        raise RateLimitError(msg, status=429, body=body)
    if 400 <= res.status_code < 500:
        raise InvalidInputError(msg, status=res.status_code, body=body)
    if res.status_code >= 500:
        raise APIError(msg, status=res.status_code, body=body)
    raise IBANforgeError(msg, status=res.status_code, body=body)


class AsyncIBANforge:
    """Async client for the IBANforge REST API."""

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
        self._client = httpx.AsyncClient(
            base_url=self.base_url, timeout=timeout, headers=headers
        )

    async def __aenter__(self) -> "AsyncIBANforge":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def format_iban(self, iban: str) -> IBANFormatResult:
        res = await self._client.get("/v1/iban/format", params={"iban": iban})
        _raise_for_status(res)
        return res.json()

    async def validate_iban(self, iban: str) -> IBANValidationResult:
        res = await self._client.post("/v1/iban/validate", json={"iban": iban})
        _raise_for_status(res)
        return res.json()

    async def validate_batch(self, ibans: Iterable[str]) -> IBANBatchResult:
        ibans_list = list(ibans)
        if not ibans_list:
            raise InvalidInputError("ibans must contain at least one IBAN")
        if len(ibans_list) > 100:
            raise InvalidInputError(
                "ibans must be at most 100 entries (got {})".format(len(ibans_list))
            )
        res = await self._client.post("/v1/iban/batch", json={"ibans": ibans_list})
        _raise_for_status(res)
        return res.json()

    async def check_compliance(self, iban: str) -> ComplianceResult:
        res = await self._client.post("/v1/iban/compliance", json={"iban": iban})
        _raise_for_status(res)
        return res.json()

    async def lookup_bic(self, code: str) -> BICLookupResult:
        res = await self._client.get(f"/v1/bic/{code}")
        _raise_for_status(res)
        return res.json()

    async def lookup_ch_clearing(self, iid: Union[str, int]) -> CHClearingResult:
        res = await self._client.get(f"/v1/ch/clearing/{iid}")
        _raise_for_status(res)
        return res.json()

    # ---- Reference data (all FREE, no key needed) ----

    async def iban_structures(self) -> IBANStructureList:
        """Every country the API can parse, with its IBAN length. FREE."""
        res = await self._client.get("/v1/iban/structure")
        _raise_for_status(res)
        return res.json()

    async def iban_structure(self, country: str) -> IBANStructure:
        """One country's BBAN template — field offsets, lengths, charsets. FREE."""
        res = await self._client.get(f"/v1/iban/structure/{country}")
        _raise_for_status(res)
        return res.json()

    async def test_iban(
        self, country: Optional[str] = None, count: Optional[int] = None
    ) -> TestIbanResult:
        """Test IBANs with a REAL, register-allocated bank code, and the proof. FREE."""
        params: Dict[str, Any] = {}
        if country is not None:
            params["country"] = country
        if count is not None:
            params["count"] = count
        res = await self._client.get("/v1/test-iban", params=params)
        _raise_for_status(res)
        return res.json()

    async def validate_reference(
        self, reference: str, reference_type: Optional[str] = None
    ) -> ReferenceValidationResult:
        """Check a QR-bill (QRR), ISO 11649 (RF/SCOR), Belgian OGM/VCS or Finnish
        payment reference against the dated document that publishes its rule. FREE.

        This checks the reference ALONE. The pairing verdict — whether that
        reference may legally travel with a given account — is the paid half:
        send a ``reference`` field to POST /v1/iban/validate.
        """
        params: Dict[str, Any] = {"reference": reference}
        if reference_type is not None:
            params["reference_type"] = reference_type
        res = await self._client.get("/v1/reference/validate", params=params)
        _raise_for_status(res)
        return res.json()

    async def check_address(
        self, scheme: str, address: Dict[str, Any]
    ) -> AddressCheckResult:
        """Check a structured ISO 20022 postal address against a scheme's rules
        (``sps``, ``hvps_plus``, ``fedwire``). FREE.

        Every finding names the guideline it was read from: relay ``source`` with
        the verdict rather than the boolean alone.
        """
        res = await self._client.post("/v1/address/check", json={"scheme": scheme, "address": address})
        _raise_for_status(res)
        return res.json()

    async def credit_bundles(self) -> CreditBundleList:
        """Prepaid credit packs and their per-call price. FREE to list."""
        res = await self._client.get("/v1/credits/bundles")
        _raise_for_status(res)
        return res.json()

    async def demo(self) -> DemoResult:
        """Worked examples of every endpoint, no key and no payment. FREE."""
        res = await self._client.get("/v1/demo")
        _raise_for_status(res)
        return res.json()

    @staticmethod
    async def generate_api_key(
        email: str,
        *,
        base_url: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        code: Optional[str] = None,
    ) -> APIKey:
        """Create a free API key (200 requests/month). See the sync client for
        the disposable-domain and mailbox-verification rules."""
        payload: Dict[str, Any] = {"email": email}
        if code:
            payload["code"] = code
        async with httpx.AsyncClient(base_url=resolve_base_url(base_url), timeout=timeout) as cl:
            res = await cl.post("/v1/keys/generate", json=payload)
            _raise_for_status(res)
            return res.json()

    async def usage(self) -> APIKeyUsage:
        if not self.api_key:
            raise AuthError("usage() requires an API key — pass api_key='ifk_...' to the constructor")
        res = await self._client.get("/v1/keys/usage")
        _raise_for_status(res)
        return res.json()

    async def health(self) -> HealthInfo:
        res = await self._client.get("/health")
        _raise_for_status(res)
        return res.json()

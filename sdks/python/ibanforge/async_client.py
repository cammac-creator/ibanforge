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
            out = await ibanforge.validate_iban("CH9300762011623852957")
            print(out["valid"])

    asyncio.run(main())
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

DEFAULT_BASE_URL = "https://api.ibanforge.com"
DEFAULT_TIMEOUT = 30.0
USER_AGENT = "ibanforge-python/1.1.0"


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
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        user_agent: str = USER_AGENT,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        headers = {"User-Agent": user_agent}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
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

    @staticmethod
    async def generate_api_key(
        email: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> APIKey:
        async with httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=timeout) as cl:
            res = await cl.post("/v1/keys/generate", json={"email": email})
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

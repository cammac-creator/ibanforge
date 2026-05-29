"""IBANforge Python SDK.

Official client for the IBANforge REST API — IBAN validation, BIC/SWIFT
lookup, Swiss BC-Nummer, compliance triage. Made for AI finance agents and
fintech developers.

Quick start:

    pip install ibanforge

    from ibanforge import IBANforge
    client = IBANforge(api_key="ifk_...")
    out = client.validate_iban("CH9300762011623852957")
    print(out["valid"], (out.get("bic") or {}).get("bank_name"))

For asyncio (FastAPI, langchain async, fan-out concurrency):

    from ibanforge import AsyncIBANforge
    async with AsyncIBANforge(api_key="ifk_...") as client:
        out = await client.validate_iban("...")
"""

from ._version import __version__
from .async_client import AsyncIBANforge
from .client import IBANforge
from .exceptions import (
    APIError,
    AuthError,
    IBANforgeError,
    InvalidInputError,
    PaymentRequiredError,
    QuotaExhaustedError,
    RateLimitError,
)

__all__ = [
    "IBANforge",
    "AsyncIBANforge",
    "IBANforgeError",
    "AuthError",
    "PaymentRequiredError",
    "QuotaExhaustedError",
    "RateLimitError",
    "InvalidInputError",
    "APIError",
    "__version__",
]

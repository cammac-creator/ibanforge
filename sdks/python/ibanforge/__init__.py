"""IBANforge Python SDK.

Official client for the IBANforge REST API — IBAN validation, BIC/SWIFT
lookup, Swiss BC-Nummer, compliance triage. Made for AI finance agents and
fintech developers.

Quick start:

    pip install ibanforge

    from ibanforge import IBANforge
    client = IBANforge(api_key="ifk_...")
    out = client.validate_iban("CH1000230000000012345")
    print(out["valid"], (out.get("bic") or {}).get("bank_name"))

`api_key` and `base_url` fall back to the IBANFORGE_API_KEY and
IBANFORGE_API_BASE environment variables — the same names the MCP server reads.

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

"""Custom exception classes for the IBANforge SDK."""

from __future__ import annotations

from typing import Any


class IBANforgeError(Exception):
    """Base class for all IBANforge SDK errors."""

    def __init__(self, message: str, *, status: int | None = None, body: Any | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.body = body


class AuthError(IBANforgeError):
    """API key is missing, invalid, or revoked."""


class PaymentRequiredError(IBANforgeError):
    """402 returned by the API. The agent must either authenticate with an API key
    (Authorization: Bearer ifk_...) or pay per call via the x402 protocol on Base.

    The 402 body is in `self.body` and includes `accepts` (payment requirements),
    `free_tier` (instructions to obtain a free key), and `x402` (protocol pointers).
    """


class QuotaExhaustedError(IBANforgeError):
    """The API key's monthly quota is exhausted.

    Note: by default the IBANforge API will fall back to advertising x402 payment
    requirements (HTTP 402) instead of returning 429 — agents that scale beyond
    their quota can keep calling and pay per request. This exception is only
    raised if the server explicitly returns 429.
    """


class RateLimitError(IBANforgeError):
    """Global rate limit exceeded (per-IP)."""


class InvalidInputError(IBANforgeError):
    """4xx returned for an obviously malformed request — bad IBAN length, bad BIC
    format, missing query param, etc. Carries the server's `error_detail` if any.
    """


class APIError(IBANforgeError):
    """5xx — server-side failure. Retry with backoff."""

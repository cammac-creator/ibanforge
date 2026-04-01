"""IBANforge Python SDK — IBAN validation & BIC/SWIFT lookup."""

import httpx
from typing import Optional


class IBANforge:
    """Client for the IBANforge API."""

    def __init__(self, base_url: str = "https://api.ibanforge.com"):
        self.base_url = base_url.rstrip("/")
        self._client = httpx.Client(base_url=self.base_url, timeout=30.0)

    def validate_iban(self, iban: str) -> dict:
        """Validate a single IBAN and optionally look up its BIC.

        Args:
            iban: The IBAN to validate (e.g., "CH93 0076 2011 6238 5295 7")

        Returns:
            dict with keys: iban, valid, country, check_digits, bban, bic, formatted, cost_usdc
        """
        res = self._client.post("/v1/iban/validate", json={"iban": iban})
        res.raise_for_status()
        return res.json()

    def validate_batch(self, ibans: list[str]) -> dict:
        """Validate multiple IBANs in one call (up to 100).

        Args:
            ibans: List of IBANs to validate

        Returns:
            dict with keys: results, count, valid_count, cost_usdc
        """
        res = self._client.post("/v1/iban/batch", json={"ibans": ibans})
        res.raise_for_status()
        return res.json()

    def lookup_bic(self, code: str) -> dict:
        """Look up a BIC/SWIFT code.

        Args:
            code: BIC code (8 or 11 characters, e.g., "UBSWCHZH80A")

        Returns:
            dict with keys: bic, found, institution, country, city, lei, cost_usdc
        """
        res = self._client.get(f"/v1/bic/{code}")
        res.raise_for_status()
        return res.json()

    def health(self) -> dict:
        """Check API health status."""
        res = self._client.get("/health")
        res.raise_for_status()
        return res.json()

    def close(self):
        """Close the HTTP client."""
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

"""Unit tests for the sync IBANforge client.

Uses respx to mock httpx — no real network calls.
"""

from __future__ import annotations

import httpx
import pytest
import respx

from ibanforge import (
    APIError,
    AsyncIBANforge,
    AuthError,
    IBANforge,
    InvalidInputError,
    PaymentRequiredError,
    PayloadTooLargeError,
    QuotaExhaustedError,
    RateLimitError,
)

BASE = "https://api.ibanforge.com"
SAMPLE_IBAN = "CH9300762011623852957"


@pytest.fixture
def client() -> IBANforge:
    return IBANforge(api_key="ifk_test_key")


@respx.mock
def test_format_iban_no_key_required():
    cl = IBANforge()  # no api_key
    respx.get(f"{BASE}/v1/iban/format").mock(
        return_value=httpx.Response(200, json={"iban": SAMPLE_IBAN, "valid": True})
    )
    out = cl.format_iban(SAMPLE_IBAN)
    assert out["valid"] is True
    cl.close()


@respx.mock
def test_validate_iban_authorization_header(client: IBANforge):
    route = respx.post(f"{BASE}/v1/iban/validate").mock(
        return_value=httpx.Response(200, json={"iban": SAMPLE_IBAN, "valid": True})
    )
    out = client.validate_iban(SAMPLE_IBAN)
    assert out["valid"] is True
    sent = route.calls.last.request
    assert sent.headers.get("authorization") == "Bearer ifk_test_key"


@respx.mock
def test_validate_batch_too_many_raises_local(client: IBANforge):
    too_many = [SAMPLE_IBAN] * 101
    with pytest.raises(InvalidInputError):
        client.validate_batch(too_many)


@respx.mock
def test_lookup_bic(client: IBANforge):
    respx.get(f"{BASE}/v1/bic/UBSWCHZH80A").mock(
        return_value=httpx.Response(200, json={"bic": "UBSWCHZH80A", "found": True})
    )
    out = client.lookup_bic("UBSWCHZH80A")
    assert out["found"] is True


@respx.mock
def test_lookup_ch_clearing(client: IBANforge):
    respx.get(f"{BASE}/v1/ch/clearing/762").mock(
        return_value=httpx.Response(200, json={"iid": "00762", "found": True})
    )
    out = client.lookup_ch_clearing(762)
    assert out["found"] is True


@respx.mock
def test_compliance(client: IBANforge):
    respx.post(f"{BASE}/v1/iban/compliance").mock(
        return_value=httpx.Response(
            200, json={"iban": SAMPLE_IBAN, "valid": True, "risk_score": 5, "recommended_action": "allow"}
        )
    )
    out = client.check_compliance(SAMPLE_IBAN)
    assert out["recommended_action"] == "allow"


@respx.mock
def test_402_raises_payment_required(client: IBANforge):
    respx.post(f"{BASE}/v1/iban/validate").mock(
        return_value=httpx.Response(
            402,
            json={
                "x402Version": 1,
                "error": "payment_required",
                "message": "Pay or use a key",
                "accepts": [{"scheme": "exact", "network": "base"}],
            },
        )
    )
    with pytest.raises(PaymentRequiredError) as exc:
        client.validate_iban(SAMPLE_IBAN)
    assert exc.value.status == 402
    assert exc.value.body["accepts"][0]["network"] == "base"


@respx.mock
def test_401_raises_auth_error(client: IBANforge):
    respx.post(f"{BASE}/v1/iban/validate").mock(
        return_value=httpx.Response(401, json={"error": "invalid_api_key"})
    )
    with pytest.raises(AuthError):
        client.validate_iban(SAMPLE_IBAN)


@respx.mock
def test_429_quota_exceeded_distinct_from_rate_limit(client: IBANforge):
    respx.post(f"{BASE}/v1/iban/validate").mock(
        return_value=httpx.Response(429, json={"error": "quota_exceeded", "limit": 200, "used": 200})
    )
    with pytest.raises(QuotaExhaustedError):
        client.validate_iban(SAMPLE_IBAN)


@respx.mock
def test_429_generic_rate_limit(client: IBANforge):
    respx.post(f"{BASE}/v1/iban/validate").mock(
        return_value=httpx.Response(429, json={"error": "rate_limited"})
    )
    with pytest.raises(RateLimitError):
        client.validate_iban(SAMPLE_IBAN)


@respx.mock
def test_400_raises_invalid_input(client: IBANforge):
    respx.post(f"{BASE}/v1/iban/validate").mock(
        return_value=httpx.Response(400, json={"error": "invalid_iban", "error_detail": "too short"})
    )
    with pytest.raises(InvalidInputError) as exc:
        client.validate_iban("CH")
    assert "too short" in str(exc.value)


@respx.mock
def test_413_raises_payload_too_large(client: IBANforge):
    """Audit DX-09, 2026-09-01. 413 fell into the `InvalidInputError` catch-all,
    which tells a caller to fix a body that is not malformed, only too big — so
    the retry loop repeats the same payload forever. Its own class carries its
    own remedy: split the payload."""
    respx.post(f"{BASE}/v1/iban/batch").mock(
        return_value=httpx.Response(413, json={"error": "payload_too_large", "message": "body over 1 MB"})
    )
    with pytest.raises(PayloadTooLargeError) as exc:
        client.validate_batch([SAMPLE_IBAN])
    assert exc.value.status == 413
    assert exc.value.code == "payload_too_large"
    # Still an IBANforgeError, so a caller catching the base class is unaffected.
    assert isinstance(exc.value, InvalidInputError) is False


@pytest.mark.asyncio
@respx.mock
async def test_async_413_raises_payload_too_large():
    respx.post(f"{BASE}/v1/iban/batch").mock(
        return_value=httpx.Response(413, json={"error": "payload_too_large"})
    )
    async with AsyncIBANforge() as cl:
        with pytest.raises(PayloadTooLargeError):
            await cl.validate_batch([SAMPLE_IBAN])


# ---- Audit DX-10, 2026-09-01: the two free endpoints shipped on 27/08/2026 ----
#
# Both clients covered 12 endpoints and omitted these two. They are the only
# calls that answer 200 with no key and no payment — the free shop window an
# agent tries before deciding anything — and they were unreachable from the
# client the docs point at.


@respx.mock
def test_validate_reference_is_free_and_passes_the_type_through():
    cl = IBANforge()  # no api_key
    route = respx.get(f"{BASE}/v1/reference/validate").mock(
        return_value=httpx.Response(
            200,
            json={"reference": "RF18539007547034", "scheme": "rf", "valid": True, "status": "checked"},
        )
    )
    out = cl.validate_reference("RF18539007547034", reference_type="scor")
    assert out["valid"] is True
    sent = route.calls.last.request
    assert sent.url.params["reference"] == "RF18539007547034"
    assert sent.url.params["reference_type"] == "scor"
    assert sent.headers.get("authorization") is None
    cl.close()


@respx.mock
def test_validate_reference_relays_valid_none():
    """Norwegian KID and Swedish OCR are configured per creditor account by the
    beneficiary's bank: `None` is the answer, and it must not read as False."""
    cl = IBANforge()
    respx.get(f"{BASE}/v1/reference/validate").mock(
        return_value=httpx.Response(
            200,
            json={"reference": "12345678903", "scheme": "kid", "valid": None, "status": "not_checkable"},
        )
    )
    out = cl.validate_reference("12345678903")
    assert out["valid"] is None
    cl.close()


@respx.mock
def test_check_address_posts_scheme_and_address():
    cl = IBANforge()
    route = respx.post(f"{BASE}/v1/address/check").mock(
        return_value=httpx.Response(
            200,
            json={
                "scheme": "sps",
                "conforms": True,
                "findings": [
                    {
                        "rule": "twn_nm_required",
                        "verdict": "pass",
                        "detail": 'TwnNm is present ("Zurich").',
                        "source": "SIX, Swiss Implementation Guidelines, SPS 2026 v2.3",
                    }
                ],
            },
        )
    )
    out = cl.check_address("sps", {"twn_nm": "Zurich", "ctry": "CH"})
    assert out["conforms"] is True
    # Each finding names the document it was read from; a bare boolean would
    # strip the licence-bearing citation the API is careful to attach.
    assert "SIX" in out["findings"][0]["source"]
    import json as _json

    assert _json.loads(route.calls.last.request.content) == {
        "scheme": "sps",
        "address": {"twn_nm": "Zurich", "ctry": "CH"},
    }
    cl.close()


@pytest.mark.asyncio
@respx.mock
async def test_async_check_address():
    respx.post(f"{BASE}/v1/address/check").mock(
        return_value=httpx.Response(200, json={"scheme": "sps", "conforms": False, "findings": []})
    )
    async with AsyncIBANforge() as cl:
        out = await cl.check_address("sps", {"ctry": "CH"})
    assert out["conforms"] is False


@pytest.mark.asyncio
@respx.mock
async def test_async_validate_reference():
    respx.get(f"{BASE}/v1/reference/validate").mock(
        return_value=httpx.Response(200, json={"reference": "21000", "scheme": "qrr", "valid": True})
    )
    async with AsyncIBANforge() as cl:
        out = await cl.validate_reference("21000")
    assert out["scheme"] == "qrr"


@respx.mock
def test_500_raises_api_error(client: IBANforge):
    respx.post(f"{BASE}/v1/iban/validate").mock(return_value=httpx.Response(500, text="boom"))
    with pytest.raises(APIError):
        client.validate_iban(SAMPLE_IBAN)


@respx.mock
def test_generate_api_key_static_method():
    respx.post(f"{BASE}/v1/keys/generate").mock(
        return_value=httpx.Response(
            200, json={"api_key": "ifk_xxx", "monthly_limit": 200, "email": "a@b.c"}
        )
    )
    out = IBANforge.generate_api_key("a@b.c")
    assert out["api_key"].startswith("ifk_")


def test_usage_without_key_raises():
    cl = IBANforge()  # no api_key
    with pytest.raises(AuthError):
        cl.usage()
    cl.close()


@pytest.mark.asyncio
@respx.mock
async def test_async_validate_iban():
    respx.post(f"{BASE}/v1/iban/validate").mock(
        return_value=httpx.Response(200, json={"iban": SAMPLE_IBAN, "valid": True})
    )
    async with AsyncIBANforge(api_key="ifk_test_key") as cl:
        out = await cl.validate_iban(SAMPLE_IBAN)
    assert out["valid"] is True


@pytest.mark.asyncio
@respx.mock
async def test_async_402():
    respx.post(f"{BASE}/v1/iban/validate").mock(
        return_value=httpx.Response(402, json={"error": "payment_required", "accepts": []})
    )
    async with AsyncIBANforge() as cl:
        with pytest.raises(PaymentRequiredError):
            await cl.validate_iban(SAMPLE_IBAN)

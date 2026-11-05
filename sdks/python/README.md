# IBANforge Python SDK

[![PyPI](https://img.shields.io/pypi/v/ibanforge.svg)](https://pypi.org/project/ibanforge/)
[![Python](https://img.shields.io/pypi/pyversions/ibanforge.svg)](https://pypi.org/project/ibanforge/)
[![License](https://img.shields.io/pypi/l/ibanforge.svg)](https://pypi.org/project/ibanforge/)

Official Python SDK for the [IBANforge API](https://ibanforge.com?src=sdk-py) — IBAN validation, BIC/SWIFT lookup, Swiss BC-Nummer, and sanctions/SEPA/VoP compliance triage.

Built for AI finance agents and fintech developers. Sync + async clients, full type hints, typed exceptions.

> The examples below use recorded API responses. CI executes the Python blocks and checks the annotated output against those recordings. Bank records, source dates, coverage, quotas and prices can change: these assertions do not prove the current live answer. Use the response you receive, including its source and date, for your integration.

## Install

```bash
pip install ibanforge
```

## Free format check (no key needed)

Save money by pre-filtering bad IBANs before paying for enrichment — and note that a malformed IBAN is a **200 with `valid: False`**, not an exception:

```python
from ibanforge import IBANforge

with IBANforge() as client:                         # no api_key required
    out = client.format_iban("CH93007620116238529XX")
    print(out["valid"])                             # False
    print(out["error"])                             # 'checksum_failed'

    ok = client.format_iban("CH1000230000000012345")
    print(ok["valid"])                              # True
    print(ok["bban"]["bank_code"])                  # '00230'
```

## Quick start with a reusable key

[Create a key once](#get-a-reusable-key-without-e-mail) and replace `ifk_...` below, or omit `api_key` to use your server's `IBANFORGE_API_KEY`. Keep the key in secret configuration and out of source files and logs. The earlier format check needs no key. The SDK sends the submitted IBAN to the API; it is not an offline validator.

```python
from ibanforge import IBANforge

with IBANforge(api_key="ifk_...") as client:
    out = client.validate_iban("CH1000230000000012345")

    print(out["valid"])                            # True
    print((out.get("country") or {}).get("code"))                    # 'CH'
    print((out.get("bic") or {}).get("bank_name"))                   # 'UBS Switzerland AG'
    print((out.get("bic") or {}).get("code"))                        # 'UBSWCHZH'
    print((out.get("sepa") or {}).get("member"))                     # True
    print((out.get("sepa") or {}).get("schemes"))                    # ['SCT', 'SDD']
    print((out.get("clearing") or {}).get("iid"))                    # '00230'
    print((out.get("clearing") or {}).get("sic"))                    # True
    print((out.get("clearing") or {}).get("qr_iid"))                 # '30005'
    print((out.get("bank_code_check") or {}).get("status"))          # 'verified'
    print((out.get("risk_indicators") or {}).get("country_risk"))    # 'standard'
```

`api_key` and `base_url` fall back to the `IBANFORGE_API_KEY` and `IBANFORGE_API_BASE` environment variables — the same names the MCP server reads, so one setting configures both.

## Read the bank-code result separately from the checksum

A valid checksum does not establish that the bank code is allocated. `bank_code_check` describes the evidence available for that code, independently of `valid`:

```python
from ibanforge import IBANforge

with IBANforge(api_key="ifk_...") as client:
    # Réponse enregistrée : format valide, code banque absent du registre utilisé.
    ghost = client.validate_iban("CH9300762011623852957")

    print(ghost["valid"])                            # True
    print(ghost["bank_code_check"]["status"])        # 'not_in_register'
    print(ghost["bank_code_check"]["authoritative"]) # True
    print(ghost["bic"])                              # None
    print(ghost["clearing"])                         # None
    print(ghost["next_steps"][0]["code"])            # 'bank_code_not_allocated'
```

`valid` and `bank_code_check` answer different questions. In the recorded example, `not_in_register` with `authoritative: true` reports a code absent from the exhaustive register used, at its reference date. A partial source cannot prove absence. An unavailable source is not a negative result, and a verified code can also carry retirement information. Preserve `register`, its dates, `reason`, and any retirement or successor fields in your review record.

A missing BIC stays unknown; do not invent one or silently replace supplied banking details. These checks do not establish account existence, account ownership, or authorization to pay. SEPA and VoP fields describe country or participant coverage, not a beneficiary-name match. See the [validation response guide](https://ibanforge.com/docs/iban-validate?src=sdk-py).

For a fixture or demo, request a synthetic test IBAN and inspect the proof returned. It does not identify a usable payment account:

```python
from ibanforge import IBANforge

with IBANforge() as client:                         # free, no key
    t = client.test_iban(country="CH")
    proof = t["test_ibans"][0]["proof"]["bank_code_check"]
    print(proof["status"])                          # 'verified'
    print(proof["authoritative"])                   # True
```

## Get a reusable key without e-mail

```python
from ibanforge import IBANforge

key = IBANforge.generate_api_key()
print(key["monthly_limit"])                         # 25
# key["api_key"] is shown ONCE — store it now.
```

No address, card or confirmation is needed. Store the key in your secret configuration,
reuse it for subsequent calls, and read `usage()` for its actual allowance. Normally this
key provides 25 REST requests per month; temporary creation protection can lower that
allowance, so read `monthly_limit` from the response. Do not create a key per request.

After the key has served a call, `POST /v1/keys/claim` with
`Authorization: Bearer ifk_…` can raise its allowance: an explicitly supplied mailbox
and a six-digit code give 200 requests per month; an x402 payment made on the key gives
200 requests once. An exhausted quota does not authorize sending an address or making
a payment on the user's behalf. Follow the API's error details and retry delay.

The existing email argument and code option remain supported for callers who explicitly
choose that route. No email is inferred from environment variables or other accounts.

## Quick start (async)

This sends two separate validation requests, each metered separately. Keep concurrency bounded in a larger import. A failed request makes `gather` raise; other requests may already have completed and consumed units. Use `validate_batch` when a single ordered batch is a better fit, and preserve per-input results and unknown fields.

```python
import asyncio
from ibanforge import AsyncIBANforge

IBANS = ["CH1000230000000012345", "DE89370400440532013000"]

async def main():
    async with AsyncIBANforge(api_key="ifk_...") as client:
        results = await asyncio.gather(*[client.validate_iban(i) for i in IBANS])
        print(len(results))                         # 2
        print(sum(1 for r in results if r["valid"]))  # 2

asyncio.run(main())
```

## All endpoints

The amounts below are per-call x402 prices in USDC, not charges added to an API-key allowance. On a key, each metered call uses one request or credit; a batch uses one per submitted IBAN, including invalid entries. Free reference routes remain free. Read `usage()` for the key's allowance and [pricing](https://ibanforge.com/pricing?src=sdk-py) for current plans and payment options. This SDK does not buy credits or sign x402 payments automatically.

| Method | x402 price or free route | What it does |
|---|---|---|
| `format_iban(iban)` | **free** | Pure mod-97 + structure check. Pre-filter malformed IBANs before paying. |
| `validate_iban(iban)` | $0.005 | Full enrichment — BIC, EMI/vIBAN flag, SEPA + VoP, bank-code register check, Swiss BC-Nummer for CH/LI |
| `validate_batch([iban, ...])` | $0.002 / IBAN | Up to 100 IBANs in one call. CSV cleanup, payout list triage. |
| `lookup_bic(code)` | $0.003 | BIC/SWIFT → bank name, country, city, LEI, registered address. Fields depend on the source and may be absent. |
| `lookup_ch_clearing(iid)` | $0.003 | Swiss BC-Nummer / IID → SIX rail participation + QR-IID, with the source and dates returned by the API. |
| `check_compliance(iban)` | $0.02 | Sanctions (bank BIC) + FATF + SEPA Instant + VoP + risk score 0–100 |
| `validate_reference(reference)` | **free** | QR-bill (QRR), ISO 11649 (RF/SCOR), Belgian OGM/VCS or Finnish reference, checked against the dated document that publishes the rule |
| `check_address(scheme, address)` | **free** | A structured ISO 20022 postal address measured against a scheme's rules (`sps`, `hvps_plus`, `fedwire`), each finding citing its guideline |
| `iban_structures()` | **free** | Every supported country and its IBAN length |
| `iban_structure(country)` | **free** | One country's BBAN template — offsets, lengths, charsets |
| `test_iban(country=...)` | **free** | Synthetic test IBANs with the bank-code proof available at generation |
| `credit_bundles()` | **free** | Prepaid packs and their per-call price |
| `demo()` | **free** | Worked examples of every endpoint |
| `usage()` | **free** | This key's quota for the current month |
| `health()` | **free** | API version, database size |
| `IBANforge.generate_api_key(email=None)` | **free** | Reusable key without e-mail; read its returned quota |

In practice:

```python
from ibanforge import IBANforge

with IBANforge(api_key="ifk_...") as client:
    batch = client.validate_batch(["CH1000230000000012345", "DE89370400440532013000"])
    print(batch["count"])                           # 2
    print(batch["valid_count"])                     # 2

    bic = client.lookup_bic("UBSWCHZH80A")
    print(bic["institution"])                       # 'UBS Switzerland AG'
    print(bic["lei"])                               # '549300WOIFUSNYH0FL22'

    ch = client.lookup_ch_clearing("230")
    print(ch["institution"]["name"])                # 'UBS Switzerland AG'
    print(ch["payment_services"]["sic"])            # True
    print(ch["qr_iid"])                             # '30005'

    structures = client.iban_structures()
    print(structures["total"])                      # 89

    ch_structure = client.iban_structure("CH")
    print(ch_structure["iban_length"])              # 21
    print(ch_structure["bban_pattern"])             # '5!n12!c'

    packs = client.credit_bundles()
    print(packs["bundles"][0]["credits"])           # 1000
    print(packs["bundles"][0]["price_usdc"])        # 5

    d = client.demo()
    print(len(d["iban_examples"]) > 0)              # True

    print(client.usage()["limit"])                  # 200
    print(client.health()["status"])                # 'ok'
```

## Compliance triage

The score is nested under `compliance`. There is no top-level `risk_score`, and no `recommended_action`. The output below is a recorded example, not a current clearance. Read each check's `screened` state, `flags` and source dates in `meta`: an empty match list or a low score does not establish that every source was available.

```python
from ibanforge import IBANforge

with IBANforge(api_key="ifk_...") as client:
    out = client.check_compliance("GB29NWBK60161331926819")

    print(type(out["compliance"]["risk_score"]).__name__)   # 'int'
    print(out["compliance"]["risk_level"])                  # 'low'
    print(out["compliance"]["sanctions"]["matched_lists"])  # []
    print(out["compliance"]["sanctions"]["fatf_status"])    # 'member'
    print(out["meta"]["scope"])                             # 'bank_bic_only'
```

> Sanctions screening is at the **bank (BIC8)** level — it does not screen the beneficiary name and is not a regulated AML/CFT product. `risk_level: 'unassessable'` means nothing could be screened; it is the absence of a verdict, never a favourable one, and `risk_score` is then `None`.

## Error handling

HTTP failures raise typed exceptions derived from `IBANforgeError`, with `.status`, `.code` (the API's error slug, when present) and `.body`. Transport and timeout failures remain `httpx.RequestError` subclasses; catching only `IBANforgeError` does not catch them. A response-decoding failure can also occur without an API verdict.

```python
from ibanforge import IBANforge, AuthError, InvalidInputError

with IBANforge(api_key="ifk_wrong") as client:
    try:
        client.usage()
    except AuthError as e:
        print(e.status)                             # 401
        print(e.code)                               # 'invalid_key'

with IBANforge() as client:
    try:
        client.lookup_bic("NOTABIC")
    except InvalidInputError as e:
        print(e.status)                             # 400
        print(e.code)                               # 'invalid_bic_format'
```

| Class | HTTP | When |
|---|---|---|
| `AuthError` | 401 / 403 | Read the error code: invalid/revoked key or an access restriction; `verification_required` specifically requests mailbox verification |
| `PaymentRequiredError` | 402 | No usable allowance or payment proof. The response body may include an x402 challenge; inspect its shape and the current key usage before choosing an authorized next step |
| `QuotaExhaustedError` | 429 | Only HTTP 429 with `error: quota_exceeded`; exhausted API-key quota can instead return 402 |
| `RateLimitError` | 429 | Other HTTP 429 responses; read the reason and retry delay, then use bounded backoff |
| `PayloadTooLargeError` | 413 | The body is over the limit — split it, do not retry the same payload |
| `InvalidInputError` | other 4xx | Malformed request (a malformed *IBAN* is a 200, see above) |
| `APIError` | 5xx | Server-side failure; keep the result unavailable and retry only under a bounded policy |

Keep failed requests separate from invalid input. Neither a network error nor a 402/429/5xx response is a bank-code verdict. Do not loop on key creation or purchase credits automatically. A retry after an uncertain response may consume another unit; stop the workflow or queue it for review when its retry budget is exhausted.

## For LLM agents (LangChain, LlamaIndex, CrewAI, AutoGen)

The IBANforge API is also available as a native MCP server (`npx -y ibanforge-mcp`) and via x402 micropayments — see the [agent guide](https://ibanforge.com/agents?src=sdk-py). For Python-first agents, the SDK above is usually enough.

## Configuration

```python
from ibanforge import IBANforge

client = IBANforge(
    api_key="ifk_...",     # or the IBANFORGE_API_KEY environment variable
    base_url=None,         # or IBANFORGE_API_BASE; defaults to api.ibanforge.com
    timeout=30.0,          # seconds, default
    user_agent="my-app/1.2",
)
print(client.health()["version"] is not None)       # True
client.close()
```

## Links

- API documentation: <https://ibanforge.com/docs?src=sdk-py>
- Interactive OpenAPI: <https://ibanforge.com/openapi?src=sdk-py>
- Agent guide: <https://ibanforge.com/agents?src=sdk-py>
- TypeScript SDK: [`@ibanforge/sdk`](https://www.npmjs.com/package/@ibanforge/sdk)
- MCP server: [`ibanforge-mcp`](https://www.npmjs.com/package/ibanforge-mcp)
- Source: <https://github.com/cammac-creator/ibanforge>

## License

MIT.

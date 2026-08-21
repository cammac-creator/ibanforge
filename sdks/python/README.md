# IBANforge Python SDK

[![PyPI](https://img.shields.io/pypi/v/ibanforge.svg)](https://pypi.org/project/ibanforge/)
[![Python](https://img.shields.io/pypi/pyversions/ibanforge.svg)](https://pypi.org/project/ibanforge/)
[![License](https://img.shields.io/pypi/l/ibanforge.svg)](https://pypi.org/project/ibanforge/)

Official Python SDK for the [IBANforge API](https://ibanforge.com) — IBAN validation, BIC/SWIFT lookup, Swiss BC-Nummer, and sanctions/SEPA/VoP compliance triage.

Built for AI finance agents and fintech developers. Sync + async clients, full type hints, typed exceptions.

> Every code block on this page is executed by the test suite, against recorded responses from the real API, and each `#` comment on a `print` is checked against what actually printed. A block that stops being true fails CI.

## Install

```bash
pip install ibanforge
```

## Quick start

```python
from ibanforge import IBANforge

with IBANforge(api_key="ifk_...") as client:
    out = client.validate_iban("CH1000230000000012345")

    print(out["valid"])                            # True
    print(out["country"]["code"])                  # 'CH'
    print(out["bic"]["bank_name"])                 # 'UBS Switzerland AG'
    print(out["bic"]["code"])                      # 'UBSWCHZH'
    print(out["sepa"]["member"])                   # True
    print(out["sepa"]["schemes"])                  # ['SCT', 'SDD']
    print(out["clearing"]["iid"])                  # '00230'
    print(out["clearing"]["sic"])                  # True
    print(out["clearing"]["qr_iid"])               # '30005'
    print(out["bank_code_check"]["status"])        # 'verified'
    print(out["risk_indicators"]["country_risk"])  # 'standard'
```

`api_key` and `base_url` fall back to the `IBANFORGE_API_KEY` and `IBANFORGE_API_BASE` environment variables — the same names the MCP server reads, so one setting configures both.

## The answer nobody else gives: is this bank code real?

An IBAN can pass its mod-97 checksum and still name a bank that does not exist. `bank_code_check` says which:

```python
from ibanforge import IBANforge

with IBANforge(api_key="ifk_...") as client:
    # The IBAN the SWIFT registry uses as an illustration. Structurally
    # perfect, bank code 00762 allocated to nobody:
    ghost = client.validate_iban("CH9300762011623852957")

    print(ghost["valid"])                            # True
    print(ghost["bank_code_check"]["status"])        # 'not_in_register'
    print(ghost["bank_code_check"]["authoritative"]) # True
    print(ghost["bic"])                              # None
    print(ghost["clearing"])                         # None
    print(ghost["next_steps"][0]["code"])            # 'bank_code_not_allocated'
```

`valid: True` **and** `not_in_register` is the correct pair: the number is well-formed, the bank is not there. Do not send. (This is also why `out["bic"]["bank_name"]` raises `TypeError` on that IBAN — `bic` is `None`. Use `(out.get("bic") or {}).get("bank_name")` when the IBAN is untrusted.)

Need an IBAN that *does* resolve — for a fixture, a demo, a test suite? Ask for one, with its proof:

```python
from ibanforge import IBANforge

with IBANforge() as client:                         # free, no key
    t = client.test_iban(country="CH")
    proof = t["test_ibans"][0]["proof"]["bank_code_check"]
    print(proof["status"])                          # 'verified'
    print(proof["authoritative"])                   # True
```

## Get a free API key (1 line, no signup form)

```python
from ibanforge import IBANforge

key = IBANforge.generate_api_key("you@company.com")
print(key["monthly_limit"])                         # 200
# key["api_key"] is shown ONCE — store it now.
```

Use a mailbox you can read: fictional domains (`example.com`, `mailinator`, …) are refused with `disposable_email`. A **second** key from the same network within seven days answers `403 verification_required` and mails a six-digit code — call again with it:

```python
from ibanforge import IBANforge

key = IBANforge.generate_api_key("you@company.com", code="123456")
print(key["monthly_limit"])                         # 200
```

When the monthly quota is exhausted, the API falls back to advertising x402 payment requirements instead of dead-ending, and the key resumes at the start of the next month.

## Quick start (async)

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

| Method | Cost | What it does |
|---|---|---|
| `format_iban(iban)` | **free** | Pure mod-97 + structure check. Pre-filter malformed IBANs before paying. |
| `validate_iban(iban)` | $0.005 | Full enrichment — BIC, EMI/vIBAN flag, SEPA + VoP, bank-code register check, Swiss BC-Nummer for CH/LI |
| `validate_batch([iban, ...])` | $0.002 / IBAN | Up to 100 IBANs in one call. CSV cleanup, payout list triage. |
| `lookup_bic(code)` | $0.003 | BIC/SWIFT → bank name, country, city, LEI, registered address. 121k+ BIC entries (39k+ LEI-enriched via GLEIF). |
| `lookup_ch_clearing(iid)` | $0.003 | Swiss BC-Nummer / IID → full SIX BankMaster rail participation + QR-IID, the deepest Swiss clearing data in any public API. |
| `check_compliance(iban)` | $0.02 | Sanctions (bank BIC) + FATF + SEPA Instant + VoP + risk score 0–100 |
| `iban_structures()` | **free** | Every supported country and its IBAN length |
| `iban_structure(country)` | **free** | One country's BBAN template — offsets, lengths, charsets |
| `test_iban(country=...)` | **free** | Test IBANs with a REAL bank code, plus the register row proving it |
| `credit_bundles()` | **free** | Prepaid packs and their per-call price |
| `demo()` | **free** | Worked examples of every endpoint |
| `usage()` | **free** | This key's quota for the current month |
| `health()` | **free** | API version, database size |
| `IBANforge.generate_api_key(email)` | **free** | 200 requests/month |

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

## Compliance triage

The score is nested under `compliance`. There is no top-level `risk_score`, and no `recommended_action`.

```python
from ibanforge import IBANforge

with IBANforge(api_key="ifk_...") as client:
    out = client.check_compliance("GB29NWBK60161331926819")

    print(out["compliance"]["risk_score"])                  # 10
    print(out["compliance"]["risk_level"])                  # 'low'
    print(out["compliance"]["sanctions"]["matched_lists"])  # []
    print(out["compliance"]["sanctions"]["fatf_status"])    # 'member'
    print(out["compliance"]["reachability"]["sct"])         # True
    print(out["compliance"]["vop"]["participant"])          # False
    print(out["meta"]["scope"])                             # 'bank_bic_only'
```

> Sanctions screening is at the **bank (BIC8)** level — it does not screen the beneficiary name and is not a regulated AML/CFT product. `risk_level: 'unassessable'` means nothing could be screened; it is the absence of a verdict, never a favourable one, and `risk_score` is then `None`.

## Error handling

The SDK raises typed exceptions — catch the specific class you care about, or the base `IBANforgeError`. Each carries `.status`, `.code` (the API's error slug) and the parsed `.body`.

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
| `AuthError` | 401 / 403 | Missing, revoked or mistyped key; mailbox verification required |
| `PaymentRequiredError` | 402 | No key and no credit. `e.body["accepts"]` carries the x402 challenge — pay and retry, no dead end |
| `QuotaExhaustedError` | 429 | Monthly free quota spent (the API usually answers 402 instead, so you can pay through) |
| `RateLimitError` | 429 | Too fast — back off |
| `InvalidInputError` | other 4xx | Malformed request (a malformed *IBAN* is a 200, see above) |
| `APIError` | 5xx | Server-side failure — retry with backoff |

## For LLM agents (LangChain, LlamaIndex, CrewAI, AutoGen)

The IBANforge API is also available as a native MCP server (`npx -y ibanforge-mcp`) and via x402 micropayments — see the [agent guide](https://ibanforge.com/agents). For Python-first agents, the SDK above is usually enough.

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

- API documentation: <https://ibanforge.com/docs>
- Interactive OpenAPI: <https://ibanforge.com/openapi>
- Agent guide: <https://ibanforge.com/agents>
- TypeScript SDK: [`@ibanforge/sdk`](https://www.npmjs.com/package/@ibanforge/sdk)
- MCP server: [`ibanforge-mcp`](https://www.npmjs.com/package/ibanforge-mcp)
- Source: <https://github.com/cammac-creator/ibanforge>

## License

MIT.

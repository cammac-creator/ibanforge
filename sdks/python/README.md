# IBANforge Python SDK

[![PyPI](https://img.shields.io/pypi/v/ibanforge.svg)](https://pypi.org/project/ibanforge/)
[![Python](https://img.shields.io/pypi/pyversions/ibanforge.svg)](https://pypi.org/project/ibanforge/)
[![License](https://img.shields.io/pypi/l/ibanforge.svg)](https://pypi.org/project/ibanforge/)

Official Python SDK for the [IBANforge API](https://ibanforge.com) — IBAN validation, BIC/SWIFT lookup, Swiss BC-Nummer, and sanctions/SEPA/VoP compliance triage.

Built for AI finance agents and fintech developers. Sync + async clients, full type hints, typed exceptions.

## Install

```bash
pip install ibanforge
```

## Get a free API key (1 line, no signup form)

```python
from ibanforge import IBANforge

key = IBANforge.generate_api_key("you@example.com")
print(key["api_key"])  # ifk_… — store it, it's shown only once
print(key["monthly_limit"])  # 200 free requests/month
```

When the monthly quota is exhausted, the API automatically falls back to advertising x402 payment requirements (no dead-end). Your key resumes working at the start of the next month.

## Quick start (sync)

```python
from ibanforge import IBANforge

with IBANforge(api_key="ifk_...") as client:
    out = client.validate_iban("CH9300762011623852957")

    print(out["valid"])                  # True
    print(out["country"])                # {"code": "CH", "name": "Switzerland"}
    print(out["bic"]["bankName"])        # "UBS Switzerland AG"
    print(out["bic"]["lei"])             # "BFM8T61CT2L1QCEMIK50"
    print(out["sepa"])                   # {"reachable": True, "instant": True}
    print(out["vop"]["participant"])     # True
    print(out["ch_clearing"]["bc_nummer"])  # "762"
    print(out["risk_score"])             # 5
```

## Quick start (async)

```python
import asyncio
from ibanforge import AsyncIBANforge

async def main():
    async with AsyncIBANforge(api_key="ifk_...") as ibanforge:
        # Fan out 100 validations concurrently
        results = await asyncio.gather(*[
            ibanforge.validate_iban(iban) for iban in ibans
        ])
        valid = sum(1 for r in results if r["valid"])
        print(f"{valid}/{len(results)} valid")

asyncio.run(main())
```

## All endpoints

| Method | Cost | What it does |
|---|---|---|
| `format_iban(iban)` | **free** | Pure mod-97 + structure check. Use to pre-filter malformed IBANs before paying. |
| `validate_iban(iban)` | $0.005 | Full enrichment — BIC, country, EMI/vIBAN flag, SEPA + VoP, risk score, Swiss BC-Nummer for CH/LI |
| `validate_batch([iban, ...])` | $0.002 / IBAN | Up to 100 IBANs in one call. CSV cleanup, payout list triage. |
| `lookup_bic(code)` | $0.003 | Resolve BIC/SWIFT into bank name, country, city, LEI, address. 121,197 BIC entries (38,761 LEI-enriched via GLEIF). |
| `lookup_ch_clearing(iid)` | $0.003 | Resolve a Swiss BC-Nummer / IID. The only API with this data. |
| `check_compliance(iban)` | $0.02 | Pre-flight risk triage: sanctions (OFAC/EU/UN), FATF, SEPA Instant, VoP, risk score 0-100, recommended_action ∈ {allow, review, block} |
| `usage()` | free | Current month quota usage for your key |
| `health()` | free | API version, BIC count, uptime |

## Free format check (no key needed)

Save money by pre-filtering bad IBANs before paying for enrichment:

```python
from ibanforge import IBANforge

with IBANforge() as client:  # no api_key required
    out = client.format_iban("CH9300762011623852957")
    if not out["valid"]:
        print("Skip:", out["error"])      # e.g. "checksum_failed"
    else:
        print(out["bban"]["bank_code"])   # "00762"
```

## Compliance triage (the killer feature)

```python
out = client.check_compliance("RU1234567890123456789012345678")  # made-up RU
print(out["risk_score"])             # high (Russia + FATF flag)
print(out["recommended_action"])     # "block" | "review" | "allow"
print(out["sanctions"]["lists"])     # ["OFAC", "EU"] etc.
print(out["fatf"]["list"])           # "grey" | "black" | "none"
print(out["sepa"]["reachable"])
```

## Error handling

The SDK raises typed exceptions — catch the specific class you care about, or the base `IBANforgeError`:

```python
from ibanforge import (
    IBANforge,
    AuthError, PaymentRequiredError, QuotaExhaustedError,
    RateLimitError, InvalidInputError, APIError, IBANforgeError,
)

with IBANforge(api_key="ifk_...") as client:
    try:
        out = client.validate_iban("not-an-iban")
    except InvalidInputError as e:
        print(e.body["error"])  # "invalid_format"
    except AuthError:
        print("Bad or revoked API key")
    except PaymentRequiredError as e:
        # Your quota is exhausted — switch to x402 to keep going
        print(e.body["accepts"])  # x402 payment requirements
    except RateLimitError:
        print("Slow down")
    except APIError as e:
        print(f"Server error {e.status} — retry with backoff")
    except IBANforgeError as e:
        print(f"Other: {e}")
```

## For LLM agents (LangChain, LlamaIndex, CrewAI, AutoGen)

The IBANforge API is also available as a native MCP server (`npx -y ibanforge-mcp`) and via x402 micropayments — see the [agent guide](https://ibanforge.com/agents). For Python-first agents, the SDK above is usually enough.

## Configuration

```python
client = IBANforge(
    api_key="ifk_...",
    base_url="https://api.ibanforge.com",  # default
    timeout=30.0,                          # seconds, default
    user_agent="my-app/1.2",               # custom UA
)
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

# IBANforge Python SDK

Official Python SDK for the [IBANforge API](https://ibanforge.com) — IBAN validation & BIC/SWIFT lookup.

## Installation

```bash
pip install ibanforge
```

## Usage

```python
from ibanforge import IBANforge

client = IBANforge()

# Validate a single IBAN
result = client.validate_iban("CH93 0076 2011 6238 5295 7")
print(result["valid"])      # True
print(result["bic"])        # "UBSWCHZH80A"
print(result["formatted"])  # "CH93 0076 2011 6238 5295 7"

# Validate multiple IBANs at once (up to 100)
batch = client.validate_batch([
    "CH93 0076 2011 6238 5295 7",
    "DE89370400440532013000",
    "FR7630006000011234567890189",
])
print(batch["valid_count"])  # 3
print(batch["results"])      # list of individual results

# Look up a BIC/SWIFT code
bic = client.lookup_bic("UBSWCHZH80A")
print(bic["institution"])  # "UBS AG"
print(bic["country"])      # "CH"
print(bic["city"])         # "BASEL"

# Check API health
status = client.health()
print(status["status"])  # "ok"

# Use as a context manager (auto-closes connection)
with IBANforge() as client:
    result = client.validate_iban("GB29NWBK60161331926819")
    print(result)
```

## Custom base URL

```python
client = IBANforge(base_url="https://your-self-hosted-ibanforge.com")
```

## Documentation

Full API reference: [https://ibanforge.com/docs](https://ibanforge.com/docs)

## License

MIT

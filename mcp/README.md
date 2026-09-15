# ibanforge-mcp

[![npm](https://img.shields.io/npm/v/ibanforge-mcp)](https://www.npmjs.com/package/ibanforge-mcp)
[![License](https://img.shields.io/npm/l/ibanforge-mcp)](https://github.com/cammac-creator/ibanforge/blob/main/LICENSE)

Official **Model Context Protocol (MCP) server** for [IBANforge](https://ibanforge.com?src=npm-mcp) — IBAN validation, BIC/SWIFT lookup, Swiss BC-Nummer (1,100+ SIX entries), EMI/vIBAN classification, SEPA + VoP reachability and compliance risk scoring.

## Tools

| Tool                  | Description                                                                                                              | Cost (USDC) |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------- |
| `validate_iban`       | Validate a single IBAN (ISO 13616 mod-97), resolve BIC, classify issuer (bank/EMI/vIBAN), SEPA + VoP flags               | 0.005       |
| `batch_validate_iban` | Validate up to 100 IBANs in one call                                                                                     | 0.002 each  |
| `lookup_bic`          | Lookup BIC/SWIFT against 121k+ BIC entries (39k+ LEI-enriched via GLEIF)                                                  | 0.003       |
| `lookup_ch_clearing`  | Lookup Swiss BC-Nummer / IID against 1,100+ SIX BankMaster entries — full rail participation (SIC, euroSIC, CHF instant) + QR-IID | 0.003       |
| `check_compliance`    | Full compliance check: IBAN + sanctions (OFAC) + SEPA Instant + VoP + risk score (0-100)                                 | 0.02        |
| `validate_payment_reference` | Validate a structured payment reference — RF/ISO 11649 ("SCOR"), Swiss QR reference ("QRR"), Belgian OGM/VCS, Finnish viitenumero — each against the dated document that publishes the rule. Supply an IBAN to get the QRR↔QR-IBAN pairing verdict (billed as one `validate_iban` call) | free |
| `check_postal_address` | Check a structured ISO 20022 postal address against SPS (SIX), HVPS+ (T2) or Fedwire rules ahead of the November 2026 changes — every finding cites its source document and date | free |
| `check_swiss_qr_bill` | Check the text payload of a Swiss QR-bill against its structural rules; does not validate the beneficiary account | free |
| `audit_creditor_file` | Audit an entire creditor/supplier file (CSV/XLSX): IBAN, bank, BIC, SEPA reach and address conformity per row, plus file-wide checks (duplicates, BIC mismatch, address vs. IBAN country). Free preview with masked IBANs; the full annotated report is a paid deliverable | free preview (report: CHF via Stripe) |
| `audit_status`        | Check payment status of an audit job created by `audit_creditor_file` and get the report download link once paid          | free        |
| `send_feedback`       | Report incorrect data, or claim the refund the x402 terms promise when a paid answer was wrong                            | free        |

## Connect and get a first result

### Remote MCP: no installation or key

Use the Streamable HTTP URL **https://api.ibanforge.com/mcp** in a compatible MCP client.
This remote service has its own allowance: 10 tool units per IP per day; each IBAN in a
batch counts as one unit. An API key does not increase this remote allowance.

For Claude Code:

```bash
claude mcp add --transport http ibanforge https://api.ibanforge.com/mcp
```

Ask: “Validate DE89370400440532013000, identify the bank, and explain what the result
can and cannot prove.” Read `valid`, `bank_code_check` and the provenance of any BIC.
A valid checksum does not prove that an account exists or belongs to a named person.

### Installed MCP: REST access with an optional reusable key

For Claude Desktop, add this to its MCP configuration; for Cursor, use `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ibanforge": {
      "command": "npx",
      "args": ["-y", "ibanforge-mcp"]
    }
  }
}
```

For Claude Code:

```bash
claude mcp add --transport stdio ibanforge -- npx -y ibanforge-mcp
```

This configuration intentionally works without a placeholder key. The installed package
calls the REST API: eligible keyless routes share its daily trial, separate
from remote MCP. Always read the returned limits; individual free utilities have their
own protections. After the trial, single-IBAN validation may return **format only**, marked
`_degraded: true` and `_scope: "format_only"`. It contains no bank, SEPA or compliance verdict.
A rejected batch returns an error; it is not expanded into individual free requests.

## Keep using the same key

Create a key without supplying an address:

```bash
curl -X POST https://api.ibanforge.com/v1/keys/generate
```

Store the returned `api_key` securely and add it as `IBANFORGE_API_KEY` in the MCP server's
`env` object, then reconnect the client. Do not paste a placeholder key and do not mint a
new key for every conversation. Normally the anonymous key gives 25 REST calls/month;
read `monthly_limit`, since a temporary protection can reduce it. It provides a stable
identity, a dedicated quota and `GET /v1/keys/usage`.

Once used, that same key can be claimed at `POST /v1/keys/claim`, with
`Authorization: Bearer ifk_…`, never a key in the body. A six-digit code sent to an address
explicitly supplied for this purpose gives 200 calls/month. An x402 payment made on the
key gives 200 calls once. Do not infer an address or initiate payment without authorization.
Prepaid credits also work with the configured key.

**This package has no wallet and does not sign or automatically pay x402 requests.**
It returns the API's payment requirements. To pay per call, use an x402-capable HTTP client
following [the payment guide](https://ibanforge.com/docs/pay-as-an-agent).

## Recover without guessing

- `isError: true`: no successful tool result. Inspect `error`, `status`, `cause` and `_hint`.
- `402`: follow the existing key's cause or configure an available key; do not create keys to bypass limits.
- `429`: wait for `retry_after` when present. The client forwards the HTTP `Retry-After` value.
- `request_timeout` / `transport_error`: no complete response was received. This is not a bank verdict.
- `_degraded: true`: only format was checked. Never use it as evidence of bank or SEPA reachability.

Requests time out after 30 seconds, including reading the response body. There is no automatic
retry: an interrupted upload or other POST may already have been processed.

## Examples

After adding the server, ask your AI agent:

- "Validate the IBAN CH10 0023 0000 0000 1234 5"
- "Look up BIC UBSWCHZH80A"
- "Look up Swiss BC-Nummer 230"
- "Run a compliance check on IBAN GB29 NWBK 6016 1331 9268 19"
- "Validate these 5 IBANs in batch: …"

## Configuration

| Env var               | Default                       | Description                                                |
| --------------------- | ----------------------------- | ---------------------------------------------------------- |
| `IBANFORGE_API_BASE`  | `https://api.ibanforge.com`   | Override for self-hosted or staging instances              |
| `IBANFORGE_API_KEY`   | _(unset)_                     | Optional real Bearer `ifk_*` key; omit until one is available |
| `IBANFORGE_TIMEOUT_MS` | `30000` | Complete HTTP response deadline, 1–120000 ms; invalid values use the default |

## Data sources

- **121k+ BIC entries** from public sources, refreshed monthly — exact live counts at [api.ibanforge.com/llms.txt](https://api.ibanforge.com/llms.txt). Sources:
  - [PeterNotenboom/SwiftCodes](https://github.com/PeterNotenboom/SwiftCodes) (MIT-licensed SWIFT directory)
  - [GLEIF](https://www.gleif.org) BIC-LEI mapping (the only rows with LEI codes, 39k+)
  - EBA Clearing STEP2 SCT (official SEPA Reachable PSPs directory)
  - Deutsche Bundesbank BLZ (official quarterly file)
  - NBP EWIB (official Polish bank registry)
  - SIX Group BankMaster (Swiss BICs)
- **1,100+ BC-Nummern** from the official [SIX BankMaster](https://www.six-group.com/en/products-services/banking-services/bank-master-data.html) CSV
- **EMI / vIBAN classification** from a curated dataset of 30+ known issuer prefixes
- **VoP participants** from the EBA RT1 / SCT Inst directories

## Links

- [Website](https://ibanforge.com?src=npm-mcp)
- [API documentation](https://ibanforge.com/docs?src=npm-mcp)
- [OpenAPI 3.1 spec](https://api.ibanforge.com/openapi.json)
- [x402 discovery](https://api.ibanforge.com/.well-known/x402)
- [Issue tracker](https://github.com/cammac-creator/ibanforge/issues)

## Legal

Calls made through this server hit the hosted API and are governed by the
[Terms of Service](https://ibanforge.com/legal/terms?src=npm-mcp) ([privacy](https://ibanforge.com/legal/privacy?src=npm-mcp),
[DPA](https://ibanforge.com/legal/dpa?src=npm-mcp)). Validation confirms IBAN structure
and registry data — it does not confirm that an account exists or belongs to
anyone; verify the payee by name before sending funds.

## License

Apache-2.0

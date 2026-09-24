# ibanforge-mcp

[![npm](https://img.shields.io/npm/v/ibanforge-mcp)](https://www.npmjs.com/package/ibanforge-mcp)
[![License](https://img.shields.io/npm/l/ibanforge-mcp)](https://github.com/cammac-creator/ibanforge/blob/main/LICENSE)

Official **Model Context Protocol (MCP) server** for [IBANforge](https://ibanforge.com?src=npm-mcp).

Check the bank behind an IBAN before you pay: validation in 89 countries, a bank-code verdict from the national register (DE, AT, BE, SK, BG, CH, LI at this release; the live list is in [llms.txt](https://api.ibanforge.com/llms.txt)), the bank and BIC with their source, the SEPA, SEPA Instant and VoP readiness of the bank, and bank-level sanctions (OFAC, EU, UN).

Not a name check (VoP, BAV, CoP), not proof that an account exists or is open, not a sanctions screening of the payee (bank and country only), not a licensed copy of the SWIFT BIC directory. The national check digits inside the BBAN are not checked yet (the French RIB key, the Italian CIN, the Spanish DC, the German account-number methods): an IBAN with a wrong national key but a correct mod-97 still comes back valid. Only the UK modulus check and the Polish settlement-number check digit are run.

For business software and AI agents alike: an API key that needs no e-mail, prepaid packs by card, and x402 micropayments on the HTTP API.

## Free access

This README gives no figures on purpose: a published package stays as it is until the next release, while the allowances of the service can change. The figures in force are served live at [rate-limits.yml](https://api.ibanforge.com/.well-known/rate-limits.yml) and by [GET /v1](https://api.ibanforge.com/v1).

- **Remote MCP, nothing to install:** `https://api.ibanforge.com/mcp` answers full tool calls without a key or a wallet, within its own allowance per source address (`mcp_anonymous` in rate-limits.yml), a batch counting one per IBAN. It is separate from the REST trial below, and an API key does not raise it.
- **This package, before you have a key:** `validate_iban` goes through the REST API's keyless trial (`rest_anonymous_trial`), counted per source address; the `trial` block of each answer says how many calls are left and when the count resets. The other paid tools need a key, prepaid credits or x402.
- **A key that needs no e-mail and no card:** `POST https://api.ibanforge.com/v1/keys/generate` with an empty body returns an `ifk_` key with a monthly allowance on every endpoint (`anonymous_key`). Claimed at `POST /v1/keys/claim` with a code mailed to an address given for this, the same key gets a larger monthly allowance (`free_tier`; see [Keep using the same key](#keep-using-the-same-key)).

## Tools

| Tool                  | Description                                                                                                              | Cost (USDC) |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------- |
| `validate_iban`       | Validate a single IBAN (ISO 13616 mod-97), resolve BIC, classify issuer (bank/EMI/vIBAN), SEPA + VoP flags               | 0.005       |
| `batch_validate_iban` | Validate up to 100 IBANs in one call                                                                                     | 0.002 each  |
| `lookup_bic`          | Lookup BIC/SWIFT against 121k+ BIC entries (39k+ LEI-enriched via GLEIF)                                                  | 0.003       |
| `lookup_ch_clearing`  | Lookup Swiss BC-Nummer / IID against 1,100+ SIX BankMaster entries — full rail participation (SIC, euroSIC, CHF instant) + QR-IID | 0.003       |
| `check_compliance`    | Pre-payment check: IBAN + sanctions lists (OFAC, EU, UN) matched on the payee's bank (BIC8) and country, never on the payee's name + FATF + SEPA Instant + VoP readiness + risk score (0-100) | 0.02        |
| `validate_payment_reference` | Validate a structured payment reference — RF/ISO 11649 ("SCOR"), Swiss QR reference ("QRR"), Belgian OGM/VCS, Finnish viitenumero — each against the dated document that publishes the rule. Supply an IBAN to get the QRR↔QR-IBAN pairing verdict (billed as one `validate_iban` call) | free |
| `check_postal_address` | Check a structured ISO 20022 postal address against SPS (SIX), HVPS+ (T2) or Fedwire rules ahead of the November 2026 changes — every finding cites its source document and date | free |
| `check_swiss_qr_bill` | Check the text payload of a Swiss QR-bill against its structural rules; does not validate the beneficiary account | free |
| `audit_creditor_file` | Audit an entire creditor/supplier file (CSV/XLSX): IBAN, bank, BIC, SEPA reach and address conformity per row, plus file-wide checks (duplicates, BIC mismatch, address vs. IBAN country). Free preview with masked IBANs; the full annotated report is a paid deliverable | free preview (report: CHF via Stripe) |
| `audit_status`        | Check payment status of an audit job created by `audit_creditor_file` and get the report download link once paid          | free        |
| `send_feedback`       | Report incorrect data, or claim the refund the x402 terms promise when a paid answer was wrong                            | free        |
| `request_api_key`     | Open a key request a human approves in a browser — no e-mail, no card, no account. Shows a short code and a link to hand to your human | free        |
| `poll_api_key`        | Collect the key once a human has approved it. Handed over exactly once, with the line to paste into an MCP client config  | free        |

The USDC prices are those of x402 payments on the HTTP API, the only way a batch costs less per IBAN than single validations. On a key or prepaid credits, each paid call uses one request or one credit, and each IBAN of a batch uses one.

## Get a durable key from inside your MCP client

No e-mail, no account, no form. Four steps, about fifteen seconds of human time:

1. Call **`request_api_key`**. Read `status` first — `ok` means a code was issued.
2. Show your human the `display_to_human` block **verbatim**: it carries the short code
   and the link. Do not open the link yourself, and never invent an address.
3. Your human opens the page, checks the code matches, and clicks. The page gives a key
   with no address at all; they may add one there to raise the monthly allowance.
4. Call **`poll_api_key`** (no argument needed). On `approved` it carries the key **once**,
   plus a ready-made `config_line` to paste. Save it as `IBANFORGE_API_KEY` and reconnect.

Both tools are free and keep working after the free allowance is spent — that is the point
of them.

## Connect and get a first result

### Remote MCP: no installation or key

Use the Streamable HTTP URL **https://api.ibanforge.com/mcp** in a compatible MCP client.
This remote service has its own allowance per source address (see [Free access](#free-access));
each IBAN in a batch counts as one unit. An API key does not increase this remote allowance.

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
calls the REST API: without a key, `validate_iban` uses its keyless trial, separate
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
new key for every conversation. The key starts at the monthly allowance given in
[Free access](#free-access); read `monthly_limit`, since a temporary protection can reduce it.
It provides a stable identity, a dedicated quota and `GET /v1/keys/usage`.

Once used, that same key can be claimed at `POST /v1/keys/claim`, with
`Authorization: Bearer ifk_…`, never a key in the body. A six-digit code sent to an address
explicitly supplied for this purpose raises the key's monthly allowance, every month. An x402
payment made on the key raises it once. The figures are those of `free_tier` in
[rate-limits.yml](https://api.ibanforge.com/.well-known/rate-limits.yml). Do not infer an
address or initiate payment without authorization. Prepaid credits also work with the
configured key: one credit per call, and one per IBAN in a batch.

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

- "Validate the IBAN DE89 3704 0044 0532 0130 00 and tell me which bank holds its code"
- "Is the bank code of CH93 0076 2011 6238 5295 7 allocated?" (the IBAN passes mod-97; the
  SIX register allocates its bank code to nobody, so `bank_code_check.reason` is `not_allocated`)
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

- **Bank-code verdict**: the national registers of Germany (Bundesbank), Austria (OeNB), Belgium (NBB), Slovakia (NBS), Bulgaria (BNB) and Switzerland and Liechtenstein (SIX BankMaster) at this release, where a code the register does not hold is `not_allocated`; elsewhere a partial register or a composite map, where a miss is not a refusal. The live list is in [llms.txt](https://api.ibanforge.com/llms.txt).
- **121k+ BIC entries** (entries, not institutions). GLEIF and the national registers are refreshed monthly; the SwiftCodes rows are a public copy of the SWIFT directory frozen in January 2018, re-imported without changing, and still about two thirds of the directory. Exact live counts at [api.ibanforge.com/llms.txt](https://api.ibanforge.com/llms.txt). Sources:
  - [PeterNotenboom/SwiftCodes](https://github.com/PeterNotenboom/SwiftCodes) (MIT-licensed public copy of the SWIFT directory, data frozen in January 2018)
  - [GLEIF](https://www.gleif.org) BIC-LEI mapping (the only rows with LEI codes, 39k+)
  - EBA Clearing STEP2 SCT (official SEPA Reachable PSPs directory)
  - Deutsche Bundesbank BLZ (official quarterly file)
  - NBP EWIB (official Polish bank registry)
  - SIX Group BankMaster (Swiss BICs)
- **1,100+ BC-Nummern** from the official [SIX BankMaster](https://www.six-group.com/en/products-services/banking-services/bank-master-data.html) CSV
- **EMI / vIBAN classification** from a curated set of non-bank issuers (EMIs, payment institutions, digital banks) and, for Spanish bank codes, the EBA PSD2 register; the live count is served at [llms.txt](https://api.ibanforge.com/llms.txt)
- **VoP readiness** from the EPC Verification of Payee scheme register (`vop.csv`), refreshed weekly with the other compliance lists
- **Sanctions** from the OFAC, EU and UN lists, matched on the payee's bank (BIC8) and country, never on the payee's name

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

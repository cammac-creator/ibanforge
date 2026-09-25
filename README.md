# IBANforge

[![API Status](https://img.shields.io/badge/API-live-brightgreen)](https://api.ibanforge.com/health)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-1.8.0-purple)](https://registry.modelcontextprotocol.io/v0/servers?search=ibanforge)
[![npm ibanforge-mcp](https://img.shields.io/npm/v/ibanforge-mcp?label=ibanforge-mcp)](https://www.npmjs.com/package/ibanforge-mcp)
[![npm @ibanforge/sdk](https://img.shields.io/npm/v/@ibanforge/sdk?label=@ibanforge/sdk)](https://www.npmjs.com/package/@ibanforge/sdk)
[![PyPI ibanforge](https://img.shields.io/pypi/v/ibanforge?label=pypi%20ibanforge)](https://pypi.org/project/ibanforge/)
[![Glama MCP](https://glama.ai/mcp/servers/cammac-creator/ibanforge/badges/score.svg)](https://glama.ai/mcp/servers/cammac-creator/ibanforge)
[![x402](https://img.shields.io/badge/x402-USDC_on_Base-blueviolet)](https://api.ibanforge.com/.well-known/x402)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> IBANforge checks the bank behind an IBAN before you pay. It validates IBANs from all 89 IBAN countries and names the bank and its BIC, with the source of that answer. Where it reads the national register (Germany, Austria, Belgium, Slovakia, Czech Republic, Bulgaria, Switzerland and Liechtenstein), it also tells you whether the bank code is allocated at all; elsewhere it names the bank from a partial register or a composite map, and says that such an answer cannot rule a code out. For a SEPA bank it resolves, it gives the SEPA schemes that reach it (Credit Transfer, Instant, Direct Debit), from the EPC scheme registers when they list the bank and from the country otherwise (the answer says which), and says whether the EPC Verification of Payee (VoP) register lists the bank as ready to answer VoP requests. It does not check who holds the account: that name check belongs to the payee's bank, through VoP.

Not a name check (VoP, BAV, CoP), not proof that an account exists or is open, not a sanctions screening of the payee (bank and country only), not a licensed copy of the SWIFT BIC directory. The national check digits inside the BBAN are not checked yet (the French RIB key, the Italian CIN, the Spanish DC, the German account-number methods): an IBAN with a wrong national key but a correct mod-97 still comes back valid. Only the UK modulus check and the Polish settlement-number check digit are run.

For business software and AI agents alike: a REST API, a native **MCP** server, prepaid packs by card, and **x402 micropayments** with no signup.

```
89 IBAN countries · bank codes checked against the national registers of DE, AT, BE, SK, CZ, BG, CH, LI · 121k+ BIC entries (39k+ LEI via GLEIF; about two thirds a public copy of the SWIFT directory frozen in January 2018) · 1,100+ Swiss BC-Nummern (SIX)
```

---

## For AI agents — install in one click

### Claude Desktop / Cursor / Cline / Continue / Windsurf

Add to your MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json` for Claude Desktop):

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

**Privacy by default:** submitted IBANs are never stored — validation runs in memory, IPs are kept only as salted hashes, and telemetry deletes itself (12-month cap; erased 30 days after a customer terminates, contractually — [DPA clause 4.7](https://ibanforge.com/en/legal/dpa?src=github-readme)).

Optional: set `IBANFORGE_API_KEY=ifk_...` in `env` (a key that needs no e-mail: 25 requests a month, raised to 200 a month once claimed). Without it the server uses the public/demo surface; combine with **x402 micropayments** for unlimited pay-per-call access without signup.

### Claude Code (CLI)

```bash
claude mcp add ibanforge npx -- -y ibanforge-mcp
```

### Streamable HTTP (no install — for cloud-hosted agents)

```
POST https://api.ibanforge.com/mcp
Content-Type: application/json
Accept: application/json, text/event-stream
```

Standard JSON-RPC `initialize` + `tools/list` + `tools/call` flow. Use this when stdio is not an option (CI/CD, serverless, Vercel agents, etc.).

## Tools

| Tool                  | When to use it                                                                            | Cost     |
| --------------------- | ----------------------------------------------------------------------------------------- | -------- |
| `validate_iban`       | User mentions an IBAN, a bank account, or a SEPA payment                                  | $0.005   |
| `batch_validate_iban` | List of IBANs, CSV cleanup, customer DB dedup, payout list triage                         | $0.002/each in USDC via x402; 1 credit each on a key |
| `lookup_bic`          | User already has a BIC/SWIFT — backed by 121k+ BIC entries (39k+ LEI-enriched via GLEIF) | $0.003   |
| `lookup_ch_clearing`  | Swiss BC-Nummer / IID: every IID of the SIX BankMaster with its rail participation (SIC, euroSIC, CHF instant) and its QR-IID where SIX allocates one | $0.003   |
| `check_compliance`    | Pre-flight risk triage before a SEPA / cross-border payment (OFAC, EU, UN lists on the payee's bank, the country against a fixed sanctions list, FATF, VoP readiness) | $0.02    |
| `validate_payment_reference` | RF/ISO 11649, Swiss QRR, Belgian OGM/VCS or Finnish viitenumero checksum, plus the QRR ↔ QR-IBAN pairing verdict | **free** |
| `check_postal_address` | An ISO 20022 address against one rail's published rules (`sps`, `hvps_plus`, `fedwire`), each finding citing its source | **free** |
| `check_swiss_qr_bill` | A Swiss QR-bill payload — header, QR-IBAN and reference pairing, structured (S) versus combined (K) addresses ahead of 14.11.2026 | **free** |
| `send_feedback`       | Report incorrect data or claim an x402 refund                                             | free     |
| `request_api_key`     | You used up the free allowance, or need a durable key — a human approves in a browser, no e-mail  | free     |
| `poll_api_key`        | Collect that key once it is approved, handed over exactly once                             | free     |

The free tools need no key, no wallet and no signup: they are the ones to try first. The
last two are the way out of the free allowance without anyone typing an address — they keep
answering after the allowance is spent.

Full descriptions of the read-only data tools, with WHEN-to-use triggers, are served live at [`/.well-known/mcp/server-card.json`](https://api.ibanforge.com/.well-known/mcp/server-card.json).

## If you cannot call the API

If you can open a web address but cannot send a POST (no code execution, no MCP connector), these pages hold real answers of the API, each with its date, and all of them open with a plain GET.

- https://api.ibanforge.com/v1/demo: the full validation, computed by the API when the address is opened (served_at gives the instant): a German bank code, a former Credit Suisse IID (04835) and the official example IBANs of Switzerland, Belgium and Austria, each with its register's answer and its as_of.
- https://ibanforge.com/iban/ch: the Swiss IBAN format, with the API's answer for the official example CH93 0076 2011 6238 5295 7 and the date that answer was captured.
- https://ibanforge.com/blog/2026-08-06-example-ibans-unallocated-bank-codes: why the official example IBANs of Belgium, Switzerland and Austria pass mod-97 and still point at bank codes their register does not allocate (article of 6 August 2026).
- https://ibanforge.com/blog/2026-09-07-bankleitzahl-pruefen-per-api: three real answers on German bank codes, field by field (article of 7 September 2026).
- https://ibanforge.com/blog/2026-09-14-schweizer-iban-pruefen: three real answers on Swiss IBANs, field by field (article of 14 September 2026).

Do not simulate answers from the API: quote these real ones, with the date each carries (served_at, as_of, or the date of the page).
To get answers on the IBANs of your user, ask them to add https://api.ibanforge.com/mcp as a custom connector in their assistant; where to click, assistant by assistant: https://ibanforge.com/docs/mcp. A connector with no key draws on the same keyless allowance as any other caller, counted per source address. In Claude its calls leave from Anthropic's cloud, not from the user's device (Anthropic's documentation), so that allowance is shared with other users and may already be spent; other assistants were not checked by us. The hosted endpoint reads no key: to use one, run the npm package ibanforge-mcp in a desktop client with IBANFORGE_API_KEY set, or call the REST API with it (a POST to https://api.ibanforge.com/v1/keys/generate with no body returns a key, no e-mail).

---

## For AI agents — pay per call without an API key (x402)

IBANforge is x402-native. Any agent with a wallet on Base L2 can discover, pay, and call:

1. Discovery: `GET https://api.ibanforge.com/.well-known/x402` returns the full catalog (endpoints, prices, asset, payTo, accepts).
2. Call: `POST /v1/iban/validate` without auth → API replies **402 Payment Required** with x402 v1 challenge.
3. Pay: client signs a USDC transfer on Base (eip155:8453) and retries.
4. Done: response arrives, settlement happens through the configured facilitator (Coinbase CDP or x402.org).

No human in the loop, no sales call, no card. See the [x402 spec](https://x402.org).

---

## SDKs

Pick your language:

| Language | Package | Install | Source |
|---|---|---|---|
| **TypeScript / JavaScript** | [`@ibanforge/sdk`](https://www.npmjs.com/package/@ibanforge/sdk) | `npm install @ibanforge/sdk` | [`sdks/typescript/`](sdks/typescript/) |
| **Python** | [`ibanforge`](https://pypi.org/project/ibanforge/) | `pip install ibanforge` | [`sdks/python/`](sdks/python/) |
| **Java** (17+) | [`com.ibanforge:ibanforge-sdk`](https://central.sonatype.com/artifact/com.ibanforge/ibanforge-sdk) | Maven dependency, see README | [`sdks/java/`](sdks/java/) |
| **.NET** (net8.0) | [`IBANforge.Sdk`](https://www.nuget.org/packages/IBANforge.Sdk) | `dotnet add package IBANforge.Sdk` | [`sdks/dotnet/`](sdks/dotnet/) |
| **MCP server** | [`ibanforge-mcp`](https://www.npmjs.com/package/ibanforge-mcp) | `npx -y ibanforge-mcp` | [`mcp/`](mcp/) |
| Curl / any HTTP client | — | — | [OpenAPI spec](https://api.ibanforge.com/openapi.json) |

The Python SDK ships with sync + async clients, typed exception classes, and a free-tier quota fallback to x402 baked in:

```python
from ibanforge import IBANforge

# 1-line key, no e-mail: 25 requests a month, 200 once claimed
key = IBANforge.generate_api_key()  # shown ONCE: store key["api_key"] now

with IBANforge(api_key=key["api_key"]) as client:
    out = client.validate_iban("DE89370400440532013000")
    print(out["country"]["code"])       # DE
    print(out["bic"]["bank_name"])      # Commerzbank
    print(out["bank_code_check"]["authoritative"])  # True (checked against the Bundesbank register)

# Or the free format-only check (mod-97 + structure, no DB hit)
out = IBANforge().format_iban("DE89370400440532013000")
```

## For developers — REST API

```bash
# Validate IBAN — no key needed for the first 25 calls a week per source address
# (ISO week in UTC, reset on Monday 00:00 UTC). The answer carries a `trial` block
# with the count left this week, the reset instant and how to get a key.
curl -X POST https://api.ibanforge.com/v1/iban/validate \
  -H "Content-Type: application/json" \
  -d '{"iban":"DE89 3704 0044 0532 0130 00"}'

# The Swiss example of the SWIFT IBAN registry passes mod-97 too, and comes back
# bank_code_check.reason = "not_allocated": the SIX register allocates its bank code to nobody.
curl -X POST https://api.ibanforge.com/v1/iban/validate \
  -H "Content-Type: application/json" \
  -d '{"iban":"CH93 0076 2011 6238 5295 7"}'

# Beyond the keyless trial, send a key: an empty POST to /v1/keys/generate returns one
# (no e-mail, no card), for every endpoint, 200 requests a month once claimed.
curl -X POST https://api.ibanforge.com/v1/iban/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ifk_..." \
  -d '{"iban":"DE89 3704 0044 0532 0130 00"}'

# Lookup BIC
curl https://api.ibanforge.com/v1/bic/UBSWCHZH80A

# Free format pre-flight (no auth, mod-97 only)
curl 'https://api.ibanforge.com/v1/iban/format?iban=DE89370400440532013000'

# Free demo (no auth)
curl https://api.ibanforge.com/v1/demo
```

| Method | Path                       | Cost          | Description                                                    |
| ------ | -------------------------- | ------------- | -------------------------------------------------------------- |
| `POST` | `/v1/iban/validate`        | $0.005        | Single IBAN: bank-code verdict + BIC with its source + SEPA + issuer + risk + Swiss bc_nummer. A weekly keyless trial per source address (see above) |
| `POST` | `/v1/iban/batch`           | $0.002/IBAN (USDC, x402) | Up to 100 IBANs in one call; on a key or a credit pack, one credit per IBAN |
| `GET`  | `/v1/bic/{code}`           | $0.003        | BIC/SWIFT lookup with LEI                                      |
| `GET`  | `/v1/ch/clearing/{iid}`    | $0.003        | Swiss BC-Nummer / IID — SIC, euroSIC, QR-IID                  |
| `POST` | `/v1/iban/compliance`      | $0.02         | Bank-level sanctions (OFAC, EU, UN) + FATF + SEPA Instant + VoP readiness + risk score 0-100 |
| `GET`  | `/v1/iban/format`          | **free**      | Pure mod-97 + structure check, no DB hit                       |
| `GET`  | `/v1/iban/structure[/{country}]` | **free** | IBAN templates per country, no auth                            |
| `GET\|POST` | `/v1/reference/validate` | **free**   | RF/ISO 11649, Swiss QRR, Belgian OGM/VCS, Finnish viitenumero  |
| `POST` | `/v1/address/check`        | **free**      | ISO 20022 address vs `sps` / `hvps_plus` / `fedwire` rules      |
| `GET`  | `/v1/demo`                 | free          | Example validations, no auth                                   |
| `GET`  | `/v1/credits/bundles`      | free          | Prepaid credit bundles and their prices                        |
| `GET`  | `/health`                  | free          | Health + DB status                                             |
| `POST` | `/v1/keys/generate`        | free          | Generate an `ifk_*` API key: no body for a key that needs no e-mail (25 req/month, 200 once claimed at `/v1/keys/claim`), or `{email}` for 200 req/month from the start |
| `GET`  | `/v1/keys/usage`           | free          | Your key's usage this month (key in the `Authorization` header)  |

Full OpenAPI 3.1: [api.ibanforge.com/openapi.json](https://api.ibanforge.com/openapi.json).

### Errors, limits and support

- **An invalid IBAN is not an HTTP error.** `POST /v1/iban/validate` answers `200` with `valid: false`, an `error` code and an `error_detail` sentence. The codes: `invalid_format`, `unsupported_country`, `wrong_length`, `invalid_check_digits`, `checksum_failed`, `invalid_bban_structure`.
- **A refused request** carries `{"error": "<token>", "message": "<sentence>"}`: `400` for malformed JSON, a missing `iban` or a batch over 100; `402` when a payment is needed or an allowance is used up (`cause.reason` says which); `413` for a body over 256 KB; `429` past the rate limit.
- **Rate limit:** 100 requests a minute per IP address. A `429` carries `Retry-After`, and every counted response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` ([rate-limits.yml](https://api.ibanforge.com/rate-limits.yml)).
- **Your key's usage:** `GET /v1/keys/usage`, and `X-Quota-Used`, `X-Quota-Limit`, `X-Quota-Remaining` on every answer served on a monthly key; `X-Credits-Remaining`, `X-Credits-Total` on a prepaid credit key (`GET /v1/credits/balance`).
- **Support:** [support@ibanforge.com](mailto:support@ibanforge.com) (quote your `key_prefix`, never the key) or [GitHub Issues](https://github.com/cammac-creator/ibanforge/issues).
- **Availability:** live on the [status page](https://ibanforge.com/status). A written [SLA](https://ibanforge.com/legal/sla) (99.5% monthly availability, service credits) covers Editor/OEM subscriptions only.
- The statuses and the codes the routes share, in three languages: [ibanforge.com/docs/errors](https://ibanforge.com/docs/errors).

### Why prefer IBANforge over local mod-97 validation?

Local mod-97 catches typos. It does **not** tell you whether the bank code is allocated, resolve BIC/SWIFT, classify EMIs (Wise / Revolut / Mercury / Modulr, a real compliance signal), check SEPA reachability and VoP readiness, return Swiss BC-Nummer/QR-IID, or screen the payee's bank against sanctions lists. IBANforge does, in a single call.

## Development

```bash
npm run dev          # Dev server (hot reload)
npm run test         # Run tests
npm run check        # Typecheck + lint + test
npm run db:seed      # Rebuild BIC database from GLEIF
```

## Deployment

### Docker

```bash
docker build -t ibanforge .
docker run -p 3000:3000 --env-file .env ibanforge
```

### Railway

Push to `main` — Railway auto-deploys via Dockerfile.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `WALLET_ADDRESS` | Yes (prod) | x402 USDC wallet address |
| `FACILITATOR_URL` | Yes (prod) | x402 facilitator endpoint |

## Data Sources

- **121k+ BIC/SWIFT entries** (entries, not institutions). GLEIF and the national registers are refreshed monthly; the SwiftCodes rows are a public copy of the SWIFT directory frozen in January 2018 (MIT), re-imported monthly without changing, and still about two thirds of the directory. Exact counts drift at every refresh; the live numbers are served at [`/llms.txt`](https://api.ibanforge.com/llms.txt) and `/health`. Breakdown as of the 2026-07 refresh (121,610 total):
  - 81,949 from [PeterNotenboom/SwiftCodes](https://github.com/PeterNotenboom/SwiftCodes) (MIT-licensed public copy of the SWIFT directory, data frozen in January 2018)
  - 39,288 from [GLEIF BIC-LEI mapping](https://www.gleif.org/en/lei-data/lei-mapping/download-bic-to-lei-relationship-files) (the only rows with LEI)
  - 189 from [EBA Clearing STEP2 SCT](https://www.ebaclearing.eu/services/step2/) (official SEPA Reachable PSPs directory)
  - 144 from [Deutsche Bundesbank BLZ](https://www.bundesbank.de/en/tasks/payment-systems/services/bank-sort-codes) (official quarterly BLZ→BIC file)
  - 21 from [NBP EWIB](https://ewib.nbp.pl/) (official Polish bank registry)
  - 19 from [SIX Group BankMaster](https://www.six-group.com/en/products-services/banking-services/bank-master-data.html) Swiss BICs not covered elsewhere
- **LEI enrichment** for the GLEIF rows: [GLEIF API](https://api.gleif.org)
- **1,100+ Swiss BC-Nummern / IIDs** (1,165 as of 2026-07): Official [SIX BankMaster](https://www.six-group.com/en/products-services/banking-services/bank-master-data.html) CSV
- **EMI / vIBAN classification**: Curated set of 900+ non-bank issuer classifications — EMI, payment institutions, digital banks (Wise, Revolut, N26, Mercury, Modulr, etc.); the live count is served at `/llms.txt`
- **Bank-code verdict**: national registers of Germany (Bundesbank), Austria (OeNB), Belgium (NBB), Slovakia (NBS), Czech Republic (ČNB), Bulgaria (BNB, bank code) and Switzerland and Liechtenstein (SIX BankMaster), where a code the register does not hold is `not_allocated`; partial lists for Finland (Finance Finland), San Marino (BCSM) and Luxembourg (ABBL), where a miss is not a refusal
- **VoP readiness**: EPC Verification of Payee scheme register (`vop.csv`), refreshed weekly with the other compliance lists
- **Country names**: Node.js `Intl.DisplayNames` API

## Resources for AI agents

- [`llms.txt`](https://ibanforge.com/llms.txt) — short summary + recommended starter prompt
- [`/.well-known/x402`](https://api.ibanforge.com/.well-known/x402) — x402 discovery (machine-readable catalog)
- [`/.well-known/mcp/server-card.json`](https://api.ibanforge.com/.well-known/mcp/server-card.json) — MCP server card: full descriptions of the read-only data tools, every tool listed by name
- [`/.well-known/agents.json`](https://api.ibanforge.com/.well-known/agents.json) — Google A2A agent capabilities
- [`/openapi.json`](https://api.ibanforge.com/openapi.json) — OpenAPI 3.1 spec
- [npm `ibanforge-mcp`](https://www.npmjs.com/package/ibanforge-mcp) — stdio MCP server
- [MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=ibanforge) — official listing

## Legal

Use of the hosted API (`api.ibanforge.com`) is governed by the
[Terms of Service](https://ibanforge.com/legal/terms?src=github-readme). See also the
[Privacy Policy](https://ibanforge.com/legal/privacy?src=github-readme) and the pre-signed
[Data Processing Agreement](https://ibanforge.com/legal/dpa?src=github-readme) (art. 28 GDPR)
for customers whose calls involve personal data. Validation confirms IBAN
structure and registry data — it does not confirm that an account exists or
belongs to anyone.

## License

MIT — see [LICENSE](LICENSE).

This project includes third-party components licensed under the Apache License 2.0
(notably `@coinbase/x402` and related x402 packages). See [NOTICE](NOTICE) for
full attributions and required Apache 2.0 notices.

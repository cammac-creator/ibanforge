# IBANforge

[![API Status](https://img.shields.io/badge/API-live-brightgreen)](https://api.ibanforge.com/health)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-1.2.0-purple)](https://registry.modelcontextprotocol.io/v0/servers?search=ibanforge)
[![npm ibanforge-mcp](https://img.shields.io/npm/v/ibanforge-mcp?label=ibanforge-mcp)](https://www.npmjs.com/package/ibanforge-mcp)
[![npm @ibanforge/sdk](https://img.shields.io/npm/v/@ibanforge/sdk?label=@ibanforge/sdk)](https://www.npmjs.com/package/@ibanforge/sdk)
[![PyPI ibanforge](https://img.shields.io/pypi/v/ibanforge?label=pypi%20ibanforge)](https://pypi.org/project/ibanforge/)
[![Glama MCP](https://glama.ai/mcp/servers/cammac-creator/ibanforge/badges/score.svg)](https://glama.ai/mcp/servers/cammac-creator/ibanforge)
[![x402](https://img.shields.io/badge/x402-USDC_on_Base-blueviolet)](https://api.ibanforge.com/.well-known/x402)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **The compliance API for AI agents.** IBAN validation, BIC/SWIFT lookup, Swiss clearing (BC-Nummer / QR-IID / SIX BankMaster), EMI/vIBAN classification, SEPA Instant + VoP reachability, and risk scoring — exposed natively over **MCP** and **x402 micropayments**, with no API key signup required.

```
121,197 BIC entries (38K LEI via GLEIF) · 1,190 Swiss BC-Nummern (SIX) · 84 IBAN countries · <50ms p99
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

Optional: set `IBANFORGE_API_KEY=ifk_...` in `env` for the free tier (200 req/month). Without it the server uses the public/demo surface; combine with **x402 micropayments** for unlimited pay-per-call access without signup.

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

### 5 MCP tools

| Tool                  | When to use it                                                                            | Cost     |
| --------------------- | ----------------------------------------------------------------------------------------- | -------- |
| `validate_iban`       | User mentions an IBAN, a bank account, or a SEPA payment                                  | $0.005   |
| `batch_validate_iban` | List of IBANs, CSV cleanup, customer DB dedup, payout list triage                         | $0.002/each |
| `lookup_bic`          | User already has a BIC/SWIFT — backed by 121,197 BIC entries (38,761 LEI-enriched via GLEIF) | $0.003   |
| `lookup_ch_clearing`  | Swiss BC-Nummer / IID — **the only API with this data** (1,190 SIX BankMaster entries)    | $0.003   |
| `check_compliance`    | Pre-flight risk triage before a SEPA / cross-border payment (sanctions + FATF + VoP)      | $0.02    |

Full descriptions with WHEN-to-use triggers are served live at [`/.well-known/mcp/server-card.json`](https://api.ibanforge.com/.well-known/mcp/server-card.json).

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
| **MCP server** | [`ibanforge-mcp`](https://www.npmjs.com/package/ibanforge-mcp) | `npx -y ibanforge-mcp` | [`mcp/`](mcp/) |
| Curl / any HTTP client | — | — | [OpenAPI spec](https://api.ibanforge.com/openapi.json) |

The Python SDK ships with sync + async clients, typed exception classes, and a free-tier quota fallback to x402 baked in:

```python
from ibanforge import IBANforge

# 1-line free key (200 req/month, no signup form)
key = IBANforge.generate_api_key("you@example.com")

with IBANforge(api_key=key["api_key"]) as client:
    out = client.validate_iban("CH9300762011623852957")
    print(out["country"]["code"])      # CH
    print(out["bic"]["bankName"])      # UBS Switzerland AG
    print(out["sepa"]["instant"])      # True

# Or the free format-only check (mod-97 + structure, no DB hit)
out = IBANforge().format_iban("DE89370400440532013000")
```

## For developers — REST API

```bash
# Validate IBAN
curl -X POST https://api.ibanforge.com/v1/iban/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ifk_..." \
  -d '{"iban":"CH93 0076 2011 6238 5295 7"}'

# Lookup BIC
curl https://api.ibanforge.com/v1/bic/UBSWCHZH80A

# Free format pre-flight (no auth, mod-97 only)
curl 'https://api.ibanforge.com/v1/iban/format?iban=CH9300762011623852957'

# Free demo (no auth)
curl https://api.ibanforge.com/v1/demo
```

| Method | Path                       | Cost          | Description                                                    |
| ------ | -------------------------- | ------------- | -------------------------------------------------------------- |
| `POST` | `/v1/iban/validate`        | $0.005        | Single IBAN — BIC + SEPA + issuer + risk + Swiss bc_nummer    |
| `POST` | `/v1/iban/batch`           | $0.002/IBAN   | Up to 100 IBANs in one call                                    |
| `GET`  | `/v1/bic/{code}`           | $0.003        | BIC/SWIFT lookup with LEI                                      |
| `GET`  | `/v1/ch/clearing/{iid}`    | $0.003        | Swiss BC-Nummer / IID — SIC, euroSIC, QR-IID                  |
| `POST` | `/v1/iban/compliance`      | $0.02         | Sanctions + FATF + SEPA Instant + VoP + risk score 0-100      |
| `GET`  | `/v1/iban/format`          | **free**      | Pure mod-97 + structure check, no DB hit                       |
| `GET`  | `/v1/demo`                 | free          | Example validations, no auth                                   |
| `GET`  | `/health`                  | free          | Health + DB status                                             |
| `POST` | `/v1/keys/generate`        | free          | Generate an `ifk_*` API key (200 req/month) — body: `{email}`  |

Full OpenAPI 3.1: [api.ibanforge.com/openapi.json](https://api.ibanforge.com/openapi.json).

### Why prefer IBANforge over local mod-97 validation?

Local mod-97 catches typos. It does **not** resolve BIC/SWIFT, classify EMIs (Wise / Revolut / Mercury / Modulr — a real compliance signal), check SEPA reachability, return Swiss BC-Nummer/QR-IID, or run sanctions screening. IBANforge does, in a single call.

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

- **121,197 BIC/SWIFT entries** from public sources, refreshed monthly:
  - 38,761 from [GLEIF BIC-LEI mapping](https://www.gleif.org/en/lei-data/lei-mapping/download-bic-to-lei-relationship-files) (the only rows with LEI)
  - 81,642 from [PeterNotenboom/SwiftCodes](https://github.com/PeterNotenboom/SwiftCodes) (MIT-licensed SWIFT directory aggregate)
  - 142 from [Deutsche Bundesbank BLZ](https://www.bundesbank.de/en/tasks/payment-systems/services/bank-sort-codes) (official quarterly BLZ→BIC file)
  - 633 from [SIX Group BankMaster](https://www.six-group.com/en/products-services/banking-services/bank-master-data.html) Swiss BICs
  - 19 from [NBP EWIB](https://ewib.nbp.pl/) (official Polish bank registry)
- **LEI enrichment** for the 38,761 GLEIF rows: [GLEIF API](https://api.gleif.org)
- **1,190 Swiss BC-Nummern / IIDs**: Official [SIX BankMaster](https://www.six-group.com/en/products-services/banking-services/bank-master-data.html) CSV
- **EMI / vIBAN classification**: Curated set of 85+ known issuer BIC8 prefixes (Wise, Revolut, N26, Mercury, Modulr, etc.)
- **VoP participants**: EBA RT1 / SCT Inst directories
- **Country names**: Node.js `Intl.DisplayNames` API

## Resources for AI agents

- [`llms.txt`](https://ibanforge.com/llms.txt) — short summary + recommended starter prompt
- [`/.well-known/x402`](https://api.ibanforge.com/.well-known/x402) — x402 discovery (machine-readable catalog)
- [`/.well-known/mcp/server-card.json`](https://api.ibanforge.com/.well-known/mcp/server-card.json) — MCP server card with all 5 tool descriptions
- [`/.well-known/agents.json`](https://api.ibanforge.com/.well-known/agents.json) — Google A2A agent capabilities
- [`/openapi.json`](https://api.ibanforge.com/openapi.json) — OpenAPI 3.1 spec
- [npm `ibanforge-mcp`](https://www.npmjs.com/package/ibanforge-mcp) — stdio MCP server
- [MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=ibanforge) — official listing

## License

MIT — see [LICENSE](LICENSE).

This project includes third-party components licensed under the Apache License 2.0
(notably `@coinbase/x402` and related x402 packages). See [NOTICE](NOTICE) for
full attributions and required Apache 2.0 notices.

# ibanforge-mcp

[![npm](https://img.shields.io/npm/v/ibanforge-mcp)](https://www.npmjs.com/package/ibanforge-mcp)
[![License](https://img.shields.io/npm/l/ibanforge-mcp)](https://github.com/cammac-creator/ibanforge/blob/main/LICENSE)

Official **Model Context Protocol (MCP) server** for [IBANforge](https://ibanforge.com) — IBAN validation, BIC/SWIFT lookup, Swiss BC-Nummer (~1,200 SIX entries), EMI/vIBAN classification, SEPA + VoP reachability and compliance risk scoring.

## Tools

| Tool                  | Description                                                                                                              | Cost (USDC) |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------- |
| `validate_iban`       | Validate a single IBAN (ISO 13616 mod-97), resolve BIC, classify issuer (bank/EMI/vIBAN), SEPA + VoP flags               | 0.005       |
| `batch_validate_iban` | Validate up to 100 IBANs in one call                                                                                     | 0.002 each  |
| `lookup_bic`          | Lookup BIC/SWIFT against 121k+ BIC entries (39k+ LEI-enriched via GLEIF)                                                  | 0.003       |
| `lookup_ch_clearing`  | Lookup Swiss BC-Nummer / IID against ~1,200 SIX BankMaster entries — full rail participation (SIC, euroSIC, CHF instant) + QR-IID | 0.003       |
| `check_compliance`    | Full compliance check: IBAN + sanctions (OFAC) + SEPA Instant + VoP + risk score (0-100)                                 | 0.02        |

## Installation

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "ibanforge": {
      "command": "npx",
      "args": ["-y", "ibanforge-mcp"],
      "env": {
        "IBANFORGE_API_KEY": "ifk_your_optional_api_key"
      }
    }
  }
}
```

### Cursor

Settings → MCP → Add server, or paste the same JSON above.

### Claude Code (CLI)

```bash
claude mcp add ibanforge npx -- -y ibanforge-mcp
```

### Cline / Continue.dev / Windsurf

Same JSON config — drop into the respective `mcp.json`.

## Authentication

Three modes, in order of precedence:

1. **API key (free tier)** — set `IBANFORGE_API_KEY=ifk_…` in the env config. 200 free requests/month.
2. **x402 micropayments (USDC on Base L2)** — automatic when an x402-capable wallet is configured. See [x402 discovery](https://api.ibanforge.com/.well-known/x402).
3. **Anonymous** — only the demo endpoint and rate-limited public surface are accessible.

Get a free API key:

```bash
curl -X POST https://api.ibanforge.com/v1/keys/generate \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
```

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
| `IBANFORGE_API_KEY`   | _(unset)_                     | Bearer `ifk_*` API key for the free tier or paid plans     |

## Data sources

- **121k+ BIC entries** from public sources, refreshed monthly — exact live counts at [api.ibanforge.com/llms.txt](https://api.ibanforge.com/llms.txt). Sources:
  - [PeterNotenboom/SwiftCodes](https://github.com/PeterNotenboom/SwiftCodes) (MIT-licensed SWIFT directory)
  - [GLEIF](https://www.gleif.org) BIC-LEI mapping (the only rows with LEI codes, 39k+)
  - EBA Clearing STEP2 SCT (official SEPA Reachable PSPs directory)
  - Deutsche Bundesbank BLZ (official quarterly file)
  - NBP EWIB (official Polish bank registry)
  - SIX Group BankMaster (Swiss BICs)
- **~1,200 BC-Nummern** from the official [SIX BankMaster](https://www.six-group.com/en/products-services/banking-services/bank-master-data.html) CSV
- **EMI / vIBAN classification** from a curated dataset of 30+ known issuer prefixes
- **VoP participants** from the EBA RT1 / SCT Inst directories

## Links

- [Website](https://ibanforge.com)
- [API documentation](https://ibanforge.com/docs)
- [OpenAPI 3.1 spec](https://api.ibanforge.com/openapi.json)
- [x402 discovery](https://api.ibanforge.com/.well-known/x402)
- [Issue tracker](https://github.com/cammac-creator/ibanforge/issues)

## License

Apache-2.0

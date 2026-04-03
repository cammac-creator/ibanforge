# IBANforge

[![API Status](https://img.shields.io/badge/API-live-brightgreen)](https://ibanforge-production.up.railway.app/health)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-3_tools-purple)](https://ibanforge.vercel.app/docs/mcp)

**IBAN validation & BIC/SWIFT lookup API** with SEPA compliance data, issuer classification, risk indicators, x402 micropayments, and MCP integration for AI agents.

> **Free during beta** — all endpoints are currently free. Prices shown below will apply when x402 micropayments are activated.

## Features

- **IBAN Validation** — Full mod-97 checksum verification, BBAN structure parsing, 75+ countries
- **BIC/SWIFT Lookup** — 39,000+ entries from GLEIF with LEI enrichment
- **SEPA Compliance** — Membership status, payment schemes (SCT/SDD/SCT_INST), VoP requirement per country
- **Issuer Classification** — Detects traditional banks, neobanks, EMIs (Wise, Revolut, N26...), and payment institutions for vIBAN detection
- **Risk Indicators** — Composite risk signal: issuer type, country risk (FATF-based), test BIC, SEPA reachability, VoP coverage
- **Batch Processing** — Validate up to 100 IBANs in one call
- **x402 Micropayments** — Pay-per-call with USDC (from $0.002/request)
- **MCP Server** — Native AI agent integration via Model Context Protocol
- **Self-hosted** — Docker deployment, SQLite database, no external dependencies

## Quick Start

```bash
git clone https://github.com/cammac-creator/ibanforge.git
cd ibanforge
npm install
cp .env.example .env
npm run dev
```

## API Endpoints

| Method | Path | Cost | Description |
|--------|------|------|-------------|
| `POST` | `/v1/iban/validate` | $0.005 | Validate a single IBAN |
| `POST` | `/v1/iban/batch` | $0.002/IBAN | Validate up to 100 IBANs |
| `GET` | `/v1/bic/:code` | $0.003 | Lookup BIC/SWIFT code |
| `GET` | `/v1/demo` | Free | Example validations |
| `GET` | `/health` | Free | Health check |
| `GET` | `/stats` | Free | Usage statistics |

## Examples

### Validate IBAN

```bash
curl -X POST https://api.ibanforge.com/v1/iban/validate \
  -H "Content-Type: application/json" \
  -d '{"iban": "CH93 0076 2011 6238 5295 7"}'
```

### Lookup BIC

```bash
curl https://api.ibanforge.com/v1/bic/UBSWCHZH80A
```

## MCP Integration

Add to your Claude Desktop or AI agent config:

```json
{
  "mcpServers": {
    "ibanforge": {
      "command": "npx",
      "args": ["tsx", "src/mcp/server.ts"],
      "cwd": "/path/to/ibanforge"
    }
  }
}
```

Available tools: `validate_iban`, `batch_validate_iban`, `lookup_bic`

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

- **BIC/SWIFT entries**: [GLEIF BIC-LEI mapping](https://www.gleif.org/en/lei-data/lei-mapping/download-bic-to-lei-relationship-files)
- **LEI enrichment**: [GLEIF API](https://api.gleif.org)
- **Country names**: Node.js `Intl.DisplayNames` API

## License

MIT

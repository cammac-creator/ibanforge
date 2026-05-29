# IBANforge

API de validation IBAN et lookup BIC/SWIFT avec micropaiements x402, interface MCP pour agents AI, données SEPA/VoP, classification émetteur (vIBAN detection), et indicateurs de risque compliance.

## Stack

- **Runtime** : Node.js 20+ / TypeScript
- **Framework** : Hono
- **Database** : SQLite (better-sqlite3) — `data/bic.sqlite` (121,399 BIC entries: 38,761 GLEIF + 81,642 SwiftCodes/MIT + 633 SIX + 201 EBA Step2 SCT + 142 Bundesbank + 19 NBP; plus 1,190 Swiss clearing entries SIX), `data/stats.sqlite`
- **Payments** : x402/hono (USDC micropayments)
- **AI Agents** : MCP SDK (Model Context Protocol)
- **Deploy** : Docker → Railway
- **Domain** : ibanforge.com

## Architecture

```
src/
  index.ts              # Entry point — Hono app + server
  types.ts              # Shared TypeScript types
  routes/
    iban-validate.ts    # POST /v1/iban/validate (single IBAN)
    iban-batch.ts       # POST /v1/iban/batch (up to 100)
    bic-lookup.ts       # GET /v1/bic/:code (BIC/SWIFT lookup)
    ch-clearing.ts      # GET /v1/ch/clearing/:iid (Swiss BC-Nummer lookup)
    health.ts           # GET /health
    stats.ts            # GET /stats
    landing.ts          # GET / (HTML landing page)
    demo.ts             # GET /v1/demo (free examples)
  lib/
    iban.ts             # IBAN validation logic (mod97, BBAN parsing)
    enrich.ts           # Post-validation enrichment (BIC, issuer, SEPA, risk, CH clearing)
    ch-clearing.ts      # Swiss BC-Nummer lookup, institution type detection
    issuers.ts          # EMI/neobank classification (30+ known BIC8 mappings)
    bic-validator.ts    # BIC format validation (ISO 9362)
    bic-lookup.ts       # BIC database queries
    countries.ts        # ISO country data (IBAN lengths, BBAN structures, SEPA zones, VoP, country risk)
    stats.ts            # Stats recording and queries
    db.ts               # Database connections
  middleware/
    x402.ts             # x402 payment middleware
  mcp/
    server.ts           # MCP server (validate_iban, batch_validate, lookup_bic, lookup_ch_clearing)
  db/
    schema.sql          # SQLite schema
    seed.ts             # GLEIF BIC-LEI data seeder
scripts/
  enrich-countries.ts   # Backfill country_name on existing data
  seed-bc-nummer.ts     # Download + seed SIX BankMaster CSV into bic.sqlite
data/
  bic.sqlite            # Pre-built BIC + Swiss clearing database (tracked in git)
  stats.sqlite          # API usage stats
```

## Conventions

- **Langue du code** : anglais (noms de variables, commentaires, commits)
- **Langue de communication** : toujours en francais avec Alain
- **Commits** : conventional commits (feat:, fix:, chore:, docs:)
- **Types** : strict TypeScript, pas de `any` sauf cas justifie
- **Erreurs** : Hono HTTPException pour les erreurs API, jamais de try/catch silencieux
- **Tests** : vitest, fichiers `*.test.ts` a cote du code source
- **Formatting** : prettier (voir .prettierrc)
- **Linting** : eslint (voir eslint.config.js)

## API Endpoints

| Method | Path | Cost (USDC) | Description |
|--------|------|-------------|-------------|
| POST | /v1/iban/validate | 0.005 | Validate single IBAN + optional BIC lookup |
| POST | /v1/iban/batch | 0.002/IBAN (max $0.20 / batch of 100) | Validate up to 100 IBANs |
| GET | /v1/bic/:code | 0.003 | Lookup BIC/SWIFT code |
| GET | /v1/ch/clearing/:iid | 0.003 | Swiss BC-Nummer / IID clearing lookup |
| POST | /v1/iban/compliance | 0.02 | Sanctions (bank-BIC) + FATF + SEPA + VoP + risk score 0-100 |
| GET | /v1/demo | free | Example validations |
| GET | /health | free | Health check + stats |
| GET | /stats | free | Detailed statistics |
| GET | / | free | Landing page |

## Commands

```bash
npm run dev          # Dev server with hot reload
npm run build        # TypeScript compilation
npm run start        # Production server
npm run test         # Run tests
npm run check        # typecheck + lint + test (pre-push)
npm run db:seed      # Seed BIC database from GLEIF
npm run db:enrich    # Backfill country names
npm run db:seed-ch   # Seed Swiss BC-Nummer from SIX BankMaster
npm run mcp          # Start MCP server for AI agents
```

## Deployment

- Push to `main` triggers Railway auto-deploy
- Docker multi-stage build (builder for tsc, slim for runtime)
- Health check on /health with 30s timeout
- Pre-built SQLite databases included in Docker image

## Environment Variables

See `.env.example`. Required for production:
- `PORT` — Server port (default: 3000)
- `WALLET_ADDRESS` — x402 USDC wallet for receiving payments
- `FACILITATOR_URL` — x402 facilitator endpoint

## x402 Payment Notes

The middleware must NOT fail-open. If `WALLET_ADDRESS` is not set in production, the server should refuse to start rather than serving requests for free.

## Database

- `bic.sqlite` : 121,399 BIC entries (38,761 LEI-enriched via GLEIF + 81,642 from PeterNotenboom/SwiftCodes MIT + 633 SIX Group + 201 EBA Clearing STEP2 SCT + 142 Bundesbank + 19 NBP) + 1,190 Swiss clearing entries from SIX BankMaster. Read-only at runtime. Refreshed monthly via `.github/workflows/refresh-bic.yml`.
- `stats.sqlite` : API usage tracking. Read-write.
- Both use WAL mode for concurrent access.
- Country names populated via `Intl.DisplayNames` API (no hardcoded list).
- Swiss clearing data includes BC-Nummern, SIC/euroSIC participation, QR-IID allocations, and institution classification.

## MCP Integration

The MCP server exposes tools for AI agents:
- `validate_iban` — Validate a single IBAN (includes Swiss clearing enrichment for CH/LI)
- `batch_validate_iban` — Validate multiple IBANs
- `lookup_bic` — Look up a BIC/SWIFT code
- `lookup_ch_clearing` — Look up a Swiss BC-Nummer / IID (institution, SIC, QR-IID)

Run with: `npm run mcp` (stdio transport)

## Testing

```bash
npm run test         # Run all tests
npm run test:watch   # Watch mode
```

Tests live next to source files (`*.test.ts`). Use vitest with no special config needed.

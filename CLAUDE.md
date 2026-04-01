# IBANforge

API de validation IBAN et lookup BIC/SWIFT avec micropaiements x402 et interface MCP pour agents AI.

## Stack

- **Runtime** : Node.js 20+ / TypeScript
- **Framework** : Hono
- **Database** : SQLite (better-sqlite3) — `data/bic.sqlite` (39K+ entries GLEIF), `data/stats.sqlite`
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
    iban-batch.ts       # POST /v1/iban/batch (up to 10)
    bic-lookup.ts       # GET /v1/bic/:code (BIC/SWIFT lookup)
    health.ts           # GET /health
    stats.ts            # GET /stats
    landing.ts          # GET / (HTML landing page)
    demo.ts             # GET /v1/demo (free examples)
  lib/
    iban.ts             # IBAN validation logic (mod97, BBAN parsing)
    bic-validator.ts    # BIC format validation (ISO 9362)
    bic-lookup.ts       # BIC database queries
    countries.ts        # ISO country data (IBAN lengths, BBAN structures, Intl names)
    stats.ts            # Stats recording and queries
    db.ts               # Database connections
  middleware/
    x402.ts             # x402 payment middleware
  mcp/
    server.ts           # MCP server (validate_iban, batch_validate, lookup_bic)
  db/
    schema.sql          # SQLite schema
    seed.ts             # GLEIF BIC-LEI data seeder
scripts/
  enrich-countries.ts   # Backfill country_name on existing data
data/
  bic.sqlite            # Pre-built BIC database (tracked in git)
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
| POST | /v1/iban/validate | 0.002 | Validate single IBAN + optional BIC lookup |
| POST | /v1/iban/batch | 0.015 | Validate up to 10 IBANs |
| GET | /v1/bic/:code | 0.001 | Lookup BIC/SWIFT code |
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

- `bic.sqlite` : 39,243 BIC entries with LEI enrichment from GLEIF. Read-only at runtime.
- `stats.sqlite` : API usage tracking. Read-write.
- Both use WAL mode for concurrent access.
- Country names populated via `Intl.DisplayNames` API (no hardcoded list).

## MCP Integration

The MCP server exposes tools for AI agents:
- `validate_iban` — Validate a single IBAN
- `batch_validate_iban` — Validate multiple IBANs
- `lookup_bic` — Look up a BIC/SWIFT code

Run with: `npm run mcp` (stdio transport)

## Testing

```bash
npm run test         # Run all tests
npm run test:watch   # Watch mode
```

Tests live next to source files (`*.test.ts`). Use vitest with no special config needed.

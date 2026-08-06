# IBANforge

API de validation IBAN et lookup BIC/SWIFT avec micropaiements x402, interface MCP pour agents AI, données SEPA/VoP, classification émetteur (vIBAN detection), et indicateurs de risque compliance.

## Stack

- **Runtime** : Node.js 22+ / TypeScript (20 est en fin de vie depuis le 2026-04-30 ; 24 est impossible tant que better-sqlite3 11 ne publie pas de binaire linux-x64 pour l'ABI 137)
- **Framework** : Hono
- **Database** : SQLite (better-sqlite3) — `data/bic.sqlite` (121k+ BIC entries from GLEIF + SwiftCodes/MIT + SIX + EBA Step2 SCT + Bundesbank + NBP, plus 1,100+ Swiss clearing entries SIX — counts drift at each monthly refresh, read them live via `getEntryCount()` / `getChClearingCount()`), `data/stats.sqlite`
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
    issuers.ts          # EMI/neobank classification (85 known BIC8 mappings — the live count is served in /llms.txt)
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
- **Prenom** : Claude-Alain, jamais « Alain »

## 🚨 Ce dépôt est PUBLIC

Tout ce qui est commité est lisible par n'importe qui : le code, mais aussi les
**commentaires**, les **fixtures de test** et les **messages de commit**. Un
message de commit poussé ne se réécrit plus.

**Ne jamais écrire ici :**

- le nom ou l'adresse mail d'un client, d'un prospect, ou d'une personne chez
  eux, **y compris comme fixture de test** ;
- un chiffre tiré de l'activité réelle : nombre de prospects ou de réponses,
  appels servis, part d'automation dans l'entrant, montant encaissé,
  chronologie datée du comportement d'un client ;
- une adresse mail personnelle de Claude-Alain.

**Fixtures inventées, obligatoires :** `acme@example.com`, `Société Alpha`,
`alpha.example.net`.

**Le raisonnement se garde, la quantité se retire.** Un commentaire qui explique
pourquoi le code est écrit ainsi est de la documentation utile et doit survivre
sans son chiffre : « mesuré sur la vraie boîte, N entrants sur M étaient des
robots » devient « près d'un tiers des entrants était de l'automation ». Idiome
adopté : voir `frontend/lib/crm/automated.ts`.

Ne sont **pas** concernés, ce sont des chiffres produit publics : le quota du
palier gratuit, la taille de la base BIC, la couverture pays, les coûts
d'hébergement, les objectifs annoncés, le marketing écrit pour être publié.

⚠️ Cette classe a été purgée **sept fois** les 29 et 30/07/2026, et chaque
balayage se croyait complet en ne cherchant que ce que le précédent avait
trouvé. Elle revient surtout par les **fixtures de test** et par le `src/`, que
les balayages du frontend ne regardaient pas. Ne jamais déclarer ce balayage
terminé.

## ⚠️ Sessions parallèles sur ce dépôt

Plusieurs terminaux Claude travaillent souvent ici en même temps, parfois dans
`.claude/worktrees/`. Le 30/07/2026 ça a coûté deux pannes silencieuses, les
deux causées par des pushs concurrents sur `main`.

**1. `git fetch` puis rebase avant CHAQUE push.** Sans exception.

**2. Ne jamais pousser pendant que Claude-Alain publie sur npm.**
`npm version patch` modifie `package.json` et le lockfile, *puis* commite et
tague. Si l'arbre est sale à cet instant, il **ne touche pas à git du tout et
ne dit rien**. Le 30/07 : npm servait 1.4.1 pendant que le dépôt disait 1.4.0,
sans tag, donc sans mise à jour du registre MCP.

**3. Un `main` laissé rouge devient le problème de l'autre session.** Le 30/07,
un commit CRM est passé au rouge en héritant d'un désaccord de versions
introduit deux commits plus tôt. La session concernée a cherché la panne chez
elle. Si on casse `main`, on répare tout de suite ou on revert.

**4. Ne pas ranger le chantier d'une autre session.** Worktrees, branches et
stashes appartiennent à qui les a créés. Vérifier l'activité récente avant de
supposer qu'un worktree est mort :
`find .claude/worktrees/<nom> -type f -not -path "*/node_modules/*" -newermt "-1 day"`.

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

- Push to `main` triggers Railway auto-deploy (l'API Hono)
- ⚠️ **Le frontend Vercel ne se met PAS en ligne tout seul.** Un push produit un
  déploiement de production joignable sur son URL `vercel.app`, mais
  `ibanforge.com` est un alias figé : il ne bouge qu'après un
  `vercel alias set` manuel, sur l'apex **et** sur `www`. Un push n'expose donc
  rien aux visiteurs, ce qui en fait le banc d'essai avant promotion.
- ⚠️ **Aucun preview Vercel ne peut servir le dashboard.** L'environnement
  Preview n'a ni `SESSION_SECRET` ni `ADMIN_SECRET` (Production seulement) :
  pas de session, pas de données. Faire relire une UI de dashboard passe donc
  par un déploiement de production, jamais par un preview de branche.
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

- `bic.sqlite` : 121k+ BIC entries (38k+ LEI-enriched via GLEIF; other sources: PeterNotenboom/SwiftCodes MIT, SIX Group, EBA Clearing STEP2 SCT, Bundesbank, NBP) + 1,100+ Swiss clearing entries from SIX BankMaster. Counts drift at each refresh — never hardcode them in served surfaces; use `getEntryCount()` / `getChClearingCount()` / `getLeiEnrichedCount()` (src/lib/bic-lookup.ts). Read-only at runtime. Refreshed monthly via `.github/workflows/refresh-bic.yml`.
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

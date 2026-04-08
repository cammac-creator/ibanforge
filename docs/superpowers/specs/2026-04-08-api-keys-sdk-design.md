# IBANforge API Keys + Free Tier + npm SDK — Design Spec

## Objectif

Permettre aux développeurs sans wallet crypto de tester IBANforge via une clé API gratuite (200 req/mois), et publier un SDK npm TypeScript pour une intégration en une ligne.

## 1. Système de clés API

### Génération

- Endpoint : `POST /v1/keys/generate`
- Body : `{ "email": "dev@example.com" }`
- Response : `{ "api_key": "ifk_a1b2c3d4e5f6...", "email": "dev@example.com", "monthly_limit": 200, "message": "Save this key — it will not be shown again." }`
- Rate limit : 1 clé par email par jour
- La clé est préfixée `ifk_` (IBANForge Key) + 32 chars hex aléatoires (crypto.randomBytes)
- La clé est retournée UNE SEULE FOIS — seul le SHA-256 hash est stocké en DB

### Vérification d'usage

- Endpoint : `GET /v1/keys/usage`
- Header : `Authorization: Bearer ifk_xxx`
- Response : `{ "used": 42, "limit": 200, "remaining": 158, "month": "2026-04", "key_prefix": "ifk_a1b2" }`
- Si clé invalide : `{ "error": "invalid_key", "message": "API key not found or inactive" }` (401)

### Stockage (stats.sqlite)

```sql
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT UNIQUE NOT NULL,
  key_prefix TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  active INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_email ON api_keys(email);

CREATE TABLE IF NOT EXISTS api_usage (
  key_hash TEXT NOT NULL,
  month TEXT NOT NULL,
  count INTEGER DEFAULT 0,
  PRIMARY KEY (key_hash, month)
);
```

### Sécurité

- Clé jamais stockée en clair (SHA-256 hash uniquement)
- Préfixe `ifk_` pour identification visuelle
- Rate limit sur génération (1/email/jour) via table api_keys created_at
- Clés désactivables via champ `active` (admin)

## 2. Coexistence Clé API + x402

### Flow de requête (ordre de priorité)

1. **Pre-validation input** (existant) — retourne 400 si invalide (gratuit)
2. **Check clé API** — si header `Authorization: Bearer ifk_xxx` présent :
   - Hash la clé, lookup dans api_keys
   - Si trouvée + active + quota < 200 ce mois → incrémenter api_usage, skip x402, servir la réponse
   - Si quota dépassé → retourner `{ "error": "quota_exceeded", "message": "Monthly limit of 200 requests reached. Use x402 payment for additional requests.", "used": 200, "limit": 200 }` (429)
   - Si clé invalide → ignorer (passer au x402, ne pas bloquer)
3. **x402 middleware** (existant) — si pas de clé ou clé invalide → 402 Payment Required

### Implémentation

Nouveau middleware `apiKeyMiddleware()` placé APRÈS pre-validation, AVANT x402 :

```
Pre-validation → API Key check → x402 → Route handler
```

Si la clé API est valide et le quota OK, le middleware appelle `next()` en skipant x402. Sinon, il passe au x402.

Le skip se fait en settant un flag dans le context Hono : `c.set('apiKeyAuthenticated', true)`. Le x402 middleware check ce flag et skip si true.

## 3. Endpoints affectés

Tous les endpoints payants acceptent la clé API :
- `POST /v1/iban/validate` ($0.005 ou 1 req gratuite)
- `POST /v1/iban/batch` ($0.20 ou 1 req gratuite — attention: une requête batch = 1 req dans le quota, pas N)
- `GET /v1/bic/:code` ($0.003 ou 1 req gratuite)
- `POST /v1/iban/compliance` ($0.02 ou 1 req gratuite)

Les endpoints gratuits ne sont pas affectés (/v1/demo, /health, /stats, etc.).

## 4. SDK npm `@ibanforge/sdk`

### Package

- Nom : `@ibanforge/sdk`
- Repo : monorepo — `packages/sdk/` dans le repo ibanforge existant
- Publié sur npm
- TypeScript-first, types inclus
- ESM + CJS dual build
- Zéro dépendance (utilise `fetch` natif)

### API

```typescript
import { IBANforge } from '@ibanforge/sdk';

const client = new IBANforge('ifk_your_api_key');
// ou sans clé (x402 seulement)
const client = new IBANforge();

const result = await client.validate('CH9300762011623852957');
const bic = await client.lookupBIC('UBSWCHZH');
const compliance = await client.compliance('DE89370400440532013000');
const batch = await client.validateBatch(['CH93...', 'DE89...']);
const usage = await client.usage();
```

### Classe IBANforge

```typescript
class IBANforge {
  constructor(apiKey?: string, options?: { baseUrl?: string });

  validate(iban: string): Promise<IBANValidationResult>;
  validateBatch(ibans: string[]): Promise<BatchValidationResult>;
  lookupBIC(code: string): Promise<BICLookupResult>;
  compliance(iban: string): Promise<ComplianceCheckResult>;
  usage(): Promise<UsageResult>;
}
```

### Types exportés

Le SDK exporte tous les types de réponse :
- `IBANValidationResult`
- `BatchValidationResult`
- `BICLookupResult`
- `ComplianceCheckResult` (= IBANValidationResult + compliance layer)
- `ComplianceResult` (sanctions, reachability, vop, risk_score)
- `UsageResult`
- `IBANforgeError`

### Gestion d'erreurs

- Les erreurs API sont wrappées dans `IBANforgeError` avec `status`, `error`, `message`
- Le SDK throw sur les erreurs 4xx/5xx
- 402 est wrappé en `IBANforgeError` avec un message clair ("Payment required — provide an API key or use x402")

### Build

- `tsup` pour le build (ESM + CJS)
- `tsconfig.json` avec `declaration: true`
- `package.json` avec `exports`, `types`, `main`, `module`

## 5. Fichiers

### Backend (clés API)

| Fichier | Action | Responsabilité |
|---------|--------|---------------|
| `src/lib/db.ts` | Modifier | Ajouter tables api_keys + api_usage au schema |
| `src/lib/api-keys.ts` | Créer | generateKey, validateKey, checkQuota, incrementUsage |
| `src/middleware/api-key.ts` | Créer | Middleware Hono pour check clé API |
| `src/routes/api-keys.ts` | Créer | POST /v1/keys/generate + GET /v1/keys/usage |
| `src/middleware/x402.ts` | Modifier | Skip si apiKeyAuthenticated = true |
| `src/index.ts` | Modifier | Monter les nouvelles routes et middleware |
| `src/lib/api-keys.test.ts` | Créer | Tests unitaires |

### SDK npm

| Fichier | Action | Responsabilité |
|---------|--------|---------------|
| `packages/sdk/src/index.ts` | Créer | Classe IBANforge |
| `packages/sdk/src/types.ts` | Créer | Types exportés |
| `packages/sdk/package.json` | Créer | Package config |
| `packages/sdk/tsconfig.json` | Créer | TypeScript config |
| `packages/sdk/README.md` | Créer | Documentation npm |

## 6. Hors périmètre

- Pas de dashboard frontend pour les clés (le dev utilise l'API directement)
- Pas de tiers payants / Stripe billing
- Pas de révocation de clé via API (admin via DB direct)
- Pas d'OAuth / GitHub login
- Pas de SDK Python ou PHP
- Pas de webhook pour les alertes de quota

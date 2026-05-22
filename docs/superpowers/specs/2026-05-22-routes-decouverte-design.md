# IBANforge — Routes de découverte alias — Design Spec

> Date : 2026-05-22 · Statut : validé · Origine : rapport `docs/business/analyse-trafic-2026-05-21.md` (priorité P3)

## Objectif

Servir les conventions de découverte que les crawlers d'annuaires agent / MCP réclament, au lieu de leur renvoyer `404`. But : capter une découvrabilité gratuite auprès de l'écosystème de crawlers qui indexe IBANforge en ce moment.

## 1. Contexte

Sur 30 jours, ~420 requêtes tombent en `404` sur des chemins de découverte qu'IBANforge ne sert pas :

| Chemin | Hits 404 |
|---|---|
| `/.well-known/mcp.json` | 83 |
| `/.well-known/agent.json` | 78 |
| `/agents.txt` | 53 |
| `/agents.json` | 52 |
| `/agent-directory.json` | 52 |
| `/mcp.json` | 52 |

IBANforge sert **déjà les manifestes équivalents** :

- `/.well-known/agents.json` — manifeste agent A2A (`src/routes/discovery.ts`)
- `/.well-known/mcp/server-card.json` — carte serveur MCP (`src/routes/mcp-card.ts`)

Il manque seulement les **alias**. Le code adopte déjà cette philosophie : `discovery.ts` sert `/.well-known/oauth-protected-resource` avec un commentaire explicite — « Returning 404 makes them give up ».

## 2. Décision

Servir le contenu **directement** (`HTTP 200` + corps), pas de redirect :

- C'est le pattern déjà en place dans `discovery.ts`.
- Les crawlers naïfs — la cible — ne suivent pas tous les redirects ; un `200` garantit qu'ils obtiennent le manifeste.

Pour éviter la duplication : factoriser chaque manifeste en **constante de module**, servie par la route canonique et par ses alias.

## 3. Les 6 routes

| Chemin | Sert | Fichier |
|---|---|---|
| `/.well-known/agent.json` | `AGENT_MANIFEST` (JSON) | `discovery.ts` |
| `/agents.json` | `AGENT_MANIFEST` (JSON) | `discovery.ts` |
| `/agent-directory.json` | `AGENT_MANIFEST` (JSON) | `discovery.ts` |
| `/agents.txt` | `AGENTS_TXT` (texte) | `discovery.ts` |
| `/.well-known/mcp.json` | `MCP_SERVER_CARD` (JSON) | `mcp-card.ts` |
| `/mcp.json` | `MCP_SERVER_CARD` (JSON) | `mcp-card.ts` |

## 4. Changements de code

### 4.1 `src/routes/discovery.ts`

- Extraire le corps de la route `/.well-known/agents.json` en constante de module `AGENT_MANIFEST` (objet). La route canonique sert désormais `c.json(AGENT_MANIFEST)` — **contenu inchangé**.
- Ajouter 3 routes alias — `/.well-known/agent.json`, `/agents.json`, `/agent-directory.json` — servant toutes `c.json(AGENT_MANIFEST)`.
- Ajouter `/agents.txt` servant une constante `AGENTS_TXT` via `c.text(AGENTS_TXT, 200, { 'Content-Type': 'text/plain; charset=utf-8' })` (jamais `c.json`). `AGENTS_TXT` : un texte court — nom IBANforge, une ligne de description, la liste des endpoints de découverte (`/.well-known/agents.json`, `/openapi.json`, `/.well-known/x402`, `/mcp`), un pointeur vers `/llms.txt`.

### 4.2 `src/routes/mcp-card.ts`

- Extraire le corps de la route `/.well-known/mcp/server-card.json` en constante de module `MCP_SERVER_CARD` (objet, construite après `pkg`). La route canonique sert désormais `c.json(MCP_SERVER_CARD)` — **contenu inchangé**.
- Ajouter 2 routes alias — `/.well-known/mcp.json`, `/mcp.json` — servant `c.json(MCP_SERVER_CARD)`.

### 4.3 `src/index.ts`

**Aucun changement.** `discovery` et `mcpCard` y sont déjà montés (`app.route('/', …)`), avant le `notFound`. `/mcp.json` et `/mcp` sont des chemins distincts — pas de conflit.

## 5. Tests (TDD)

Aucun test ne couvre `discovery.ts` ni `mcp-card.ts` aujourd'hui. La factorisation touche les routes canoniques — il faut donc un filet sur le canonique **et** les alias.

### `src/routes/discovery.test.ts` (créer)

- `/.well-known/agents.json` (canonique) → `200`, corps porte `schema_version` et un tableau `capabilities` non vide.
- Chacun des 3 alias (`/.well-known/agent.json`, `/agents.json`, `/agent-directory.json`) → `200`, corps **identique** au canonique.
- `/agents.txt` → `200`, en-tête `Content-Type` commençant par `text/plain`, corps contenant `IBANforge` et un pointeur vers `llms.txt`.

### `src/routes/mcp-card.test.ts` (créer)

- `/.well-known/mcp/server-card.json` (canonique) → `200`, corps porte un tableau `tools` de longueur 5.
- Chacun des 2 alias (`/.well-known/mcp.json`, `/mcp.json`) → `200`, corps **identique** au canonique.

## 6. Fichiers

| Fichier | Action | Responsabilité |
|---|---|---|
| `src/routes/discovery.ts` | Modifier | `AGENT_MANIFEST` + `AGENTS_TXT` + 4 routes (3 alias JSON + `/agents.txt`) |
| `src/routes/mcp-card.ts` | Modifier | `MCP_SERVER_CARD` + 2 routes alias |
| `src/routes/discovery.test.ts` | Créer | Tests routes agent — canonique + 3 alias + `/agents.txt` |
| `src/routes/mcp-card.test.ts` | Créer | Tests carte MCP — canonique + 2 alias |

## 7. Compromis assumés

- **`agent.json` (singulier) ≠ `agents.json` (pluriel).** Les deux émergent de conventions différentes — l'A2A utilise le pluriel ; certaines conventions de découverte d'agents utilisent le singulier avec une forme différente. On sert le **même manifeste A2A** à tous les alias `agent*`. Un consommateur strict d'un format « singulier » recevra des champs qu'il ne reconnaît pas — mais l'alternative est un `404`. Choix pragmatique : au minimum, le crawler apprend qu'IBANforge existe. Pas de recherche de schéma au-delà (YAGNI).

## 8. Hors périmètre

- Toute retouche de `src/index.ts`.
- Ajout des nouveaux chemins à la liste `free_endpoints` du manifeste `/.well-known/x402` ou à la section « Discovery endpoints » de `llms.txt` (synchronisation optionnelle, hors du cœur de P3).
- README, OpenAPI, marketing.
- Implémenter un schéma distinct pour le format `agent.json` singulier.

# Routes de découverte alias — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servir en `HTTP 200` les 6 conventions de découverte que les crawlers d'annuaires réclament (`~420` requêtes/mois en 404), comme alias des manifestes de découverte existants.

**Architecture:** Chaque manifeste (carte serveur MCP, manifeste agent A2A) est extrait en constante de module ; la route canonique et ses alias servent la même constante. `/agents.txt` sert un index de découverte en texte. Aucun changement à `index.ts` — `discovery` et `mcpCard` y sont déjà montés.

**Tech Stack:** TypeScript strict, Hono, vitest.

**Spec :** `docs/superpowers/specs/2026-05-22-routes-decouverte-design.md`

**Notes d'exécution :**
- Tâches séquentielles ; les Tâches 2 et 3 modifient toutes deux `discovery.ts` et `discovery.test.ts`.
- `git add` à chemins explicites — jamais `git add -A` ni `.` (`POINT-SITUATION.html` non suivi à la racine doit le rester).
- Pattern de test du repo (cf. `src/routes/bic-lookup.test.ts`) : `const app = new Hono(); app.route('/', subApp); await app.request(path)`.

---

### Task 1 : `mcp-card.ts` — carte MCP factorisée + 2 alias

Extraire la carte serveur MCP en constante `MCP_SERVER_CARD` et la servir sur le chemin canonique + les alias `/.well-known/mcp.json` et `/mcp.json`.

**Files:**
- Modify: `src/routes/mcp-card.ts`
- Create: `src/routes/mcp-card.test.ts`

- [ ] **Step 1 : Écrire le test**

Créer `src/routes/mcp-card.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { mcpCard } from './mcp-card.js';

function makeApp() {
  const app = new Hono();
  app.route('/', mcpCard);
  return app;
}

describe('mcpCard — MCP server card + discovery aliases', () => {
  it('serves the canonical /.well-known/mcp/server-card.json', async () => {
    const res = await makeApp().request('/.well-known/mcp/server-card.json');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; tools: unknown[] };
    expect(body.name).toBe('IBANforge');
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools).toHaveLength(5);
  });

  it('serves the same card on the /.well-known/mcp.json alias', async () => {
    const app = makeApp();
    const canonical = await (await app.request('/.well-known/mcp/server-card.json')).json();
    const res = await app.request('/.well-known/mcp.json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(canonical);
  });

  it('serves the same card on the /mcp.json alias', async () => {
    const app = makeApp();
    const canonical = await (await app.request('/.well-known/mcp/server-card.json')).json();
    const res = await app.request('/mcp.json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(canonical);
  });
});
```

- [ ] **Step 2 : Lancer le test et vérifier le RED partiel**

Run : `cd /Users/claude-alainmartin/ibanforge && npx vitest run src/routes/mcp-card.test.ts`
Expected : 1 test passe (canonique — la route existe déjà), 2 tests échouent (alias en 404 — `expected 404 to be 200`).

- [ ] **Step 3 : Réécrire `src/routes/mcp-card.ts`**

Remplacer **tout le contenu** de `src/routes/mcp-card.ts` par :

```ts
import { Hono } from 'hono';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

// MCP server card. Served at the canonical /.well-known/mcp/server-card.json
// and at the /.well-known/mcp.json and /mcp.json aliases that agent/MCP
// directory crawlers request (~135 hits/month previously landed in 404).
const MCP_SERVER_CARD = {
  name: 'IBANforge',
  description:
    'IBAN validation, BIC/SWIFT lookup, Swiss clearing, SEPA compliance and risk scoring API for AI agents. 121,399 BIC entries (38,761 LEI-enriched via GLEIF), 1,190 Swiss BC-Nummer from SIX, 84 countries.',
  url: 'https://api.ibanforge.com/mcp',
  transport: 'streamable-http',
  version: pkg.version,
  tools: [
    {
      name: 'validate_iban',
      description:
        'Verify a European IBAN AND enrich it with bank, compliance and routing data. Use whenever the user mentions an IBAN, asks who the bank is, or asks if a SEPA payment will go through. Returns: valid, country, BIC, bank name, EMI/vIBAN flag, SEPA + VoP, risk_score, Swiss bc_nummer for CH/LI. Cost: $0.005.',
    },
    {
      name: 'batch_validate_iban',
      description:
        'Validate up to 100 IBANs in one call (cheaper than calling validate_iban repeatedly). Use for CSV/spreadsheet cleanup, customer DB dedup, or pre-flight payout list triage. Cost: $0.002 per IBAN, max $0.20 per batch.',
    },
    {
      name: 'lookup_bic',
      description:
        'Resolve a BIC/SWIFT code (8 or 11 chars) into the underlying bank. Use only when the user already has a BIC — for IBAN inputs, prefer validate_iban which resolves the BIC automatically. Backed by 121,399 BIC entries (38,761 LEI-enriched via GLEIF). Cost: $0.003.',
    },
    {
      name: 'check_compliance',
      description:
        'Pre-flight compliance triage on an IBAN before a SEPA / cross-border payment: sanctions screening (OFAC/EU/UN), FATF jurisdiction flag, SEPA Instant reachability, VoP (EU 2024/886) participant. Returns risk_score 0-100. Informational, not a regulated AML/CFT product. Cost: $0.02.',
    },
    {
      name: 'lookup_ch_clearing',
      description:
        'Resolve a Swiss BC-Nummer / IID (1-5 digits) into institution name, type, SIC, euroSIC, QR-IID. The only API that exposes this data — alternatives do not cover it. Backed by 1,190 SIX BankMaster entries. Cost: $0.003. Only relevant for CH/LI accounts.',
    },
  ],
  homepage: 'https://ibanforge.com',
  repository: 'https://github.com/cammac-creator/ibanforge',
  documentation: 'https://ibanforge.com/docs/mcp',
};

const mcpCard = new Hono();

for (const path of ['/.well-known/mcp/server-card.json', '/.well-known/mcp.json', '/mcp.json']) {
  mcpCard.get(path, (c) => c.json(MCP_SERVER_CARD));
}

export { mcpCard };
```

Le contenu de `MCP_SERVER_CARD` est **identique** à l'objet servi aujourd'hui — seules la factorisation en constante et l'ajout des 2 alias changent.

- [ ] **Step 4 : Lancer le test et vérifier le GREEN**

Run : `cd /Users/claude-alainmartin/ibanforge && npx vitest run src/routes/mcp-card.test.ts`
Expected : PASS — 3 tests verts.

- [ ] **Step 5 : Commit**

```bash
cd /Users/claude-alainmartin/ibanforge
git add src/routes/mcp-card.ts src/routes/mcp-card.test.ts
git commit -m "$(cat <<'EOF'
feat(discovery): alias the MCP server card on mcp.json paths

Factor the card into MCP_SERVER_CARD and serve it on the canonical
path plus /.well-known/mcp.json and /mcp.json, the aliases MCP
directory crawlers request (~135 404s/month).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2 : `discovery.ts` — manifeste agent factorisé + 3 alias JSON

Extraire le manifeste agent A2A en constante `AGENT_MANIFEST` et le servir sur le chemin canonique + les 3 alias `/.well-known/agent.json`, `/agents.json`, `/agent-directory.json`.

**Files:**
- Modify: `src/routes/discovery.ts`
- Create: `src/routes/discovery.test.ts`

- [ ] **Step 1 : Écrire le test**

Créer `src/routes/discovery.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { discovery } from './discovery.js';

function makeApp() {
  const app = new Hono();
  app.route('/', discovery);
  return app;
}

describe('discovery — agent manifest + aliases', () => {
  it('serves the canonical /.well-known/agents.json', async () => {
    const res = await makeApp().request('/.well-known/agents.json');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { schema_version: string; capabilities: unknown[] };
    expect(body.schema_version).toBe('v1');
    expect(Array.isArray(body.capabilities)).toBe(true);
    expect(body.capabilities.length).toBeGreaterThan(0);
  });

  it('serves the same manifest on the /.well-known/agent.json alias', async () => {
    const app = makeApp();
    const canonical = await (await app.request('/.well-known/agents.json')).json();
    const res = await app.request('/.well-known/agent.json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(canonical);
  });

  it('serves the same manifest on the /agents.json alias', async () => {
    const app = makeApp();
    const canonical = await (await app.request('/.well-known/agents.json')).json();
    const res = await app.request('/agents.json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(canonical);
  });

  it('serves the same manifest on the /agent-directory.json alias', async () => {
    const app = makeApp();
    const canonical = await (await app.request('/.well-known/agents.json')).json();
    const res = await app.request('/agent-directory.json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(canonical);
  });
});
```

- [ ] **Step 2 : Lancer le test et vérifier le RED partiel**

Run : `cd /Users/claude-alainmartin/ibanforge && npx vitest run src/routes/discovery.test.ts`
Expected : 1 test passe (canonique), 3 tests échouent (alias en 404).

- [ ] **Step 3 : Modifier `src/routes/discovery.ts`**

Remplacer ce bloc :

```ts
// ──────────────────────────────────────────────────────────────────────────────
// /.well-known/agents.json — A2A agent discovery (emerging standard)
// Lets autonomous agents discover IBANforge as a service they can pay & call.
// ──────────────────────────────────────────────────────────────────────────────

discovery.get('/.well-known/agents.json', (c) => {
  return c.json({
    schema_version: 'v1',
    name: 'IBANforge',
    description:
      'IBAN validation, BIC/SWIFT lookup, Swiss clearing and compliance risk scoring for autonomous agents.',
    url: 'https://ibanforge.com',
    contact: 'https://github.com/cammac-creator/ibanforge',
    capabilities: [
      'iban_validation',
      'bic_lookup',
      'swift_lookup',
      'swiss_clearing_lookup',
      'sepa_compliance_check',
      'sanctions_screening',
      'vop_check',
      'emi_classification',
      'viban_detection',
      'country_risk_scoring',
    ],
    payment: {
      protocol: 'x402',
      network: NETWORK,
      asset: USDC_BASE,
      discovery: 'https://api.ibanforge.com/.well-known/x402',
    },
    interfaces: [
      { type: 'rest', url: 'https://api.ibanforge.com', spec: 'https://api.ibanforge.com/openapi.json' },
      { type: 'mcp', transport: 'http', url: 'https://api.ibanforge.com/mcp' },
      { type: 'mcp', transport: 'stdio', package: 'ibanforge-mcp' },
    ],
  });
});
```

Par ce bloc :

```ts
// ──────────────────────────────────────────────────────────────────────────────
// /.well-known/agents.json — A2A agent discovery (emerging standard).
// Served at the canonical path and at the agent.json / agents.json /
// agent-directory.json aliases that directory crawlers request
// (~182 hits/month previously landed in 404).
// ──────────────────────────────────────────────────────────────────────────────

const AGENT_MANIFEST = {
  schema_version: 'v1',
  name: 'IBANforge',
  description:
    'IBAN validation, BIC/SWIFT lookup, Swiss clearing and compliance risk scoring for autonomous agents.',
  url: 'https://ibanforge.com',
  contact: 'https://github.com/cammac-creator/ibanforge',
  capabilities: [
    'iban_validation',
    'bic_lookup',
    'swift_lookup',
    'swiss_clearing_lookup',
    'sepa_compliance_check',
    'sanctions_screening',
    'vop_check',
    'emi_classification',
    'viban_detection',
    'country_risk_scoring',
  ],
  payment: {
    protocol: 'x402',
    network: NETWORK,
    asset: USDC_BASE,
    discovery: 'https://api.ibanforge.com/.well-known/x402',
  },
  interfaces: [
    { type: 'rest', url: 'https://api.ibanforge.com', spec: 'https://api.ibanforge.com/openapi.json' },
    { type: 'mcp', transport: 'http', url: 'https://api.ibanforge.com/mcp' },
    { type: 'mcp', transport: 'stdio', package: 'ibanforge-mcp' },
  ],
};

for (const path of [
  '/.well-known/agents.json',
  '/.well-known/agent.json',
  '/agents.json',
  '/agent-directory.json',
]) {
  discovery.get(path, (c) => c.json(AGENT_MANIFEST));
}
```

Le contenu de `AGENT_MANIFEST` est **identique** à l'objet servi aujourd'hui. La ligne `export { discovery };` en fin de fichier reste inchangée.

- [ ] **Step 4 : Lancer le test et vérifier le GREEN**

Run : `cd /Users/claude-alainmartin/ibanforge && npx vitest run src/routes/discovery.test.ts`
Expected : PASS — 4 tests verts.

- [ ] **Step 5 : Commit**

```bash
cd /Users/claude-alainmartin/ibanforge
git add src/routes/discovery.ts src/routes/discovery.test.ts
git commit -m "$(cat <<'EOF'
feat(discovery): alias the agent manifest on agent.json paths

Factor the A2A manifest into AGENT_MANIFEST and serve it on the
canonical path plus /.well-known/agent.json, /agents.json and
/agent-directory.json, the aliases directory crawlers request.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3 : `discovery.ts` — index `/agents.txt` en texte

Ajouter `/agents.txt` : un index de découverte en texte brut (façon `llms.txt`), réclamé ~53 fois/mois.

**Files:**
- Modify: `src/routes/discovery.ts`
- Modify: `src/routes/discovery.test.ts`

- [ ] **Step 1 : Ajouter le test**

Dans `src/routes/discovery.test.ts`, remplacer la fin du fichier :

```ts
    expect(await res.json()).toEqual(canonical);
  });
});
```

Par :

```ts
    expect(await res.json()).toEqual(canonical);
  });

  it('serves /agents.txt as plain text', async () => {
    const res = await makeApp().request('/agents.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    const body = await res.text();
    expect(body).toContain('IBANforge');
    expect(body).toContain('llms.txt');
  });
});
```

- [ ] **Step 2 : Lancer le test et vérifier le RED**

Run : `cd /Users/claude-alainmartin/ibanforge && npx vitest run src/routes/discovery.test.ts`
Expected : le nouveau test échoue (`/agents.txt` en 404) ; les 4 autres passent.

- [ ] **Step 3 : Modifier `src/routes/discovery.ts`**

Remplacer la ligne finale :

```ts
export { discovery };
```

Par :

```ts
// /agents.txt — plain-text discovery index (llms.txt-style), requested by
// directory crawlers (~53 hits/month previously landed in 404).
const AGENTS_TXT = `# IBANforge — agent & API discovery

IBAN validation, BIC/SWIFT lookup, Swiss clearing and compliance risk
scoring API, built for AI agents and developers.

## Discovery endpoints
- Agent manifest (A2A): https://api.ibanforge.com/.well-known/agents.json
- MCP server card:      https://api.ibanforge.com/.well-known/mcp/server-card.json
- OpenAPI 3.1:          https://api.ibanforge.com/openapi.json
- x402 payment:         https://api.ibanforge.com/.well-known/x402
- MCP server (HTTP):    https://api.ibanforge.com/mcp

## Full agent guide
https://api.ibanforge.com/llms.txt
`;

discovery.get('/agents.txt', (c) =>
  c.text(AGENTS_TXT, 200, { 'Content-Type': 'text/plain; charset=utf-8' }),
);

export { discovery };
```

- [ ] **Step 4 : Lancer le test et vérifier le GREEN**

Run : `cd /Users/claude-alainmartin/ibanforge && npx vitest run src/routes/discovery.test.ts`
Expected : PASS — 5 tests verts.

- [ ] **Step 5 : Commit**

```bash
cd /Users/claude-alainmartin/ibanforge
git add src/routes/discovery.ts src/routes/discovery.test.ts
git commit -m "$(cat <<'EOF'
feat(discovery): add /agents.txt plain-text discovery index

llms.txt-style text index pointing crawlers to the JSON manifests.
Served as text/plain. ~53 404s/month previously.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4 : Vérification finale + déploiement

**Files:** aucun (vérification + push).

- [ ] **Step 1 : Lancer la suite complète (typecheck + lint + tests)**

Run : `cd /Users/claude-alainmartin/ibanforge && npm run check`
Expected : PASS — typecheck sans erreur, lint sans erreur, tous les tests verts (dont les 8 nouveaux : `mcp-card.test.ts` 3 + `discovery.test.ts` 5).

- [ ] **Step 2 : Pousser sur `main` (déclenche le déploiement Railway)**

```bash
cd /Users/claude-alainmartin/ibanforge
git push
```

Expected : `main -> main` accepté par le remote.

- [ ] **Step 3 : Vérifier les 6 routes en production**

Railway redéploie automatiquement (~1-2 min). Poller les 6 chemins jusqu'à ce qu'ils renvoient tous `200` (timeout ~5 min) :

```bash
PATHS="/.well-known/agent.json /agents.json /agent-directory.json /agents.txt /.well-known/mcp.json /mcp.json"
for i in $(seq 1 20); do
  ok=0
  for p in $PATHS; do
    code=$(curl -s -m 15 -o /dev/null -w "%{http_code}" "https://api.ibanforge.com$p")
    [ "$code" = "200" ] && ok=$((ok + 1))
  done
  if [ "$ok" = "6" ]; then
    echo "✓ 6/6 routes de découverte live en production (tentative $i)"
    exit 0
  fi
  echo "tentative $i/20 — $ok/6 routes en 200, nouvelle tentative dans 15 s"
  sleep 15
done
echo "✗ seulement $ok/6 routes en 200 après ~5 min — vérifier le dashboard Railway"
exit 1
```

Expected : `✓ 6/6 routes de découverte live en production`.

---

## Récapitulatif des fichiers

| Fichier | Tâche | Action |
|---|---|---|
| `src/routes/mcp-card.ts` | 1 | `MCP_SERVER_CARD` + 3 routes (canonique + 2 alias) |
| `src/routes/mcp-card.test.ts` | 1 | Créé — tests carte MCP |
| `src/routes/discovery.ts` | 2, 3 | `AGENT_MANIFEST` + 4 routes JSON ; `AGENTS_TXT` + `/agents.txt` |
| `src/routes/discovery.test.ts` | 2, 3 | Créé — tests manifeste agent + `/agents.txt` |

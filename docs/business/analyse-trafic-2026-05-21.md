# IBANforge — Analyse profonde du trafic API

**Date :** 2026-05-21
**Source :** production `api.ibanforge.com` — endpoints `/stats/*` + `/admin/scanners` + `/admin/revenue` (Bearer STATS_TOKEN), fenêtre 30 jours.
**Déclencheur :** Alain observe « de l'activité provenant de l'étranger ».

---

## Verdict en une ligne

**Le pic de trafic (~12× depuis le 12 mai) n'est PAS des clients. C'est l'écosystème de crawlers agent / MCP / x402 qui a découvert IBANforge et le catalogue.** 63 111 requêtes ont produit **126 vraies opérations** et **0,098 USDC encaissé** (paiements de test).

Nuance décisive : ce sont des **bots de catalogue et des scanners x402** — **aucun agent LLM de production** (ChatGPT, Claude, Cursor, Perplexity…) n'apparaît dans le trafic. Bonne nouvelle : ta distribution *vers les annuaires* fonctionne, tu es découvrable. Mauvaise : conversion ≈ 0, et le marché que tu vises — l'agent LLM qui exécute une tâche et paie — n'a pas encore mordu. Le levier n'est pas plus de trafic, c'est la conversion.

---

## 1. Le volume : 99,8 % de bruit

| Métrique | Valeur |
|---|---|
| Requêtes totales | **63 111** (61 023 sur 30 j ; 1 105 aujourd'hui) |
| Statuts 2xx / 4xx / 5xx | 31 758 / **31 299** / 4 |
| Vraies opérations métier | **126** (101 validate, 13 batch, 12 bic) |
| Revenu « tenté » (stats) | 0,324 USDC |
| Revenu **encaissé on-chain** | **0,098 USDC** — 13 tx, **un seul wallet**, datées 29 avr + 2 mai (= tests) |

La moitié des requêtes sont des erreurs 4xx. Le ratio 63 111 requêtes → 126 opérations → 0,10 $ dit tout : ce trafic ne consomme pas le produit, il le *sonde*.

Volume quotidien stable depuis ~10 mai : ~2 000–4 400 req/jour, avec une signature plate de **~850 hits paywall + ~560 entrées invalides chaque jour** — empreinte d'un **scanner planifié (cron)**, pas d'un usage humain.

---

## 2. Qui sont ces « clients étrangers » ? — Des bots, pas des acheteurs

⚠️ *Limite data : seules 8 685 / 61 023 requêtes (14 %) ont un IP/User-Agent loggé (feature récente, commit 062f8f2). Le reste est antérieur. L'attribution ci-dessous est un échantillon récent représentatif.*

L'API ne stocke **aucune géolocalisation du caller** (seulement un `ip_hash` salté). Mais les User-Agents trahissent l'origine — l'écosystème agentique mondial. Trois familles :

### A. Un scanner x402 dominant — `axios/1.14.0`
- **1 seule IP** (`3f26ba66…`), **4 267 requêtes**, 18→21 mai.
- Frappe **exactement 6 endpoints, exactement 711 fois chacun** : lit `/.well-known/x402`, puis sonde les 5 endpoints payants. ~1 cycle toutes les **6 minutes**.
- Ne paie **jamais** (tout en 402/400). C'est un **moniteur d'annuaire x402** (type x402scan / Bazaar) qui surveille les API listées.

### B. Crawlers de répertoires agent / MCP
Ils t'ont trouvé via ton manifeste x402, ton serveur MCP et tes `.well-known`, et te cataloguent :

| User-Agent | Requêtes | Nature |
|---|---|---|
| `AgenstryBot/0.3.0` (agenstry.com) | 884 | Crawler d'annuaire, 37 chemins balayés |
| `flows-crawler/0.1` (usemur.dev) | 308 | Crawler |
| `MCPScoringEngine/1.0` | 145 | **Note/classe ton serveur MCP** |
| `AgentDiscoveryIndex/1.0` (montexi.com) | 69 | Index d'agents |
| `APIHub-HealthCheck/1.0` | 86 | Health-check d'annuaire |
| `MCP-Catalog-Bot`, `SmartFlowObservatory`, `SkillsRep-Scanner`, `agentView-CORS-Probe` (agentview.de) | ~50 | Bots de catalogue/scan |

### C. Clients MCP
`node` (52 IP), `python-httpx` (5 IP), UA navigateur headless — ~1 150 requêtes sur `/mcp`, quasi toutes en 2xx. Frameworks d'agents qui se connectent réellement au serveur MCP. Aucun revenu (le canal `/mcp` est gratuit, 0 appel payant).

### D. Le signal client le plus parlant
`ibanforge-mcp/1.0` — **quelqu'un a installé ton paquet npm officiel**, l'a utilisé activement pendant **une journée** (95 appels, 19→20 mai), a tapé le paywall **55 fois** sur validate/compliance/batch… puis a disparu. *C'est la conversion ratée la plus importante du jeu de données* (peut-être toi en test — **à confirmer**).

**Répartition par canal (30 j) :** `api` 72 % (44 195 — contient le scanner + les bots) · `mcp_http` 15 % (9 279) · `bot` 8 % · `web` 4 % · `mcp_stdio` 0,4 %.

---

## 3. Ce qui les intéresse vraiment

- **Ta surface de découverte est dévorée :** `/.well-known/x402` 7 638 lectures · `/openapi.json` 7 180 · `/llms.txt` 2 223 · `/mcp` 10 317 · `/.well-known/agents.json` 94. L'écosystème *sait* qu'IBANforge existe.
- **Les 5 endpoints payants sont sondés de façon uniforme** (validate ~4 900, batch ~4 800, compliance ~4 700, bic ~4 600, ch ~4 600) — répartition trop égale pour un usage réel : signature d'un balayage méthodique.
- **Les rares vraies validations sont bien étrangères :** sur 126 opérations, pays de l'IBAN testé = CH 86 (tes tests), puis **GB 18, NL 16, DE 8, IE 7, FR 4, BE 3**. Les tout derniers jours : un petit pic **Pays-Bas** (NL 9 le 20 mai, 7 le 21). Probablement ce que tu vois sur le dashboard : une poignée — pas un flux — de validations réelles non-CH.
- **Premier vrai sommet de funnel : 15 inscriptions self-service en 30 j.** `/v1/keys/generate` → 201 ×15 (emails réels exigés, domaines jetables bloqués ; +5 tentatives rate-limitées). Petit mais > 0, et ce sont des **humains**. ⚠️ *Activation faible* : 126 opérations métier au total sur la période (dont 86 sur IBAN CH = tes tests) → l'usage externe réel se compte en dizaines d'appels, ces clés sont en quasi-totalité **dormantes**. *(Vérification fine bloquée : `/v1/admin/keys` exige l'`ADMIN_SECRET` côté Railway, distinct de celui du projet Vercel — à checker par toi.)*
- **Le grand absent — aucun agent LLM de production.** Zéro `ChatGPT-User`, `ClaudeBot`, `Claude-User`, `Cursor`, `Cline`, `PerplexityBot` dans les 100 premières sources (ta classification `AGENT_PATTERNS` les détecterait pourtant). Seuls les *annuaires d'agents* et les *scanners x402* te trouvent — pas les agents qui exécutent de vraies tâches financières. **C'est LE signal à surveiller : ton marché cible n'a pas encore démarré.**

---

## 4. Ce qui peut être amélioré — priorisé par ROI

### P1 — Transformer le mur 402 en rampe d'accès *(impact : élevé)*
**13 100+ hits paywall → ~0 paiement.** L'enveloppe 402 ne propose que le rail crypto (USDC/Base) — la quasi-totalité des agents (et des humains derrière) ne peuvent pas payer ainsi. **Ajouter dans la réponse 402 un lien explicite « clé API gratuite » + « pack de crédits Stripe ».** C'est le geste #1 pour capter le curieux — exactement le cas `ibanforge-mcp/1.0` qui a churné après 55× 402.

### P2 — Les 406 sur `/mcp` : 308 connexions MCP perdues *(impact : moyen — pas un bug serveur)*
**308 tentatives de connexion à `/mcp` rejetées en HTTP 406.** Vérifié dans le code : ce 406 ne vient d'aucun handler maison — c'est le **SDK MCP** (`StreamableHTTPServerTransport`) qui l'émet, le spec MCP Streamable HTTP *imposant* l'en-tête `Accept: application/json, text/event-stream`. Comportement donc **conforme**, déclenché par des clients mal configurés ou des scanners naïfs. Ce n'est pas à « corriger » au sens strict — mais 308 connexions perdues (dont peut-être le `MCPScoringEngine` qui te note) restent dommageables en pleine phase de découverte. *Option à évaluer, hors-spec :* un shim avant le SDK renvoyant un message JSON pédagogique au lieu d'un 406 nu — sans casser les clients conformes.

### P3 — Ajouter les fichiers `.well-known` que les bots réclament *(impact : moyen — effort faible)*
~420 requêtes 404 sur des conventions de découverte que tu ne sers pas : `/.well-known/mcp.json` (83), `/.well-known/agent.json` (78), `/agents.json` (52), `/agent-directory.json` (52), `/mcp.json` (52), `/agents.txt` (53). Les crawlers te disent littéralement quels fichiers ils veulent. Des **routes alias** vers tes manifestes existants = découvrabilité gratuite.

### P4 — Erreur 400 pédagogique sur `/v1/bic/:code` & `/v1/ch/clearing/:iid` *(impact : moyen)*
**9 190 requêtes en 400** (format invalide, *avant* le paywall). Dont ~280 sur `/v1/bic/%7Bcode%7D` et `/v1/ch/clearing/%7Biid%7D` : des agents qui consomment ton OpenAPI **sans substituer le placeholder `{code}`**. Détecter ce cas et renvoyer un message utile (« tu as envoyé le gabarit OpenAPI ; ex. valide : `/v1/bic/UBSWCHZH80A` ») aide l'agent à se corriger seul.

### P5 — Séparer signal et bruit dans le dashboard *(impact : moyen)*
Le bucket `api` (72 %) mélange le scanner axios, les bots d'annuaire et les vrais clients — le funnel et le revenu sont noyés. La liste `BOT_PATTERNS` (`src/lib/stats.ts`) rate `AgenstryBot`, `flows-crawler`, `MCPScoringEngine`, `APIHub-HealthCheck`, `agentView`, `SkillsRep`, `MCP-Catalog-Bot`… L'élargir reclasserait ~1 500 requêtes en `bot` → le dashboard montrerait enfin le vrai.

### P6 — Fiabiliser la mesure *(impact : faible mais structurant)*
- **Logging IP/UA : 14 % de couverture seulement.** Vérifier que chaque requête écrit bien `ip_hash` (lecture des en-têtes proxy) pour que les prochaines analyses soient complètes.
- **`/admin/revenue` : 3/131 chunks RPC échouent** (rate-limit RPC public). Configurer un `BASE_RPC_URL` dédié (Alchemy/QuickNode, tier gratuit).
- **« Phantom drift » non résorbé :** 0,324 tenté vs 0,098 encaissé = **0,226 USDC orphelins**, inchangé depuis avril.

### P7 (mineur)
Méthodes HTTP fuzzées (DELETE/PUT/PATCH sur les routes POST) → renvoyer 405 plutôt que 404 ; `/sitemap.xml` 404 (~210 hits) appartient au front, pas à l'API.

---

## 5. L'enseignement de fond

Le pic **valide une partie de ta DISTRIBUTION** : ton listing x402 + MCP + `.well-known` te rend visible **pour les annuaires et les scanners** de l'écosystème. Il **ne valide ni la demande, ni le canal cible** : 0 client payant, 0,10 $ de revenu de test, et **aucun agent LLM de production** ne t'a encore appelé. Les *robots qui cataloguent les API* t'ont trouvé ; les *agents qui exécutent des tâches et paient* — ton marché — pas encore.

C'est cohérent au mot près avec l'audit du 12 mai : *x402 = moat narratif pour 2027+, le revenu 2026 se chasse par Stripe + intros chaudes*. La priorité produit n°1 actionnable aujourd'hui : **transformer le mur 402 en rampe** (clé gratuite / Stripe visible au moment du 402) pour convertir le curieux — et **corriger le 406 MCP** pour ne pas perdre les connexions d'agents pendant que l'écosystème, justement, te regarde.

---

## Annexe — limites & prochaine étape

- **Pas de géo du caller** dans l'API (seulement `ip_hash` salté). L'« activité étrangère » que tu vois vient probablement du dashboard Railway/Vercel (qui, lui, géolocalise). **Envoie-moi une capture de cet écran** : je croiserai avec les User-Agents ci-dessus pour confirmer si les IP correspondent bien aux bots identifiés (AgenstryBot, usemur, montexi, agentview.de…).
- Données extraites le 2026-05-21 ; fenêtre glissante 30 jours. Le scanner `axios` était encore actif il y a quelques heures (dernier hit 08:47 UTC).

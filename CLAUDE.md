# IBANforge

API de validation IBAN et lookup BIC/SWIFT avec micropaiements x402, interface MCP pour agents AI, données SEPA/VoP, classification émetteur (vIBAN detection), et indicateurs de risque compliance.

> 🤝 **`AGENTS.md`, à côté, dit la même chose pour les autres agents** (Codex le lit, pas ce
> fichier-ci) : règles dures, versions de Node par zone, travaux en cours, et les deux
> conventions internes (une seule feuille de route, un rapport HTML par chantier).
> **Une règle qui change ici change là-bas**, sinon deux agents travaillent sur deux lois.

## Stack

- **Runtime** : Node.js 22+ / TypeScript (20 est en fin de vie depuis le 2026-04-30 ; 24 est impossible tant que better-sqlite3 — `^13` aujourd'hui — ne publie pas de binaire linux-x64 pour l'ABI de Node 24, et `node:24-slim` n'a pas de compilateur)
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
    iban.ts             # ADAPTATEUR de 25 lignes seulement : mod97, longueurs et découpage BBAN
                        # vivent HORS de ce dépôt, dans le paquet npm aliasé `iban-core`
                        # (npm:ibanforge, publié depuis cammac-creator/iban-core).
                        # Filet local : src/lib/iban-core-contract.test.ts
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
- **Les « 25 » ne partagent jamais une phrase.** L'essai sans clé, c'est 25 validations
  par semaine (semaine ISO, UTC), sur la seule `POST /v1/iban/validate`. L'accès sans clé du
  transport `/mcp` est une allocation séparée (`MCP_WEEKLY_LIMIT`, `src/lib/mcp-limits.ts`) :
  25 unités d'outil par semaine et par source, un lot comptant une unité par IBAN. La clé sans
  e-mail, c'est 25 requêtes par mois, sur tous les endpoints. Nommer la porte, annoncer la clé
  par ses 200 une fois réclamée ; `src/routes/free-doors-claims.test.ts` y veille. Le paquet npm
  `ibanforge-mcp` n'écrit aucun de ces chiffres : figé jusqu'à sa prochaine version, il renvoie
  à `rate-limits.yml` et à `GET /v1` (`mcp/src/published-text.test.ts`).

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
| GET | /stats | admin | Detailed statistics — exige `Authorization: Bearer STATS_TOKEN`, jamais public |
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
- ⚠️ **Le frontend Vercel ne se met PAS en ligne tout seul, et la cause n'est pas
  celle qu'on croyait.** Mesuré le 21/08/2026 : le déploiement de production EST
  à jour côté Vercel — `vercel promote` le refuse avec « already the current
  production deployment ». Ce sont les **domaines** qui sont détournés : un
  `vercel alias set` les épingle sur un déploiement précis, et cet épinglage
  **écrase l'assignation de production**. Le workaround est donc devenu la cause,
  et il se ré-arme à chaque fois qu'on l'applique.
  → En attendant de le retirer : `vercel alias set <url-du-déploiement>
  ibanforge.com` **et** `www.ibanforge.com`. Retour arrière : `vercel rollback`.
  → Pour en finir : retirer l'épinglage pour que les domaines suivent la
  production nativement. C'est la décision de Claude-Alain, elle supprime le banc
  d'essai avant publication.
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

### Surcouche privée des données sous conditions (depuis le 25.09.2026)

Ce qui peut être servi mais pas redistribué (lignes EBA STEP2, NBP et OeNB de l'annuaire,
registres AT, BE et SM, liste PRA, liste ONU, registres EPC) est listé UNE fois, dans
`src/lib/restricted-family.ts`, avec la définition de chaque table et la façon de dater ses
lignes. En production, il vient d'un fichier privé par base, désigné par
`RESTRICTED_BIC_OVERLAY_PATH` et `RESTRICTED_COMPLIANCE_OVERLAY_PATH` (chemins absolus sur
le volume Railway, `/app/data/…`), fusionné au démarrage dans une copie de la base publique
fraîche (`src/lib/restricted-overlay.ts`, `restricted-overlay-runtime.ts`), membre par
membre, la donnée la plus fraîche l'emportant : le public est gardé (`kept_public`) quand il
est plus récent, ou non daté et différent. La dernière surcouche acceptée est gardée à côté
(`*.accepted.sqlite`) et servie au démarrage si le fichier de la variable est refusé ou perd
un membre qu'elle sert (un membre tardif absent compris), même s'il en gagne un autre ; un tel
fichier ne la remplace jamais.
Recharger : remplacer le fichier de façon atomique (voisin puis `mv`), l'API le contrôle en
dix minutes au plus, ne refusionne que cette base, et garde ce qu'elle sert si le nouveau est
refusé ou perdrait un membre servi. État : `GET /health` → `restricted_overlays`. Construire :
`npm run overlay -- extract` (sans téléchargement) ou `npm run overlay:seed` (circuit privé
seulement). Retirer : ôter la variable, redémarrer, vérifier `off`, puis effacer
`restricted-*.merged-*`, `restricted-*.accepted.sqlite` et la surcouche dans l'ancien dossier ;
effacer le seul fichier privé n'est PAS un retour arrière. **Jamais** commiter une surcouche
ni une copie fusionnée, jamais en écrire une dans un dépôt git (le script refuse ;
`.gitignore` attrape `restricted-*.sqlite*` et `*.merged-*.sqlite*`), jamais ajouter une table
ou une source à la famille ailleurs que dans cette constante. Même règle dans `AGENTS.md`.

**Le retrait (étape 6, 25.09.2026)** : plus rien de la famille dans ce dépôt, hors historique
git. Les seeders publics tournent avec `SEED_FAMILY=public` par défaut et ne téléchargent aucun
membre ; les bases suivies se reconstruisent sans la famille (`npm run overlay -- strip`, sans
téléchargement) et `src/lib/public-base-family-free.test.ts` échoue si une ligne revient ; la
carte composite n'a plus les clés AT, BE, LU, PL et FI (les clés PL, FI et LU et la liste
finlandaise reviennent par la surcouche : membres `map_pl`, `map_fi`, `map_lu` et
`register_fi`, marqués `mayBeAbsent`, reconstruits par `scripts/seed-curated-map.ts` ;
`/health` nomme sous `restricted_overlays.bic.absent` ceux que la surcouche servie ne porte
pas) ; les
pages /at, /be et /sm lisent l'API à la demande. Sans surcouche,
chaque réponse qui dépend de la famille dit « non consulté », jamais « non ».

**Le tirage (étape 5, depuis le 25.09.2026)** : `src/lib/restricted-overlay-pull.ts`. Un dépôt
privé reconstruit la surcouche chaque semaine (conformité) et chaque mois (BIC), ne commite
aucune donnée, et publie une release : les deux fichiers et un `manifest.json`
(`src/lib/restricted-overlay-manifest.ts` : SHA-256, taille, date de génération, commit public,
lignes par membre), après une porte de qualité (`npm run overlay -- check`, puis `manifest
--previous` : aucun fichier ni membre perdu, aucun membre en baisse de plus de 10 %). Une
source en panne au passage mensuel ne l'arrête plus : chaque seeder de la famille rend compte
de chaque membre (`scripts/seed-report.ts`), et un membre dont la source a échoué est repris
tel quel de la surcouche précédente posée au chemin de sortie, dates d'origine gardées
(`scripts/restricted-carry-over.ts`), noté dans le fichier et le manifeste (`carried_over`) et
annoncé par une annotation `::warning::` ; refus si aucun membre n'est frais, sans surcouche
précédente, ou si une donnée reprise a plus de 45 jours ou une date inconnue, ou si sa liste
PRA sort de la fenêtre du seeder. Avec
`RESTRICTED_OVERLAY_PULL_REPO` (owner/name, écrit nulle part dans ce dépôt) et
`RESTRICTED_OVERLAY_PULL_TOKEN` (jeton à grain fin, lecture seule du contenu de ce seul dépôt),
la veille de dix minutes tire la dernière release toutes les quatre heures plus une gigue d'au
plus trente minutes (une heure après un échec, jamais au démarrage) ; un fichier dont
l'empreinte est déjà servie, en place ou acceptée n'est jamais retéléchargé ; sinon
téléchargement plafonné, empreinte vérifiée, `inspectOverlay` doit accepter chaque membre et
aucun membre servi ne doit y manquer (`members_lost`), un
voisin est écrit puis renommé sur le fichier de `RESTRICTED_*_OVERLAY_PATH`, et la base est
rechargée aussitôt. Tout échec garde ce qui est servi. Les deux variables absentes : aucun
appel réseau, aucune alerte, `GET /health` → `restricted_overlays.pull` vaut `off` ; sinon il
donne l'état, la dernière tentative et le dernier succès, la dernière release, et pour chaque
base la release et la date de génération du fichier servi, jamais le nom du dépôt ni le jeton.
Alertes, refermées seules : `overlay:pull` (aucun tirage réussi depuis 24 h),
`overlay:pull:stale` (dernière release de plus de 9 jours, ou fichier de plus de 9 jours pour
la conformité, 35 pour le BIC, ou absent). Retirer : ôter d'abord les deux variables du
tirage, puis retirer la surcouche comme ci-dessus.

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

## Remettre une PR à l'intégrateur (depuis le 15.09.2026)

La session principale Claude Code intègre **toute seule** : un veilleur sur le Mac de l'intégrateur
regarde ce dépôt toutes les cinq minutes (sans terminal ouvert, sans dépenser un jeton tant que rien
n'est prêt) et lance une passe dès qu'une PR est prête ; la passe prend chaque PR prête l'une après l'autre, relit le
diff, fusionne dans `main` avec les contrôles locaux (dont `next build`, que la CI ne fait pas),
surveille le déploiement, prouve le changement en ligne, pose le jalon sur la feuille de route
privée et prévient Claude-Alain. On ne lui demande rien, sauf quand une règle dit que c'est à lui.

Ce qui rend une PR *prête* :

- branche `codex/<sujet>-<aaaammjj>`, base `main`, **pas un brouillon**, tous les contrôles GitHub
  verts ;
- une description en français : ce qui change, ce qui a été testé (check racine, tests du site,
  `next build`, contrôles navigateur) et, si le site est touché, **une chose à vérifier en ligne
  après publication** (une phrase nouvelle, un fichier à empreinte, un champ JSON) qui n'existe
  qu'après le changement ;
- le dossier privé `docs/internal/<sujet>-<aaaa-mm-jj>/` avec `PASSATION.md` et, si un jalon est
  attendu, `ETAPE-PROPOSEE.json` (`titre`, `statut`, `resume`, `rapport`, `url_locale`, `version`,
  `integration`). L'intégrateur l'enregistre et y écrit `enregistre_le`.

Ce que l'intégrateur répond, par étiquette :

| Étiquette | Sens | Quoi faire |
|---|---|---|
| `integrateur:en-cours` | fusion, tests et publication en cours | rien ; ne pas pousser sur cette branche tant que l'étiquette est là |
| `integrateur:a-corriger` | un commentaire public dit ce qui doit changer | pousser le correctif sur la même branche ; l'étiquette tombe seule à la passe suivante |
| `integrateur:attente-claude-alain` | prix, quotas, registres, textes légaux, infrastructure : sa décision | attendre ; il retire l'étiquette |

L'intégrateur ne fusionne jamais Dependabot, `vps-migration` ni `registre-gr-*` (autres circuits,
autres sessions) et ne publie jamais un paquet (`RELEASING.md`).

La mécanique : `docs/internal/integration/integrateur.py` (privé, sur le Mac). Le jugement : la
skill `/ibanforge-integrer` de la session principale. Page privée du journal :
`docs/internal/pages/integrateur.html` sur le port des pages internes.

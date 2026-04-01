# IBANforge Frontend — Design Spec

**Date:** 2026-04-01
**Status:** Approved
**Scope:** Site web ibanforge.com (Next.js sur Vercel) + dashboard + docs + playground

---

## 1. Architecture

Deux applications distinctes, un seul produit :

```
ibanforge.com (Vercel/Next.js)       api.ibanforge.com (Railway/Hono)
┌────────────────────────────┐       ┌──────────────────────────┐
│  Pages publiques :         │       │  Endpoints existants :   │
│  - / (landing)             │ fetch │  - POST /v1/iban/validate│
│  - /playground             │ ────> │  - POST /v1/iban/batch   │
│  - /docs                   │       │  - GET /v1/bic/:code     │
│  - /pricing                │ <──── │  - GET /health           │
│  - /blog                   │ JSON  │  - GET /stats            │
│                            │       │  - GET /stats/history    │
│  Page protegee :           │       │  - GET /v1/demo          │
│  - /dashboard              │       │                          │
└────────────────────────────┘       └──────────────────────────┘
```

Le frontend est un site statique/SSR classique qui consomme l'API via fetch.
L'API ne change pas de stack — on ajoute juste un endpoint `/stats/history`.

### Communication frontend <-> API

- Le frontend appelle l'API via `NEXT_PUBLIC_API_URL` (env var)
- En dev : `http://localhost:3000` (API locale)
- En prod : `https://api.ibanforge.com`
- CORS deja configure sur l'API Hono (origin: ibanforge.com)
- Les appels playground passent par une API route Next.js (`/api/playground`) pour eviter d'exposer les endpoints payants cote client — le playground est gratuit, le proxy cote serveur appelle `/v1/demo` ou fait un bypass x402

## 2. Pages

### 2.1 Landing page (`/`)

**But :** Convertir un visiteur en utilisateur en 5 secondes.

**Structure :**
1. Hero : titre "IBANforge" + tagline + CTA "Try it now" (lien vers /playground)
2. Features : 4 cartes (75+ pays, 39K+ BIC, MCP pour AI agents, x402 micropaiements)
3. Endpoints : tableau des 3 endpoints payants avec prix
4. Quick start : snippet curl copier-coller
5. Footer : liens docs, GitHub, pricing

**Design :** Dark theme, accent ambre/or, typographie clean. Pas de hero image — focus sur le texte et le code.

### 2.2 Playground (`/playground`)

**But :** Tester l'API sans payer, sans s'inscrire. Meilleur argument de vente.

**Structure :**
- 2 onglets : "Validate IBAN" et "Lookup BIC"
- Champ de saisie avec exemples pre-remplis (placeholder)
- Bouton "Validate" / "Lookup"
- Resultat affiche en JSON formatte avec coloration syntaxique
- Indicateur de temps de reponse
- Lien "Use this in your code" qui renvoie vers /docs

**Technique :**
- Appelle `/api/playground` (API route Next.js) qui proxie vers l'API Hono
- Le proxy utilise le endpoint `/v1/demo` ou un bypass interne — pas de paiement x402
- Rate limit cote proxy : 20 appels/min par IP pour eviter l'abus
- Exemples pre-charges : CH93 0076 2011 6238 5295 7 (IBAN), UBSWCHZH80A (BIC)

### 2.3 Documentation (`/docs`)

**But :** Un agent AI ou un developpeur doit savoir comment appeler l'API.

**Structure :**
- `/docs` — Vue d'ensemble (introduction, auth, base URL)
- `/docs/iban-validate` — POST /v1/iban/validate (params, reponse, erreurs, exemples)
- `/docs/iban-batch` — POST /v1/iban/batch
- `/docs/bic-lookup` — GET /v1/bic/:code
- `/docs/mcp` — Configuration MCP pour Claude Desktop / AI agents
- `/docs/x402` — Comment fonctionnent les micropaiements (explique simplement)
- `/docs/errors` — Codes d'erreur et troubleshooting

**Chaque page endpoint contient :**
- Description de l'endpoint
- URL + methode HTTP
- Parametres (avec types et exemples)
- Reponse JSON annotee
- Exemples de code : curl, Python (requests), TypeScript (fetch)
- Erreurs possibles

**Technique :**
- Fichiers MDX dans `content/docs/`
- Layout sidebar avec navigation
- Coloration syntaxique (shiki via rehype-pretty-code)
- Copier-coller sur les blocs de code

### 2.4 Pricing (`/pricing`)

**But :** Transparence totale sur les prix.

**Structure :**
- Tableau des 3 endpoints avec prix unitaire
- Explication x402 : "Pay per call, no subscription, no API key"
- Comparaison : "100 validations = $0.20" (mettre en perspective)
- Mode test : "Use /v1/demo for free testing"
- FAQ prix (3-4 questions)

### 2.5 Dashboard (`/dashboard`)

**But :** Voir l'activite de l'API et du site en temps reel.

**Auth :** Mot de passe simple via variable d'env `DASHBOARD_PASSWORD`. Cookie de session httpOnly apres login. Pas de base de donnees utilisateurs.

**3 volets :**

#### Volet A — Stats API (priorite 1)
- Appels aujourd'hui / semaine / mois (graphique ligne Recharts)
- Revenus USDC cumules (compteur + graphique)
- Repartition par endpoint (donut chart : IBAN validate / batch / BIC lookup)
- Taux de succes (% validations reussies)
- Top 10 pays les plus demandes
- Source : GET `{API_URL}/stats` + GET `{API_URL}/stats/history`

#### Volet B — Stats site web
- Visiteurs uniques, pages vues
- Pages les plus consultees
- Source : Vercel Analytics (integre, gratuit, respecte la vie privee)
- Pas de composant custom pour ca — on utilise le dashboard Vercel natif avec un lien

#### Volet C — Monitoring
- Pastille verte/rouge : API en ligne ?
- Temps de reponse actuel (ms)
- Historique uptime 30 jours (barres vertes/rouges)
- Source : le dashboard ping `/health` toutes les 60s via un cron Vercel ou un setInterval cote client

**Layout dashboard :**
```
┌─────────────────────────────────────────────┐
│  IBANforge Dashboard          [Logout]       │
├─────────────┬───────────────────────────────┤
│             │  ┌──────┐ ┌──────┐ ┌───────┐  │
│  Sidebar:   │  │Today │ │Week  │ │Revenue│  │
│  - Overview │  │ 142  │ │ 891  │ │$1.78  │  │
│  - API Stats│  └──────┘ └──────┘ └───────┘  │
│  - Monitor  │                                │
│  - Settings │  [===== Line Chart =====]      │
│             │                                │
│             │  ┌─ Endpoints ──┐ ┌─ Pays ──┐  │
│             │  │  Donut chart │ │ Top 10  │  │
│             │  └──────────────┘ └─────────┘  │
└─────────────┴───────────────────────────────┘
```

### 2.6 Blog (`/blog`)

**But :** Changelog, annonces, SEO.

**Structure :**
- Liste d'articles (titre, date, extrait)
- Page article individuelle
- Fichiers MDX dans `content/blog/`
- Premier article : "Introducing IBANforge — IBAN validation API for AI agents"

**Technique :** MDX + contentlayer ou simple fs.readdir sur les fichiers MDX. Pas de CMS.

## 3. Stack technique

| Technologie | Role |
|-------------|------|
| Next.js 15 | Framework (App Router) |
| shadcn/ui | Composants UI |
| Tailwind CSS | Styling |
| Recharts | Graphiques dashboard |
| MDX + rehype-pretty-code | Documentation et blog |
| Vercel Analytics | Stats visiteurs |
| next-themes | Dark/light mode (default: dark) |

## 4. Structure des fichiers

```
ibanforge/
  src/                          # API Hono (existant, inchange)
  frontend/                     # Nouveau — Next.js app
    app/
      layout.tsx                # Root layout, theme, fonts
      page.tsx                  # Landing page
      playground/page.tsx       # Playground interactif
      docs/
        layout.tsx              # Layout sidebar docs
        page.tsx                # /docs overview
        [slug]/page.tsx         # Pages docs dynamiques
      pricing/page.tsx          # Page tarifs
      dashboard/
        layout.tsx              # Layout dashboard + auth guard
        page.tsx                # Overview
        api-stats/page.tsx      # Volet A
        monitoring/page.tsx     # Volet C
        login/page.tsx          # Login simple
      blog/
        page.tsx                # Liste articles
        [slug]/page.tsx         # Article individuel
      api/
        playground/route.ts     # Proxy vers API Hono (gratuit)
        auth/route.ts           # Login/logout dashboard
    components/
      ui/                       # shadcn components
      landing/                  # Composants landing page
      playground/               # Composants playground
      docs/                     # Sidebar, code blocks
      dashboard/                # Charts, stats cards, monitor
    content/
      docs/                     # Fichiers MDX documentation
      blog/                     # Fichiers MDX blog
    lib/
      api-client.ts             # Fetch wrapper vers l'API Hono
      auth.ts                   # Logic auth dashboard (cookie-based)
    public/
      og-image.png              # Open Graph image
```

## 5. Modifications cote API (Hono)

Un seul ajout necessaire : endpoint `/stats/history` pour le dashboard.

```
GET /stats/history?period=7d|30d|90d
```

Retourne un tableau jour par jour :
```json
[
  { "date": "2026-04-01", "iban_validate": 42, "iban_batch": 5, "bic_lookup": 89, "revenue_usdc": 0.15 },
  { "date": "2026-04-02", ... }
]
```

Source : la table `daily_stats` dans stats.sqlite (existe deja, juste besoin d'une route).

## 6. Deploiement

| Composant | Plateforme | Domaine |
|-----------|-----------|---------|
| Frontend Next.js | Vercel | ibanforge.com |
| API Hono | Railway | api.ibanforge.com |

**DNS (Infomaniak ou registrar du domaine) :**
- `ibanforge.com` → CNAME vers Vercel
- `api.ibanforge.com` → CNAME vers Railway

**Variables d'env frontend (Vercel) :**
- `NEXT_PUBLIC_API_URL` = `https://api.ibanforge.com`
- `DASHBOARD_PASSWORD` = mot de passe dashboard

**Variables d'env API (Railway) :**
- `PORT`, `WALLET_ADDRESS`, `FACILITATOR_URL` (existants)
- `CORS_ORIGIN` = `https://ibanforge.com`

## 7. Ordre d'implementation

Phase 1 — MVP (le site existe et fonctionne) :
1. Setup Next.js + shadcn dans `frontend/`
2. Landing page
3. Playground (avec proxy API route)
4. Docs (3 pages endpoints + overview)
5. Health endpoint public (deja existant sur l'API)

Phase 2 — Confiance et conversion :
6. Pricing page
7. Exemples de code (curl, Python, TypeScript) dans les docs
8. Page status/uptime

Phase 3 — Dashboard :
9. Ajouter `/stats/history` a l'API Hono
10. Auth simple dashboard
11. Dashboard volet A (stats API)
12. Dashboard volet C (monitoring)

Phase 4 — SEO et croissance :
13. Blog avec premier article
14. Vercel Analytics (volet B)
15. Open Graph meta tags + SEO

Phase 5 — Deploiement prod :
16. Deploy API sur Railway
17. Deploy frontend sur Vercel
18. Configurer DNS (ibanforge.com + api.ibanforge.com)
19. Tests end-to-end en production

## 8. Ce qui est hors scope

- Dashboard client / login utilisateur (pas besoin en x402)
- Systeme de facturation / Stripe
- Forum / communaute
- SEO avance / marketing de contenu
- Support multi-langues du site (anglais uniquement pour v1)

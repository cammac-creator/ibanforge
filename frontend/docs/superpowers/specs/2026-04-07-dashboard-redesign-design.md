# Dashboard IBANforge v2 — Design Spec

## Objectif

Refonte complète du dashboard admin IBANforge : nouveau design inspiré Stripe Dashboard (dense, lisible, professionnel) + nouvelles pages Analytics et Quality pour guider les décisions produit. Pas d'export de données — focus sur les insights d'usage.

## Utilisateur cible

Alain (admin unique). Dashboard protégé par mot de passe existant.

## Direction visuelle

- **Style** : Stripe Dashboard — dense mais lisible, data-rich, couleurs subtiles
- **Layout** : Top-nav horizontal (tabs), pas de sidebar
- **Palette** : Dark (#09090b background), cards avec gradients subtils (#111113 → #151518), bordures #1e1e22
- **Accents** : ambre (#f59e0b) pour validate, bleu (#3b82f6) pour batch, vert (#22c55e) pour BIC, rouge (#ef4444) pour erreurs
- **Typo** : font-mono pour les chiffres/données, sans-serif pour le texte
- **Stat cards** : gradient background, sparkline intégrée, badge trend (pill vert/rouge/gris)
- **Period selector** : toujours visible en haut à droite (7d / 30d / 90d)

## Structure des pages

### 1. Overview (`/dashboard`)

Page d'accueil — vue synthétique des KPIs.

**Composants :**
- **3 stat cards avec sparklines** (ligne horizontale) :
  - Appels aujourd'hui + trend % vs hier + sparkline 7j
  - Revenue USDC + trend % + sparkline 7j
  - Taux de succès global + badge stable/up/down + sparkline 7j
- **Line chart principal** : volume 30j par endpoint (3 lignes : validate, batch, BIC). Redesigné avec le nouveau style.
- **Barre de répartition endpoints** : 3 progress bars horizontales avec % (remplace le donut chart actuel, plus lisible)
- **Top 5 pays** : compact, emoji drapeaux, compteur, mini-bar proportionnelle

**Données** : endpoints existants `/stats` + `/stats/history`

### 2. Analytics (`/dashboard/analytics`) — NOUVEAU

Patterns d'usage pour comprendre comment l'API est utilisée.

**Composants :**
- **Heatmap horaire** : grille 24 colonnes (heures) × 7 lignes (jours de la semaine). Couleur = intensité d'appels (ambre clair → ambre foncé). Tooltip au hover avec le nombre exact.
- **Résumé peak hours** : texte généré côté frontend — ex: "Pic d'activité : Tue–Thu 10h–15h CET. Weekend : -72%"
- **Corrélations endpoints** : 3 barres empilées montrant les patterns d'usage combiné :
  - % validate seul
  - % validate + BIC lookup
  - % batch only
  - % batch + BIC
- **Tendance géo** : line chart multi-séries des top 5 pays sur la période sélectionnée
- **Endpoint popularity trend** : area chart empilé montrant l'évolution de la répartition validate/batch/BIC dans le temps

**Données** : nouveau endpoint `GET /stats/hourly` + `GET /stats/patterns`

### 3. Quality (`/dashboard/quality`) — NOUVEAU

Qualité des requêtes — comprendre les erreurs pour améliorer le produit et la documentation.

**Composants :**
- **3 stat cards erreurs** :
  - Taux d'erreur validate (% + sparkline trend)
  - Taux miss BIC (% + sparkline trend)
  - Total erreurs période (nombre + trend)
- **Top IBANs invalides** : tableau des patterns récurrents — colonnes : pays/préfixe IBAN (tronqué), nombre d'occurrences, type d'erreur (format, check digit, longueur). Top 10.
- **BICs introuvables** : tableau des codes BIC cherchés mais absents de la base GLEIF — colonnes : code BIC, nombre de recherches, pays. Top 10.
- **Erreurs par pays** : bar chart horizontal — quels pays génèrent le plus d'erreurs (IBANs invalides)
- **Success rate trend** : line chart montrant l'évolution du taux de succès par endpoint sur la période

**Données** : nouveau endpoint `GET /stats/errors`

### 4. Monitoring (`/dashboard/monitoring`) — REDESIGN

Même fonctionnalités que le monitoring actuel, redesigné dans le nouveau style.

**Composants (inchangés fonctionnellement) :**
- Indicateur de statut (online/offline) avec pulse animation
- Grille d'info : response time, version, uptime, BIC database entries
- Stats summary : total operations, IBAN validations, BIC lookups
- Uptime bar 30 jours
- Auto-refresh 60s

**Changements visuels :**
- Intégré dans le layout top-nav (plus de page isolée)
- Cards avec gradients subtils
- Response time avec sparkline des dernières vérifications

## Composants UI

### Nouveaux composants

| Composant | Fichier | Description |
|-----------|---------|-------------|
| `TopNav` | `components/dashboard/top-nav.tsx` | Navigation horizontale avec tabs actifs, period selector, logo IF |
| `StatCardV2` | `components/dashboard/stat-card-v2.tsx` | Card avec gradient, sparkline SVG intégrée, badge trend pill |
| `Heatmap` | `components/dashboard/heatmap.tsx` | Grille horaire 24×7, tooltip hover, échelle de couleur dynamique |
| `ErrorTable` | `components/dashboard/error-table.tsx` | Tableau compact pour top erreurs/BICs, triable, lignes alternées |
| `ProgressBars` | `components/dashboard/progress-bars.tsx` | Barres horizontales de répartition avec labels et % |
| `DashboardLayout` | `app/[locale]/dashboard/(protected)/layout.tsx` | Nouveau layout avec TopNav au lieu de sidebar |

### Composants refondus

| Composant | Changements |
|-----------|-------------|
| `LineChart` | Nouveau style tooltip, couleurs alignées, option area fill |
| `StatCard` | Remplacé par `StatCardV2` |
| `DonutChart` | Supprimé — remplacé par `ProgressBars` |
| `SidebarNav` | Supprimé — remplacé par `TopNav` |
| `DashboardHeader` | Intégré dans `TopNav` |
| `QuickActions` | Supprimé — la top-nav remplit ce rôle |

## Backend — Changements nécessaires

### Modifications DB (stats.sqlite)

**Table `operations` — enrichir :**
```sql
-- Colonnes existantes : id, operation_type, country_code, success, created_at
-- Ajouter :
ALTER TABLE operations ADD COLUMN hour INTEGER;        -- 0-23
ALTER TABLE operations ADD COLUMN day_of_week INTEGER; -- 0=Mon, 6=Sun
ALTER TABLE operations ADD COLUMN error_detail TEXT;   -- IBAN tronqué (4 premiers chars) ou BIC code
```

Les colonnes `hour` et `day_of_week` sont redondantes avec `created_at` mais permettent des requêtes agrégées rapides sans parsing de date en SQLite.

**Nouvelle table `hourly_stats` :**
```sql
CREATE TABLE IF NOT EXISTS hourly_stats (
  date TEXT NOT NULL,          -- YYYY-MM-DD
  hour INTEGER NOT NULL,       -- 0-23
  day_of_week INTEGER NOT NULL,-- 0=Mon, 6=Sun
  operation_type TEXT NOT NULL,
  total INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  PRIMARY KEY (date, hour, operation_type)
);
```

### Nouveaux endpoints API

**`GET /stats/hourly?period=7|30`**
```json
{
  "heatmap": [
    { "day": 0, "hour": 9, "total": 45 },
    { "day": 0, "hour": 10, "total": 72 }
  ],
  "peak_hours": { "start": 10, "end": 15, "days": [1, 2, 3] },
  "weekend_drop_pct": 72
}
```

**`GET /stats/errors?period=30`**
```json
{
  "error_rate": {
    "iban_validate": { "rate": 1.2, "trend": [1.5, 1.3, 1.2, 1.1, 1.2, 1.3, 1.2] },
    "bic_lookup": { "rate": 4.2, "trend": [3.8, 4.0, 4.1, 4.2, 4.0, 4.3, 4.2] }
  },
  "top_invalid_ibans": [
    { "prefix": "GB82", "country": "GB", "count": 47, "error_type": "check_digit" }
  ],
  "top_missing_bics": [
    { "bic": "DEUTDEFF", "count": 23, "country": "DE" }
  ],
  "errors_by_country": [
    { "country": "GB", "count": 89 },
    { "country": "FR", "count": 45 }
  ]
}
```

**`GET /stats/patterns?period=30`**
```json
{
  "usage_combos": {
    "validate_only": 67,
    "validate_and_bic": 22,
    "batch_only": 8,
    "batch_and_bic": 3
  },
  "geo_trend": [
    { "date": "2026-04-01", "CH": 34, "DE": 28, "FR": 15 }
  ],
  "endpoint_share_trend": [
    { "date": "2026-04-01", "iban_validate": 64, "iban_batch": 24, "bic_lookup": 12 }
  ]
}
```

Tous protégés par `STATS_TOKEN` (même mécanisme que `/stats` existant).

### Modification du recording de stats

Dans `src/lib/stats.ts`, enrichir `recordOperation()` pour stocker :
- `hour` et `day_of_week` extraits de `new Date()`
- `error_detail` : les 4 premiers caractères de l'IBAN invalide ou le code BIC non trouvé
- Agrégation dans `hourly_stats` en plus de `daily_stats`

Note : `error_detail` ne stocke que des préfixes tronqués (4 chars), pas les IBANs complets — pas de données sensibles.

## Internationalisation

Toutes les nouvelles pages et composants doivent être traduits en 3 langues (en/fr/de) via next-intl. Ajouter les clés dans les 3 fichiers de messages :
- `dashboard.analytics.*`
- `dashboard.quality.*`
- `dashboard.topNav.*`

## Contraintes techniques

- Next.js 16 App Router + React 19
- Les pages Overview, Analytics, Quality sont des Server Components (fetch côté serveur avec STATS_TOKEN)
- La page Monitoring reste un Client Component (auto-refresh)
- Recharts pour les charts (déjà installé)
- Heatmap : SVG custom (pas de dépendance supplémentaire)
- Sparklines dans stat cards : SVG inline (pas Recharts, trop lourd pour un micro-graphique)

## Hors périmètre

- Pas de système de clés API (chantier séparé)
- Pas d'export CSV/JSON
- Pas de date picker custom (7d/30d/90d suffit)
- Pas d'alertes/notifications
- Pas de live feed temps réel

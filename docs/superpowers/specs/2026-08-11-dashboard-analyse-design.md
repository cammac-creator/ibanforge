# Dashboard — évolution de la partie analyse

Date : 2026-08-11 · Statut : approuvé (design validé à l'oral, construction de nuit autorisée)

## Problème

La page `/dashboard` analyse du **trafic** (requêtes, statuts HTTP, pays) alors que
les décisions du propriétaire portent sur des **clients** (qui s'active, qui paie,
quel canal amène des inscrits qui appellent). Trois faiblesses concrètes :

1. La table « Clients & leads » lit `used` seul — or les clés prépayées décomptent
   `credits_remaining` et laissent `used` à zéro : un client payant y apparaît
   « unused ». Le raisonnement usage doit toujours lire les crédits.
2. Le dashboard ne sait pas répondre à « est-ce cassé ? » : une panne de collecte
   (token tourné, écriture stats en échec) produit les mêmes zéros qu'une vraie
   baisse de trafic.
3. Aucune vue conversion : inscription → 1er appel → limite → achat n'existe nulle
   part, alors que c'est la question business n° 1.

## Axe 1 — Vue Clients « argent d'abord »

### Backend : `GET /v1/admin/activation` (X-Admin-Secret)

Agrégation **par email** (jamais par clé), comptes internes exclus via
`isInternalEmail`. Par client :

- `email`, `keys` (préfixes + rôle free/paid), `signup_at` (min created_at),
  `source` (valeurs distinctes), `first_call_at` (min created_at dans
  `request_log` sur les préfixes du client), `last_seen_at` (max),
  `calls_90d` (comptage billable), `free_used_month` + `free_quota`
  (somme api_usage mois courant sur les clés sans crédits),
  `paywall_hits` (402/429 sur ses clés, période),
  `paid` : `credits_total`, `credits_remaining`, `packs` (nb de clés à crédits).
- Bloc `funnel` (période 30/90 j, inscrits de la période) : `signed_up`,
  `first_call`, `hit_limit` (quota atteint OU 402/429 vu), `purchased` + délais
  médians signup→1er appel et 1er appel→achat (en heures).
- Bloc `sources` : par source d'inscription → inscrits, % ayant appelé, payants.
- Bloc `cohorts` : 8 semaines ISO × { signups, called_pct, paid_pct }.

Un seul endpoint : la page fait déjà 7 fetchs, on n'en ajoute qu'un.

### Frontend

- **Table Clients** (remplace « Clients & leads ») : une ligne par email —
  source, inscrit depuis, 1er appel (délai), usage gratuit du mois (barre),
  **crédits si payant** (barre restants/total + badge PAYANT), statut recalculé :
  `new` (inscrit < 3 j sans appel) → `active` → `at-limit` (quota ou 402/429)
  → `paying` → `dormant` (payant sans appel depuis 14 j) → `silent`
  (jamais appelé ≥ 3 j). Le statut d'un payant ne peut JAMAIS être « unused ».
- **Funnel d'activation** : 4 marches avec taux de passage + délais médians.
  Remplace le funnel robots comme bloc de tête ; le funnel HTTP existant
  descend d'un cran mais reste (il mesure la demande machine).
- **Provenance** : barres par source avec « % qui appellent ».
- **Cohortes** : grille 8 semaines.
- Cumul revenu x402 affiché borné au 2026-04-17 (fin des revenus fantômes que
  le tooltip actuel avoue), avec note.

## Axe 2 — Fiabilité de la mesure

- **Témoin de collecte** : `/stats` expose `last_write_at` (max created_at de
  request_log). La bande santé affiche « dernière écriture il y a X min » ;
  > 30 min entre 06:00 et 22:00 UTC → bandeau rouge « collecte en panne — les
  zéros ci-dessous ne sont pas fiables ».
- **Erreur ≠ zéro** : chaque fetch de la page distingue « données reçues » de
  « fetch en échec (401/timeout) » ; un bloc en échec affiche un état d'erreur
  explicite, jamais des zéros.
- **Bande attendue** : sur la courbe requêtes/jour, bande grise = min–max des
  8 mêmes jours de semaine précédents. Calculée côté backend : chaque entrée de
  `/stats/history` porte `expected_min`/`expected_max` (une période de 7 jours
  affichée n'aurait pas assez d'historique pour le calcul côté page) ; point
  hors bande marqué.
- **Annotations** : table `events` (ts, label, kind `deploy|manual`) dans
  stats.sqlite. Un event `deploy` auto au boot du serveur (version npm),
  `POST /v1/admin/events` pour noter à la main (rotation, campagne, mention).
  Repères verticaux sur les courbes trafic + funnel.

## Axe 3 — Le point hebdo auto-rédigé

- **Stockage** : table `weekly_digest` (week TEXT PK 'YYYY-Www', created_at,
  body_fr TEXT, facts_json TEXT). `POST /v1/admin/digest` (upsert par semaine,
  rejouable sans doublon) + `GET /v1/admin/digest?limit=N`.
- **Script VPS** `~/ibf-weekly-digest.py` (même famille que les mails
  d'activation) : cron lundi 07:00 UTC. Il lit /stats, /stats/history,
  /stats/business-funnel, /v1/admin/activation ; calcule TOUS les deltas
  semaine/semaine en Python ; envoie à `claude-sonnet-5` (fallback haiku) un
  prompt en FRANÇAIS avec les faits verrouillés — le modèle ne fait aucune
  arithmétique, chiffres copiés à l'exact ; poste le digest + un message
  Telegram (bot habituel). Kill-switch `~/ibf-digest.pause`, `--dry-run`.
- **Frontend** : encart « Le point de la semaine » en tête de dashboard
  (semaine courante ou dernière disponible), historique dépliable.

## Contraintes transverses

- Repo PUBLIC : ni chiffre d'activité réel ni nom/adresse client dans code,
  commentaires, fixtures (`acme@example.com`), messages de commit, ce spec.
- Livraison par lots : A (backend activation) → B (UI clients) → C (fiabilité)
  → D (digest). Chaque lot : tests + `npm run check`, commit, push (Railway
  auto), frontend promu par `vercel alias set` sur apex + www.
- `git fetch` + rebase avant chaque push (sessions parallèles).
- Secrets jamais affichés ; le script VPS lit les secrets de `~/tabornio/.env`
  sur le VPS.

## Hors périmètre (non demandé)

Brancher /stats/sources, /stats/patterns, status-by-path-table sur la page ;
top pays par période. (Quick wins proposés, non retenus dans ce lot.)

# Village IBANforge — visualisation live et gamifiée du pipeline (`/live`)

**Date** : 2026-09-01 · **Statut** : design validé en brainstorm, spec en relecture
**Décideur** : Claude-Alain · **Portée** : frontend (page publique) + un endpoint API léger

---

## 1. But

Rendre visible un produit invisible. Une validation IBAN traverse une dizaine
d'étapes réelles en moins d'une seconde ; personne ne le voit. La page `/live`
montre un petit monde en vue de dessus, style action-RPG 16-bit, où chaque
étape du pipeline est une station tenue par un personnage. On tape un IBAN,
un coursier le porte de station en station, et chaque déplacement correspond
à une vraie étape de la vraie requête qui vient d'être servie.

**Le but premier est de clarifier IBANforge et ce qui s'y passe.** Le ludique
est au service de la pédagogie, jamais l'inverse. Usages : démos en direct
(taper le vrai IBAN d'un ami), clips pour les réseaux sociaux, explication du
produit à des non-initiés. Public visé : développeurs, fintech, curieux
techniques.

## 2. Décisions actées (brainstorm du 01/09/2026)

| # | Décision | Choix |
|---|----------|-------|
| 1 | Où ça vit | **Page publique** du site, `ibanforge.com/live` (frontend Next.js existant) |
| 2 | Moteur « live » | **Reconstruction du chemin** depuis la réponse JSON réelle — vrai appel au moment de la démo, chemin déduit de la réponse riche (sources, registres, verdicts). Zéro modification du chemin chaud de l'API |
| 3 | Fourmillement | **Vrai trafic + décor distinct** : seuls les vrais événements parcourent le pipeline ; des PNJ décoratifs vaquent au village mais n'y courent jamais |
| 4 | Périmètre v1 | **Tout le monde** : quête validate détaillée, compliance, batch (via trafic réel), caravanes mensuelles — livré en jalons M1→M4 |
| 5 | Technique | **Canvas 2D artisanal** dans `frontend/`, aucune dépendance nouvelle |
| 6 | Charte graphique | **Forge 16-bit** : village-forge, pierre et braise, ambre du site (`--amber-500 #F59E0B`) sur tons chauds. **Contrainte forte : pas trop sombre — la lisibilité prime.** Sol regénéré en version « après-midi doré » |
| 7 | Héros | Le coursier **doré aux yeux lumineux** (planche Midjourney choisie). Les trois autres variantes deviennent coursiers-PNJ du trafic réel |
| 8 | Honnêteté | Ce qui est montré : de vraies requêtes, le vrai chemin de CETTE requête, ralenti ~10-12 s pour l'œil. Les micro-durées intermédiaires sont synthétiques (assumé et affiché) ; le `processing_ms` réel est montré à la fin |

## 3. La machine à clarifier

Trois mécanismes au-dessus du pixel art — c'est eux qui portent le but n°1 :

1. **Étiquettes réelles.** Le nom de chaque station est rendu par le moteur en
   typographie du site (jamais dessiné dans les sprites) : « Péage x402 »,
   « Scribe mod-97 », « Bibliothèque BIC », « Registre Bundesbank »…
2. **Barre de narration.** Boîte de dialogue façon RPG en bas du canvas,
   sous-titrant chaque étape en clair : « Le scribe vérifie la clé de
   contrôle… ✓ » → « Le coursier entre au registre Bundesbank :
   BLZ 55350010 → BIC MALADE51WOR ». C'est l'outil pédagogique principal et le
   fallback d'accessibilité (`aria-live="polite"`, texte DOM réel).
3. **Le projecteur.** Pendant une quête, le village s'atténue légèrement, le
   chemin du coursier reste pleinement éclairé : l'œil suit une seule histoire
   dans le fourmillement.

Chute finale : à la frappe de la réponse, le lingot affiche le
`processing_ms` **réel** — « 12 secondes à l'écran, X ms en vrai ». Le ralenti
devient un argument de perf.

## 4. La carte du village — stations ↔ code réel

Chemin principal en S, entrée à gauche. Chaque station est adossée à un module
réel ; cette table est le contrat d'honnêteté du monde.

| Station (à l'écran) | Étape réelle | Code |
|---|---|---|
| Porte-péage x402 | Paiement USDC ou clé API (`cost_usdc`, gratuit si `apiKeyAuthenticated`) | `middleware/x402.ts` |
| Poste du Scribe | Syntaxe, longueur pays, mod-97 | `lib/iban.ts` (`validateIBAN`) |
| Table du Découpeur | Parsing BBAN → code banque / guichet / compte | `lib/iban.ts` (`result.bban`) |
| Bibliothèque BIC | Lookup annuaire composite (GLEIF, SwiftCodes, SIX, EBA, Bundesbank, NBP) ; provenance `directory_prefix` / `curated_map` | `lib/bic-lookup.ts` |
| Ruelle des Registres (maisons à bannières) | Registres nationaux, provenance `national_register` : DE (Bundesbank/BLZ), AT (OeNB), BE (NBB), BG (BNB/BAE), NL, FI… Le coursier n'entre QUE dans la maison du pays de l'IBAN | `lib/de-blz.ts`, `lib/bg-bae.ts`, `lookupNationalCode`, `lib/nl-*`, `lib/fi-*` |
| Guichet SIX | Clearing suisse (CH/LI) : BC-Nummer, SIC, QR-IID | `lib/ch-clearing.ts` |
| Tribunal du Verdict | Verdict bank-code : `in_register` / `not_in_register` / `unavailable` (lookup en échec → `unavailable`, jamais un faux refus) | `checkBankCode` dans `lib/enrich.ts` |
| Atelier du Classificateur | Banque / EMI / néobanque | `lib/issuers.ts` |
| Poste-frontière | Zone SEPA, atteignabilité VoP | `lib/countries.ts` |
| Tour de guet (quête compliance) | Sanctions (BIC banque), GAFI, score de risque | `lib/compliance*.ts` |
| LA FORGE | Assemblage de la réponse, `reference_check` éventuel, `processing_ms` ; lingot scellé ✓ ou sceau brisé ✗, JSON réel affiché | `routes/iban-validate.ts` |
| Entrepôt + caravanes (bord de carte) | Rafraîchissement mensuel des données ; plaques « stock du MM/AAAA » au survol des maisons, tirées des vraies dates | `.github/workflows/refresh-bic.yml`, `as_of` / `getReferenceAsOf` |
| Place du village (PNJ décoratifs) | Rien — décor assumé, ne court jamais le pipeline | — |

Les échecs réels se voient : IBAN invalide → sceau brisé chez le Scribe et
sortie par la porte des erreurs, sans visiter la suite (fidèle au code :
`enrichResult` ne s'exécute pas sur un IBAN invalide).

## 5. Architecture

### 5.1 Frontend (`frontend/`)

- Page `app/[locale]/live/page.tsx` + composant client `VillageCanvas`.
- Moteur maison, zéro dépendance : tilemap JSON, spritesheet packée,
  `requestAnimationFrame`, tweens position/opacité, hit-testing pour le
  survol, `image-rendering: pixelated`, gestion du devicePixelRatio.
- **`journey-builder.ts` — le cœur.** Entrée : la réponse JSON du relais.
  Sortie : séquence d'étapes typées `[{station, outcome, details}]`, étalée
  sur 10-12 s par le planificateur. Pure et déterministe : rejouer la même
  réponse produit le même film. **Un test à fixtures verrouille la carte
  réponse→étapes** (voir §8) pour qu'une évolution du pipeline casse le test,
  pas l'honnêteté du monde.
- Saisie : champ IBAN (+ onglets compliance / BIC) → relais existant
  `POST /internal/playground` (plafonné côté API, types `iban` |
  `compliance` | `bic` déjà couverts). **Aucune nouvelle surface de paiement
  ni de clé exposée.**
- Survol d'un agent/station : carte-parchemin (asset choisi) avec rôle,
  explication courte, détail live (ex. la source du BIC réellement servie).
- i18n : next-intl, EN/FR/DE — étiquettes, narration, cartes de survol.
- Image OG dédiée (image-clé « après-midi doré » regénérée).

### 5.2 API (`src/`) — un seul ajout

- **`GET /v1/ops/recent`** (nouveau, gratuit) : les dernières opérations
  depuis `stats.sqlite` — `{ t, type, country, success }`, plafonné (~50),
  cache en mémoire ~5 s. **Jamais d'IBAN ni d'IP** (la table ne les connaît
  pas). Même niveau d'exposition que `/stats`, déjà public.
- Le frontend le polle toutes les ~5 s (suspendu onglet caché). Chaque vraie
  opération = un coursier-PNJ sur trajet simplifié selon son type ; un vrai
  batch = une escouade.
- Heures creuses : les PNJ décoratifs continuent de vaquer, mention discrète
  « trafic calme » — on ne simule jamais du trafic.

### 5.3 Batch en v1

Pas de champ de saisie batch public (le relais ne l'expose pas ; l'ouvrir
serait une surface d'abus). Le batch vit à l'écran par le vrai trafic
(escouades). Réévaluable en v2.

## 6. Assets

Source : planches Midjourney générées et choisies par Claude-Alain
(direction « Forge 16-bit »). Traitement : découpe, nettoyage des fonds,
harmonisation, packing en spritesheet(s) PNG sous `frontend/public/village/`
avec noms propres (`ground.png`, `houses.png`, `hero.png`, `fx.png`…).

Inventaire validé : village clé (référence d'ambiance + OG), sol pavé
(⏳ regénération claire), rangée de maisons à bannières, tour de guet +
poste-frontière + table à sceaux, accessoires (pièce ambre, lingot, sceaux
✓/✗, cadre parchemin, charrette), effets (étincelles, fumées, lucioles,
halos), 4 planches de coursiers (héros = doré aux yeux lumineux).

⏳ **À la main de Claude-Alain** : regénérer sur Midjourney (1) le sol version
« après-midi doré », (2) l'image-clé dorée pour l'OG (prompts fournis en
brainstorm), puis déposer les PNG retenus dans un dossier local **hors git**
(les planches brutes pèsent des Mo ; seules les spritesheets packées entrent
au dépôt). Budget : spritesheets ≤ ~200 Ko au total après packing.

Droits : générations Midjourney du compte de Claude-Alain (usage commercial
selon les conditions de son abonnement). Aucun asset de franchise existante ;
les prompts n'ont jamais nommé de jeu ou d'éditeur.

## 7. Honnêteté, perf, accessibilité, sécurité

- Un petit « ? » affiche la règle du jeu : « De vraies requêtes, le vrai
  chemin, ralenti pour l'œil. » Micro-durées synthétiques assumées ;
  `processing_ms` réel affiché à la forge.
- Perf : moteur ≤ ~30 Ko gzip, 60 fps visés, aucune animation ni poll quand
  l'onglet est caché. La page est une route isolée : zéro impact sur le reste
  du site.
- Accessibilité : narration en DOM (`aria-live`), page utilisable au clavier ;
  `prefers-reduced-motion` → mode « étapes » textuel sans animation.
- Sécurité : réutilisation du relais plafonné existant ; `ops/recent` en
  lecture seule sur des agrégats déjà publics ; aucune clé côté client.
- 🚨 Dépôt public : aucun IBAN réel dans les fixtures (utiliser ceux de
  `/v1/demo`), aucun chiffre d'activité réelle dans le code, les commentaires
  ou cette spec.

## 8. Tests

- **Verrou journey-builder** : fixtures de vraies réponses (DE avec registre,
  CH avec clearing, BG, AT/BE, IBAN invalide mod-97, code banque inconnu,
  réponse compliance) → séquence d'étapes attendue. Toute évolution du
  pipeline qui change la réponse casse ce test et force la mise à jour du
  monde.
- `ops/recent` : forme, plafond, cache, absence de champs sensibles.
- Composants : narration (contenu par étape), saisie (états d'erreur du
  relais : 400, plafond atteint).
- Visuel : contrôle manuel sur mobile + desktop, thème clair/sombre du site.

## 9. Jalons (tout est v1 ; chaque jalon se déploie et se filme)

| Jalon | Contenu | Critère « filmable » |
|---|---|---|
| **M1** | Monde + quête validate + saisie + narration + projecteur | Taper un IBAN → quête complète lisible, échec mod-97 montré, JSON final affiché |
| **M2** | `ops/recent` + coursiers-PNJ + escouades batch | Trafic réel visible en fond de démo |
| **M3** | Quête compliance (tour de guet) + guichet SIX (CH/LI) | Démo compliance et démo IBAN suisse |
| **M4** | Caravanes + plaques `as_of` + image OG + finitions i18n | Partage réseau avec belle carte OG, page EN/FR/DE |

## 10. Hors périmètre v1 (idées notées, non engagées)

Champ de saisie batch public · instrumentation SSE d'événements réels ·
son/chiptune (si un jour : coupé par défaut) · permalien de rejeu d'une
quête · easter egg « village de nuit » (réutiliserait les planches sombres) ·
caméra qui suit le coursier en zoom.

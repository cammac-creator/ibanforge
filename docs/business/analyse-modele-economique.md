# Analyse du modele economique IBANforge

**Source :** Analyse detaillee preparee le 2026-04-01
**Status :** Reference — document complet d'analyse

---

> Ce document est l'analyse brute qui a informe la roadmap economique.
> Voir `roadmap-economique.md` pour le plan d'action.

## Corrections appliquees par rapport a l'analyse originale

### 1. Infrastructure : Railway, pas Cloudflare Workers (pour le MVP)

L'analyse recommandait Cloudflare Workers pour le cout quasi nul. Mais notre stack (Hono + better-sqlite3) utilise des **bindings natifs C++** incompatibles avec les V8 isolates de Workers. La migration vers Workers + D1 est possible mais represente un chantier de rewrite significatif. 

**Decision :** Railway pour le MVP (~$5/mois), migration Workers en Phase 5 si le volume le justifie (>1M appels/mois).

### 2. Prix ajustes a la hausse

L'analyse place le sweet spot a $0.005/appel. Nos prix initiaux etaient trop bas :
- IBAN validate : $0.002 → **$0.005**
- BIC lookup : $0.001 → **$0.003**
- Batch : $0.015 → **$0.020**

### 3. Stripe credits = Phase 2, pas MVP

Le systeme de cles API + credits Stripe necessite : authentification, gestion de comptes, dashboard client, integration Stripe Checkout, logique de decompte. C'est un chantier de 2-3 semaines minimum. Le MVP lance avec x402 uniquement.

---

## Analyse originale complete

(contenu de reference conserve ci-dessous)

### Paysage concurrentiel

Le corridor de prix pour les APIs BIC/SWIFT se situe entre $0.005 et $0.01/appel.

- iban.com : €0.047-€0.265/appel (premium, licence SWIFT)
- FinCodesAPI : $0.0099-$0.039/appel
- IBANAPI : $0.023-$0.038/appel
- AbstractAPI : $0.00165/appel
- API KISS : $0.01/appel

### Economie x402 vs Stripe

x402 est structurellement superieur pour les micropaiements < $5 :
- $0.005/appel : x402 garde 60%, Stripe perd 5900%
- $0.01/appel : x402 garde 80%, Stripe perd 2900%
- $10 pack credits : Stripe garde 94% — viable

### Modele hybride optimal

75% revenus previsibles (Stripe credits) + 25% usage-based (x402).

Le tier gratuit (200 appels/mois) sert le SEO et le funnel de conversion (taux conversion freemium → payant : 3-7% pour APIs B2B).

### Segments cibles par priorite

1. Agents IA autonomes (via MCP/x402) — volume potentiel le plus eleve
2. Developpeurs fintech — faciles a atteindre, budget $50-500/mois
3. Integrateurs ERP — budget eleve, churn bas, mais cycle de vente long
4. Banques/institutions — viendront apres traction, pas avant $5K MRR

### Donnees GLEIF : avantages et limites

- Avantage : CC0 (domaine public), gratuit, mis a jour 3x/jour
- Limite : ~39K entrees BIC-LEI vs ~100K+ dans le registre SWIFT officiel
- Strategie : transparence sur la couverture, enrichissement progressif

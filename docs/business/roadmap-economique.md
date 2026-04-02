# IBANforge — Roadmap Economique

**Date:** 2026-04-01
**Status:** Draft v1
**Objectif:** De 0 a 100 clients payants en 12 mois

---

## Positionnement

**"Premiere API BIC/SWIFT + IBAN payable par agents IA via x402 et MCP."**

Le differenciateur n'est pas la donnee (GLEIF est public) mais l'accessibilite :
- Agents IA : decouvrent et paient automatiquement via x402/MCP
- Developpeurs : playground gratuit, docs claires, pas d'abonnement

## Pricing v1 (lancement)

| Endpoint | Methode | Prix x402 | Notes |
|----------|---------|-----------|-------|
| /v1/iban/validate | POST | $0.005 | Validation IBAN + BIC lookup |
| /v1/iban/batch | POST | $0.020 | Jusqu'a 100 IBANs |
| /v1/bic/:code | GET | $0.003 | Lookup BIC/SWIFT + LEI |
| /v1/demo | GET | Gratuit | Exemples, playground |
| /health, /stats | GET | Gratuit | Monitoring |

**Justification prix :** Le marche se situe entre $0.005 et $0.01/appel pour les APIs BIC/SWIFT specialisees. On se positionne dans le bas de cette fourchette pour favoriser l'adoption, avec une marge brute >90% (cout marginal quasi nul).

**Prix x402 vs futur Stripe :** Le prix x402 sera 20% superieur au prix Stripe equivalent (prime d'acces sans friction pour les agents IA).

## Modele economique cible (Phase 2)

| Tier | Modele | Prix | Rail | Cible |
|------|--------|------|------|-------|
| Gratuit | 200 appels/mois, cle API | $0 | Cle API | Evaluation, SEO |
| x402 Agent | Pay-per-call, sans compte | $0.006/appel | x402 USDC | Agents IA |
| Starter | Pack 5 000 credits | $25 ($0.005/appel) | Stripe | Devs, petites equipes |
| Pro | Pack 25 000 credits | $100 ($0.004/appel) | Stripe | Production, fintechs |
| Enterprise | Volume custom, SLA | Sur devis | Facture | Banques, ERP |

**Note :** Le tier gratuit + Stripe sont Phase 2. Le MVP lance avec x402 uniquement + playground gratuit.

## Structure de couts

| Poste | Cout mensuel | Notes |
|-------|-------------|-------|
| Railway (API) | $5 | Docker, auto-deploy |
| Vercel (frontend) | $0 | Hobby plan gratuit |
| Domaine ibanforge.com | ~$1 | ~$12/an |
| Donnees GLEIF | $0 | CC0, domaine public |
| x402 facilitator | $0 | 1000 tx/mois gratuit (Coinbase CDP) |
| **Total** | **~$6/mois** | |

**Marge brute estimee : >90%** a tout niveau de volume.

**Point d'attention juridique :** Les donnees BIC proviennent de GLEIF (CC0), pas du registre SWIFT propriétaire. Etre transparent sur la couverture (~39K entrees vs ~100K+ dans le registre officiel SWIFT).

## Phases de developpement

### Phase 1 — MVP (en cours, semaines 1-4)
- [x] API fonctionnelle (Hono + SQLite + x402)
- [x] 39K entrees BIC avec LEI enrichment
- [x] MCP server (3 outils)
- [x] Frontend ibanforge.com (landing, playground, docs, dashboard)
- [x] Deploy Railway + Vercel + DNS
- [x] Ajuster les prix a $0.005/$0.003/$0.020

### Phase 2 — Distribution (semaines 5-8)
- [ ] Publier comme MCP server sur Smithery + GitHub MCP Registry
- [ ] Lister sur RapidAPI (acces passif a 4M+ devs)
- [ ] Publier librairies client (Python, TypeScript) sur PyPI/npm
- [ ] Show HN + Product Hunt + IndieHackers launch
- [x] Premier article blog technique (SEO)

### Phase 3 — Monetisation elargie (mois 3-4)
- [ ] Systeme de cles API + tier gratuit (200 appels/mois)
- [ ] Credits prepaves Stripe (packs $25/$100)
- [ ] Dashboard client (stats d'usage par cle API)
- [ ] x402 Bazaar listing (discovery automatique)

### Phase 4 — Croissance (mois 5-8)
- [ ] Contenu SEO bi-mensuel (cibler "SWIFT code API", "BIC validation Python")
- [ ] Connecteurs Zapier/Make/n8n
- [ ] Endpoints adjacents (routing number US, IFSC Inde)
- [ ] Partenariats 3-5 SaaS comptabilite

### Phase 5 — Scale (mois 9-12)
- [ ] Migration Cloudflare Workers/D1 si volume > 1M appels/mois
- [ ] Cibler integrateurs ERP
- [ ] Enterprise tier avec SLA
- [ ] Deuxieme lancement PH sur la feature MCP/x402

## Projections de revenus (scenario base)

| Periode | MRR | Clients payants | Source principale |
|---------|-----|-----------------|-------------------|
| Mois 1-3 | $150 | 8 | Early adopters x402 |
| Mois 4-6 | $600 | 30 | HN/PH launch + MCP |
| Mois 7-9 | $1 500 | 50 | SEO + agents x402 reguliers |
| Mois 10-12 | $3 000 | 75 | Stripe credits + agent volume |
| Mois 13-18 | $5 000 | 120 | Integrations + expansion |
| Mois 19-24 | $8 000 | 200 | Enterprise + scale |

**Revenu cumule 24 mois (base) : ~$80 000**

## Metriques cles a suivre

- **MRR** (Monthly Recurring Revenue) — objectif : $3K a 12 mois
- **Nombre de clients payants** — objectif : 75 a 12 mois
- **Volume d'appels mensuel** — proxy de la valeur creee
- **Ratio x402/Stripe** — mesure l'adoption agents vs humains
- **Cout d'acquisition client (CAC)** — doit rester < $10 (organique)
- **Churn mensuel** — cible < 4%

## Risques identifies

| Risque | Impact | Mitigation |
|--------|--------|------------|
| Execution marketing insuffisante | Eleve | Respecter le 50/50 build/marketing |
| Adoption x402 plus lente que prevu | Moyen | Stripe credits en backup |
| Concurrent first-mover dans le niche | Moyen | Avantage vitesse, MCP/x402 natif |
| Donnees GLEIF insuffisantes vs SWIFT | Moyen | Transparence, enrichissement progressif |
| Changement pricing x402 facilitator | Faible | Marges >90%, absorbe les hausses |

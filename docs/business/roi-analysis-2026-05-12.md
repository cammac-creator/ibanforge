# IBANforge — Analyse ROI à 90 jours

**Date :** 2026-05-12
**Statut :** Synthèse de 4 recherches parallèles (prospects CH/UE, concurrents AML, canaux distribution, marché agents IA / x402)
**Auteur :** Synthèse Claude pour Alain Martin

---

## Verdict

Le meilleur ROI à 90 jours **n'est pas** x402, RapidAPI seul, ni un nouveau canal exotique. C'est **LinkedIn Sales Navigator + Stripe branché + 20 prospects nommés Suisses/UE** activés cette semaine. La recherche x402 confirme que le marché est prématuré (~$5-15K/jour de vrai volume mondial après filtrage wash trading, zéro agent finance en production payant pour de la validation IBAN). Le revenue 2026 se chasse en EUR via VoP/AP automation, pas en USDC sur Base. x402 reste un moat narratif pour 2027+.

---

## Top 7 actions classées par ROI à 90 jours

| # | Action | Effort | ROI | Quand |
|---|--------|--------|-----|-------|
| 1 | 5 warm intros via SwissBorg/Twitter (Rémond, Neves, Bilican, Kehrli, Aumasson) | 4h cette semaine | **Très élevé** — seul vrai chemin vers 1er client | Semaine 1 |
| 2 | Brancher Stripe Checkout (packs $25/$100) | Sprint 6-10h | **Très élevé** — débloque 99,9% des devs | Semaine 1-2 |
| 3 | LinkedIn Sales Nav + 50 messages/jour sur les 15 cold prospects | $99/mo + 60h sur 90j | **Élevé** — voie testée B2B fintech | Semaine 2+ |
| 4 | Pivot pitch AP automation : Spendesk/Pleo/Ramp EU/Qonto/Mooncard | 25h démos + outreach | **Élevé** — marché mature, drivers PSD3 | Semaine 3-6 |
| 5 | Listing RapidAPI Hub | 8h setup | **Moyen-élevé** — compense l'absence Stripe initiale | Semaine 2-3 |
| 6 | 3 articles SEO long-tail (Validate IBAN Python, VoP 2027, MCP finance) | 24h sur 6 sem | **Moyen** — payoff 6-12 mois, compose | Continu |
| 7 | Pitch B2B partnership vers ComplyAdvantage/Flagright/iPiD (marque blanche vIBAN+Swiss) | 15h + 3 calls | **Moyen-élevé si ça mord** | Semaine 4-8 |

---

## 20 prospects nommés (extraits de la recherche)

Triés par accessibilité — warm intros / leviers existants en haut, cold en bas.

| # | Nom | Rôle | Entreprise | Accessibilité |
|---|-----|------|------------|----------------|
| 1 | Nicolas Rémond | CTO | SwissBorg (Lausanne) | **Warm direct** — client long-time, DM Twitter ou support |
| 2 | Jay Neves | Payments Operations Team Lead | SwissBorg | **Warm via #1** |
| 3 | Adem Bilican | CTO & Co-founder | Relai (Zurich) | **Warm via Twitter actif** |
| 4 | Jérôme Kehrli | CTO | NetGuardians (Yverdon) | **Warm via blog/Twitter** |
| 5 | Jean-Philippe Aumasson | CSO & Co-founder | Taurus SA (Genève) | **Warm via Twitter (très actif)** |
| 6 | Thomas Hunziker | CTO & Co-founder | Wallee Group (Winterthur) | Cold mais réponsif (founder mode) |
| 7 | Lucie Poirier | Head of Payment Facilitator | Wallee Group | Cold mais réponsif |
| 8 | Thomas Suter | CTO & Co-founder | Apiax (Zurich) | Cold ciblé (partenariat) |
| 9 | Philip Schoch | CEO & Co-founder | Apiax | Cold ciblé |
| 10 | Markos (nom complet à valider) | CTO | AMINA Bank (Zug) | Cold mais réponsif |
| 11 | Vassili Lavrov | Head of Product Infrastructure | Taurus SA | Cold ciblé |
| 12 | Tom Sprenger | CTO | Bexio (Rapperswil) | Cold mais réponsif (ex-AdNovum) |
| 13 | Matthias Zürrer | CPO | Bexio | Cold mais réponsif |
| 14 | Alexander Vetter | CTO & Partner | Abacus Research (Wittenbach) | Cold mais réponsif |
| 15 | Julien May | Head of Software Engineering | SMG (Tutti/Anibis/Ricardo) | Cold mais réponsif (eng niveau) |
| 16 | Jörg Sandrock | Co-founder & CEO | Neon (Zurich) | Cold mais réponsif |
| 17 | Stefan Windisch | Global Head of In-House Bank | Roche Treasury (Basel) | Cold dur (mais case study public) |
| 18 | Oliver Heister | CTO | Datatrans / Planet (Zurich) | Cold dur (corporate gros) |
| 19 | Jan De Schepper | CEO | Yuh / Swissquote | Cold dur mais ROI clair |
| 20 | Florian Teuteberg | CEO & Founder | Digitec Galaxus (Zurich) | Cold dur |

---

## Concurrents AML/RegTech — opportunités B2B

Tous ces acteurs n'exposent **ni détection vIBAN/EMI, ni Swiss BC-Nummer/QR-IID, ni MCP natif**. C'est un vrai trou de marché.

### Top 3 cibles partnership B2B (IBANforge = fournisseur en marque blanche)

1. **ComplyAdvantage / Flagright / LSEG World-Check** — pas de validation IBAN native. Pitch : "issuer_type + vIBAN_flag" complément $0.005/call dans leur pipeline.
2. **NetGuardians / Vyntra** — pas de couche BC-Nummer/QR-IID. Pitch : feed enrichment Swiss-specific.
3. **iPiD** — réseau VoP global mais pas de classification émetteur. Pitch : "issuer classification layer" marque blanche pour AMLR.

### Top 3 cibles concurrentielles (prendre leurs clients)

1. **Sis ID** — enterprise-only sans pricing public, pas de MCP. Cible : fintechs FR self-serve.
2. **SurePay** — pricing mensuel + seuil 6000/an. Cible : trésoreries qui veulent "pre-VoP" à $0.005.
3. **Trustpair** — plateforme lourde. Cible : devs API-first qui veulent une brique atomique.

---

## Pourquoi x402 / agents IA finance n'est PAS le ROI 90j

**Chiffres mai 2026** (toutes sources web vérifiées) :

- Volume x402 organique réel après filtrage wash trading : **~$5-15K/jour TOUT écosystème confondu** (81% du brut est wash trading selon Artemis)
- x402 Bazaar : ~100 APIs listées, **170 paiements on-chain cumulés** (ratio 1.7/API = registry, pas marché)
- **Aucun agent finance autonome en production payant pour de la validation IBAN documenté** en mai 2026
- AWS AgentCore Payments : preview en avril 2026, zéro customer production cité
- Forrester "1/3 B2B agentique fin 2026" = prédiction, pas réalité

**Conclusion** : x402 reste un moat narratif pour 2027+. Garder le rail x402 listé sur AWS AgentCore Bazaar + Glama + Smithery (6h effort) pour capturer la discovery quand le marché bascule, mais ne pas en attendre du revenue 2026.

---

## Ranking des canaux de distribution (10 canaux étudiés)

| Rang | Canal | ROI 90j | Note |
|------|-------|---------|------|
| 1 | LinkedIn outreach ciblé (Sales Nav) | Très élevé | 2-5% cold→demo, 20-30% demo→paid (B2B benchmark) |
| 2 | RapidAPI Hub | Élevé | 4M devs, billing géré, 20% commission |
| 3 | Postman API Network | Moyen-élevé | 35M devs, collections publiques |
| 4 | Reddit (r/SwissFintech, r/ClaudeAI) | Moyen | Top referrer historique mais low-intent B2B |
| 5 | Newsletters sponsoring (<$2K) | Moyen | FBW Mikula, This Week in Fintech |
| 6 | Dev.to + SEO long-tail | Moyen | Payoff 6-12 mois, compose |
| 7 | ProductHunt relaunch | **À éviter maintenant** | Brûle la cartouche unique sans social proof |
| 8 | Hacker News | Faible-moyen | Déjà tenté, hit-or-miss |
| 9 | Smithery / MCP Registry / Glama | Faible (revenue) | Bon SEO/credibility, marché immature |
| 10 | Awesome-lists | Faible (vanity) | <500 vues/list/mois |

---

## 2 pièges critiques

1. **Ne PAS relancer ProductHunt** sans 5-10 clients payants + 50 stars GitHub. L'algo PH déclasse les produits sans traction initiale et tu ne peux pas relancer le même produit. Cible Q3 2026 minimum.

2. **Ne PAS miser sur x402 pour le revenue 2026.** Risque réel : 6-12 mois sans revenue mesurable pendant que SurePay/iPiD consolident le marché VoP par les canaux classiques. Garder x402 comme moat narratif et positioning, facturer en EUR.

---

## Plan d'action 90 jours (résumé)

### Semaine 1-2 (sprint immédiat)
- [ ] 5 warm intros activés (Rémond, Neves, Bilican, Kehrli, Aumasson)
- [ ] Sprint Stripe Checkout (packs $25 / $100)
- [ ] Setup LinkedIn Sales Nav, scrapping ciblé 200-400 prospects

### Semaine 3-6 (acquisition)
- [ ] 50 messages LinkedIn/jour sur les 15 cold prospects + AP automation EU
- [ ] Listing RapidAPI Hub (8h)
- [ ] Démos vers Spendesk / Pleo / Ramp EU / Qonto / Mooncard
- [ ] 1er article SEO publié (dev.to)

### Semaine 7-12 (partnership + content compound)
- [ ] Pitch B2B vers ComplyAdvantage / Flagright / iPiD (marque blanche)
- [ ] 2-3 articles SEO supplémentaires
- [ ] AWS AgentCore Bazaar listing (positioning x402 long terme)
- [ ] Premier case study client à publier (si signature)

### Cible 90 jours
- **1-3 clients payants signés** (au moins 1 via warm intro Suisse, 1 via LinkedIn cold)
- **Stripe en production** débloquant la conversion long-tail
- **1er case study publié** pour amorcer la social proof
- **MRR cible mois 3** : $150-500 (réaliste vs $150 du scenario base)

---

## Sources

Toutes les sources sont citées dans les recherches sources des 4 agents (12 mai 2026) :
- CoinDesk, Artemis Analytics (x402 volume réel)
- AWS, Glama, EBA, SurePay, iPiD (marché VoP)
- LinkedIn, Crunchbase, theorg, RocketReach (prospects)
- Postman, RapidAPI, Reddit, Ramp blog (canaux distribution)

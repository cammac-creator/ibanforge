# IBANforge — Audit des canaux de distribution

**Date :** 2026-05-22
**Méthode :** 2 recherches web réelles (écosystème agents IA / MCP / x402 ; canaux dev & fintech B2B), croisées avec l'état réel du projet (`SUBMISSIONS.md`, `.github/workflows/release-publish.yml`, PRs GitHub de `cammac-creator`).
**Périmètre :** où promouvoir IBANforge — plateformes, annuaires, communautés, contenu.

---

## Résumé exécutif

Trois constats orientent cet audit.

1. **IBANforge est déjà présent sur ~10 surfaces de découverte** (MCP Registry, Glama, Smithery, MCP.so, RapidAPI, DevHunt, npm, PyPI, 3 awesome-lists mergées). Le problème n'est pas l'absence de canaux — c'est la conversion : l'analyse de trafic du 21 mai a montré que ces canaux amènent surtout des crawlers, pas des clients.

2. **Le levier le plus immédiat est déjà à moitié fait.** Le repo contient un `SUBMISSIONS.md` avec le matériel prêt-à-coller pour PulseMCP, Cline et awesome-x402-servers — non soumis. Et 2 Pull Requests sur la plus grosse liste MCP (`punkpeye/awesome-mcp-servers`, 87 k★) traînent ouvertes depuis avril/mai. Finir ces actions = quelques heures, zéro recherche.

3. **Le vrai terrain neuf de 2026 n'est pas un canal de plus, c'est un changement de méthode :** la découverte d'API passe désormais par les *answer engines* (ChatGPT, Perplexity) et par le positionnement réglementaire (VoP/SEPA). C'est là qu'est l'investissement durable.

Honnêteté : plusieurs « gros » canaux (Stripe App Marketplace, AWS Marketplace, partenariats RVM) ont un impact théorique élevé mais un coût d'entrée disproportionné pour un solo founder qui mène plusieurs chantiers. Ils sont signalés, pas poussés en priorité.

---

## 1. ✅ Déjà en place

| Surface | Statut | Note |
|---|---|---|
| MCP Registry officiel | Publié (`io.github.cammac-creator/ibanforge`) | Le registre canonique du protocole. |
| Glama.ai | Listé, build OK | Annuaire MCP majeur (auto-rescan 24-48 h). |
| Smithery | Fiche existante (`smithery.ai/server/ibanforge`) | « Redeploy from npm » au prochain release. |
| MCP.so | Fiche existante (`mcp.so/server/ibanforge`) | « Refresh from GitHub » au prochain release. |
| RapidAPI | Fiche existante | Voir §4 — canal en déclin, fiche à laisser dormir. |
| DevHunt | Fiche existante | Annuaire de lancements dev. |
| npm | `ibanforge-mcp` + `@ibanforge/sdk` publiés | ~458 downloads/sem = bruit de fond (miroirs), pas des usagers. |
| PyPI | `ibanforge` publié | — |
| awesome-lists mergées | `moov-io/awesome-fintech`, `public-apis/public-apis`, `xpaysh/awesome-x402` | 3 PRs acceptées sur 9+ tentées. |
| Twitter/X | Thread posté (@Cammac) | Pas de traction mesurée. |
| dev.to | 1 article publié | < 25 vues. |
| Hacker News | Show HN tenté | Mort dans `/new` (10 uniques). À ne pas refaire — voir §4. |

**Lecture :** la couverture « annuaire » est déjà large. Inutile d'en empiler — l'enjeu est ailleurs (§2 et §3).

---

## 2. 🟡 Préparé ou en attente — le levier court terme n°1

Ce sont les actions à plus fort rapport effort/impact : le travail de préparation est **déjà fait**, il reste à appuyer sur le bouton.

### 2.1 — Soumissions préparées, jamais envoyées

`SUBMISSIONS.md` contient le matériel prêt-à-coller (nom, descriptions, tags, exemples) pour :

- **PulseMCP** — `pulsemcp.com/submit`. Annuaire MCP à curation manuelle quotidienne (~12 000 serveurs), affiche une estimation de trafic par serveur. Soumission via formulaire web. **Effort : 10 min.**
- **Cline MCP Marketplace** — `github.com/cline/mcp-marketplace`. Marketplace officiel de Cline (extension de codage IA très installée) ; serveur installable en un clic dans l'éditeur. Soumission par PR/issue GitHub. *Vérifié : aucune PR `cammac-creator` sur ce repo — non soumis.* **Effort : 15 min.**
- **awesome-x402-servers (`a6b8`)** — PR GitHub. *Vérifié : aucune PR `cammac-creator` sur ce repo — non soumis.* **Effort : 10 min.**

### 2.2 — Pull Requests ouvertes qui traînent

- **`punkpeye/awesome-mcp-servers`** (87 k★, la liste MCP de référence, catégorie « 💰 Finance & Fintech ») — **2 PRs IBANforge ouvertes** : #4458 (label `has-glama`, 2 mai) et #4912 (label `missing-glama`, 12 mai), plus #4053 fermée. Elles ne sont pas mergées. Action : consolider en **une seule** PR propre, et relancer le mainteneur. La catégorie Finance est peu peuplée — bonne place à prendre, mais il faut débloquer la PR.
- **`agno-agi/agno`** — PR #7769 « cookbook: add IBANforge MCP tools example » (label `stale`, `first-time-contributor`). Intéressant : faire entrer IBANforge dans le *cookbook* d'un framework d'agents IA répandu = exposition à des développeurs qui construisent des agents. À relancer.
- **4 awesome-lists secondaires** avec PRs ouvertes : `marcelscruz/public-apis`, `caracreative/awesome-open-banking`, `yudai-nkt/awesome-hono`, `7kfpun/awesome-fintech`. Faible valeur (voir §4) — relancer une fois, sans y réinvestir.

### 2.3 — Contenu prêt non publié

- **4 posts Reddit** rédigés (`docs/marketing/reddit.md`), jamais postés. Reddit reste actif (r/fintech) **et** est l'une des sources les plus citées par ChatGPT — double intérêt. Condition : poster en mode *entraide* (répondre à des questions, mentionner l'outil quand c'est pertinent), pas en mode annonce. Un Show HN-bis échouerait ; un commentaire utile bien voté, non.

### 2.4 — Bloqué / investigué

- **agentic.market (Coinbase)** — investigué le 30/04 : aucun formulaire public ; le catalogue se synchronise depuis le Bazaar Coinbase CDP. IBANforge n'apparaît ni dans l'un ni dans l'autre. Déblocage = augmenter le volume de transactions x402 réelles sur Base + démarche directe via le Discord CDP `#x402`. Dépend donc d'un usage réel, pas d'une soumission.

---

## 3. 🔵 Nouveau — à instruire

### 3.1 — Écosystème agents IA / MCP / x402

- **x402-list.com** (`x402-list.com/submit`) — annuaire « agent-first » des services x402, JSON machine-lisible, uptime live. Soumission directe ouverte. IBANforge n'y figure pas. **Effort : 10 min. Différenciateur : peu d'API sont x402-natives.**
- **x402scan** (`x402scan.com/resources/register`) — explorateur de l'écosystème x402 (Merit Systems). Découverte semi-automatique : soumettre l'URL ; si elle renvoie un schéma x402 valide, indexation auto. Soumettre explicitement plutôt qu'attendre. **Effort : 5 min.**
- **Discord officiel MCP** (~12 600 membres) — canal *showcase* pour une annonce ponctuelle. Pas un listing permanent ; ne pas spammer.
- **Annuaires MCP secondaires** — MCP Hunt (type Product Hunt du MCP, bon pour un pic ponctuel), MCP Market, MCP Server Finder. Faible effort, faible trafic propre — à faire seulement si la soumission prend < 5 min.
- **xpaysh/awesome-x402** — IBANforge y est déjà (PR #221 mergée, #296 de consolidation mergée, #353 de raffinement ouverte). Rien à ajouter sinon finaliser #353.

### 3.2 — Le changement de méthode : answer engines + réglementaire

- **GEO / Answer Engine Optimization** — *la* recommandation de fond. La découverte d'API se fait de plus en plus via ChatGPT (800 M+ utilisateurs/sem), Perplexity, Google AI Overviews ; le recouvrement entre top liens Google et sources citées par l'IA est tombé sous 20 %. Concrètement : (1) restructurer chaque page de doc/blog en *réponse directe* dès les premières phrases ; (2) créer des pages-questions (« Comment valider un IBAN suisse », « Qu'est-ce que VoP SEPA », « IBAN vs BIC vs clearing ») ; (3) dates de mise à jour fraîches et visibles ; (4) s'assurer que les crawlers IA accèdent au site. Zéro budget, 100 % à la portée d'un solo founder, effet durable.
- **Positionnement VoP / SEPA 2026** — fenêtre réglementaire rare : VoP obligatoire pour les PSP SEPA, rulebook effectif en cours d'année. Produire le contenu de référence « se préparer à VoP » sert **à la fois** le GEO et la captation de décideurs paiements en stress de conformité (avec budget et échéance). Un seul effort de contenu, deux résultats.
- **Postman API Network** (`postman.com/explore`) — listing gratuit, 0 % de commission, 40 M+ développeurs. Créer un workspace public avec une collection prête à l'emploi (validate, lookup BIC, risk score) : devient à la fois vitrine et terrain d'essai « Run in Postman » sans friction. **Quick win.**

### 3.3 — Communautés de décideurs (jeu long)

- **This Week in Fintech** — Slack 10 000+ membres fintech + newsletter 225 000+ décideurs. Participation organique gratuite sur les sujets paiements/compliance. Le sponsoring newsletter est hors budget — viser l'organique.
- **ACAMS** — la plus grande communauté anti-financial-crime (chapitres locaux, dont DACH). Le bon public pour le volet *scoring de risque / compliance* d'IBANforge (Head of AML). Meetups régionaux accessibles sans gros budget.
- **Finextra** — média/communauté fintech qui accepte des contributions de membres ; bon pour la crédibilité et la captation answer-engine.
- **daily.dev**, **podcasts fintech mid-size** (PayPod, Around the Coin… ciblés via Podseeker) — secondaires, à activer une fois le contenu de base en place.

### 3.4 — Note réalisme (solo founder)

Trois canaux ont un fort potentiel mais un coût d'entrée disproportionné pour un solo founder qui mène IBANforge en parallèle d'autres projets — **à garder en réserve, pas maintenant** :

- **Stripe App Marketplace** — distribution réelle et qualifiée, mais exige de développer et faire valider une vraie app Stripe.
- **AWS Marketplace** — vrai canal entreprise, mais onboarding compliance long ; à reporter jusqu'à ce qu'un client entreprise le réclame.
- **Partenariats RVM (VoP)** — devenir/partenariser avec un Routing & Verification Mechanism : fort levier B2B, mais cycle commercial long.

---

## 4. Ce qui ne vaut PAS le coup

- **RapidAPI** — marketplace en fort déclin depuis son rachat, commission ~25 %. IBANforge y a une fiche : la laisser dormir, ne rien y réinvestir.
- **Stack Overflow** — volume de questions effondré (~-78 % sur un an) ; les développeurs demandent désormais aux LLM. Aucune présence à y construire.
- **Discord « fintech »** — vérifié : ces serveurs sont quasi tous crypto/trading/DeFi, pas du B2B paiements/compliance. Zéro temps à y consacrer.
- **Re-tenter Hacker News en mode lancement** — le Show HN a déjà échoué ; un second essai promotionnel échouera pareil.
- **Soumettre encore des awesome-lists** — 9+ déjà tentées, 3 mergées, le reste traîne. ROI nul, les awesome-lists sont devenues du bruit. Ne pas en ajouter.

---

## 5. Top 5 — actions priorisées

| # | Action | Effort | Impact | Pourquoi |
|---|--------|--------|--------|----------|
| 1 | **Soumettre PulseMCP + Cline + awesome-x402-servers** (matériel déjà prêt dans `SUBMISSIONS.md`) | ~1 h | Moyen-élevé | Le meilleur rapport effort/impact : tout est rédigé, il reste à envoyer. Trois surfaces de découverte agents en plus, ce jour. |
| 2 | **GEO / Answer Engine Optimization** — restructurer doc + blog en réponses directes, créer des pages-questions | Moyen, continu | Très élevé | Remplace le SEO et Stack Overflow effondrés. La découverte d'API se fait via ChatGPT/Perplexity en 2026. Zéro budget, effet durable. |
| 3 | **Contenu d'autorité VoP / SEPA 2026** | Moyen | Élevé | Fenêtre réglementaire rare. Sert le GEO (#2) **et** capte des décideurs paiements avec budget et échéance. Un effort, deux résultats. |
| 4 | **Consolider et débloquer la PR `punkpeye/awesome-mcp-servers`** + soumettre x402-list.com & x402scan | ~1 h | Moyen | 87 k★, catégorie Finance peu peuplée ; les annuaires x402 verrouillent le positionnement « x402-natif », rare et différenciant. |
| 5 | **Présence organique This Week in Fintech (Slack) + ACAMS (chapitres)** | Faible-moyen, jeu long | Moyen-élevé | Les seuls endroits où sont réellement les décideurs (VP Payments, Head of AML). À démarrer maintenant car l'effet met des mois à porter. |

---

## Limites de cet audit

- Les notes d'impact sont des jugements raisonnés (adéquation d'audience, signaux d'activité 2026), pas des mesures de conversion — aucune source ne chiffre les leads réels d'un canal pour une API B2B de niche.
- **Canaux DACH / Suisse non explorés** — vu l'ancrage suisse d'IBANforge (clearing SIX, BC-Nummer), des canaux de la place financière helvétique (Swiss Fintech, SFTI, Swiss Payment Association) pourraient être pertinents : piste à creuser dans une passe dédiée.
- Statut « non soumis » de PulseMCP / Cline / awesome-x402-servers : confirmé pour Cline et awesome-x402-servers (aucune PR `cammac-creator`) ; PulseMCP est un formulaire web non traçable via GitHub — considéré non soumis sur la foi de `SUBMISSIONS.md` (cases non cochées).
- Les politiques de soumission exactes (délais, gratuité) des annuaires secondaires sont à confirmer sur place au moment de soumettre.

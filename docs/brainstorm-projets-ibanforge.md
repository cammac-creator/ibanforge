# Projets liés à IBANforge — transfert pour nouveau projet

> Extraction des 26 idées IBAN/paiements/agents/MCP parmi les 154 du brainstorm.
> Triées par proximité avec le cœur IBANforge (stack Hono/SQLite/x402/MCP + données BIC/IBAN/VoP).
> Généré le 2026-04-15 depuis `projet Jennifer/docs/brainstorm/favoris-approfondis/` + les 3 analyses avancées.

---

## 🎯 Tier 1 — Extensions **directes** d'IBANforge (même API, même données, même stack)

Ces projets réutilisent ≥70 % du code IBANforge, la base BIC 121k entrées (38k LEI-enrichies via GLEIF + SWIFT directory + Bundesbank + SIX + NBP), le middleware x402 et le serveur MCP. Timing parfait avec les deadlines VoP 2025/2027. Ce sont les candidats les plus naturels si tu veux capitaliser sur l'actif IBANforge.


### #1 · SEPAgate  🟢  💎
- **Catégorie** : Infrastructure agents IA
- **ARR 24m (brainstorm)** : 120k CHF · **Ambition** : 5/5 · **Effort** : 12/20
- **Fit Alain** : 80% stack réutilisable (Hono, x402, SQLite, MCP), trilingue FR/DE/IT parfait pour tuning name-matching zone euro. Pas besoin d'associé, extension naturelle du savoir IBANforge.
- **Problème** : Le règlement EU 2024/886 impose la Verification of Payee (VoP) à toutes les banques de la zone euro depuis le 9 octobre 2025, et hors euro depuis le 9 juillet 2027 — mais les agents IA qui initient des virements SEPA n'ont aucun oracle normalisé pour pré-valider nom↔IBAN↔BIC avant soumission. Les PSP facturent la VoP 0.02 à 0.10 EUR par requête et 
- **Monétisation** : 0.015 USDC/vérification VoP (3x le prix validate IBAN pur), tier flat 149 EUR/mois 15k vérifs pour corporates. Break-even ~1200 vérifs/jour soit ~18 USD/jour. Cible 24 mois : 60 corporates flat + 40 agents x402, ARR réaliste 140-180k CHF. Marge 82% après coût DB + Railway.
- **Solution** : API unique POST /vop qui retourne match/close-match/no-match + score, combinant sources publiques (registres commerce CH/DE/FR/IT, LEI GLEIF, BIC directory) et heuristiques fuzzy name-matching. Extension directe d'IBANforge : réutilise la base BIC 121k entrées (38k LEI-enrichies via GLEIF), la validation mod97, le middleware x402. Ajout d'un module 
- **Barrière** : Construire le graphe nom↔IBAN propre prend 6-9 mois (agrégation Zefix/Handelsregister/RNE + matching LEI + nettoyage doublons). Un concurrent doit répliquer la stack IBANforge + VoP + fuzzy multilingue FR/DE/IT/ES. Wise/Revolut ne vendront 
- **Risque** : Les banques/PSP pourraient pousser un standard VoP gratuit côté émetteur qui rendrait l'oracle tiers redondant d'ici 2027.


### #7 · ProofOfCompliance    
- **Catégorie** : Infrastructure agents IA
- **ARR 24m (brainstorm)** : 24k CHF · **Ambition** : 5/5 · **Effort** : 7/20
- **Fit Alain** : Stack x402/MCP OK, mais crédibilité régulateur = faible en solo. Nécessite partenariat cabinet compliance ou Big 4 pour adoption.
- **Problème** : Quand un agent IA effectue un virement automatisé soumis à due diligence (VoP, sanctions check, KYC), il n'existe aucun standard pour prouver ex-post que les vérifications ont bien été faites à ce moment-là. Les audit trails traditionnels (logs internes) sont falsifiables et non-interopérables. PSD3 et AMLR vont imposer traçabilité renforcée 2027-2
- **Monétisation** : 0.001 USDC par reçu signé + abonnement 29-99 USD/mois accès portail audit. Cible 24 mois : 40 opérateurs d'agents B2B réglementés, ARR 60-100k CHF. Marge >90% après coût gas Base (quelques USD/jour).
- **Solution** : Middleware qui signe chaque action régulée (VoP, IBAN check, sanctions ping, norme consultée) avec clé ed25519 de l'agent, ancre hash Merkle quotidien sur Base (coût dérisoire), expose endpoint /proof/:hash pour vérification tierce. SDK drop-in 3 lignes de code.
- **Barrière** : Technique faible (n'importe qui peut signer + ancrer). Barrière = devenir la référence standard auprès d'auditeurs/régulateurs. 12-18 mois de travail d'évangélisation avec Big 4 et ACPR/FINMA.
- **Risque** : Standard concurrent émerge côté Linux Foundation/x402 gratuit et rend le projet obsolète. Timing trop précoce (demande 2027-2028).


### #13 · SanctionsPing    
- **Catégorie** : Infrastructure agents IA
- **ARR 24m (brainstorm)** : 72k CHF · **Ambition** : 5/5 · **Effort** : 12/20
- **Fit Alain** : Stack maîtrisée, trilingue utile pour fuzzy FR/DE/IT, zéro conflit UIKER. Projet très aligné avec IBANforge.
- **Problème** : Un agent IA qui initie un paiement B2B doit vérifier OFAC SDN, EU CFSP, SECO, UK HMT, ONU — 5 listes, formats différents (XML, CSV, PDF), mises à jour quotidiennes. Aucune API agent-first unifiée avec fuzzy matching multilingue. Sanctions.io et ComplyAdvantage facturent 1000-5000 USD/mois en entreprise.
- **Monétisation** : 0.01 USDC/check, abo 49 EUR/mois 10k checks pour PME, 499 EUR/mois 500k pour fintechs. Cible 24 mois : 40 clients flat + agents, ARR 100-180k CHF. Break-even 600 checks/jour.
- **Solution** : API GET /sanctions/check?name=...&country=... retourne match/close/no avec fuzzy matching (Levenshtein + phonétique + transliteration Cyrillic/Arabic). Consolidation 5 listes publiques quotidienne. x402 natif + Stripe fallback.
- **Barrière** : Pipeline de consolidation + fuzzy multilingue = 2-3 mois de travail propre. Concurrents B2B classiques (Refinitiv, Dow Jones) à 10-50k USD/an ne viseront jamais le segment agent/PME.
- **Risque** : Faux positifs/négatifs fuzzy = risque réputationnel énorme si client rate une sanction. Nécessite disclaimer juridique solide + assurance E&O.


### #14 · AgentBill    
- **Catégorie** : Infrastructure agents IA
- **ARR 24m (brainstorm)** : 38k CHF · **Ambition** : 4/5 · **Effort** : 18/20
- **Fit Alain** : Trilingue DE/FR pour TVA CH+DE, stack x402 maîtrisée, adjacent à QRBillGen (idée 26) — pourrait se bundler. Pas de conflit UIKER.
- **Problème** : Un agent IA qui paie 500 micro-factures x402 par jour (0.001-0.05 USDC chacune) génère un cauchemar comptable : aucune facture PDF consolidée, pas de TVA ventilée, pas d'archivage conforme LA/GeBüV CH 10 ans ou AO DE. Les entreprises qui déploient des agents ne peuvent pas comptabiliser leurs dépenses IA propres.
- **Monétisation** : 9 CHF/mois par agent + 0.3% sur volume x402 intercepté. Cible 24 mois : 200 agents de 50 corporates, ARR 60-100k CHF. Volume augmente mécaniquement avec adoption x402 2027-2028.
- **Solution** : Middleware wallet qui intercepte tous les paiements x402 sortants d'un agent, les groupe par fournisseur/mois, génère facture PDF consolidée conforme TVA CH (avec QR-bill) et DE (XRechnung), archive chiffré 10 ans (S3 Glacier ou équivalent CH).
- **Barrière** : Intégrer TVA CH + DE + QR-bill + archivage conforme = 3-4 mois de travail spécialisé. Crédibilité compta locale requise (partenariat fiduciaire CH utile).
- **Risque** : Adoption x402 réelle reste faible (28k USD/jour dont moitié artificielle en avril 2026). Volume insuffisant avant 2028. Trop en avance.


### #15 · TrustRegistry.ai    
- **Catégorie** : Infrastructure agents IA
- **ARR 24m (brainstorm)** : 28k CHF · **Ambition** : 4/5 · **Effort** : 15/20
- **Fit Alain** : Stack OK, mais neutralité fragile si Alain opère aussi IBANforge/SEPAgate dans le même registry. Conflit d'intérêt structurel.
- **Problème** : Avec l'explosion attendue x402/MCP, comment un agent sait-il qu'une API tierce est fiable, respecte son prix, répond correctement ? Aucun scoring public signé. Risque de fraude (paiement reçu, réponse dégradée). Problème réel à partir de 2027-2028 quand volume décolle.
- **Monétisation** : Freemium — score public gratuit, API batch pour agents 0.001 USDC/query, listing "certifié audit" 199 CHF/mois pour fournisseurs API. Cible 24 mois : 30 fournisseurs certifiés, ARR 40-70k CHF.
- **Solution** : Registry public merkle-tree signé des APIs x402 vérifiées avec score uptime + ratio paiement/réponse-valide + latence médiane mesurés par sondes indépendantes. Endpoint /trust/:api_id retourne score signé vérifiable on-chain.
- **Barrière** : Infra sondes multi-région + crédibilité neutre = 6 mois. Barrière principale = neutralité perçue (pas juge et partie).
- **Risque** : Standard émerge côté Linux Foundation/x402 gratuit (très probable après avril 2026), projet obsolète. Trop en amont du marché.


### #26 · QRBillGen    
- **Catégorie** : Micro-SaaS
- **ARR 24m (brainstorm)** : 48k CHF · **Ambition** : 5/5 · **Effort** : 8/20
- **Fit Alain** : Trilingue CH, stack maîtrisée, synergie IBANforge/AgentBill évidente. Pas de conflit UIKER.
- **Problème** : Le QR-bill est obligatoire en CH depuis 2022 mais générer un QR-bill valide programmatiquement nécessite stack ISO 20022 + SwissQRCode + PDF compliance. Librairies existantes (swissqrbill) sont OK mais nécessitent dev custom pour chaque use case. API hosted manque.
- **Monétisation** : 0.02 CHF/génération, 29 CHF/mois 5k gens, 99 CHF/mois 50k pour fiduciaires. Cible 24 mois : 80 clients + agents, ARR 40-80k CHF. Synergie bundling avec AgentBill (14) et PDFInvoiceExtract (17).
- **Solution** : API POST /qrbill → retourne PDF/PNG/SVG validé SIX officiel, 1 endpoint simple, docs 1 page. Validation IBAN via IBANforge intégrée.
- **Barrière** : Faible (librairies open source existent). Barrière = DX et marketing CH local trilingue.
- **Risque** : Bexio/SIX publient API officielle gratuite. Marché limité à CH (~8M habitants).


### #154 · IBANforge-PSP-Subcontract-Swiss    
- **Catégorie** : Infrastructure agents IA
- **ARR 24m (brainstorm)** : 200k CHF · **Ambition** : 4/5 · **Effort** : 60/20
- **Fit Alain** : Extension 100% IBANforge. Trilingue pour négocier PSP cantonaux. Tech 100% maîtrisée. Associé non requis techniquement, partenaire commercial PSP obligatoire (pas equity).
- **Problème** : Les 4 banques cantonales + 2 Raiffeisen/PostFinance CH doivent implémenter la VoP Verification of Payee obligatoire 9 juillet 2027 (règlement EU 2024/886). Chacune devra investir 500K-2M pour développer en interne ou contracter SurePay/iPiD à 200-500K/an. Segment "petite" PSP CH non-adressable pour SurePay (cycle enterprise long, ticket min 100K/an
- **Monétisation** : 3000-8000 CHF/mois/PSP client sous-traitant (cible 3 PSP signés à 24m = 180K ARR) + 0.01 CHF/call VoP facturé au PSP + setup fee 20000 CHF one-shot. Très petite base clients possible mais ARPU très élevé. ARR 24m : 150-250K. Exit potentiel : vente à SurePay/iPiD à 5-8x ARR.
- **Solution** : Offre "VoP-as-a-Service" white-label pour PSP CH sur IBANforge avec signature EPC Scheme participant via partenariat Sygnum/Customer I/Neon (PSP licencié CH membre scheme). Alain fait 100% de la tech (API + infrastructure), le PSP partenaire assume la conformité EPC. Revenue split 60/40 Alain/PSP. Target marché : 5-10 banq
- **Barrière** : Partenariat avec PSP CH membre EPC Scheme = 6-12 mois négociation + crédibilité technique (IBANforge prouve). Connaissance réglementaire VoP + compliance CH = 6 mois. Un concurrent solo partirait de zéro.
- **Risque** : SurePay lance offre "small PSP CH" à prix agressif = concurrence frontale. Mitigation : vitesse + prix 5-10x plus compétitif + trilingue + data sovereignty CH argument.


---

## 🔗 Tier 2 — Extensions **adjacentes** (même stack agents/x402/MCP, domaine fintech-voisin)

Réutilisent la stack mais visent un problème adjacent (KYB, sanctions, marketplace MCP, oracles on-chain). Synergie forte mais moins mécanique que le Tier 1.


### #2 · AgentGate.ch  🟡  💎
- **Catégorie** : Infrastructure agents IA
- **ARR 24m (brainstorm)** : 36k CHF · **Ambition** : 3/5 · **Effort** : 45/20
- **Fit Alain** : Trilingue CH, crédibilité locale pour négocier Moneyhouse/partenaires. Stack maîtrisée à 100%. Aucun conflit UIKER (pas de roulements).
- **Problème** : Les agents IA suisses qui ont besoin de données entreprise officielles frappent un mur : Moneyhouse facture 1000 CHF/mois amont non-agent-friendly, Terravis est fermé aux non-notaires, Zefix a des CGU anti-revente, OFS/OIBT n'ont pas d'API moderne. Résultat : aucun agent autonome ne peut faire de due diligence CH propre sans développeur humain dans
- **Monétisation** : 0.02-0.08 USDC/appel selon profondeur, pack revendeur Moneyhouse négocié 3000 CHF/mois fixe → marge sur volume. Cible 24 mois : 30 fintechs/KYC CH + 100 agents indie, ARR 90-150k CHF. Break-even ~500 appels/jour.
- **Solution** : Passerelle x402 qui expose 5-8 endpoints normalisés (company_lookup, directors, bankruptcy, sanctions, permits OIBT, statistiques OFS/NOGA) en agrégeant sources publiques licites + revendant Moneyhouse en gros via contrat B2B négocié. Un seul appel agent → JSON consolidé. Fallback Stripe fiat pour les clients non-crypt
- **Barrière** : Négocier un contrat revente Moneyhouse prend 3-6 mois de discussions légales, et seul un solo founder CH trilingue avec crédibilité technique peut l'obtenir à tarif raisonnable. Les CGU Zefix imposent un montage prudent (cache interne, pas 
- **Risque** : Moneyhouse refuse la revente API et attaque les CGU Zefix — projet mort si les deux verrous lâchent en même temps.


### #6 · IdentityPing    
- **Catégorie** : Données niche
- **ARR 24m (brainstorm)** : 90k CHF · **Ambition** : 5/5 · **Effort** : 20/20
- **Fit Alain** : Trilingue, stack 100% maîtrisée, recoupe AgentGate.ch (peut être vendu comme module premium de celui-ci plutôt que projet séparé).
- **Problème** : Un agent IA qui doit vérifier une entreprise CH avant paiement/contrat appelle aujourd'hui 5-7 APIs séparément (Zefix pour existence, SHAB pour faillites, SECO pour sanctions, GLEIF pour LEI, Moneyhouse pour dirigeants), chacune avec auth différente, format hétérogène, latence cumulée 3-8s. Aucune vue consolidée agent-first.
- **Monétisation** : 0.015 USDC/rapport léger, 0.05 USDC/rapport full. Abo 99 CHF/mois 5k rapports pour fintechs/KYC. Cible 24 mois : 25 clients flat + 80 agents indie, ARR 110-160k CHF. Break-even 1500 rapports/jour.
- **Solution** : Endpoint unique GET /entity/:uid?scope=full retourne JSON consolidé : existence + statut + dirigeants + ayants-droit + faillites + sanctions + LEI + flags risque en 1 appel sub-1s. Interface x402 native + fallback REST+Stripe. Mise à jour quotidienne background.
- **Barrière** : Semblable à AgentGate.ch — la valeur est dans la normalisation + contrats sources. 4-6 mois de travail pour cloner. Différenciation par qualité matching et couverture.
- **Risque** : Redondance avec AgentGate.ch — à fusionner probablement en un seul produit plutôt que deux SKUs parallèles.


### #8 · AgentDirectory.ch    
- **Catégorie** : Marketplace
- **ARR 24m (brainstorm)** : 50k CHF · **Ambition** : 4/5 · **Effort** : 21/20
- **Fit Alain** : Stack OK, mais concurrence frontale Anthropic = David vs Goliath. Modèle business fragile.
- **Problème** : Le MCP Registry Anthropic officiel est généraliste et mondial. Les développeurs européens/CH qui veulent trouver un MCP spécialisé (VoP SEPA, Zefix, normes CH) filtré par juridiction, prix x402, uptime mesuré, n'ont pas d'outil dédié. Découvrabilité des MCP B2B européens = médiocre.
- **Monétisation** : Freemium — listing gratuit, premium 49 CHF/mois, sponso top catégorie 199 CHF/mois, affiliation Claude/Cursor/Windsurf. Cible 24 mois : 500 listings, 30 premium, 10 sponso, ARR 50-80k CHF optimiste.
- **Solution** : Registre curé de MCP servers spécialisés B2B/EU avec ping uptime horaire, index capabilities normalisées, filtres par prix x402/juridiction/langue, pages SEO par catégorie. Listing gratuit, premium 49 CHF/mois pour badge "vérifié" + analytics.
- **Barrière** : Faible techniquement. Barrière = effet réseau (devenir le hub de référence EU avant qu'Anthropic n'ajoute filtres géographiques au MCP Registry officiel). Fenêtre 12-18 mois max.
- **Risque** : Anthropic publie filtres EU/juridiction sur MCP Registry officiel en 2026-2027 et tue le projet du jour au lendemain.


### #17 · PDFInvoiceExtract.ch    
- **Catégorie** : Données niche
- **ARR 24m (brainstorm)** : 58k CHF · **Ambition** : 4/5 · **Effort** : 25/20
- **Fit Alain** : Trilingue FR/DE/IT indispensable pour factures CH. Réutilise IBANforge pour IBAN validation et éventuellement QRBillGen inverse. Pas de conflit UIKER.
- **Problème** : Les PME CH reçoivent 80% de leurs factures fournisseurs en PDF (pas QR-bill scannable direct), la saisie comptable manuelle coûte 30-90 sec/facture. Les OCR généralistes (Google, Azure) ratent le contexte CH : IBAN à valider, TVA à ventiler en 3 taux (8.1% / 2.6% / 3.8%), QR-bill à décoder, adresse fournisseur.
- **Monétisation** : 0.10 CHF/extraction, 29 CHF/mois 500 extractions, 99 CHF/mois 5k pour fiduciaires. Cible 24 mois : 40 fiduciaires + 15 logiciels compta intégrés, ARR 90-150k CHF. Break-even 60 abonnements.
- **Solution** : Endpoint /extract qui prend PDF facture CH et retourne JSON structuré complet : fournisseur, IBAN validé via IBANforge, TVA ventilée par taux, montant QR-bill décodé, échéance, numéro référence. Claude Sonnet + règles post-traitement CH.
- **Barrière** : Tuning post-traitement CH (TVA, QR, IBAN) = 2 mois propres + synergie IBANforge. Concurrents généralistes (Rossum, Mindee) ne tuneront pas pour CH spécifiquement.
- **Risque** : Bexio/Abacus/Klara intègrent en natif et ferment le marché — fenêtre 18-24 mois max.


### #30 · WebhookRelay.eu    
- **Catégorie** : Infra passive
- **ARR 24m (brainstorm)** : 40k CHF · **Ambition** : 5/5 · **Effort** : 8/20
- **Fit Alain** : Stack Hono/TypeScript OK. Pas de conflit UIKER. Synergie potentielle avec x402 (webhook paiement).
- **Problème** : Hookdeck, Svix, Zapier webhooks sont US ou chers (Svix 500+ USD/mois enterprise). Besoin EU-hosted, simple, transform JMESPath built-in, RGPD-first. Marché webhook relay en croissance avec explosion APIs/agents.
- **Monétisation** : Free 1k/mois, 19 EUR/mois 100k, 99 EUR/mois 1M, 499 EUR/mois illimité. Cible 24 mois : 150 payants, ARR 80-140k CHF.
- **Solution** : Service 1 webhook in → N endpoints out avec retry exponentiel + transform JMESPath + filtrage. Hébergé EU (Infomaniak ou OVH). API + UI.
- **Barrière** : Technique moyenne (retry distribué + transform engine = 2-3 mois). Concurrence Hookdeck/Svix bien installée.
- **Risque** : Hookdeck/Svix ajoutent région EU + tarif agressif. Marché commoditisé. Différenciation difficile sans niche claire.


### #37 · AgentOntology    
- **Catégorie** : Licensing / IP
- **ARR 24m (brainstorm)** : 55k CHF · **Ambition** : 4/5 · **Effort** : 30/20
- **Fit Alain** : MCP déjà maîtrisé, positionnement thought-leader possible via IBANforge. Solo faisable mais associé académique (chercheur semantic web) renforce crédibilité (10-15% equity).
- **Problème** : Les agents IA consommant des API (MCP, function calling) hallucinent sur les concepts métier ambigus (Incoterms 2020 vs 2010, KYC tier 1-3, payment types SEPA Inst vs SCT) faute d'ontologie partagée. Chaque équipe réinvente un vocabulaire, créant incompatibilités entre agents. Le W3C et schema.org ne couvrent pas ces verticales fintech/logistique.
- **Monétisation** : Dual licensing AGPL (open source pour adoption) + commerciale 999 CHF/an par organisation (cible 150 orgs à 24m = 150K ARR) + consulting intégration 150 CHF/h (cible 400h/an = 60K) + sponsoring concepts prioritaires par fintechs 5K/concept. ARR 24m : 250-300K. Marge 88%.
- **Solution** : Ontologie JSON-LD versionnée sémantiquement (Incoterms, KYC levels, payment types, trade finance, identity providers, compliance frameworks) + MCP tool `resolve_concept(term, context)` retournant définition canonique + synonymes + relations. Versioning strict (v1.2.3), changelog, tests de régression.
- **Barrière** : Légitimité académique + industrielle (besoin citations + adoptions par 3-5 acteurs tier 1 type Stripe, Wise, Ripple). Temps de construction 18-24 mois de curation + revue par experts domaine.
- **Risque** : Anthropic/OpenAI publient leur propre ontologie standard → adoption captée par le vendor lock-in des modèles dominants, projet marginalisé.


### #38 · HonoPluginsPro    
- **Catégorie** : Licensing / IP
- **ARR 24m (brainstorm)** : 48k CHF · **Ambition** : 4/5 · **Effort** : 25/20
- **Fit Alain** : Stack Hono déjà maîtrisée via IBANforge, profil développeur autonome. Solo parfait, pas d'associé nécessaire.
- **Problème** : Hono grandit vite (500K+ downloads/semaine) mais l'écosystème middlewares commercial est désert — les équipes enterprise réimplémentent rate-limit distribué Redis, audit log SOC2, multi-tenant, RBAC, circuit breaker à chaque projet. Express/Fastify ont cet écosystème payant, Hono pas encore. Fenêtre 12-18 mois avant commoditisation.
- **Monétisation** : Tiers 99 CHF/an (Solo, 1 middleware), 499 CHF/an (Team, 4 middlewares), 1999 CHF/an (Enterprise, tous + support priorité 48h). Cible 300 licences à 24m = 180K + 40 Enterprise = 80K = 260K ARR. Consulting intégration 180 CHF/h = 40K. Marge 87%.
- **Solution** : Collection 8 middlewares premium battle-tested (rate-limit Redis/Upstash, audit log append-only, multi-tenant avec isolation DB, RBAC attribute-based, circuit breaker, distributed tracing OTel, feature flags, webhook retry) packagés sur npm privé avec SLA, docs exhaustives, tests 95%+ coverage.
- **Barrière** : Qualité code + tests + docs de niveau enterprise demande 9-12 mois effort concentré. Réputation open-source dans communauté Hono (contributions core, blog posts techniques) prérequis sur 6-12 mois.
- **Risque** : Honô-JS core team intègre ces middlewares en standard (cf. Fastify) ou un VC-backed (Hono Inc. hypothétique) débarque avec marketing 10x → produit écrasé en 6 mois.


### #40 · StableOracle    
- **Catégorie** : Créatif
- **ARR 24m (brainstorm)** : 35k CHF · **Ambition** : 4/5 · **Effort** : 20/20
- **Fit Alain** : x402 et crypto déjà connus, Hono OK, faible capex. Solo possible mais associé blockchain dev (smart contracts Solidity) utile si on veut aller au-delà du feed (20% equity).
- **Problème** : Les smart contracts Base L2 consommant des données CH officielles (inflation CH OFS, SARON SNB, résultats votations fédérales, MeteoSwiss) n'ont pas de feed signé cryptographiquement ; Chainlink ne couvre que les assets liquides US/EU. Les DeFi produits à destination CH (stablecoin CHF, prediction markets) n'existent pas faute d'oracle fiable.
- **Monétisation** : 0.05 USDC/update consommée on-chain (cible 200K updates/an à 24m = 10K USDC ≈ 9K CHF) + abonnement feed premium 199 CHF/mois (cible 30 clients DeFi = 72K) + licensing B2B web2 traditional 999 CHF/an (cible 25 clients = 25K). ARR 24m : 100-130K. Marge 80%.
- **Solution** : Oracle-as-a-service avec feeds signés ed25519 poussés on-chain Base L2 à fréquence variable (SARON quotidien, inflation mensuel, votations ad-hoc, météo horaire). Vérification multi-source (3 APIs croisées + attestation humaine pour votations). Tool MCP `get_feed(name, timestamp)` pour agents.
- **Barrière** : Infrastructure multi-source + signature cryptographique fiabilisée + uptime 99.95% sur 6-12 mois avant confiance DeFi. Adoption par 2-3 protocoles CHF-denominated prérequise.
- **Risque** : Le marché DeFi CHF reste embryonnaire (SNB hostile aux stablecoins privés) ; volume on-chain insuffisant pendant 3-5 ans → revenus plats.


---

## 🏛️ Tier 3 — Fintech/banking mais **domaine éloigné** (à mentionner pour complétude)

Touchent les paiements, la finance ou le B2B industriel CH/DACH mais ne s'appuient pas directement sur IBANforge. À écarter pour un focus pur IBANforge — à garder en veille si pivot plus large vers "fintech agents IA DACH".


### #69 · PrivateMembers-DACH-Founders    
- **Catégorie** : Services premium
- **ARR 24m (brainstorm)** : 900k CHF · **Ambition** : 3/5 · **Effort** : 90/20
- **Fit Alain** : Sa position de solo founder CH réussi (IBANforge) = légitimité directe. Trilingue = club réellement DACH (pas juste DE ou FR). Extraversion commerciale aide. Associé non requis, board d'advisors parmi premiers membres.
- **Problème** : Founders CH/DACH avec PME 1-10M CHF CA sont trop senior pour meetups startups/incubateurs (ceux-ci visent pre-seed), trop junior pour YPO (seuil 2M USD CA perso, 50K USD/an cotisation), trop isolés géographiquement. Besoin pairs niveau équivalent pour sparring, deals, recrutement, échanges fournisseurs.
- **Monétisation** : 6000 CHF/an/membre × 150 membres = 900K ARR an 3. Événements : coûts 200K/an (lieux, catering, speakers), directory/tech 50K. Marge nette 600K+. Leviers : tier premium 15K (masterminds 12 pers), partenariats sponsors premium (banques privées, M&A boutiques) = 200-400K additionnel
- **Solution** : Club physique + digital : 4 événements/an (retraites 2-3j lieux premium CH/AT), WhatsApp/Slack privé curaté, directory membres avec compétences/besoins, "deal flow" privé (levées/acquisitions entre membres). Sélection stricte : CA 1-10M + 3 ans activité + parrainage 2 membres.
- **Barrière** : Qualité membership initiale = prophétie auto-réalisatrice (premiers 30 membres décident tout), 2-3 ans réputation, network effect = inattaquable après 100+ membres fidèles.
- **Risque** : Cold start problem brutal : sans 30 membres de qualité recrutés rapidement (12-18 mois), club meurt en incubation ; réputation d'un membre toxique contamine tout.


### #83 · CryptoCustody-CH-SME    
- **Catégorie** : Fintech
- **ARR 24m (brainstorm)** : 3000k CHF · **Ambition** : 3/5 · **Effort** : 365/20
- **Fit Alain** : Stack x402/fintech aligné. Trilingue. MAIS capital massif requis (Alain budget limité explicitement incompatible), compliance/banking team indispensable = co-founders multiples. Non fit seul.
- **Problème** : PME CH (e-commerce, SaaS, export) reçoivent paiements crypto clients internationaux (USDC, BTC, ETH) mais : banques trad refusent 80% flux crypto, convertir via Bitstamp = 1-2 jours + 0.5-1% frais, comptabilité LFAB impossible sans outil dédié. Marché potentiel 1-3Mds CHF/an flux crypto B2B CH.
- **Monétisation** : 1% fee transaction × 300M CHF flux/an an 3 = 3M. Revenus additionnels : spread FX 0.2% = 600K, abonnement reporting 500 CHF/mois × 500 PME = 3M. Total ambitieux 6M+ ARR. Break-even mois 24-30 après licence.
- **Solution** : Plateforme custody régulée FINMA (PSP ou via partenaire licencié Sygnum/SEBA), onboarding KYC PME <24h, conversion instantanée CHF, reporting comptable LFAB + TVA automatique, facturation crypto en un clic clients.
- **Barrière** : Licence FINMA PSP = 18-36 mois + 500K-1M CHF compliance + capital réglementaire 1-5M, équipe compliance/AML 3-5 ETPs = 800K/an salaires, tech custody sécurité (cold storage, multi-sig, audits) = 1M+ build.
- **Risque** : FINMA durcit (approche Bitfinex/Binance) = impossibilité obtenir licence ; crash crypto majeur = flux s'évaporent.


### #92 · EstateAutomation-CH    
- **Catégorie** : Régulation
- **ARR 24m (brainstorm)** : 2800k CHF · **Ambition** : 4/5 · **Effort** : 90/20
- **Fit Alain** : Stack SaaS aligné. Trilingue parfait (26 cantons). B2B ciblé. Associé notaire CH ou ex-notaire indispensable pour crédibilité + accès chambres cantonales. Modèle proche fintech compliance = cohérent avec IBANforge.
- **Problème** : CH = 70K successions ouvertes/an, gérées par 1500 notaires + 500 trustees/exécuteurs testamentaires. Chaque dossier 6-18 mois de paperasse répétitive (inventaires, valorisations, impôts, partages), outils actuels = Word + Excel + emails. Cabinets perdent 30-40% temps en tâches admin non-facturables. Héritiers frustrés par délais.
- **Monétisation** : 2000 CHF/dossier one-shot + 500 CHF/mois/cabinet abonnement × 100 cabinets × 12 dossiers/an = 2.4M dossiers + 600K SaaS = 3M ARR an 3. Break-even mois 15-18. Leviers : intégrations banques CH (données automatiques), module fiscal cantonal à valeur ajoutée, rachat concurrents frag
- **Solution** : Plateforme verticale pour exécuteurs : workflow complet dossier succession (checklists cantonales 26 variations), génération automatique documents (inventaire, partage, déclarations fiscales), portail héritiers (consultation état, signatures électroniques), IA extraction documents bancaires/notariés.
- **Barrière** : Relations notaires/Chambre des notaires CH = 2-3 ans, conformité cantonale 26 procédures = 18 mois build, intégrations bancaires (UBS, CS-UBS, cantonales) = 12-24 mois négos, confiance secteur juridique = cycle lent.
- **Risque** : Chambres notaires CH lancent solution collective (déjà projets pilotes VD/ZH) = rouleau compresseur régalien ; GDPR/LPD durcit extraction documents automatisée = produit freiné.


### #143 · TechLex-DACH    
- **Catégorie** : Licensing / IP
- **ARR 24m (brainstorm)** : 220k CHF · **Ambition** : 5/5 · **Effort** : 90/20
- **Fit Alain** : Croisement parfait — trilingue natif CH + 10+ ans UIKER vocabulaire roulements/transmission + tech stack Hono/x402. Solo total, zéro associé requis. Les termes s'ajoutent petit à petit pendant les heures creuses sans bloquer son emploi UIKER (hors roulements s
- **Problème** : Le vocabulaire technique du négoce industriel (roulements, hydraulique, pneumatique, transmission, joints, courroies, étanchéité) en FR/DE/IT contient 30-50K termes spécialisés dont 70% manquent dans Termium/IATE/DeepL glossaires pro. Traducteurs techniques facturent 0.18-0.35 CHF/mot parce qu'ils perdent 30% du temps à chercher équivalents précis.
- **Monétisation** : API x402 0.002 USDC/lookup + abonnement Stripe fiat 29 CHF/mois/traducteur (cible 400 traducteurs à 24m = 139K ARR) + licence enterprise 4999 CHF/an éditeurs traduction (DeepL concurrent, Trados, MemoQ — cible 10 licences = 50K) + vente exports dataset CSV 499 CHF/one-shot. ARR 2
- **Solution** : Dictionnaire technique multilingue 50k entrées FR-DE-IT-EN avec pour chaque terme : contexte d'usage (catalogue fabricant, norme, convention CH/DE/IT), phrase exemple réelle, synonymes régionaux (tessinois vs milanais vs piémontais), renvois normatifs (ISO/DIN/EN). API REST + MCP tool `translate_technical_term(term, sr
- **Barrière** : Le dataset 50k termes curé manuellement = 18-24 mois de travail artisanal impossible à cloner sans expertise métier DACH trilingue. DeepL/Google ne s'intéressent pas à cette niche (trop étroite, trop spécialisée). Un concurrent doit trouver
- **Risque** : DeepL/Google entraînent un modèle spécialisé B2B technique DACH → baisse valeur des 70% communs. Mitigation : se concentrer sur les 30% ultra-niches (dialectes, conventions régionales, contextes impli


### #145 · IndustrialGPT-FineTuned-DACH    
- **Catégorie** : Licensing / IP
- **ARR 24m (brainstorm)** : 180k CHF · **Ambition** : 4/5 · **Effort** : 120/20
- **Fit Alain** : Triple compétence IA/x402/trilingue + négoce = unique au monde. 500h IA pratique suffisent pour fine-tuning LoRA (Modal tutorial 8h). Pas d'associé. Stack déjà maîtrisée.
- **Problème** : Les éditeurs ERP/CRM B2B PME industrielles DACH (Bexio, Abacus, Odoo, Comarch, Sage) intègrent ChatGPT/Claude pour assister leurs clients mais le modèle générique confond une courroie crantée avec une courroie dentée (différence métier majeure), propose du FKM pour application alimentaire (erreur de certification), traduit "Wälzlager" en "roulement
- **Monétisation** : 0.0008 USD/1k input tokens + 0.0016 USD/1k output (30% moins cher que Claude Haiku, spécialisé DACH industrial). Cible 15 intégrateurs ERP DACH × 100M tokens/mois × 0.0012 = 180K ARR. Plus licence on-premise entreprise 9999 CHF/an (cible 5 = 50K). Coût inference externalisé = 40%
- **Solution** : Fine-tuning d'un modèle open-source (Mistral 7B, Llama 3.1 8B, Qwen 2.5 7B — au choix du client) sur dataset curé 30-50k exemples question/réponse négoce technique en FR/DE/IT. Alain construit dataset en 12 mois (extrait des prompts industriels, corpus normes ISO open, catalogues fabricants publics, vocabulaire TechLex
- **Barrière** : Dataset curé 30-50k exemples B2B industriel DACH trilingue = 12-18 mois travail expert. Fine-tuning reproductible techniquement mais qualité dataset = vrai moat. Les fournisseurs (OpenAI/Anthropic) ne feront pas de fine-tune si niche (quelq
- **Risque** : GPT-4o/Claude Opus deviennent si bons en multilingue technique que fine-tuning devient inutile avant 36 mois. Mitigation : positionner sur on-premise (data privacy) + souveraineté CH — segment non-adr


### #150 · FabricantCatalog-Federated-MCP    
- **Catégorie** : Infrastructure agents IA
- **ARR 24m (brainstorm)** : 475k CHF · **Ambition** : 5/5 · **Effort** : 90/20
- **Fit Alain** : Match absolu — trilingue + négoce + x402/MCP. Il connaît les 30 fabricants majeurs UIKER et peut les approcher pour partenariats (hors roulements pour conflit). Premier mover MCP industrial DACH = position défendable 2-3 ans.
- **Problème** : Les 500+ fabricants industriels DACH (Bosch, Schaeffler, Festo, Parker, SMC, Norgren, FAG, SKF, Klüber, Rexroth...) publient leurs catalogues techniques en PDF/HTML/API fragmentées — chaque fabricant a son propre format, vocabulaire, système de référence. Les agents IA procurement industriels doivent aujourd'hui faire 10 appels API différents avec 
- **Monétisation** : x402 0.005 USDC/recherche (cible 500k queries/an à 24m = 2500 USDC ≈ 2.3K CHF — marginal) + abonnement Stripe fiat 199 CHF/mois/agent B2B industriel (cible 80 clients = 191K) + listing premium fabricants "réf prioritaire" 499 CHF/mois (cible 30 fabricants = 180K) + licence data e
- **Solution** : Serveur MCP unique `industrial_catalog_search(product_type, specs, manufacturer)` qui fédère 20-50 catalogues publics fabricants DACH sous une API normalisée (schema unifié : dimensions, charges, matériaux, certifications, prix cat public, disponibilité). Couche de traduction réf-par-réf entre fabricants (si équivalenc
- **Barrière** : 20-50 intégrations fabricants = 6-12 mois travail + négociation partenariats (certains refusent, d'autres acceptent). Schema unifié nécessite expertise métier (Alain) pour normaliser correctement les différences entre catalogues. Brand "Le 
- **Risque** : Un fabricant majeur (Bosch, SKF) lance son propre serveur MCP officiel = perte de cette référence. Mitigation : scope large hors roulements + fédération multi-fabricants = proposition unique.


### #151 · SupplierSanity-Pro    
- **Catégorie** : Données niche
- **ARR 24m (brainstorm)** : 575k CHF · **Ambition** : 5/5 · **Effort** : 30/20
- **Fit Alain** : Match ultime — extension directe IBANforge + profil UIKER (il connaît les cas réels de fournisseurs problématiques). Trilingue. Stack 100%. Solo.
- **Problème** : Une PME industrielle DACH qui signe avec un nouveau fournisseur asiatique/est-européen/inconnu découvre trop tard (après virement 50-500K EUR) des problèmes : IBAN détourné, entreprise inexistante ou en procédure, sanctions SECO/OFAC, reviews désastreuses, changement brusque de dirigeant. Check manuel prend 2-4h via 5 outils séparés (Zefix/Moneyhou
- **Monétisation** : 0.05 USDC/check full via x402 + abonnement 149 CHF/mois 200 checks pour achats PME (cible 250 PME = 447K ARR) + 499 CHF/mois illimité + API enterprise 4999 CHF/an fiduciaires (cible 30 = 150K). ARR 24m : 500-650K. Marge 88% (réutilise infra IBANforge, coûts additionnels data sour
- **Solution** : Extension d'IBANforge pour fournisseurs industriels B2B : input nom entreprise + IBAN + pays → output scoring consolidé (validité IBAN + BIC + Zefix/Handelsregister/RNE + SECO/OFAC sanctions + mentions presse négatives via IA + stabilité direction via Zefix historique + reviews publics). Export PDF "due diligence fourn
- **Barrière** : Extension directe IBANforge = 80% stack réutilisable. Intégration Moneyhouse (contrat) + GLEIF + sanctions = 2-3 mois. Barrière majeure = brand "LE scanner fournisseur B2B CH" qui se construit via premiers clients satisfaits + recommandatio
- **Risque** : Moody's/Dow Jones descendent sur segment PME avec offre 1000 CHF/mois → compression prix. Mitigation : micropayments x402 + simplicité + vertical B2B industriel DACH.


### #152 · IndustrialCalc-Suite-DACH    
- **Catégorie** : Micro-SaaS
- **ARR 24m (brainstorm)** : 280k CHF · **Ambition** : 5/5 · **Effort** : 75/20
- **Fit Alain** : Match fort — négoce B2B + trilingue + stack Hono/SQLite. Pas d'IA requise donc coûts variables nuls. Solo complet. Synergie IBANforge (cross-promo).
- **Problème** : Les acheteurs/ingénieurs/technico-commerciaux B2B industriels DACH utilisent chaque semaine 20-30 calculateurs différents : TCO équipement (prix achat + énergie + maintenance + amortissement + valeur résiduelle), ROI machine, durée amortissement industriel, Overall Equipment Effectiveness (OEE), Cost-per-Piece, comparaison location vs achat, simula
- **Monétisation** : Free tier 5 calculateurs limités + Pro 29 CHF/mois tous calculateurs + export PDF (cible 400 abonnés à 24m = 139K ARR) + Business 99 CHF/mois 10 users + API (cible 80 = 95K) + licence white-label 2999 CHF/an fabricants (cible 15 = 45K). ARR 24m : 240-320K. Marge 92%.
- **Solution** : Suite SaaS 40-60 calculateurs industriels DACH trilingue FR/DE/IT, chacun avec mode simple (formulaire) + mode avancé (variables cachées), export PDF rapport, API pour intégration ERP, templates de cas d'usage par industrie (machines-outils, hydraulique, pneumatique, transmission, outillage). Moteurs déterministes (pas
- **Barrière** : 40-60 calculateurs validés par expertise métier = 6-9 mois travail qualifié. Traductions FR/DE/IT = expertise trilingue. Pas de moat technique (formules connues) mais moat qualité + brand + API intégrations ERP. 18 mois pour référence march
- **Risque** : Fabricants (Bosch, Festo) publient calculateurs gratuits biaisés. Mitigation : positionnement neutre (pas vendeur) + exhaustivité + trilingue + API.


### #153 · OpenCart-Swiss-B2B-Backend    
- **Catégorie** : Services B2B industriels
- **ARR 24m (brainstorm)** : 600k CHF · **Ambition** : 4/5 · **Effort** : 180/20
- **Fit Alain** : Stack Hono maîtrisée (IBANforge = preuve). Connaissance workflows B2B négoce. Trilingue. Solo faisable avec 1 dev freelance ponctuel (budget cash flow). Marketing via communautés devs CH (open-source).
- **Problème** : 3000+ PME CH de négoce B2B industriel vendent en ligne mais coincées entre Shopify (B2C-centric, TVA/QR-bill CH mal gérés), Magento 2 (cher, complexe, 20-80K setup), Bexio e-commerce (limité), ou custom Drupal (fragile). Besoins spécifiques B2B non couverts : comptes clients avec prix négociés, approval workflows, quantity breaks dégressifs, devis→
- **Monétisation** : Core open-source (lead gen) + Cloud hosted Pro 149 CHF/mois PME (cible 150 PME à 24m = 268K ARR) + Scale 499 CHF/mois multi-site (cible 30 = 180K) + consulting setup 4999-9999 CHF one-shot (cible 25/an = 150K). ARR 24m : 500-700K. Marge 65% (hosting + 10% consulting externalisabl
- **Solution** : Backend e-commerce B2B open-source + SaaS hosted spécifique PME industrielles CH, trilingue natif, stack Hono/TypeScript/SQLite. Modules prêts : pricing tiers, devis workflow, QR-bill génération, validation IBAN via IBANforge, catalogues trilingue, intégration ERP Bexio/Abacus via API. Pas de frontend imposé (headless)
- **Barrière** : Stack spécifique CH (QR-bill + IBAN + TVA 3 taux + trilingue + workflow B2B) = 6-12 mois dev. Brand open-source + communauté devs CH = 18 mois. Expertise métier négoce technique = différenciant vs Shopify gen-tech. Un concurrent doit invest
- **Risque** : Shopify lance "Shopify B2B for Switzerland" natif = concurrence écrasante. Mitigation : open-source + communauté + customisation.


---

## 📋 Synthèse pour décision

### Les 7 projets Tier 1 en une phrase

| ID | Nom | Une phrase | ARR | Feu |
|---|---|---|---|---|

| #1 | **SEPAgate** | Le règlement EU 2024/886 impose la Verification of Payee (VoP) à toutes les banques de la zone ... | 120k | 🟢 |

| #7 | **ProofOfCompliance** | Quand un agent IA effectue un virement automatisé soumis à due diligence (VoP, sanctions check,... | 24k |  |

| #13 | **SanctionsPing** | Un agent IA qui initie un paiement B2B doit vérifier OFAC SDN, EU CFSP, SECO, UK HMT, ONU — 5 l... | 72k |  |

| #14 | **AgentBill** | Un agent IA qui paie 500 micro-factures x402 par jour (0... | 38k |  |

| #15 | **TrustRegistry.ai** | Avec l'explosion attendue x402/MCP, comment un agent sait-il qu'une API tierce est fiable, resp... | 28k |  |

| #26 | **QRBillGen** | Le QR-bill est obligatoire en CH depuis 2022 mais générer un QR-bill valide programmatiquement ... | 48k |  |

| #154 | **IBANforge-PSP-Subcontract-Swiss** | Les 4 banques cantonales + 2 Raiffeisen/PostFinance CH doivent implémenter la VoP Verification ... | 200k |  |


### Recommandations issues des analyses avancées + Passe 2

1. **#1 SEPAgate + #154 IBANforge-PSP-Subcontract** → **FUSION recommandée** (même backend, 2 canaux : PSP white-label + corporate direct). ARR blended 200-300k CHF. À acter avant de lancer comme 2 produits séparés.
2. **#14 AgentBill** → **PIVOT en module** intégré à SEPAgate/IBANforge (VAT/QR-bill compliance) plutôt que produit standalone. Volume x402 réel 2026 trop faible pour justifier un produit séparé.
3. **#26 QRBillGen** → commodité (ChatGPT peut le faire, libs open source existent). Bon comme **feature gratuite d'appel** vers IBANforge, pas comme produit.
4. **#7 ProofOfCompliance** et **#13 SanctionsPing** → naturellement complémentaires à VoP. **Bundle** dans un seul produit "IBANforge-Compliance-API" avec SEPAgate.
5. **#15 TrustRegistry.ai** → trop précoce (l'écosystème x402 a besoin d'abord de volume). **Parking 12-18 mois**.

### Filtres à appliquer avant de choisir le nouveau projet

- **Contrainte 10-15 h/sem solo** : écarter Tier 3 (#83, #92, #153 = projets à équipe)
- **Budget ≤ 5000 CHF** : favoriser les extensions 0-coût (#1, #7, #13, #14 sur infra IBANforge existante)
- **Time-to-first-revenue ≤ 6 mois** : #154 (PSP CH, tickets B2B) et #1 (SEPAgate fiat abo) sont les plus rapides
- **Moat défendable** : #154 > #1 > #6 > #150 (plus le moat est structurel, plus le projet résiste à la copie)

### Décision simple recommandée

- **Nouveau projet le plus évident** : **#154 IBANforge-PSP-Subcontract-Swiss** (fusion avec #1) — score Passe 2 4.50/5, Tier S, ARR 120-400k.
- **Si tu veux un projet passif léger en parallèle** : **#14 AgentBill** comme module dans le core IBANforge.
- **Si tu veux une vraie bifurcation** : **#6 IdentityPing** (KYB agent-first) — niche différente mais stack réutilisable.

> Source complète : `/Users/claude-alainmartin/projet Jennifer/docs/brainstorm/` (154 idées) + `favoris-approfondis/` (44 deep + 15 analyses avancées + Passe 2 top 10).

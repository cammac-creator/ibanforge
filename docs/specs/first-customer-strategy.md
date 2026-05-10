# Strategie premier client payant -- Fintechs et PSPs suisses

> **Objectif** : Signer le premier client payant d'IBANforge parmi les fintechs et PSPs bases en Suisse.
> **Date** : Avril 2026
> **Horizon** : 3 mois (Q2 2026)

---

## 1. Pourquoi la Suisse ?

- **4 licences fintech FINMA** actives (Bivial, Relio, Yapeal, SR Saphirstein/Fiat24) -- petites structures agiles, pas de legacy IBAN validation en interne.
- **Obligations AML/KYC strictes** (AMLA) : chaque acteur reglemente doit verifier les coordonnees bancaires.
- **Ecosysteme concentre** : Zurich + Zug + Geneve, tout le monde se connait. Un seul client = effet boule de neige.
- **Nouvelle reglementation en cours** : remplacement de la licence fintech par deux nouvelles licences (payment institution + crypto institution, consultation ouverte fin 2025). Les fintechs investissent dans la compliance -- bon timing.

---

## 2. Cibles prioritaires

### Tier 1 -- Clients directs ideaux (premiers a contacter)

Ces entreprises traitent des IBANs au quotidien, ont des equipes tech legeres, et sont assez petites pour tester un nouveau fournisseur sans comite d'achat de 6 mois.

| Entreprise | Localisation | Ce qu'ils font | Pourquoi IBANforge | Taille estimee | Contact |
|---|---|---|---|---|---|
| **Relio** | Zurich | Comptes business digitaux pour PME, multi-devises, paiements internationaux | Validation IBAN sur chaque virement sortant + onboarding beneficiaire. La detection vIBAN aide leur compliance AML. | ~20-40 pers., licence fintech FINMA | relio.ch -- formulaire contact + LinkedIn founders |
| **Amnis Treasury** | Zurich | Plateforme tresorerie PME : FX, paiements internationaux, comptes multi-devises | API-first, deja integree avec des ERP. Validation IBAN + BIC lookup sur chaque paiement international. | ~30-50 pers., fondee 2014 | amnistreasury.com/api -- equipe tech accessible |
| **Bivial** (ex-Klarpay) | Zurich | Comptes Swiss pour business digitaux, e-commerce, createurs. IBAN personnalises, Visa. | Emetteur d'IBANs CH -- besoin de valider les IBANs recus pour les virements. Detection vIBAN cruciale pour leur clientele e-commerce. | ~30-50 pers., licence fintech FINMA, Visa principal member | bivial.com -- PR team active, LinkedIn CEO |
| **Yapeal** | Zurich | BaaS API-first, comptes avec IBANs virtuels, cartes, paiements CH et internationaux | Leur coeur de metier est l'API. IBANforge se branche directement dans leur stack. Detection vIBAN pertinente car ils emettent eux-memes des vIBANs. | ~20-40 pers., 1ere licence fintech FINMA (2020) | yapeal.ch -- API docs publiques, equipe tech active sur LinkedIn |
| **SR Saphirstein / Fiat24** | Zurich | Banking Web3, comptes Swiss, participant SWIFT et SEPA | Passerelle fiat/crypto -- validation IBAN necessaire pour les off-ramps. Niche mais tech-savvy. | ~15-30 pers., licence fintech FINMA | saphirstein.com -- CEO Haoning Zhang (ETH, ex-Avaloq/UBS) |

### Tier 2 -- RegTech / Compliance (integration produit)

Ces entreprises vendent de la compliance. IBANforge devient une brique dans leur produit.

| Entreprise | Ce qu'ils font | Angle IBANforge | Contact |
|---|---|---|---|
| **Polixis** | AML/KYC pour institutions financieres, scoring de risque | Risk scoring pays + detection vIBAN = enrichissement direct de leur pipeline compliance | polixis.com |
| **KYC Spider** | Plateforme KYC/CDD pour banques, echange securise de donnees KYC | Validation IBAN comme couche supplementaire dans le processus KYC | Via LinkedIn / site web |
| **NetGuardians** | Detection fraude et AML pour banques | La classification emetteur (neobank vs banque traditionnelle) aide a scorer les transactions | netguardians.ch |
| **Apiax** | Compliance-as-code, regles reglementaires digitalisees (Zurich, $8.1M leves) | Integration des regles IBAN par pays dans leur moteur de compliance | apiax.com |

### Tier 3 -- Partenaires canal (integration chez leurs clients)

Pas des clients directs, mais des prescripteurs qui integrent des APIs chez leurs clients bancaires.

| Entreprise | Role | Pourquoi les approcher |
|---|---|---|
| **Synpulse** | Consulting management pour banques et assurances, fondateur OpenWealth API | Recommandent des solutions API a leurs clients banques. Un partenariat = acces indirect a des dizaines de banques. |
| **Ergon** | Open banking et BaaS pour la place financiere suisse | Integrateurs techniques, peuvent recommander IBANforge dans leurs architectures. |
| **Mimacom** | Solutions digital banking, implementation open banking pour SIX bLink | Meme logique -- canal d'acces aux banques via l'integrateur. |

### Tier 4 -- Ne pas perdre de temps (pour l'instant)

| Entreprise | Pourquoi pas maintenant |
|---|---|
| **Neon** | Utilise Finstar API (Hypothekarbank Lenzburg) + Wise API. IBAN validation internalisee. |
| **Datatrans** | PSP leader suisse (600M CHF CA). Trop gros, cycle de vente trop long, validation IBAN n'est pas leur besoin. |
| **SIX Group** | Fournissent eux-memes un service IBAN checker. Concurrent, pas client. |
| **UBS, ZKB, grandes banques** | Cycles de 12+ mois, compliance interne massive, pas adapte pour un premier client. |

---

## 3. Differenciateurs IBANforge pour le marche suisse

### Ce que les concurrents ne font PAS

| Fonctionnalite | IBANforge | IBANAPI | iban.com | OpenIBAN |
|---|---|---|---|---|
| Validation IBAN (mod97) | Oui | Oui | Oui | Oui |
| BIC/SWIFT lookup (121K+ entrees, 38K LEI-enrichies via GLEIF) | Oui | Partiel | Oui | Non |
| **Detection vIBAN** (EMI/neobank) | **Oui** (30+ BIC8) | Non | Non | Non |
| **Risk scoring pays** | **Oui** | Non | Non | Non |
| **Statut SEPA / VoP** | **Oui** | Non | Partiel | Non |
| **Classification emetteur** | **Oui** | Non | Non | Non |
| Interface MCP (agents AI) | **Oui** | Non | Non | Non |
| Donnees LEI (GLEIF) | **Oui** | Non | Partiel | Non |
| Batch (100 IBANs) | Oui | Oui | Oui | Non |

### Le pitch en une phrase

> "IBANforge ne valide pas juste l'IBAN -- il vous dit si c'est un vIBAN, quel EMI l'a emis, le niveau de risque pays, et si le beneficiaire est dans la zone SEPA/VoP. En un seul appel API."

### Pourquoi c'est pertinent pour la Suisse

1. **Obligations AMLA** : les fintechs suisses doivent classifier les risques. Le risk scoring pays integre fait gagner du temps.
2. **Detection vIBAN** : avec la montee des EMIs (Revolut, Wise, N26), savoir si un IBAN est "virtual" est un signal compliance de plus en plus demande.
3. **Donnees GLEIF** : source autoritaire pour les BICs, reconnue par FINMA et les regulateurs.
4. **MCP-native** : les fintechs suisses investissent dans l'IA (cf. Unique, etc.) -- l'interface MCP est un differenciateur "future-proof".

---

## 4. Strategie de pricing pilote

### Le probleme x402

Le modele actuel (micropaiements USDC via x402) est innovant mais constitue un **frein a l'adoption** pour un premier client suisse :
- Les fintechs suisses facturent en CHF/EUR
- Le departement finance ne va pas gerer des paiements USDC pour un outil interne
- Le setup x402 ajoute une friction technique

### Proposition : offre pilote en 3 paliers

| Phase | Duree | Offre | Objectif |
|---|---|---|---|
| **Discovery** | 2 semaines | **Gratuit** -- 200 req/jour, cle API dediee, support direct Slack/email | Prouver la valeur technique, zero friction |
| **Pilot** | 2 mois | **Gratuit** -- 2'000 req/jour, acces batch, SLA email 24h | Integration en production, mesurer l'usage reel |
| **Production** | Ongoing | **Facturation mensuelle CHF/EUR** -- paliers volume | Premier revenu |

### Grille tarifaire production suggeree

| Volume mensuel | Prix par requete | Cout mensuel approx. |
|---|---|---|
| 0 -- 1'000 | Gratuit | CHF 0 |
| 1'001 -- 10'000 | CHF 0.005 | CHF 5 -- 50 |
| 10'001 -- 50'000 | CHF 0.004 | CHF 40 -- 200 |
| 50'001 -- 200'000 | CHF 0.003 | CHF 150 -- 600 |
| 200'000+ | Sur devis | Negociable |

### Benchmark concurrentiel

- **IBANAPI** : $15 pour 2'000 req ($0.0075/req) a $115 pour 30'000 req ($0.0038/req) -- validation basique uniquement
- **iban.com** : EUR 530/an pour 2'000 req (EUR 0.265/req) a EUR 2'350/an pour 50'000 req (EUR 0.047/req)
- **IBANforge** a CHF 0.003-0.005/req : **competitif sur le prix ET superieur sur les features** (vIBAN, risk, SEPA/VoP, LEI)

### Action requise

> **BLOCKER** : Il faut implementer une facturation classique (mensuelle, CHF/EUR, sur facture ou Stripe) en parallele du x402. Sans ca, aucune fintech suisse ne signera. Le free tier avec cle API est le pont d'entree, mais le passage a la facturation doit etre frictionless.

---

## 5. Plan d'approche concret

### Semaine 1-2 (Avril 2026) -- URGENT

1. **Evenement SFTA le 16 avril 2026** (Zurich, ORBIZ Josef, 15h-17h45 + apero)
   - S'inscrire immediatement via swissfinte.ch/events
   - Objectif : rencontrer 5+ personnes de fintechs Tier 1/2
   - Preparer un one-pager IBANforge (A4, en anglais)
   - Avoir le playground demo sur telephone

2. **Cold outreach Tier 1** : envoyer les 5 emails (voir templates ci-dessous)

3. **LinkedIn** : connecter avec les CTO/Head of Engineering de chaque cible Tier 1

### Semaine 3-4 (Avril-Mai 2026)

4. **Follow-up** les non-reponses (2eme email + LinkedIn)
5. **Demo calls** avec les interesses -- montrer le playground en live
6. **Creer les cles API pilotes** pour les premiers testeurs

### Mai-Juin 2026

7. **Accompagner l'integration** du premier pilote (support technique direct)
8. **Preparer Swiss Fintech Week** (19-25 juin 2026, Zurich)
   - S'inscrire comme participant
   - Objectif : avoir un premier client comme reference pour les conversations
9. **Contacter les Tier 2** (regtech) avec le cas d'usage pilote comme preuve

### Juin-Juillet 2026

10. **Convertir le pilote en client payant**
11. **Publier un case study** (avec accord du client)
12. **Approcher les Tier 3** (consultants) pour le canal indirect

---

## 6. Templates d'outreach

### 6.1 Email a froid -- Francais

**Objet** : Validation IBAN enrichie pour [Nom Entreprise] -- detection vIBAN et risk scoring

---

Bonjour [Prenom],

Je suis [Prenom], fondateur d'IBANforge -- une API de validation IBAN pensee pour les fintechs qui ont besoin de plus qu'un simple check mod97.

En une seule requete API, IBANforge retourne :
- La validation IBAN complete (75+ pays)
- Le BIC/SWIFT associe (121K+ entrees, dont 38K LEI-enrichies via GLEIF)
- La **classification emetteur** : banque traditionnelle, neobank, EMI (detection vIBAN)
- Le **score de risque pays** et le statut SEPA/VoP

J'ai vu que [Nom Entreprise] [description specifique de ce qu'ils font et pourquoi c'est pertinent -- ex: "traite des paiements internationaux pour des PME suisses"]. La detection de vIBANs et le risk scoring pourraient renforcer votre compliance sans ajouter de complexite a votre stack.

**Je propose un acces pilote gratuit** (2'000 requetes/jour pendant 2 mois) pour que votre equipe puisse tester en conditions reelles.

Un call de 15 minutes cette semaine pour une demo ?

Cordialement,
[Signature]

---

### 6.2 Email a froid -- Deutsch (formel, Sie-Form)

**Betreff** : Erweiterte IBAN-Validierung fur [Firmenname] -- vIBAN-Erkennung und Risikobewertung

---

Sehr geehrte/r [Herr/Frau Nachname],

mein Name ist [Vorname], Grunder von IBANforge -- einer IBAN-Validierungs-API, die speziell fur Fintechs entwickelt wurde, die mehr als eine einfache Mod97-Prufung benotigen.

Mit einem einzigen API-Aufruf liefert IBANforge:
- Vollstandige IBAN-Validierung (75+ Lander)
- BIC/SWIFT-Zuordnung (121'000+ Eintrage, davon 38'000 mit LEI-Anreicherung via GLEIF)
- **Emittenten-Klassifizierung**: traditionelle Bank, Neobank oder EMI (vIBAN-Erkennung)
- **Landerrisiko-Scoring** und SEPA/VoP-Status

Ich habe gesehen, dass [Firmenname] [spezifische Beschreibung -- z.B. "internationale Zahlungen fur Schweizer KMU abwickelt"]. Die vIBAN-Erkennung und das Risikoscoring konnten Ihre Compliance-Prozesse starken, ohne zusatzliche Komplexitat in Ihren Tech-Stack einzufuhren.

**Ich biete Ihnen gerne einen kostenlosen Pilotzugang an** (2'000 Anfragen/Tag uber 2 Monate), damit Ihr Team die Losung unter realen Bedingungen testen kann.

Hatten Sie diese Woche 15 Minuten Zeit fur eine kurze Demo?

Mit freundlichen Grussen,
[Unterschrift]

---

### 6.3 Message LinkedIn (court, informel mais professionnel)

**Francais :**

> Bonjour [Prenom], je developpe IBANforge, une API de validation IBAN qui va au-dela du check basique -- detection de vIBANs, classification emetteur (neobank/EMI), et risk scoring pays. Je pense que ca pourrait etre utile pour [Nom Entreprise], notamment pour [point specifique]. Pilote gratuit disponible. Ca vous dirait un call de 15 min ?

**Deutsch :**

> Hallo [Vorname], ich entwickle IBANforge, eine IBAN-Validierungs-API, die uber die Standard-Prufung hinausgeht -- vIBAN-Erkennung, Emittenten-Klassifizierung und Landerrisiko-Scoring. Ich denke, das konnte fur [Firmenname] interessant sein, insbesondere fur [spezifischer Punkt]. Kostenloser Pilotzugang verfugbar. Hatten Sie Lust auf einen 15-min Call?

---

### 6.4 Pitch pour meetups / evenements Swiss fintech

**Elevator pitch (30 secondes) :**

> "IBANforge est une API de validation IBAN pour fintechs. Ce qui nous differencie : on ne se contente pas de verifier le checksum. On vous dit si l'IBAN est un vIBAN emis par un EMI comme Revolut ou Wise, on classifie l'emetteur, et on score le risque pays -- tout ca en un seul appel. C'est concu pour les equipes compliance et les developpeurs qui construisent des produits de paiement. On offre un pilote gratuit de 2 mois."

**Questions a poser pour qualifier un prospect :**

1. "Comment validez-vous les IBANs aujourd'hui ? C'est fait en interne ou via un service externe ?"
2. "Est-ce que la detection de vIBANs (IBANs emis par des EMIs) est un sujet pour votre compliance ?"
3. "Quel volume d'IBANs traitez-vous par mois approximativement ?"
4. "Utilisez-vous des agents AI dans vos workflows ? On a une interface MCP native."

---

## 7. Evenements cles a cibler

| Date | Evenement | Lieu | Action |
|---|---|---|---|
| **16 avril 2026** | **SFTA Networking Event** | ORBIZ Josef, Zurich | **URGENT** -- s'inscrire maintenant, c'est dans 6 jours |
| 19-25 juin 2026 | **Swiss Fintech Week** | Zurich | S'inscrire, preparer demo live, viser 1 client de reference |
| Q3 2026 | Swiss Fintech Association events | Zurich/Geneve | Follow-up regulier via swissfinte.ch/events |
| Recurrent | **FintechNewsCH meetups** | Zurich | Veille via fintechnews.ch, presence reguliere |

---

## 8. KPIs de succes

| Metrique | Cible Q2 2026 |
|---|---|
| Emails envoyes (Tier 1) | 5+ |
| Demos realisees | 3+ |
| Pilotes actifs (cle API utilisee) | 2+ |
| Premier client payant | 1 |
| Evenements assistes | 2+ (SFTA avril + Swiss Fintech Week juin) |

---

## 9. Risques et mitigations

| Risque | Impact | Mitigation |
|---|---|---|
| **Pas de facturation CHF/EUR** | Bloquant -- aucun client ne paiera en USDC | Implementer Stripe billing avant la fin du pilote |
| "On fait ca en interne" | Frequent chez les plus grosses structures | Insister sur les features uniques (vIBAN, risk) qui n'existent pas en interne |
| Cycle de decision long | Retarde le premier revenu | Cibler les CTOs/founders directement, pas le procurement |
| Concurrence iban.com | Marque etablie | Prix 10x inferieur + features superieures. Proposer un comparatif technique en demo |
| Marche trop petit | Volume insuffisant pour etre rentable | La Suisse est le beachhead -- l'objectif est la reference client pour attaquer EU ensuite |

---

## 10. Next steps immediats

1. [ ] **S'inscrire a l'evenement SFTA du 16 avril** (swissfinte.ch/events)
2. [ ] **Preparer un one-pager PDF** (A4, anglais, avec QR code vers le playground)
3. [ ] **Envoyer les 5 emails Tier 1** cette semaine (Relio, Amnis, Bivial, Yapeal, SR Saphirstein)
4. [ ] **Connecter sur LinkedIn** avec les CTO/founders des 5 cibles
5. [ ] **Planifier l'implementation Stripe billing** pour facturation CHF/EUR
6. [ ] **S'inscrire a Swiss Fintech Week** (19-25 juin 2026)

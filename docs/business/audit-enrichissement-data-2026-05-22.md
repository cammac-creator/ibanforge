# IBANforge — Audit d'enrichissement des bases de données

**Date :** 2026-05-22
**Méthode :** 2 recherches web réelles (sources bancaires / clearing / BIC ; sources compliance / risk / SEPA / VoP / EMI), croisées avec l'état réel des données du projet (`scripts/refresh-compliance.ts`, `scripts/enrich-bic-database.ts`, `.github/workflows/`, `src/lib/`).
**Périmètre :** sources de données officielles pour compléter BIC, IBAN, SEPA, indicateurs de risque, clearing.

---

## Résumé exécutif

IBANforge a déjà un socle de données solide et **automatisé** : 121 399 entrées BIC rafraîchies mensuellement depuis 7 sources publiques, 1 190 entrées de clearing suisse, et une base compliance rafraîchie chaque semaine depuis OpenSanctions + les registres EPC. La vérification du code a évité un piège : deux sources « recommandées » par la recherche — **OeNB** et les **registres EPC (SCT/SDD/VoP)** — sont en réalité **déjà intégrées**.

Le vrai gisement d'enrichissement est ailleurs, en deux temps.

1. **Fiabiliser ce qui existe.** Trois faiblesses concrètes : les listes FATF et pays sanctionnés sont **codées en dur** dans un script (donc figées tant que personne ne les édite) ; les entités sanctionnées viennent d'un **agrégateur tiers (OpenSanctions)** et non des sources officielles ; les BIC sanctionnés sont extraits par **expression régulière** sur du texte libre — fragile.

2. **Étendre la couverture.** La classification EMI/vIBAN repose sur ~85 correspondances codées à la main : le **registre central EBA PSD2** (un fichier JSON, des milliers d'établissements) la ferait changer d'échelle. Et plusieurs banques centrales offrent des registres de clearing/agrément exploitables, dont certains avec API officielle.

Pièges signalés : il n'existe **pas** de liste officielle gratuite de *personnes* PEP, et le service de routage VoP de l'EPC (EDS) est **réservé aux participants** — IBANforge ne peut s'appuyer que sur le registre public des participants comme proxy (ce qu'il fait déjà).

---

## 1. ✅ Déjà en place

### Données BIC / clearing — `data/bic.sqlite`, refresh mensuel automatisé

| Source | Apport | Statut |
|---|---|---|
| GLEIF (`api.gleif.org`, `mapping.gleif.org`) | 38 761 BIC enrichis LEI | Socle, refresh mensuel |
| SwiftCodes (PeterNotenboom, licence MIT) | 81 642 BIC du répertoire SWIFT | Refresh mensuel |
| Deutsche Bundesbank (CSV `blz-aktuell`) | 142 entrées (Allemagne) | Refresh mensuel |
| SIX Group | 633 entrées (Suisse) | Refresh mensuel |
| **OeNB** (Autriche) | Établissements autrichiens | **Déjà intégré** (workflow `refresh-bic.yml`) |
| NBP (Pologne) | 19 entrées | Refresh mensuel |
| EBA Clearing STEP2 SCT | 201 entrées | Refresh mensuel |
| SIX BankMaster | 1 190 entrées de clearing suisse (BC-Nummer, SIC, QR-IID) | Le seul dataset de ce type exposé par une API |

**Total : 121 399 BIC + 1 190 entrées de clearing.** Refresh : cron mensuel (`refresh-bic.yml`).

### Données compliance — `data/compliance.sqlite`, refresh hebdomadaire automatisé

| Donnée | Source actuelle | Statut |
|---|---|---|
| Entités sanctionnées (→ BIC) | **OpenSanctions** — datasets `us_ofac_sdn`, `eu_fsf`, `un_sc_sanctions` | Refresh hebdo ; voir §2.1 |
| Pays sanctionnés | **Codé en dur** dans `refresh-compliance.ts` (5 « comprehensive » + 9 « sectoral ») | Voir §2.2 |
| FATF (black / grey / members) | **Codé en dur** dans `refresh-compliance.ts` (3 / 18 / 37 pays) | Voir §2.2 |
| Participants SEPA | **Registres EPC** — SCT, SDD Core, SCT Inst (CSV officiels) | **Déjà intégré** |
| Participants VoP | **Registre EPC VoP** (`vop.csv` officiel), fallback SCT | **Déjà intégré** |
| Classification EMI / vIBAN | ~85 correspondances BIC8 codées à la main (`src/lib/issuers.ts`) | Voir §2.3 |
| Structure IBAN par pays | Données codées dans `src/lib/countries.ts` | Voir §3.2 |

**Lecture :** le pipeline est mûr et automatisé. L'enjeu n'est pas d'ajouter des sources « SEPA » ou « OeNB » (déjà là) — c'est de fiabiliser les maillons faibles et d'étendre la couverture EMI.

---

## 2. 🟡 Points faibles des sources actuelles

### 2.1 — Les sanctions viennent d'un agrégateur tiers, pas des sources officielles

`refresh-compliance.ts` télécharge les listes OFAC / EU / UN depuis **`data.opensanctions.org`** — un agrégateur open-source réputé, mais **pas la source officielle**. Pour une API vendue à des éditeurs compliance/AML (segment cible n°2), la question « d'où viennent vos données de sanctions » est une question d'acheteur.

Ce n'est **pas un bug** — OpenSanctions a de vrais avantages (format unifié, dédoublonnage, refresh maintenu). C'est un **arbitrage** à poser explicitement :

- **(a) Garder OpenSanctions** — simplicité, format unique, maintenance déléguée. Acceptable si le positionnement reste « pré-filtrage », pas « screening réglementaire ».
- **(b) Migrer aux sources officielles** — OFAC Sanctions List Service (XML *advanced*), EU FSF (via webgate EC, nécessite un compte EU Login + token), UN Consolidated List (XML). Plus crédible commercialement, plus de maintenance (3 formats, 3 cadences).
- **(c) Hybride** — sources officielles comme référence, OpenSanctions en repli/complément. Le plus robuste, le plus coûteux.

Détail technique aggravant : les BIC des entités sanctionnées sont extraits par **expression régulière** sur le champ texte `identifiers` du CSV. Un BIC mal formé ou noyé dans du texte passe à travers — couverture incomplète et non vérifiable. Quelle que soit l'option retenue, ce point d'extraction mérite d'être fiabilisé.

### 2.2 — Les listes FATF et pays sanctionnés sont codées en dur

Dans `refresh-compliance.ts`, `FATF_BLACK_LIST`, `FATF_GREY_LIST`, `FATF_MEMBERS` et les pays sanctionnés sont des **constantes JavaScript**. Le « refresh » hebdomadaire ne les met **pas** à jour — il ré-insère les mêmes valeurs figées.

Conséquence : ces listes ne bougent que si quelqu'un édite le script à la main. La FATF actualise ses listes **3 fois par an** (plénières de février, juin, octobre) ; la recherche web 2026 indique que la grey list a évolué depuis (ajouts récents) — le tableau codé en dur (18 pays) est probablement déjà en décalage avec la réalité. Idem pour les régimes de sanctions pays, qui changent au fil de l'actualité.

**Risque concret : des indicateurs de risque faux en production**, sans alerte. C'est le point le plus urgent de cet audit (voir §5 #1).

### 2.3 — La classification EMI / vIBAN plafonne à ~85 entrées

`src/lib/issuers.ts` mappe ~85 BIC8 vers un statut EMI/néobanque/vIBAN, **à la main**. C'est un vrai différenciateur produit, mais la couverture est étroite : tout EMI ou établissement de paiement absent de la liste est classé « inconnu ». Le marché des EMI/PI européens se compte en **milliers**. Source d'extension : §3.1.

---

## 3. 🔵 Nouvelles sources — à instruire

### 3.1 — Registre EBA PSD2 (extension EMI / vIBAN) — la meilleure prise

- **Quoi :** registre central de l'EBA des établissements de paiement (PI), de monnaie électronique (EMI) et AISP de toute l'UE/EEE.
- **Accès :** download complet en **JSON machine-lisible, gratuit** — `https://euclid.eba.europa.eu/register/pir/registerDownload`. Spécification des champs fournie.
- **Fraîcheur :** alimenté par les autorités nationales, mis à jour au moins une fois par jour.
- **Apport :** fait passer la classification EMI/vIBAN de ~85 à potentiellement plusieurs milliers d'émetteurs, en une requête quotidienne. Amélioration directe de la détection vIBAN — un argument de vente central.
- **Réserve :** le registre central EBA porte un disclaimer juridique fort (« no legal significance ») ; à utiliser comme socle d'extension, pas comme preuve réglementaire. Croiser avec un registre national (ex. API REGAFI, §3.3) pour les cas sensibles.

### 3.2 — SWIFT IBAN Registry (fiabiliser la structure IBAN)

- **Quoi :** spécification officielle ISO 13616 du format IBAN par pays (longueur, position de l'identifiant banque, exemples).
- **Accès :** PDF + **fichier TXT structuré**, téléchargement gratuit (`swift.com`).
- **Apport :** IBANforge code la structure IBAN dans `src/lib/countries.ts`. Le SWIFT IBAN Registry est la **source canonique** pour maintenir ce fichier à jour (ajouts de pays, corrections) plutôt que des mises à jour manuelles.
- **Réserve :** téléchargement gratuit confirmé, mais les conditions de **redistribution** du fichier ne sont pas publiées — l'usage interne pour valider (sans redistribuer le fichier brut) est l'usage de facto ; à clarifier auprès de SWIFT avant d'embarquer le fichier.

### 3.3 — Banques centrales nationales (extension clearing / agrément)

- **Czech National Bank — Directory of Payment System Codes** (`cnb.cz`) — codes de clearing tchèques en **CSV UTF-8** versionné, gratuit. Comble la couverture clearing CZ. Modèle réplicable : vérifier les pages équivalentes en Slovaquie, Hongrie, Roumanie.
- **De Nederlandsche Bank — registre public** (`dnb.nl`) — **API officielle** + fichiers, rafraîchis chaque jour ouvré. N'apporte pas le clearing, mais permet de **vérifier en temps réel le statut d'agrément** d'un établissement néerlandais — une fonctionnalité de qualité de données.
- **ACPR / Banque de France — REGAFI** (`developer.regafi.banque-france.fr`) — **API REST officielle, inscription gratuite** (100-300 appels/h). Couvre établissements de crédit, de paiement, de monnaie électronique français. La source nationale la plus directement intégrable ; bon complément de fiabilité juridique au registre EBA (§3.1).
- *Plus institutionnel, sans API :* Banque nationale de Belgique (codes de clearing en XLSX), Banco de España, Banca d'Italia (registres de consultation, pas de download bulk). Utiles en vérification ponctuelle, pas pour l'ingestion automatisée.

### 3.4 — SECO — sanctions suisses

- **Quoi :** liste des personnes/entités sanctionnées par la Suisse (SECO).
- **Accès :** **CSV et XML** (nouveau format XML conforme à un XSD), gratuit.
- **Apport :** IBANforge couvre OFAC/EU/UN mais **pas** la liste suisse. La liste SECO peut diverger marginalement de la liste UE (timing et périmètre propres à la Suisse). Ajout à coût faible, valeur réelle pour le positionnement « Swiss » d'IBANforge.

### 3.5 — OFAC officiel (lié à l'arbitrage §2.1)

Si l'option (b) ou (c) de §2.1 est retenue : le **Sanctions List Service** d'OFAC fournit la SDN en **XML *advanced*** (programmes, alias, dates) — plus riche que le CSV simple d'OpenSanctions, avec une API d'export. C'est la voie de migration vers une source de sanctions officielle.

---

## 4. Sources écartées et pièges

- **EISCD (UK)** — le répertoire de clearing UK le plus complet (sort code + BIC), mais **payant** (~2 000 £/an) et réservé aux acteurs agréés du clearing britannique. À reconsidérer seulement si la couverture UK devient un axe commercial.
- **E-Payments Routing Directory US (Fedwire/FedACH)** — la Fed ne le publie plus librement ; licence interdisant la redistribution. Hors périmètre IBAN, à écarter.
- **EPC Directory Service (EDS)** — le mécanisme officiel de routage/statut VoP, mais **réservé aux scheme participants et RVM agréés**. IBANforge ne peut pas y accéder sans devenir participant. Le proxy public = le registre EPC des participants VoP — qu'IBANforge utilise **déjà**. À présenter comme une limite, pas une opportunité.
- **Liste PEP « officielle » de personnes — n'existe pas.** L'UE ne publie que la liste des *fonctions* qui qualifient comme PEP (décision C/2023/724), pas une liste de personnes. Tout screening PEP-personnes repose sur des bases commerciales. IBANforge ne doit pas promettre un screening PEP adossé à une source officielle gratuite.
- **Agrégateurs tiers** (au-delà d'OpenSanctions déjà en place : api.store, dilisense, etc.) — pratiques, mais pas des sources officielles. À n'utiliser que comme repli technique, jamais comme source de vérité affichée.
- **BaFin (registre ZAG), Banca d'Italia (Albi)** — registres fiables mais sans API ni download bulk public ; le registre EBA (§3.1) couvre l'Allemagne et l'Italie de façon bien plus exploitable.

---

## 5. Top 5 — actions priorisées

| # | Action | Effort | Valeur | Pourquoi |
|---|--------|--------|--------|----------|
| 1 | **Fiabiliser les listes FATF + pays sanctionnés** codées en dur — recaler sur la dernière plénière FATF, puis caler le process de mise à jour sur les plénières (fév./juin/oct.) | Faible | Très élevée | Risque concret de données de risque **fausses** en production. Le « refresh » hebdo ne les touche pas aujourd'hui. À corriger en premier. |
| 2 | **Intégrer le registre EBA PSD2** (JSON quotidien) pour la classification EMI/vIBAN | Moyen | Très élevée | Fait passer la détection EMI/vIBAN de ~85 à des milliers d'émetteurs — un argument de vente central, en une seule source. |
| 3 | **Arbitrer la source des sanctions** (décision §2.1 : garder OpenSanctions / migrer officiel / hybride) et fiabiliser l'extraction BIC par regex | Décision, puis moyen | Élevée | Question d'acheteur pour le segment compliance/AML. À trancher consciemment, pas par défaut. |
| 4 | **SWIFT IBAN Registry** comme source de maintenance de `countries.ts` | Faible | Moyenne | Remplace des mises à jour manuelles de la structure IBAN par une source officielle. Clarifier la redistribution avec SWIFT. |
| 5 | **Ajouter SECO** (sanctions suisses, CSV/XML) + instruire l'**API REGAFI** | Faible-moyen | Moyenne | SECO renforce le positionnement suisse à coût faible ; REGAFI ajoute une couche officielle de fiabilité FR via API gratuite. |

---

## Limites de cet audit

- **OFSI / UK :** la recherche web indique que la liste consolidée OFSI aurait été remplacée début 2026 par une « UK Sanctions List » unique. IBANforge n'utilisant **pas** de source UK aujourd'hui, le point est sans impact immédiat — pertinent seulement si une couverture UK est ajoutée un jour ; le détail (date exacte, format) est à confirmer à ce moment-là.
- **Licences :** la plupart de ces registres publics ne publient pas de licence open-data formelle. « Public et gratuit » ≠ « libre de réutilisation commerciale ». Avant intégration commerciale, valider les conditions au cas par cas (en particulier EBA, EPC, SWIFT) — un court e-mail à l'organisme suffit souvent.
- **Couverture géographique :** les banques centrales nordiques et d'Europe de l'Est n'ont pas été explorées en profondeur (limite des outils de recherche). Pour la Finlande, la liste de référence des codes + BIC est publiée par Finance Finland (association de place, pas la banque centrale) — à qualifier comme telle. Une passe dédiée « pays non couverts » serait utile.
- **Contenu exact des fichiers :** la présence ou non du BIC dans chaque registre national n'a été vérifiée finement que pour quelques sources ; à confirmer en téléchargeant un échantillon avant intégration.
- Audit fondé sur une recherche web datée du 2026-05-22 et sur l'état du code à cette date.

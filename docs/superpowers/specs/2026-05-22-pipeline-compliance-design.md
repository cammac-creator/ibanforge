# IBANforge — Pipeline compliance : fiabilisation — Design Spec

> Date : 2026-05-22 · Statut : validé · Origine : `docs/business/audit-enrichissement-data-2026-05-22.md` — sous-projet A (actions 1, 3, 5)

## Objectif

Fiabiliser le pipeline de données compliance d'IBANforge sur trois maillons faibles identifiés par l'audit : des listes de risque qui dérivent en silence, une extraction de BIC sanctionnés fragile, et une couverture de sanctions sans la Suisse.

## 1. Contexte

`scripts/refresh-compliance.ts` reconstruit `data/compliance.sqlite` chaque semaine. Trois faiblesses :

1. **Listes FATF + pays sanctionnés codées en dur** — constantes inline dans le script ; le refresh hebdomadaire ré-insère les mêmes valeurs figées. La FATF actualise 3×/an : les listes dérivent sans alerte.
2. **BIC sanctionnés extraits par expression régulière** sur le champ texte libre `identifiers` du CSV OpenSanctions — faux positifs et faux négatifs possibles.
3. **Pas de liste de sanctions suisse** — IBANforge couvre OFAC/EU/UN mais pas SECO.

Décision de cadrage actée : on **garde OpenSanctions** comme source de sanctions (format unifié, maintenance déléguée) ; le sous-projet fiabilise, il ne migre pas.

## 2. Axe 1 — Listes FATF + pays sanctionnés dans un module daté

- **Créer `src/lib/compliance-static.ts`** (pattern `src/lib/issuers.ts` — module TypeScript typé, lisible) : exporte `FATF_BLACK_LIST`, `FATF_GREY_LIST`, `FATF_MEMBERS`, `SANCTIONED_COUNTRIES_COMPREHENSIVE`, `SANCTIONED_COUNTRIES_SECTORAL`, plus une constante `FATF_AS_OF` (ex. `'2026-02'`).
- Les valeurs sont **recalibrées à la dernière plénière FATF**. Les valeurs exactes seront fixées par une recherche web fraîche au moment du plan d'implémentation (plénière de février 2026) — ne pas figer des valeurs approximatives dans ce spec.
- `refresh-compliance.ts` importe ce module au lieu de ses constantes inline.
- **Garde-fou unique contre la dérive** (pas de mécanisme redondant) :
  - un commentaire en tête du module indiquant la **prochaine date de plénière FATF** ;
  - `FATF_AS_OF` écrit dans la table `metadata` de `compliance.sqlite` ;
  - un `console.warn` au lancement de `compliance:refresh` si `FATF_AS_OF` remonte à plus de ~5 mois.

## 3. Axe 2 — Extraction des BIC sanctionnés fiabilisée

- Aujourd'hui : `BIC_REGEX` appliqué au champ `identifiers` ; tout ce qui ressemble à un BIC est inséré dans `sanctioned_entities`.
- Design : chaque BIC candidat est **validé avant insertion** —
  1. format ISO 9362, via le `bic-validator.ts` existant ;
  2. recoupement avec la base BIC réelle (`data/bic.sqlite`, 121 399 entrées) : un candidat dont le format est invalide **ou** qui ne correspond à aucun BIC connu est rejeté.
- `refresh-compliance.ts` ouvrira `bic.sqlite` en lecture seule pour ce recoupement.
- Effet : moins de faux positifs (séquences de texte ressemblant à un BIC) ; un compteur de candidats rejetés est journalisé.

## 4. Axe 3 — Ajout de la liste SECO

- Ajouter la liste de sanctions suisse (SECO) comme **4ᵉ source**, via le dataset SECO d'OpenSanctions — cohérent avec la décision « garder OpenSanctions ».
- Le slug exact du dataset est à confirmer au moment du plan (`ch_seco_sanctions` probable — vérifier sur `data.opensanctions.org/datasets/latest/`).
- Les entités SECO sont insérées avec `source_list = 'SECO'`.
- Mettre à jour la valeur `sources` des metadata en conséquence.

## 5. Tests

- `src/lib/compliance.test.ts` existe et teste des comportements qui dépendent des constantes hardcodées (ex. statut FATF d'un pays). Recaler les listes peut **changer le résultat de tests existants** — le plan d'implémentation les listera explicitement et les ajustera.
- Nouveaux tests : la validation/rejet des BIC candidats (format + recoupement) ; la présence d'une source `SECO` ; `FATF_AS_OF` exporté et écrit dans `metadata`.

## 6. Fichiers

| Fichier | Action | Responsabilité |
|---|---|---|
| `src/lib/compliance-static.ts` | Créer | Listes FATF + pays sanctionnés, typées et datées (`FATF_AS_OF`) |
| `scripts/refresh-compliance.ts` | Modifier | Importe le module statique ; durcit l'extraction BIC ; ajoute SECO ; écrit `FATF_AS_OF` en metadata + `console.warn` de fraîcheur |
| `src/lib/compliance.test.ts` | Modifier | Ajuste les tests dépendant des valeurs recalées + nouveaux tests |

## 7. Hors périmètre

- Migration des sanctions hors OpenSanctions (décision actée : on garde OpenSanctions).
- Parsing automatique des pages FATF (HTML, pas de source machine-lisible officielle — fragile).
- **REGAFI** — noté pour un futur sous-projet « registres d'agrément », hors A.
- Sous-projets B (classification EMI) et C (structure IBAN).

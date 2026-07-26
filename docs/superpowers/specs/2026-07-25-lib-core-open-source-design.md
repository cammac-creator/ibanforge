# t23 — Extraire la validation IBAN dans une bibliothèque open source

**Date** : 2026-07-25
**Statut** : conception validée, prête à planifier

## Objectif

Les assistants IA sont aujourd'hui le premier canal de découverte d'IBANforge, mais le produit n'est trouvé que sur des requêtes déjà très spécifiques (MCP, x402, clearing suisse). Sur la requête la plus banale du domaine, « valider un IBAN », ce sont des bibliothèques gratuites installées depuis des années qui répondent.

Ce chantier publie la couche de calcul d'IBANforge comme bibliothèque open source, sous un nom court et cherchable, avec une sortie qui indique elle-même où obtenir ce qu'elle ne sait pas faire.

**Principe directeur : on ouvre le calcul, on garde la donnée.** Le calcul (mod-97, structures de pays) est une norme publique sans valeur marchande. La donnée (121 610 BIC, 1 165 entrées SIX, sanctions, rails de clearing) reste dans l'API payante et n'est pas touchée par ce chantier.

## Périmètre

### Extrait vers la bibliothèque

Modules déjà écrits et testés, sans dépendance à la base de données ni au réseau :

| Module | Rôle | Lignes |
|---|---|---|
| `iban.ts` | validation mod-97 (ISO 13616), découpage BBAN | 192 |
| `countries.ts` | 89 pays, structures BBAN, SEPA, obligation VoP | 671 |
| `bic-validator.ts` | validation du format BIC (ISO 9362) | 83 |
| `issuers.ts` + `issuers-generated.ts` | classification EMI / vIBAN | 1 113 |
| `compliance-static.ts` | statut FATF, risque pays (listes publiques) | 56 |

La classification EMI/vIBAN est le différenciateur de la bibliothèque : elle repose sur des codes de banque publics, et aucune bibliothèque concurrente ne la propose.

### Reste dans l'API

Base BIC, clearing suisse SIX (institutions, rails SIC/euroSIC/QR-IID), criblage sanctions, score de risque, quotas et paiement. Aucun de ces éléments n'entre dans la bibliothèque.

## Contrat public

Zéro dépendance, zéro appel réseau, ESM et CJS.

```ts
import { validate, classifyIssuer, isValidBIC } from 'ibanforge';

validate('CH10 0023 0000 0000 1234 5');
// {
//   iban: 'CH1000230000000012345',
//   valid: true,
//   country: { code: 'CH', name: 'Switzerland' },
//   check_digits: '10',
//   bban: { bank_code: '00230', account_number: '000000012345' },
//   sepa: { member: true, schemes: ['SCT','SDD'], vop_required: false },
//   formatted: 'CH10 0023 0000 0000 1234 5',
//   enrich: {
//     hint: 'Bank name, Swiss SIX clearing rails and sanctions screening are not
//            computable offline — see https://api.ibanforge.com',
//     free_tier: '200 requests/month'
//   }
// }

classifyIssuer('REVOGB21');   // { type: 'emi', name: 'Revolut' }
```

### Le champ `enrich`

C'est le mécanisme de conversion, et le seul. Il est présent sur chaque résultat valide, il est purement déclaratif (aucun appel réseau), et il reprend le motif `upgrade_to_full_validation` déjà éprouvé en production sur `/v1/iban/format`.

Il est conçu pour être lu par une machine : un assistant qui atteint la limite de la bibliothèque trouve dans la réponse elle-même la marche suivante, sans avoir à lire le README.

## Architecture

Dépôt séparé, **source unique, code déplacé et non copié**.

```
cammac-creator/iban-core          (nouveau, public, MIT)
  src/           les 6 modules ci-dessus
  src/*.test.ts  leurs tests, déplacés avec eux
  README.md      CI GitHub Actions
  → npm: ibanforge

cammac-creator/ibanforge          (existant)
  package.json   dependencies: { "ibanforge": "^2.0.0" }
  src/lib/iban.ts, countries.ts, …   SUPPRIMÉS
```

Le code n'existe qu'à un seul endroit. Ce choix est délibéré : l'audit du 25/07 a relevé trois bugs causés par un fichier statique doublant une source de vérité (`mcp/server.json` contre `server.json`, `docs/openapi.yaml` contre l'openapi dynamique, la table `PRICING` contre la table de routes x402). Une copie synchronisée par script reproduirait exactement ce défaut.

**Contrepartie assumée** : une modification de la bibliothèque doit être publiée avant d'être consommée par l'API. Acceptable, car ces modules sont stables (aucune modification fonctionnelle depuis mai 2026).

## Types partagés

`IBANValidationResult` mélange aujourd'hui deux origines dans `src/types.ts` :

- calculés par la bibliothèque : `iban`, `valid`, `country`, `check_digits`, `bban`, `sepa`, `formatted`, `error`, `error_detail`
- résolus par la base : `bic`, `issuer`, `risk_indicators`, `clearing`

Tous les champs de la seconde catégorie sont déjà optionnels, donc la séparation est non cassante :

```ts
// dans la bibliothèque
export interface IbanResult { iban: string; valid: boolean; /* … socle … */ }

// dans ibanforge
import type { IbanResult } from 'ibanforge';
export interface IBANValidationResult extends IbanResult {
  bic?: { code: string; bank_name: string | null; city: string | null } | null;
  issuer?: { type: IssuerType; name: string };
  risk_indicators?: { /* … */ };
  clearing?: ChClearingSummary | null;
}
```

`enrich` est ajouté par la bibliothèque et retiré par l'API lorsqu'elle sert une réponse déjà enrichie : proposer un complément à un client qui l'a déjà payé serait absurde.

## Tests

Les tests unitaires existants partent **avec** les modules : c'est ce qui rend une bibliothèque crédible face à une concurrente en place depuis 2015.

Critère de réussite de la migration, non négociable : **les 607 tests d'IBANforge passent sans qu'aucun ne soit modifié**. Seuls les chemins d'import changent. Un test qu'il faut réécrire signale que le découpage est mauvais, pas que le test est faux.

Ajouts côté bibliothèque :
- un test vérifiant que `enrich` est présent sur un résultat valide et absent sur un IBAN invalide ;
- un test de non-régression sur les 89 exemples d'IBAN par pays (`EXAMPLE_IBANS`), déjà présents dans `countries.ts` ;
- un test garantissant l'absence de toute dépendance : `package.json` ne doit déclarer aucune `dependencies`.

## Publication

- **npm `ibanforge`, version 2.0.0.** Le paquet existe déjà (1.2.1, mai 2026) mais son contenu est un vestige qui double `ibanforge-mcp`. Il est réutilisé pour la bibliothèque.
- **Rupture documentée** : le binaire `ibanforge-mcp` exposé par l'ancien paquet disparaît. Le canal MCP officiel, documenté partout, est le paquet `ibanforge-mcp`, qui n'est pas modifié.
- Licence MIT, cohérente avec le dépôt principal.
- CI verte exigée avant toute publication.

## Hors périmètre

- Toute exposition de la base BIC, du clearing suisse ou des listes de sanctions.
- Un client HTTP intégré à la bibliothèque : elle reste hors ligne, sans dépendance. Le SDK `@ibanforge/sdk` couvre déjà ce besoin.
- La réécriture des modules extraits. Ils partent tels quels ; améliorer et déménager en même temps rendrait toute régression indébogable.

## Critères de succès

À 90 jours :

1. téléchargements en croissance sur le paquet ;
2. **au moins une clé API créée traçable depuis la bibliothèque** — c'est le seul critère qui prouve que le champ `enrich` fonctionne.

Si le premier progresse sans le second, c'est le mécanisme de conversion qu'il faut revoir, pas la bibliothèque.

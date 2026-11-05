# Découverte x402 : fiche de référence IBANforge

Révision du 4 novembre 2026. Le [kit général](../../SUBMISSIONS.md) fournit les
descriptions réutilisables. Cette page remplace les anciens brouillons de messages
et états de soumission ; les démarches et leurs preuves restent dans le suivi privé.
Elle n’atteste d’aucune présence sur un catalogue tiers.

## Liens techniques publics

| Objet | URL |
| --- | --- |
| Découverte x402 IBANforge | https://api.ibanforge.com/.well-known/x402 |
| Contrat des requêtes | https://api.ibanforge.com/openapi.json |
| Guide de paiement | https://ibanforge.com/docs/x402 |
| Limites d’accès | https://api.ibanforge.com/.well-known/rate-limits.yml |
| Documentation officielle de recherche Bazaar | https://docs.cdp.coinbase.com/x402/buyer/discover-services |

La documentation Coinbase décrit une découverte publique des ressources par
recherche ou pagination, sans clé CDP. Cela permet de vérifier la présence d’une
ressource ; cela ne garantit pas son indexation ni celle d’un catalogue différent.
Vérifier chaque catalogue sur sa propre interface et conserver la date de lecture.

## Description spécifique

> IBANforge exposes IBAN validation, BIC lookup and Swiss clearing data through an HTTP API with x402 payment support. The live discovery document and OpenAPI contract describe the available resources. Bank data includes provenance and coverage limits. Results do not establish account existence or ownership, do not check a beneficiary’s name and do not authorize a payment.

## Vérifier la réponse sans payer

Cette requête ne transmet ni clé ni signature de paiement :

```bash
curl --include 'https://api.ibanforge.com/v1/bic/DEUTDEFF'
```

Sans accès fourni, la réponse attendue est HTTP 402 avec les exigences de paiement.
Lire la réponse effectivement servie : un en-tête, prix, réseau, mécanisme ou adresse
anciens ne constituent pas un contrat actuel. La validation unitaire d’IBAN peut
utiliser un essai sans clé ; elle n’est donc pas une sonde fiable du refus 402.

Le paquet MCP ne possède pas de portefeuille et ne signe pas les demandes x402.
Un client de paiement distinct et autorisé est nécessaire pour payer. Recevoir un
402 ne constitue pas une permission de dépense. Ne pas créer des transactions pour
simuler de l’activité ou tenter d’influencer un catalogue.

Si un catalogue invite les propositions, utiliser sa voie actuelle et le kit
général après dédoublonnage. Aucune promesse de trafic, aucune exclusivité de
couverture et aucune relance automatique sur plusieurs canaux.

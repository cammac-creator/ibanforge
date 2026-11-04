# IBANforge — descriptions pour les annuaires et partenaires

Textes révisés le 4 novembre 2026. Ce kit décrit le produit ; il ne prouve ni une
soumission, ni une publication, ni une recommandation par une plateforme. Les
correspondances, états des démarches et mesures commerciales restent dans le suivi
privé, hors du dépôt public.

## Identité et références

| Champ | Référence |
| --- | --- |
| Nom | IBANforge |
| Site | https://ibanforge.com |
| Documentation | https://ibanforge.com/docs |
| Éditeurs et intégrateurs | https://ibanforge.com/vendors |
| Premier essai | https://ibanforge.com/docs/onboarding |
| Contrat OpenAPI | https://api.ibanforge.com/openapi.json |
| Dépôt | https://github.com/cammac-creator/ibanforge |
| Sources et limites | https://ibanforge.com/docs/data-sources |
| Tarifs actuels | https://ibanforge.com/pricing |
| Limites actuelles | https://api.ibanforge.com/.well-known/rate-limits.yml |
| Accès et fonctions servis | https://api.ibanforge.com/v1 |

Catégories possibles, selon le vocabulaire du catalogue : API, outils de
développement, données bancaires, intégration ERP. Mots-clés factuels : IBAN, BIC,
SWIFT, clearing suisse, BLZ, QR-facture, MCP. Choisir les catégories qui décrivent
l’usage proposé, sans ajouter une certification ou un partenariat non établi.

## Descriptions prêtes à reprendre

### Français

**Courte**

> API de contrôle des IBAN et de recherche BIC et clearing suisse, pour éditeurs de logiciels et intégrateurs.

**Développée**

> IBANforge aide les éditeurs et intégrateurs à contrôler des coordonnées bancaires lors de leur saisie ou de la préparation d’un import. L’API vérifie la structure et la somme de contrôle de l’IBAN, restitue les informations bancaires disponibles avec leur provenance et propose des recherches BIC et clearing suisse. Des utilitaires contrôlent les références de paiement et les données d’une QR-facture suisse. La documentation comprend des exemples et un modèle n8n pour préparer une revue de fichier fournisseurs. L’accès se fait par API HTTP ou MCP. Les résultats ne prouvent ni l’existence du compte, ni l’identité de son titulaire, ni l’acceptation d’un paiement par une banque.

### English

**Short**

> IBAN validation, BIC lookup and Swiss clearing API for software vendors and integration teams.

**Long**

> IBANforge helps software vendors and integration teams check bank details during data entry or before an import. Its API checks IBAN structure and checksum, returns available bank information with provenance, and supports BIC and Swiss clearing lookups. Utilities check payment references and Swiss QR-bill data. The documentation includes examples and an n8n template for preparing a supplier-file review. Access is available through HTTP and MCP. Results do not establish that an account exists, identify its holder or guarantee that a bank will accept a payment.

### Deutsch

**Kurz**

> API zur IBAN-Prüfung sowie zur Abfrage von BIC und Schweizer Clearingdaten für Softwareanbieter und Integratoren.

**Ausführlich**

> IBANforge unterstützt Softwareanbieter und Integratoren bei der Prüfung von Bankverbindungen während der Erfassung oder vor einem Import. Die API prüft Aufbau und Prüfsumme der IBAN, liefert verfügbare Bankinformationen mit Quellenangaben und ermöglicht BIC- und Schweizer Clearingabfragen. Weitere Funktionen prüfen Zahlungsreferenzen und Daten einer Schweizer QR-Rechnung. Die Dokumentation enthält Beispiele und eine n8n-Vorlage zur Vorbereitung der Prüfung einer Lieferantendatei. Der Zugriff erfolgt über HTTP oder MCP. Die Ergebnisse belegen weder die Existenz des Kontos noch die Identität des Kontoinhabers und garantieren keine Annahme einer Zahlung durch eine Bank.

## Choisir un parcours selon le besoin

| Besoin présenté par l’intégrateur | Ressource à donner |
| --- | --- |
| Contrôler un IBAN saisi dans un logiciel | [Premiers appels et lecture des réponses](https://ibanforge.com/docs/onboarding) |
| Préparer un import de fournisseurs ou une migration ERP | [Conserver les originaux et isoler les propositions de correction](https://ibanforge.com/blog/2026-09-02-missing-bank-details-before-an-erp-migration) |
| Ajouter un contrôle après une extraction de document | [Cas d’usage et limites](https://ibanforge.com/blog/2026-04-02-iban-validation-use-cases) |
| Automatiser une revue dans n8n | [Recettes et modèle importable](https://ibanforge.com/docs/recipes) |
| Identifier un établissement suisse par son IID | [Clearing suisse](https://ibanforge.com/docs/ch-clearing) |
| Vérifier une Bankleitzahl allemande | [Contrôle BLZ](https://ibanforge.com/docs/blz-check) |
| Connecter un client MCP | [Guide MCP](https://ibanforge.com/docs/mcp) |

Ne pas supposer qu’un logiciel manque de contrôles natifs. Une proposition de
partenariat doit partir d’un besoin public documenté ou d’une demande reçue, puis
préciser ce qu’IBANforge ajoute et ce qui reste dans le logiciel du partenaire.

## Fiche MCP : distinguer les accès

- Service distant Streamable HTTP : `https://api.ibanforge.com/mcp`.
- Carte de découverte : `https://api.ibanforge.com/.well-known/mcp/server-card.json`.
- Paquet npm : [ibanforge-mcp](https://www.npmjs.com/package/ibanforge-mcp).
- Configuration du paquet : [README du serveur MCP](mcp/README.md).

Le service distant et le paquet installé ne partagent pas le même accès anonyme :
le premier a son allocation MCP, le second appelle l’API REST. Les limites en
vigueur sont dans `rate-limits.yml`, les outils du service distant dans sa réponse
`tools/list` ; le paquet publié suit son propre cycle de version. Ne pas annoncer
un nombre d’outils ou une version sans vérifier la surface réellement référencée.

Une clé créée sans adresse commence à l’allocation `anonymous_key`. La procédure
de réclamation de la même clé est décrite dans le [guide des clés](https://ibanforge.com/docs/api-keys).
Une clé n’est pas un portefeuille. Le paquet MCP ne signe ni ne paie automatiquement
une demande x402. Un contrôle de disponibilité VoP concerne la banque : il ne
compare pas le nom du bénéficiaire avec celui du titulaire du compte.

## Avant de transmettre une fiche

1. Vérifier la fiche et les échanges déjà existants pour le domaine concerné.
   Une ancienne case « à faire » n’est pas une preuve d’absence.
2. Lire les conditions et le format de soumission du catalogue actuel. Utiliser
   uniquement une voie gratuite autorisée ; ne pas inventer de compte, de client,
   de témoignage ou de validation par la plateforme.
3. Reprendre la description adaptée au besoin et les liens ci-dessus. Si un champ
   exige un chiffre, un tarif ou une version, le relire à sa source et noter la
   date dans le suivi privé ; ne pas recycler les valeurs d’une ancienne campagne.
4. N’inclure que des captures et données fictives explicitement identifiées.
   Aucun jeton, clé, adresse de prospect ou fichier client dans une soumission.
5. Relire l’accusé après l’envoi. « Reçu », « en examen » et « publié » sont trois
   états distincts. Une publication se vérifie sur son URL publique.

Le silence ne déclenche pas de relance ni de soumission en double. Les votes,
avis, paiements artificiels et promesses d’indexation ne font pas partie de ce kit.
Pour les catalogues x402, voir la [fiche de découverte dédiée](docs/marketing/agentic-market-submission.md).

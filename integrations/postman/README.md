# Collections Postman IBANforge

## Premiers appels

Le [téléchargement proposé par la documentation](https://ibanforge.com/docs) est une
collection courte, distincte du contrat complet ci-dessous. Son URL porte une
empreinte du contenu ; l’ancienne adresse `/ibanforge-postman.json` reste disponible
comme alias contenant le même fichier.

Elle sépare les contrôles de format et la démonstration sans clé, l’essai complet
sur l’allocation REST anonyme, puis les requêtes utilisant une clé existante. Les
exemples sont fictifs. Une réponse HTTP 200 peut contenir `valid: false` : lire le
verdict, la provenance et les limites de chaque contrôle.

Importer le fichier puis commencer par le dossier « Contrôles sans clé ». Pour le
dossier « Avec votre clé », renseigner la valeur locale de `apiKey` ou un environnement
privé ; sa valeur partagée reste vide. Ne pas publier une clé ou des données clients
dans un espace public. Le lot consomme une unité par IBAN. Cette collection ne crée
pas de clé, n’envoie pas de message et n’effectue aucun achat.

Les allocations actuelles sont dans [rate-limits.yml](https://api.ibanforge.com/.well-known/rate-limits.yml).
Le [guide des clés](https://ibanforge.com/fr/docs/api-keys) explique la création et
la réclamation d’une même clé ; aucune valeur de quota ancienne n’est à déduire
d’un fichier téléchargé.

## Collection complète générée

`ibanforge.postman_collection.json` est une autre collection, produite depuis une
version antérieure du contrat OpenAPI et maintenue dans ce répertoire. Elle ne doit
pas être confondue avec le téléchargement de premiers appels. Le contrat courant
est [OpenAPI](https://api.ibanforge.com/openapi.json) ; comparer ses chemins et
schémas avant d’utiliser un ancien export.

Cette collection contient aussi des opérations de gestion de clés et de crédits :
ne pas lancer toutes ses requêtes à la suite. Sélectionner l’opération voulue et
lire sa description. Les exemples n’autorisent aucun achat ni création de compte.

Une régénération utilise [openapi-to-postman](https://github.com/postmanlabs/openapi-to-postman),
puis exige une revue de l’authentification, des variables, exemples et descriptions.
Les corrections documentaires ponctuelles doivent être conservées ou remplacées
par le texte du contrat courant. Ne jamais exporter une clé réelle.

## Présence sur un catalogue

Une collection dans ce dépôt ne signifie pas qu’une fiche existe dans le Postman
API Network. Une éventuelle publication suit les conditions et l’interface actuelles
de Postman ; son état se vérifie séparément sur l’URL publique. Le suivi des démarches
reste privé. Le kit [SUBMISSIONS.md](../../SUBMISSIONS.md) fournit les descriptions
factuelles, sans garantir l’indexation ou une recommandation de la plateforme.

# Recette du dashboard — données fictives uniquement

Depuis le dossier `frontend`, avec Node 24 et les dépendances installées :

```sh
npm run test:dashboard
```

La commande construit une copie physique temporaire du frontend, démarre une API
fictive et un serveur Next.js sur des ports locaux libres, puis parcourt le tableau
de bord avec Chromium et WebKit. Les langues française, anglaise et allemande sont
couvertes, sur des largeurs de téléphone et d’ordinateur. Aucun fichier `.env`,
profil de navigateur, compte réel ou fichier privé n’est chargé. Les requêtes du
navigateur vers l’extérieur sont bloquées et font échouer le scénario.

Les navigateurs manquants sont téléchargés par Playwright. La compilation peut
télécharger les polices publiques utilisées par le site. La recette conserve les
dépendances du projet et son dossier `.next` habituel ; sa copie, ses serveurs et
son API sont supprimés ou arrêtés à la fin, même après un échec.

Les parcours vérifient les indicateurs métier et leur état inconnu, les cartes de
réponses API (recherche, filtres, détails, toutes les lignes), les crédits distincts
des achats, les lectures indépendantes des revenus et l’actualisation volontaire.
Ils contrôlent aussi les courbes journalières et hebdomadaires : textes et zones
de toucher, clavier, redimensionnement, changement de période et tableaux. Les
traductions, erreurs JavaScript et débordements sont également vérifiés. Aucun scénario ne réalise une écriture métier : l’API fictive les
refuse toutes.

Chaque exécution possède son dossier dans `test-results/dashboard/`. Le fichier
`dernier.json` désigne le résultat courant ; `execution.json` indique le résultat
et le nettoyage, `resultats.json` contient les verdicts Playwright. Les mesures et captures des courbes sont conservées à chaque passage ; les autres
captures et les traces le sont en cas d’échec. Elles ne contiennent que des exemples
inventés. Un cas ignoré, instable ou en échec interdit un verdict réussi. La commande
complète n’accepte pas de filtre de scénarios.

Cette recette vérifie le frontend construit avec des réponses fictives. Elle ne
remplace ni les tests du backend réel, ni le contrôle de la version servie et de la
session connectée après publication. Elle n’est pas ajoutée automatiquement à la CI.

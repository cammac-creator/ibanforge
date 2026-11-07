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

Le détail des indicateurs est aussi contrôlé : quatre populations, dossier client, erreurs de connexion et réponse incohérente, reprise après actualisation, zéro constaté, pagination, adresse ancienne échappée, session absente et navigation lente. axe-core analyse les états avec comptes et indisponible ; ses rapports sont attachés à chaque exécution. Les exemples de cette recette valident le frontend ; les tests de routes API vérifient séparément le calcul réel.

Quand axe laisse le contraste d’un texte sur dégradé indéterminé, une sonde complémentaire relève les couleurs effectives, masque temporairement le remplissage des glyphes et photographie le fond dans le même repère. Elle calcule le minimum sous chaque boîte de texte, restaure le style et refuse tout changement de géométrie. Opacité de groupe, filtres, mélange, ombre et découpe non pris en charge échouent explicitement. Les mesures et captures de fond restent dans les pièces du test. Ce contrôle limité ne vaut pas certification de la page entière.

Le menu mobile et la recherche sont parcourus jusqu’au dossier : fermeture avec Échap, retour du focus, panne puis reprise, source au corps illisible signalée comme partielle, recherche et cycle du clavier dans le dialogue. La recette ne rédige ni n’envoie de message.

Les classements de Contacts, les bandes sans échange et avec réponse attendue ou non attendue sont mesurés sur leur fond réellement rendu. La recette vérifie les tailles tactiles, les états sélectionnés et l’absence de toute tentative d’écriture métier ; elle n’actionne aucun bouton de classement ou de réponse.

La sonde de contraste refuse aussi une couleur que le canvas ne sait pas lire, une transformation autre qu’une translation et un texte coupé par un conteneur. Pour un texte fixe ou collant, toute sa boîte doit être dans la fenêtre ; les pixels de fond de la capture pleine page sont comparés à ceux d’une capture de fenêtre séparée. Tout désaccord fait échouer la mesure. Les résultats incomplets d’axe doivent relever exclusivement du cas de dégradé pris en charge.

Les cas Contacts couvrent les quatre classements et les quatre présentations du bandeau : sans échange, réponse attendue, réponse non nécessaire et attente après un envoi fictif. Aucune action de classement ni envoi n’est exécuté.

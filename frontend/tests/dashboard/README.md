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

Les classements de Contacts, les bandes sans échange et avec réponse attendue ou non attendue sont mesurés sur leur fond réellement rendu. Ce premier scénario vérifie les tailles tactiles, les états sélectionnés et l’absence de toute tentative d’écriture métier ; il n’actionne aucun bouton de classement ou de réponse.

La sonde de contraste refuse aussi une couleur que le canvas ne sait pas lire, une transformation autre qu’une translation et un texte coupé par un conteneur. Pour un texte fixe ou collant, toute sa boîte doit être dans la fenêtre ; les pixels de fond de la capture pleine page sont comparés à ceux d’une capture de fenêtre séparée. Tout désaccord fait échouer la mesure. Les résultats incomplets d’axe doivent relever des cas explicites pris en charge ci-dessous.

Les cas Contacts couvrent les quatre classements et les quatre présentations du bandeau : sans échange, réponse attendue, réponse non nécessaire et attente après un envoi fictif. Aucune action de classement ni envoi n’est exécuté.

L’audit axe et le complément de contraste sont partagés par les listes de comptes et la synthèse principale. L’accueil est contrôlé avec les comptes disponibles puis avec cette source indisponible ; les autres lectures restent actives. Les rapports incomplets non pris en charge font toujours échouer la recette.

Le complément de contraste reconnaît aussi les chiffres isolés et les textes SVG opaques sans contour (couleur fill, masquage du fill et seuil conservateur de 4,5). Une date de semaine masquée par le défilement est révélée et mesurée, puis les positions des conteneurs et de la fenêtre sont restaurées et vérifiées. Le handle de mesure est libéré même si cette vérification échoue. Les flèches doivent être le caractère monochrome →, décoratif et porté par un lien déjà nommé ; elles sont également mesurées. Aucun autre résultat incomplet n’est accepté. Les contrôles SVG vérifient une couleur rouge sous le seuil de contraste, le refus de transparence, d’opacité de remplissage et de contour, avec restauration finale et retrait garanti du gel des transitions.

La vue Revenus reçoit aussi un relevé Stripe entièrement fictif : deux devises de ventes, règlements en CHF, un autre produit du compte séparé, remboursement rattaché à une vente ancienne. La recette parcourt les fenêtres 7/30/90 jours et les tableaux au clavier, puis rend la série quotidienne incohérente sans effacer les cumuls valides. Stripe reste indisponible par défaut pour les autres scénarios.

Pour le défilement natif du tableau, l’appui sur la flèche dure 100 ms : WebKit ne défile pas si l’appui et le relâchement sont simulés sans intervalle. Le focus puis le déplacement réel sont vérifiés. Les nombres seuls suivis d’un paragraphe explicatif restent reconnus comme textes courts ; nombre et explication sont tous deux mesurés.

Un scénario distinct ouvre les commandes secondaires de « Rien à répondre » avec un correspondant robot inventé. Il intercepte dans le navigateur les deux routes de classement avant Next et simule leurs réponses ; aucune action n’atteint l’API fictive, qui continue de refuser toutes les écritures. Les quatre requêtes simulées sont vérifiées exactement. Proposition, confirmation, retrait, refus local et échec sont parcourus ; textes et boutons sont mesurés, avec une fenêtre mobile de 740 px de haut. Le survol conserve le fond non sélectionné et souligne l’action.

Les confirmations de classement sont aussi testées avec des réponses HTTP 200 vides, illisibles ou sans modification : message, statut et relation doivent afficher une absence de confirmation, sans perdre la note. Une règle vérifie l’adresse et la valeur reçues ; une autre adresse ou la valeur inverse ne vaut pas confirmation. Les réponses valides et le retrait idempotent restent acceptés. Toutes ces réponses sont interceptées avant Next, leurs requêtes sont comparées aux corps attendus et l’API fictive ne reçoit aucune écriture.

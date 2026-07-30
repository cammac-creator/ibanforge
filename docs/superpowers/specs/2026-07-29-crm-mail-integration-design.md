# CRM et boîte mail : une seule surface de travail

**Date :** 29 juillet 2026
**Périmètre :** `frontend/` (atelier) et le branchement sur l'API mail du VPS Tabornio. `src/` (API Hono) n'est pas modifié, sauf le retrait progressif d'un rôle décrit au lot 2.

> **Ce dépôt est public.** Aucun nom de client, aucune adresse réelle, aucun chiffre
> commercial dans le code, les commentaires, les tests ou les messages de commit.
> Les fixtures utilisent des données inventées (`acme@example.com`, `Société Alpha`).
> Cette règle a été violée dans le passé et a coûté une réécriture d'historique le
> 29/07/2026. Elle n'est pas négociable.

---

## 1. Le problème

L'écran de travail du CRM souffre de trois défauts distincts, dont un seul avait été
nommé au départ.

**La page place le travail en dernier.** `contacts/page.tsx` empile un podium, six
cartes de chiffres et un bandeau de campagnes avant le CRM. Environ 640 pixels
passent avant la première conversation.

**Trois blocs épinglés se disputent la hauteur.** Un commentaire de `crm-app.tsx`
documente le résultat : un en-tête de 370 px et un composeur ouvert de 265 px dans un
panneau plafonné à 76 % de la hauteur d'écran laissent **zéro pixel** au fil de
discussion, sur une fenêtre ordinaire. Le bloc qui perd est le seul qui porte
l'information : ce que la personne a écrit.

**Répondre emprunte le parcours du démarchage.** Il n'existe qu'un seul chemin
d'écriture, conçu pour le courrier à froid. Répondre à une question technique
déclenche un choix d'angle, un comptage de mots contre une cible de premier contact,
une exigence de ligne de désinscription, une surveillance de plafond quotidien et une
détection de répétition. Ces cinq règles sont justes pour un inconnu et sans objet
pour quelqu'un qui vient d'écrire.

**Et deux colonnes font le même travail.** La file du jour affiche les cinq premières
des relances dues ; la liste voisine affiche un filtre « relances dues » non tronqué,
sur le même ensemble. La file du jour est un filtre déguisé en colonne. Son seul
apport propre est son tri, silence le plus long d'abord.

## 2. La forme retenue

**Une colonne à gauche, le corps principal à droite.** Deux volets, pas trois.

- **Colonne de gauche.** Filtres en texte, avec compteur, l'actif souligné. `À
  répondre` vient en premier et active automatiquement le tri par silence le plus
  long, qui reprend le seul apport réel de l'ancienne file du jour. Chaque ligne
  montre le nom, l'objet et le début du message, au lieu d'un nom et d'un nombre de
  jours.
- **Corps principal.** Objet en titre, ligne de contexte en prose (« Il attend ta
  réponse depuis hier. »), puis le fil sur toute la hauteur disponible.
- **Recherche permanente en haut**, portant sur tout le courrier et non sur les seuls
  noms de la liste filtrée.
- **L'écriture se superpose.** La zone de rédaction s'ouvre par-dessus le bas du
  volet, en conservant les derniers messages lisibles. Le fil ne perd jamais sa
  hauteur.

**Contraintes d'habillage, exprimées par le propriétaire :** aucun badge, aucune
pastille. Un état se dit en mots dans la ligne de contexte. L'urgence passe par la
couleur du texte et un filet vertical fin, jamais par une capsule.

**Hiérarchie typographique.** Le libellé se lit normalement, le nombre est un peu plus
appuyé, et la couleur d'accent est réservée à ce qui appelle une action. Un compteur
qui ne demande rien reste gris. C'est l'inverse de l'état actuel, où des nombres de
taille de titre écrasent des libellés minuscules.

**Les six cartes de chiffres et le podium quittent cette page.** Regarder et
travailler sont deux gestes ; ils vivent sur deux pages.

## 3. Deux lots, une seule spécification

Ce document couvre les deux, séquencés pour rester livrables par incréments
commitables. Le lot 1 ne dépend pas du lot 2.

### Lot 1 : l'atelier (frontend seul)

Aucune modification de l'API Hono, aucun changement de schéma. Livre la forme du §2 et
la séparation d'intention du §4.

### Lot 2 : brancher la vraie boîte

Le VPS Tabornio détient déjà une boîte mail complète en Postgres : `mail_accounts`,
`emails`, `email_attachments`. La table `emails` porte `message_id`, `imap_uid`,
`imap_folder`, `from_address`, `to_addresses`, `cc_addresses`, `body_text`,
`body_html`, `is_read`, `is_starred`, `is_archived`, `has_attachments`, `raw_headers`
et un `embedding` vectoriel. La table des pièces jointes porte `filename`,
`file_path`, `mime_type` et un `extracted_text` déjà rempli.

L'API existe : liste, détail, recherche, actions de lecture et d'archivage,
téléchargement de pièce jointe, déclenchement de synchronisation.

**Le lot 2 n'est donc pas à construire, il est à brancher.** Le CRM consomme
aujourd'hui une copie appauvrie : un script aplatit ces messages en sept colonnes et
jette le reste. Le chantier consiste à cesser d'aplatir.

## 4. Séparer répondre de démarcher

**L'intention est déduite, jamais demandée.** Si le dernier message du fil vient de
l'autre partie, c'est une réponse. Sinon c'est une prise de contact ou une relance.

Chaque règle de `guardrails.ts` déclare l'intention à laquelle elle s'applique. Les
codes ci-dessous sont ceux du code existant, pas des intentions de nommage.

| Règle | Réponse | Prospection |
|---|---|---|
| `em_dash` | **oui, bloquant** | oui, bloquant |
| `empty_body` (à créer) | **oui, bloquant** | oui, bloquant |
| `daily_cap` | non | oui, bloquant |
| `daily_high` | non | oui, avertissement |
| `length` | non | oui, avertissement |
| `no_optout` | non | oui, premier contact seulement |
| `too_many_links` | non | oui, avertissement |
| `spam_word` | non | oui, avertissement |
| `repeat_previous` | non | oui, avertissement |
| `same_subject` | non | oui, avertissement |
| Choix d'angle (interface) | non | oui |

`em_dash` s'applique aux deux parce que ce n'est pas une règle de prospection : c'est
la règle du propriétaire sur toute prose sortante, quel qu'en soit le destinataire.

Le contrôle de l'adresse d'envoi n'est pas un garde-fou : il vit dans
`sending-account.ts` et reste inchangé, actif dans les deux intentions.

En réponse, la zone est vide et prête : écrire puis envoyer. Seules subsistent les
deux règles qui protègent d'une erreur réelle.

En prospection, l'appareil actuel reste inchangé. Il est bon là où il a été conçu.

**La génération devient un outil, plus un couloir.** Un bouton « Proposer un texte »
existe et ne se met pas en travers. L'état actuel est l'inverse : demander une
génération est la voie principale et écrire soi-même est le cas de bord.

## 5. Architecture

### 5.1 Modules purs (`frontend/lib/crm/`)

Le dépôt a déjà cette discipline : des modules purs testés, consommés par des
composants d'affichage minces. Trois s'ajoutent.

| Module | Lot | Responsabilité |
|---|---|---|
| `intent.ts` | 1 | `'reply' \| 'outbound'`, déduit de la direction du dernier message du fil. |
| `threading.ts` | 2 | Chaîner des messages en fils par `message_id` et `In-Reply-To`, avec repli sur objet plus participants. Aucun accès réseau. |
| `freshness.ts` | 2 | Âge de la donnée affichée et verdict (`fresh`, `stale`, `offline`), à partir d'un horodatage fourni. |

`threading.ts` et `freshness.ts` appartiennent au lot 2 et non au lot 1 : le type
`Message` actuel ne porte pas de `message_id`, et il n'y a rien à dater tant que la
donnée ne vient pas du VPS. Les fils restent groupés par adresse pendant tout le lot 1.

`guardrails.ts` est modifié : chaque règle déclare l'intention à laquelle elle
s'applique. Les règles existantes ne changent pas de contenu, elles gagnent une portée.

### 5.2 Composants (`frontend/components/crm/`)

`composer-dock.tsx` fait 829 lignes et porte à lui seul trois parcours d'entrée, la
sélection d'angle, les garde-fous et l'envoi. C'est le signal habituel d'un fichier qui
fait trop. Il est scindé :

| Fichier | Lot | Responsabilité |
|---|---|---|
| `mail-list.tsx` | 1 | Colonne de gauche : filtres, tri, lignes à trois niveaux. Remplace `today-rail.tsx` et `contact-list.tsx`. |
| `reply-sheet.tsx` | 1 | La zone de rédaction superposée. Un seul parcours, celui de la réponse. |
| `outbound-sheet.tsx` | 1 | La rédaction de prospection : angle, garde-fous complets. Hérite du contenu actuel de `composer-dock.tsx`. |
| `mail-thread.tsx` | 2 | `thread.tsx` étendu aux pièces jointes. Renommé seulement quand il en porte, sinon le renommage n'apprend rien. |
| `freshness-line.tsx` | 2 | Ligne d'état de la donnée, visible quand elle n'est pas fraîche. |

`today-rail.tsx` est supprimé ; son tri par silence le plus long migre dans le filtre
`À répondre` de `mail-list.tsx`.

### 5.3 Flux de données

**Lot 1.** Inchangé : les cinq charges utiles admin de l'API Hono, via
`build-contacts.ts`.

**Lot 2.** Les routes proxy de `frontend/app/api/crm/` s'étendent, en suivant le motif
déjà en place (vérification de session, puis appel serveur à serveur avec un secret
qui ne quitte jamais le serveur) :

| Route | Vers le VPS | Usage |
|---|---|---|
| `GET /api/mail/threads` | `GET /emails` | Liste, filtres, pagination |
| `GET /api/mail/threads/[id]` | `GET /emails/{id}` | Fil complet |
| `POST /api/mail/search` | `POST /emails/search` | Recherche, y compris sémantique |
| `POST /api/mail/action` | `POST /emails/action` | Lu, suivi, archivé |
| `GET /api/mail/attachments/[id]` | `GET /emails/attachments/{id}/download` | Téléchargement en proxy |

**L'état de lecture est partagé.** Marquer lu depuis le CRM appelle l'action côté VPS,
donc le client mail voit la même chose. Sans cet aller-retour on obtient deux boîtes
qui divergent, ce qui est pire qu'une seule.

**La table `email_messages` d'IBANforge cesse d'être la source du contenu.** Elle
conserve le lien vers un client ou un prospect, les brouillons et la trace des envois.
Le lot 2 ne la supprime pas : elle devient la copie de secours du §6.

**Le jeton d'accès au VPS est une variable d'environnement.** Jamais dans le dépôt.

## 6. Erreurs et modes dégradés

**Principe : ne jamais mentir sur la fraîcheur.** Afficher du vieux courrier comme
frais est le seul défaut vraiment grave dans un outil censé remplacer une boîte mail.

| Panne | Comportement |
|---|---|
| VPS injoignable | Lecture seule sur la copie SQLite, bandeau indiquant l'âge de la donnée, écriture désactivée avec le motif affiché |
| Recherche indisponible | Repli sur une correspondance locale, annoncée comme partielle |
| Chaîne de fil cassée (pas d'`In-Reply-To`) | Repli sur objet plus participants. **En cas de doute, deux fils séparés plutôt qu'une fusion.** Un fil coupé se voit, un fil mélangé se croit |
| Téléchargement de pièce jointe en échec | Erreur explicite, jamais un lien mort |
| Envoi en échec | Le brouillon est conservé. Aucun texte perdu |
| Action de lecture en échec | L'affichage optimiste se rétracte visiblement |

## 7. Tests

`vitest` côté frontend, fixtures inventées, fichiers `*.test.ts` à côté du code.

**Modules purs**, testés sans réseau :

- `threading.ts` : chaînage nominal ; `In-Reply-To` absent ; deux objets distincts avec
  le même correspondant restent deux fils ; un fil dont un maillon manque ne fusionne
  pas avec un autre.
- `intent.ts` : dernier message entrant donne `reply` ; dernier message sortant donne
  `outbound` ; fil vide donne `outbound`.
- `freshness.ts` : les trois verdicts, et le refus d'une date future (une horloge
  désynchronisée ne doit pas fabriquer une fraîcheur permanente).
- `guardrails.ts` : **le test qui compte le plus.** Prouver qu'aucune règle de
  prospection ne se déclenche en intention `reply`, et que les deux règles bloquantes
  communes se déclenchent dans les deux intentions. C'est la régression qui ramènerait
  le problème d'origine sans qu'on s'en aperçoive.

**Routes proxy** : rejet sans session, propagation des codes d'erreur, absence de fuite
du secret dans une réponse.

## 8. Prérequis à vérifier avant le lot 2

Les deux adresses IBANforge doivent être enregistrées comme comptes mail sur le VPS.
Le contrôle se fait sur place via `GET /accounts`. Si elles n'y sont pas, les ajouter
est la première étape du lot 2, avant tout code côté CRM.

## 9. Hors périmètre

- Le rendu HTML riche des messages reçus. Le lot 2 affiche `body_text` ; `body_html`
  demande un assainissement qui mérite sa propre décision.
- L'accès depuis un téléphone. La forme retenue est pensée pour un écran large.
- Le courrier personnel. Seules les deux boîtes IBANforge entrent, bruit compris, sans
  règle de tri : toute règle de tri se trompe, et se tromper sur un vrai client coûte
  plus cher que voir passer une facture d'hébergeur.

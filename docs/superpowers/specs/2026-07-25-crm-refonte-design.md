# Refonte du CRM du dashboard — design

**Date :** 2026-07-25
**Portée :** `frontend/` (dépôt `ibanforge`) + un endpoint sur le VPS Tabornio (dépôt `tabornio`, lot 4 uniquement).

> Note de confidentialité : ce dépôt est public. Ce document ne cite aucun nom de contact réel,
> aucune adresse et aucun chiffre commercial. Les exemples sont fictifs.

---

## 1. Problème

Le CRM du dashboard est réparti sur deux ateliers quasi jumeaux qui ont divergé :

| | `crm-workspace.tsx` (clients) | `prospects-workspace.tsx` (prospects) |
|---|---|---|
| Taille | 630 lignes | 503 lignes |
| Liste, recherche, filtres | dupliqués | dupliqués |
| Logique de statut | `statusOf()` dans `customers/page.tsx` | `displayStatus()` dans le composant |
| Filtres | Tous / Payants / À relancer | Actifs / À mailer / Contactés / Archivés + segment |
| Compteurs sur les filtres | aucun | aucun |
| Brouillon | natif CRM (`direction='draft'`), relu dans le fil | déposé dans le dossier IMAP Brouillons de la boîte |
| Génération de relance | oui | **absente** |

`TimelineMessage` est exporté depuis `crm-workspace.tsx` et importé par `prospects-workspace.tsx` : le
composant partagé vit dans un fichier qui fait tout le reste.

Quatre frictions à l'usage, confirmées par l'utilisateur :

1. À l'ouverture, le panneau de droite est vide et rien n'indique par qui commencer.
2. Deux onglets séparés, alors que le travail quotidien ne distingue pas prospect et client — et
   qu'un contact change d'onglet en devenant client.
3. Le panneau de détail est un long rouleau vertical : pour écrire il faut dérouler jusqu'en bas,
   et le fil s'éloigne au moment où on rédige.
4. Vocabulaire et filtres incohérents entre les deux onglets, sans compteurs.

Deux défauts de fond s'ajoutent :

- **Le dépôt IMAP casse la timeline.** Un brouillon déposé dans la boîte est envoyé depuis le client
  mail, donc sans passer par `recordSent()` : le message n'apparaît pas dans le CRM tant que la
  synchro IMAP (toutes les 15 min) ne l'a pas rattrapé, et l'utilisateur doit quitter l'application.
- **Les corps de mail contiennent tout l'historique cité** (`>`, `______ From:`, `Le … a écrit :`).
  Affichés bruts, les fils longs deviennent illisibles.

## 2. Objectifs

- Un seul socle de composants, utilisé pour les deux natures de contact.
- Une seule mécanique de brouillon.
- Une relance générable sur n'importe quel contact, contrôlée avant envoi.
- Une file de travail quotidienne visible en permanence.

**Hors périmètre :** le suivi des offres commerciales datées (reporté), la refonte des cartes de
statistiques du dashboard, tout changement du schéma `email_messages` ou `prospects`.

## 3. Architecture

### 3.1 Arborescence cible

```
frontend/lib/crm/
  types.ts              Contact (union discriminée), Message, Situation, GuardrailReport
  build-contacts.ts     interroge les 4 endpoints admin → Contact[]
  situation.ts          pur — qui a la balle, silence, prochaine action
  guardrails.ts         pur — contrôles avant envoi
  quoted.ts             pur — sépare texte neuf / historique cité

frontend/components/crm/
  crm-app.tsx           assemble rail + liste + détail, porte l'état de sélection
  today-rail.tsx        file du jour, colonne permanente
  contact-list.tsx      liste + recherche + filtres à compteurs
  contact-header.tsx    identité, et la branche propre à la nature du contact
  situation-band.tsx    bandeau : qui a la balle, silence, prochaine action
  thread.tsx            bulles, citations repliées, traduction FR
  composer-dock.tsx     amarré en bas : angle → rédaction → garde-fous → envoi
  draft-card.tsx        brouillon en attente, dans le fil
```

Supprimés : `crm-workspace.tsx`, `prospects-workspace.tsx`. La bascule est complète, sans
cohabitation transitoire — deux implémentations en parallèle reproduiraient la divergence qu'on corrige.

### 3.2 Le type `Contact`

Union discriminée sur `kind`. Le tronc commun porte ce dont la liste, le fil et le composeur ont
besoin ; chaque branche porte ce qui lui est propre. Le panneau de détail affiche la branche
correspondante, donc jamais de champ vide hérité de l'autre nature.

```ts
interface ContactBase {
  id: string;                 // email normalisé en minuscules — clé de jointure des messages
  email: string;
  company: string | null;
  country: string | null;
  website: string | null;
  messages: Message[];        // triés par date croissante
  draft: Message | null;      // direction 'draft', au plus un par contact
  unread: boolean;
  account: string;            // boîte d'expédition à utiliser pour ce contact
}

type Contact =
  | (ContactBase & {
      kind: 'client';
      apiKey: ClientKeyInfo;
      usage: UsageSeries;
      sourcing?: ProspectSourcing;   // présent si ce client vient de la liste de prospection
    })
  | (ContactBase & {
      kind: 'prospect';
      sourcing: ProspectSourcing;
      readyMail: ReadyMail | null;
    });
```

Un contact présent des deux côtés (un prospect qui a créé une clé) est **un seul `Contact` de
nature `client`**, dont le champ `sourcing` optionnel conserve l'origine — le passage
prospect → client ne le fait plus disparaître d'une liste pour réapparaître dans une autre. Le
panneau de détail affiche alors les deux blocs : la clé et l'usage, plus le signal d'achat d'origine.

### 3.3 Route

Une page : `/dashboard/contacts`. `/dashboard/customers` et `/dashboard/prospects` deviennent des
redirections permanentes. Les cartes de statistiques et « Top users today » de l'ancienne page
clients remontent dans l'en-tête de la nouvelle page.

## 4. Le fil de discussion

### 4.1 Situation (`situation.ts`)

Fonction pure `situationOf(contact, today): Situation`, sans appel réseau.

| Champ | Règle |
|---|---|
| `ballInCourt` | `'us'` si le dernier message est `in`, `'them'` s'il est `out`, `'none'` si aucun message |
| `silenceDays` | jours écoulés depuis le dernier message, quel qu'en soit le sens |
| `followupDue` | dernier message `out`, aucun `in` après lui, et `silenceDays > 10` |
| `firstContactAt` | date du premier message `out` |
| `nextAction` | premier cas vrai, **dans cet ordre exact** (voir ci-dessous) |

Ordre de résolution de `nextAction`, sans recouvrement possible :

1. aucun message → `first_mail`
2. `ballInCourt === 'us'` → `reply` — il attend une réponse, c'est toujours prioritaire
3. `followupDue` → `followup` — la balle est chez lui et le silence dépasse 10 jours
4. le contact a répondu au moins une fois, balle chez lui, dans la fenêtre des 10 jours → `firm_offer`
5. sinon → `wait`

L'ordre compte : un contact qui a répondu puis s'est tu au-delà de la fenêtre relève de la relance
(cas 3), pas de l'offre (cas 4). Sans cet ordre explicite les deux cas se recouvriraient.

Les brouillons (`direction === 'draft'`) sont **exclus** de tous ces calculs : un brouillon non envoyé
ne change ni qui a la balle ni la durée du silence.

Cette fonction remplace `statusOf()` et `displayStatus()`, aujourd'hui divergentes.

### 4.2 Citations (`quoted.ts`)

`splitQuoted(body): { fresh: string; quoted: string }`, appliqué à l'affichage seulement — le corps
stocké n'est jamais modifié.

Marqueurs de coupure reconnus, au premier qui apparaît :

- une ligne commençant par `>` (et tout ce qui suit) ;
- une ligne de séparation suivie de `From:` / `De :` / `Sent:` / `Envoyé :` ;
- `Le <date>, <nom> a écrit :` et ses variantes anglaise (`On … wrote:`), allemande, finnoise.

Si aucun marqueur n'est trouvé, `quoted` est vide et tout le corps s'affiche. Si le texte neuf est
vide (réponse purement citée), on affiche l'historique plutôt qu'une bulle vide.

### 4.3 Affichage

Bulles : contact à gauche, utilisateur à droite, brouillon à droite en pointillés. L'historique cité
est replié derrière « afficher les N lignes citées ». La traduction française automatique existante
(`snippet_fr` + bascule « voir l'original ») est reprise telle quelle.

Le bandeau de situation est collé en haut de la zone de fil : qui a la balle, depuis combien de
temps, la prochaine action, et un rappel de contexte (date du premier contact, nombre de messages).

## 5. Le composeur

Amarré en bas du panneau de détail. Le fil défile au-dessus, le composeur ne bouge pas.

### 5.1 Les trois temps de la relance

1. **Angle** — `POST /api/crm/relance-angles` renvoie 2 à 3 angles courts déduits du fil. L'utilisateur
   en choisit un. Écran sauté si le contact n'a jamais été contacté (il y a déjà un mail pré-rédigé)
   ou si l'utilisateur écrit directement.
2. **Rédaction** — l'angle retenu part vers la génération existante, qui écrit dans la langue du fil.
   Résultat éditable.
3. **Contrôle puis envoi**, ou mise en brouillon.

### 5.2 Garde-fous (`guardrails.ts`)

Fonction pure `check(draft, context): GuardrailReport`, évaluée à chaque frappe.

| Contrôle | Niveau | Seuil |
|---|---|---|
| Tiret cadratin présent | bloquant | > 0 occurrence |
| Plafond quotidien atteint | bloquant | 10 mails partis aujourd'hui |
| Cadence haute | avertissement | à partir du 8ᵉ mail du jour |
| Longueur hors cible | avertissement | relance 40-90 mots ; premier mail 90-140 |
| Trop de liens | avertissement | > 1 |
| Désinscription absente | avertissement | seulement sur un premier mail à froid |
| Mot de la liste spam | avertissement | liste courte, tenue dans le module |

Un bloquant désactive le bouton d'envoi. Un bouton « forcer l'envoi » reste disponible et demande
un second clic délibéré — les blocages protègent la réputation du domaine, ils ne prennent pas la
décision à la place de l'utilisateur.

Le compteur du jour se lit dans `email_messages` : messages `out` dont `msg_date` tombe aujourd'hui.

### 5.3 Une seule mécanique de brouillon

Le dépôt IMAP est supprimé. Tout brouillon est une ligne `email_messages` de direction `draft`,
identifiée par l'email du contact, donc écrasée à chaque enregistrement (au plus un brouillon par
contact). L'envoi passe par `/api/crm/send`, qui appelle `recordSent()` : le message apparaît dans
le fil immédiatement.

## 6. La file du jour

Colonne étroite permanente, à gauche, alimentée par `situation.ts` :

- **Tu as la balle** — `ballInCourt === 'us'`, le plus ancien en tête.
- **Relances dues** — `followupDue`, les 5 premières puis « + N autres ».
- **Compteur d'envois** — mails partis aujourd'hui, face au plafond.

Elle ne se recharge pas au changement de contact. Un contact traité en sort dès le
`router.refresh()` qui suit l'envoi.

## 7. Erreurs et cas limites

| Cas | Comportement |
|---|---|
| API admin injoignable au rendu serveur | page rendue avec une bannière « données indisponibles », listes vides, aucun crash (comportement actuel conservé) |
| Génération d'angles en échec ou VPS injoignable | message d'erreur dans le composeur, rédaction libre toujours possible |
| Envoi qui échoue côté réseau | message explicite rappelant de **vérifier la timeline avant de renvoyer** — incident documenté du 03/07 où le mail partait malgré une erreur affichée |
| Contact sans adresse email | envoi désactivé, message d'explication ; on ne devine jamais une adresse |
| `msg_date` absent ou mal formé | message rangé en fin de fil, silence non calculé plutôt qu'affiché faux |
| Brouillon existant quand on en génère un nouveau | le nouveau écrase l'ancien, avec confirmation |

## 8. Tests

Le frontend n'a aujourd'hui aucun test. On ajoute **vitest** (déjà utilisé par le backend) et on
couvre les quatre modules purs, qui portent toutes les règles :

- `situation.ts` — balle, silence, relance due, prochaine action, exclusion des brouillons ;
- `guardrails.ts` — chaque contrôle, les seuils, la distinction bloquant / avertissement ;
- `quoted.ts` — chaque marqueur de citation, absence de marqueur, réponse purement citée ;
- `build-contacts.ts` — fusion clients/prospects, contact présent des deux côtés, jointure des messages.

Les composants ne sont pas testés unitairement : ils sont vérifiés à l'œil sur le déploiement.

## 9. Lots livrables

| Lot | Contenu | Dépôts |
|---|---|---|
| 1 | Socle : types, `build-contacts`, `situation`, `quoted`, page unifiée, liste à compteurs, bulles, bandeau, composeur amarré, suppression du dépôt IMAP | ibanforge |
| 2 | File du jour + compteur d'envois | ibanforge |
| 3 | Garde-fous, testés, branchés sur le composeur | ibanforge |
| 4 | Angles de relance | tabornio + ibanforge |

Chaque lot est déployable seul. Le lot 1 règle à lui seul les quatre frictions signalées.

## 10. Décisions prises

| Question | Décision |
|---|---|
| Fusionner les deux ateliers ou les garder ? | Un socle partagé, une seule page, les deux anciens composants supprimés |
| Niveau de contrôle avant envoi | Garde-fous automatiques **et** proposition d'angle |
| Mise en page du fil | Bulles + bandeau de situation |
| Navigation | File du jour permanente à gauche, plus d'onglets clients/prospects |
| Plafond quotidien | Bloquant à 10, avertissement dès 8, forçage possible en deux clics |
| Suivi des offres commerciales datées | Reporté hors de cette refonte |

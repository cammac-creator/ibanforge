# Refonte du CRM du dashboard — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les deux ateliers CRM jumeaux par un socle partagé, avec un fil de discussion lisible, un composeur amarré, une file de travail quotidienne et des garde-fous avant envoi.

**Architecture:** Quatre modules purs et testés (`quoted`, `situation`, `guardrails`, `build-contacts`) portent toutes les règles ; des composants d'affichage minces les consomment. Une seule page `/dashboard/contacts` remplace les onglets Clients et Prospects. Le brouillon devient une ligne `email_messages` de direction `draft`, unique mécanique.

**Tech Stack:** Next.js 16.2.4 (App Router), React 19.2.4, TypeScript strict, Tailwind v4 avec variables maison, next-intl (fr/en/de), vitest (à introduire côté frontend). Backend Python FastAPI sur le VPS Tabornio pour la génération.

**Spec de référence :** `docs/superpowers/specs/2026-07-25-crm-refonte-design.md`
**Maquettes validées :** `.superpowers/brainstorm/68534-1785004412/content/fil-discussion.html` (option C) et `navigation.html` (option B). Non versionnées, locales.

## Global Constraints

- **Ce dépôt est public.** Aucun nom de contact réel, aucune adresse email réelle, aucun chiffre commercial dans le code, les commentaires, les tests ou les messages de commit. Les fixtures de test utilisent des données inventées (`acme@example.com`, `Société Alpha`).
- **Next.js 16 diffère de ce que tu connais.** Avant d'écrire du code de routage, de `page.tsx`, de `route.ts` ou de composant serveur, lis le guide correspondant dans `frontend/node_modules/next/dist/docs/01-app/`. Consigne de `frontend/AGENTS.md`, elle n'est pas facultative.
- **Zéro tiret cadratin (—) dans toute prose destinée à sortir** (mails, textes d'interface). Marqueur IA. Utiliser virgule, point, deux-points ou parenthèses.
- **Langue :** code, noms de variables et commentaires en anglais. Textes d'interface en français, via next-intl quand la clé existe déjà.
- **TypeScript strict, pas de `any`** sauf cas justifié par un commentaire.
- **Commits conventionnels** (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`).
- **Deux dépôts.** `~/ibanforge` pour tout, sauf les tâches 7a et 12 qui touchent `~/tabornio`. Le déploiement Tabornio se fait par `ssh ubuntu@83.228.246.158 'cd ~/tabornio && git pull --ff-only && docker compose up -d --build'`.
- **Sessions parallèles actives sur `~/ibanforge`.** Faire `git fetch && git rebase origin/main` avant chaque push, et ne jamais `git add -A` : ajouter les fichiers un par un.
- **Ne jamais modifier** `src/` (l'API Hono) : cette refonte est entièrement frontend, sauf le VPS.

---

## Structure des fichiers

**Créés — modules purs (`frontend/lib/crm/`)**

| Fichier | Responsabilité |
|---|---|
| `types.ts` | `Contact`, `Message`, `Situation`, `GuardrailReport` et types satellites. Aucune logique. |
| `quoted.ts` | Séparer le texte neuf de l'historique cité dans un corps de mail. |
| `situation.ts` | Qui a la balle, durée du silence, relance due, prochaine action. |
| `guardrails.ts` | Contrôles avant envoi, bloquants et avertissements. |
| `build-contacts.ts` | Interroger les 4 endpoints admin et produire `Contact[]`. |

**Créés — composants (`frontend/components/crm/`)**

| Fichier | Responsabilité |
|---|---|
| `crm-app.tsx` | Assemble rail + liste + détail. Porte l'état de sélection et de lecture. |
| `today-rail.tsx` | File du jour permanente. |
| `contact-list.tsx` | Liste, recherche, filtres à compteurs. |
| `contact-header.tsx` | Identité + bloc propre à la nature du contact. |
| `situation-band.tsx` | Bandeau de situation. |
| `thread.tsx` | Bulles, citations repliées, traduction. |
| `composer-dock.tsx` | Composeur amarré : angle, rédaction, garde-fous, envoi. |
| `draft-card.tsx` | Brouillon en attente dans le fil. |

**Créés — autres**

- `frontend/vitest.config.ts`, `frontend/lib/crm/*.test.ts`
- `frontend/app/[locale]/dashboard/(protected)/contacts/page.tsx`
- `frontend/app/api/crm/relance-angles/route.ts` (lot 4)

**Modifiés**

- `frontend/package.json` — vitest + scripts
- `frontend/components/dashboard/top-nav.tsx` — un onglet « Contacts » au lieu de deux
- `frontend/messages/{fr,en,de}.json` — clé `dashboard.topNav.contacts`
- `frontend/lib/thread-unread.ts` — importer le type depuis `lib/crm/types` au lieu du composant
- `frontend/app/[locale]/dashboard/(protected)/customers/page.tsx` → redirection
- `frontend/app/[locale]/dashboard/(protected)/prospects/page.tsx` → redirection
- `~/tabornio/backend/app/api/crm.py` — drapeau `deposit` (tâche 7a), endpoint angles (tâche 12)

**Supprimés en fin de lot 1**

- `frontend/components/dashboard/crm-workspace.tsx` (630 l)
- `frontend/components/dashboard/prospects-workspace.tsx` (503 l)
- `frontend/components/dashboard/generate-mail-button.tsx` (100 l, plus référencé)
- `frontend/components/dashboard/customer-thread.tsx` (97 l, plus référencé)

---

# LOT 1 — Le socle

## Task 1 : Outillage de test et types

**Files:**
- Create: `frontend/vitest.config.ts`
- Create: `frontend/lib/crm/types.ts`
- Modify: `frontend/package.json`

**Interfaces:**
- Consumes: rien.
- Produces: `Message`, `ContactBase`, `Contact`, `ClientKeyInfo`, `UsageSeries`, `ProspectSourcing`, `ReadyMail`, `Situation`, `NextAction`, `GuardrailReport`, `GuardrailIssue`. Toutes les tâches suivantes importent depuis `@/lib/crm/types`.

- [ ] **Step 1: Installer vitest**

```bash
cd ~/ibanforge/frontend
npm install --save-dev vitest@^3
```

- [ ] **Step 2: Créer la configuration**

`frontend/vitest.config.ts` :

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    // The only modules under test are pure: no DOM environment needed.
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
});
```

- [ ] **Step 3: Ajouter les scripts**

Dans `frontend/package.json`, section `scripts`, ajouter :

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Vérifier que vitest tourne**

Run: `cd ~/ibanforge/frontend && npm test`
Expected: `No test files found` — vitest est installé et configuré, il n'a simplement rien à exécuter. C'est le résultat attendu : les vrais tests arrivent à la tâche 2.

- [ ] **Step 5: (pas de test unitaire pour les types)**

Un fichier de test qui instancie un objet et vérifie qu'un champ vaut ce qu'on vient d'y écrire n'assert rien : c'est le compilateur qui valide une union discriminée, pas vitest. La garantie vient de `npx tsc --noEmit`, lancé à l'étape 7 et à chaque tâche suivante.

- [ ] **Step 6: Écrire les types**

`frontend/lib/crm/types.ts` :

```ts
/** One row of email_messages. 'draft' rows are CRM-native drafts, never correspondence. */
export interface Message {
  id?: string;
  direction: 'in' | 'out' | 'draft';
  msg_date: string | null;
  subject: string | null;
  snippet: string | null;
  snippet_fr?: string | null;
  lang?: string | null;
  body?: string | null;
  counterparty: string | null;
}

export interface ClientKeyInfo {
  keyPrefix: string;
  paid: boolean;
  creditsTotal: number | null;
  creditsRemaining: number | null;
  monthlyLimit: number | null;
  usedAllTime: number;
  lastActiveMonth: string | null;
}

export interface UsageSeries {
  series: number[];
  months: string[];
  days: Array<{ day: string; count: number }>;
  endpoints: Array<{ path: string; count: number }>;
}

export interface ProspectSourcing {
  prospectId: string;
  segment: string | null;
  whatTheyDo: string | null;
  fitReason: string | null;
  buyingSignal: string | null;
  signalSourceUrl: string | null;
  contactName: string | null;
  contactRole: string | null;
  emailSourceUrl: string | null;
  personalizationHook: string | null;
  confidence: string | null;
  status: string;
  source: string | null;
}

export interface ReadyMail {
  subjectEn: string | null;
  bodyEn: string | null;
  subjectFr: string | null;
  bodyFr: string | null;
  recommendedLang: 'fr' | 'en';
}

export interface ContactBase {
  /** Lowercased email — the join key for messages and read state. */
  id: string;
  email: string;
  company: string | null;
  country: string | null;
  website: string | null;
  /** Correspondence only, sorted by msg_date ascending. Never contains drafts. */
  messages: Message[];
  /** At most one CRM-native draft. */
  draft: Message | null;
  unread: boolean;
  /** Mailbox to send from for this contact. */
  account: string;
}

export type Contact =
  | (ContactBase & {
      kind: 'client';
      apiKey: ClientKeyInfo;
      usage: UsageSeries;
      /** Present when this client came from the prospect list. */
      sourcing?: ProspectSourcing;
    })
  | (ContactBase & {
      kind: 'prospect';
      sourcing: ProspectSourcing;
      readyMail: ReadyMail | null;
    });

export type NextAction = 'first_mail' | 'reply' | 'followup' | 'firm_offer' | 'wait';

export interface Situation {
  ballInCourt: 'us' | 'them' | 'none';
  silenceDays: number | null;
  followupDue: boolean;
  firstContactAt: string | null;
  hasEverReplied: boolean;
  messageCount: number;
  nextAction: NextAction;
}

export interface GuardrailIssue {
  code:
    | 'em_dash'
    | 'daily_cap'
    | 'daily_high'
    | 'length'
    | 'too_many_links'
    | 'no_optout'
    | 'spam_word';
  level: 'blocking' | 'warning';
  message: string;
}

export interface GuardrailReport {
  issues: GuardrailIssue[];
  blocking: boolean;
}
```

- [ ] **Step 7: Vérifier que les types compilent**

Run: `cd ~/ibanforge/frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 8: Commit**

```bash
cd ~/ibanforge
git add frontend/vitest.config.ts frontend/lib/crm/types.ts frontend/package.json frontend/package-lock.json
git commit -m "test(crm): add vitest to the frontend and the shared CRM types"
```

---

## Task 2 : `quoted.ts` — replier l'historique cité

**Files:**
- Create: `frontend/lib/crm/quoted.ts`
- Create: `frontend/lib/crm/quoted.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `splitQuoted(body: string | null): { fresh: string; quoted: string }`. Utilisé par `thread.tsx` (tâche 5).

- [ ] **Step 1: Écrire les tests**

`frontend/lib/crm/quoted.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { splitQuoted } from './quoted';

describe('splitQuoted', () => {
  it('returns everything as fresh when there is no quote marker', () => {
    const r = splitQuoted('Bonjour,\n\nMerci pour le retour.\n\nClaude-Alain');
    expect(r.fresh).toBe('Bonjour,\n\nMerci pour le retour.\n\nClaude-Alain');
    expect(r.quoted).toBe('');
  });

  it('cuts at the first line starting with >', () => {
    const r = splitQuoted('Yes, that works.\n\n> On the previous point\n> we agreed already');
    expect(r.fresh).toBe('Yes, that works.');
    expect(r.quoted).toContain('> On the previous point');
  });

  it('cuts at an Outlook style From: block', () => {
    const body = 'Thanks, noted.\n\n________________________________\nFrom: Someone <a@example.com>\nSent: Monday\nSubject: Re: test';
    const r = splitQuoted(body);
    expect(r.fresh).toBe('Thanks, noted.');
    expect(r.quoted).toContain('From: Someone');
  });

  it('cuts at a French "a écrit :" attribution', () => {
    const r = splitQuoted('D accord.\n\nLe 10 juillet 2026, Jean a écrit :\nle texte cité');
    expect(r.fresh).toBe('D accord.');
    expect(r.quoted).toContain('a écrit :');
  });

  it('cuts at an English "wrote:" attribution', () => {
    const r = splitQuoted('Sounds good.\n\nOn 10 Jul 2026, Jean wrote:\nquoted text');
    expect(r.fresh).toBe('Sounds good.');
    expect(r.quoted).toContain('wrote:');
  });

  it('keeps the quote as fresh when the reply is purely quoted', () => {
    const r = splitQuoted('> only quoted content here');
    expect(r.fresh).toBe('> only quoted content here');
    expect(r.quoted).toBe('');
  });

  it('handles null and empty bodies', () => {
    expect(splitQuoted(null)).toEqual({ fresh: '', quoted: '' });
    expect(splitQuoted('   ')).toEqual({ fresh: '', quoted: '' });
  });

  it('does not cut on a decorative separator with no header after it', () => {
    const r = splitQuoted('Point one.\n\n--------\n\nPoint two.');
    expect(r.quoted).toBe('');
    expect(r.fresh).toContain('Point two.');
  });

  it('does not mistake ordinary prose ending in "wrote:" for an attribution', () => {
    const r = splitQuoted('Hi,\n\nOn the API design you wrote:\nplease keep v1 stable.');
    expect(r.quoted).toBe('');
    expect(r.fresh).toContain('please keep v1 stable.');
  });

  it('does not mistake ordinary prose ending in "a écrit :" for an attribution', () => {
    // The leading line matters: with the marker on line 0, the purely-quoted
    // fallback returns the whole body as `fresh` and the assertion would pass
    // against the buggy regex too. A negative fixture needs fresh text above it.
    const r = splitQuoted('Bonjour,\n\nLe rapport que Jean a écrit :\nvoir la page 4.');
    expect(r.quoted).toBe('');
    expect(r.fresh).toContain('voir la page 4.');
  });
});
```

Ces trois derniers tests ferment des trous trouvés à l'implémentation : sans eux, la garde du séparateur pouvait être supprimée sans faire rougir la suite, et une phrase ordinaire finissant par « wrote: » était repliée comme une citation.

⚠️ **Piège de conception de test, valable pour tout ce module :** un fixture négatif dont le marqueur est en première ligne ne prouve rien. Le repli « réponse purement citée » renvoie alors tout le corps en `fresh` et `quoted` est vide quelle que soit la justesse de la règle. Toujours placer une ligne de texte neuf au-dessus du marqueur.

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npx vitest run lib/crm/quoted.test.ts` depuis `frontend/`
Expected: FAIL — `Cannot find module './quoted'`

- [ ] **Step 3: Écrire l'implémentation**

`frontend/lib/crm/quoted.ts` :

```ts
/**
 * Split a mail body into the new text and the quoted history.
 *
 * Display concern only: the stored body is never modified. Real threads carry
 * the whole history inline ('>' prefixes, Outlook 'From:' blocks, localized
 * attribution lines), which makes long threads unreadable when rendered raw.
 */

/** Attribution lines: "On <date>, X wrote:", "Le <date>, X a écrit :", German, Finnish.
 *  A real attribution always carries a date or an address, so require a digit or an "@":
 *  without that guard, ordinary prose ending in "wrote:" is mistaken for a quote header. */
const ATTRIBUTION =
  /^(?=.*[\d@])\s*(On\b.*\bwrote\s*:|Le\b.*\ba écrit\s*:|Am\b.*\bschrieb\b.*:|.*\bkirjoitti\s*:)\s*$/i;

/** A separator run (underscores or dashes) that introduces a forwarded header block. */
const SEPARATOR = /^\s*[_-]{5,}\s*$/;

/** Header line that opens a quoted block, in the locales we actually receive. */
const HEADER = /^\s*(From|De|Sent|Envoyé|To|À|Subject|Objet)\s*:/i;

export function splitQuoted(body: string | null): { fresh: string; quoted: string } {
  if (!body || !body.trim()) return { fresh: '', quoted: '' };

  const lines = body.split('\n');
  let cut = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('>')) {
      cut = i;
      break;
    }
    if (ATTRIBUTION.test(line)) {
      cut = i;
      break;
    }
    // A separator only cuts when a header line follows within the next 3 lines,
    // otherwise it is just decoration in the message itself.
    if (SEPARATOR.test(line) && lines.slice(i + 1, i + 4).some((l) => HEADER.test(l))) {
      cut = i;
      break;
    }
  }

  if (cut === -1) return { fresh: body.trim(), quoted: '' };

  const fresh = lines.slice(0, cut).join('\n').trim();
  const quoted = lines.slice(cut).join('\n').trim();

  // A purely quoted reply must still show something rather than an empty bubble.
  if (!fresh) return { fresh: quoted, quoted: '' };

  return { fresh, quoted };
}
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `npx vitest run lib/crm/quoted.test.ts` depuis `frontend/`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/ibanforge
git add frontend/lib/crm/quoted.ts frontend/lib/crm/quoted.test.ts
git commit -m "feat(crm): split quoted history out of mail bodies for display"
```

---

## Task 3 : `situation.ts` — qui a la balle et quoi faire

**Files:**
- Create: `frontend/lib/crm/situation.ts`
- Create: `frontend/lib/crm/situation.test.ts`

**Interfaces:**
- Consumes: `Message`, `Situation`, `NextAction` de `@/lib/crm/types`.
- Produces: `situationOf(messages: Message[], today?: Date): Situation`. Utilisé par `build-contacts.ts` (tâche 4), `situation-band.tsx` (tâche 5), `contact-list.tsx` (tâche 6), `today-rail.tsx` (tâche 9).

**Règle d'ordre, à respecter exactement** — sans elle, `followup` et `firm_offer` se recouvrent :

1. aucun message → `first_mail`
2. `ballInCourt === 'us'` → `reply`
3. `followupDue` → `followup`
4. a déjà répondu au moins une fois, balle chez lui, dans la fenêtre → `firm_offer`
5. sinon → `wait`

- [ ] **Step 1: Écrire les tests**

`frontend/lib/crm/situation.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { situationOf } from './situation';
import type { Message } from './types';

const TODAY = new Date('2026-07-25T12:00:00Z');
const msg = (direction: Message['direction'], date: string): Message => ({
  direction,
  msg_date: date,
  subject: 's',
  snippet: null,
  counterparty: null,
});

describe('situationOf', () => {
  it('reports first_mail when there is no message', () => {
    const s = situationOf([], TODAY);
    expect(s.ballInCourt).toBe('none');
    expect(s.nextAction).toBe('first_mail');
    expect(s.silenceDays).toBeNull();
    expect(s.messageCount).toBe(0);
  });

  it('puts the ball in our court when the last message is inbound', () => {
    const s = situationOf([msg('out', '2026-07-20T10:00'), msg('in', '2026-07-21T09:00')], TODAY);
    expect(s.ballInCourt).toBe('us');
    expect(s.silenceDays).toBe(4);
    expect(s.nextAction).toBe('reply');
  });

  it('marks a followup due past 10 days of silence with no reply', () => {
    const s = situationOf([msg('out', '2026-07-01T10:00')], TODAY);
    expect(s.ballInCourt).toBe('them');
    expect(s.silenceDays).toBe(24);
    expect(s.followupDue).toBe(true);
    expect(s.nextAction).toBe('followup');
  });

  it('does not mark a followup due inside the 10 day window', () => {
    const s = situationOf([msg('out', '2026-07-20T10:00')], TODAY);
    expect(s.followupDue).toBe(false);
    expect(s.nextAction).toBe('wait');
  });

  it('prefers followup over firm_offer when a past replier went quiet', () => {
    const s = situationOf(
      [msg('out', '2026-06-20T10:00'), msg('in', '2026-06-21T10:00'), msg('out', '2026-07-05T10:00')],
      TODAY,
    );
    expect(s.hasEverReplied).toBe(true);
    expect(s.followupDue).toBe(true);
    expect(s.nextAction).toBe('followup');
  });

  it('suggests a firm offer when a replier is still inside the window', () => {
    const s = situationOf(
      [msg('out', '2026-07-18T10:00'), msg('in', '2026-07-19T10:00'), msg('out', '2026-07-20T10:00')],
      TODAY,
    );
    expect(s.hasEverReplied).toBe(true);
    expect(s.followupDue).toBe(false);
    expect(s.nextAction).toBe('firm_offer');
  });

  it('ignores drafts entirely', () => {
    const s = situationOf([msg('out', '2026-07-01T10:00'), msg('draft', '2026-07-24T10:00')], TODAY);
    expect(s.messageCount).toBe(1);
    expect(s.silenceDays).toBe(24);
    expect(s.nextAction).toBe('followup');
  });

  it('reports the first outbound date as first contact', () => {
    const s = situationOf([msg('out', '2026-07-01T10:00'), msg('in', '2026-07-02T10:00')], TODAY);
    expect(s.firstContactAt).toBe('2026-07-01T10:00');
  });

  it('does not compute silence from a malformed date', () => {
    const s = situationOf([{ ...msg('out', 'not-a-date') }], TODAY);
    expect(s.silenceDays).toBeNull();
    expect(s.followupDue).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd ~/ibanforge/frontend && npm test -- situation`
Expected: FAIL — `Cannot find module './situation'`

- [ ] **Step 3: Écrire l'implémentation**

`frontend/lib/crm/situation.ts` :

```ts
import type { Message, NextAction, Situation } from './types';

/** Days of silence after which an unanswered outbound becomes a followup. */
export const FOLLOWUP_DAYS = 10;

const DAY_MS = 86_400_000;

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Derive the state of a conversation from its messages alone. Pure: no network,
 * no clock beyond the `today` argument, so it is deterministic under test.
 *
 * Drafts are excluded from every computation: an unsent draft changes neither
 * who holds the ball nor how long the silence has run.
 */
export function situationOf(messages: Message[], today: Date = new Date()): Situation {
  const real = messages
    .filter((m) => m.direction === 'in' || m.direction === 'out')
    .slice()
    .sort((a, b) => (a.msg_date ?? '').localeCompare(b.msg_date ?? ''));

  if (real.length === 0) {
    return {
      ballInCourt: 'none',
      silenceDays: null,
      followupDue: false,
      firstContactAt: null,
      hasEverReplied: false,
      messageCount: 0,
      nextAction: 'first_mail',
    };
  }

  const last = real[real.length - 1];
  const ballInCourt: Situation['ballInCourt'] = last.direction === 'in' ? 'us' : 'them';
  const hasEverReplied = real.some((m) => m.direction === 'in');
  const firstContactAt = real.find((m) => m.direction === 'out')?.msg_date ?? null;

  const lastDate = parseDate(last.msg_date);
  const silenceDays = lastDate ? Math.floor((today.getTime() - lastDate.getTime()) / DAY_MS) : null;

  const followupDue =
    ballInCourt === 'them' && silenceDays !== null && silenceDays > FOLLOWUP_DAYS;

  // Order matters — see the plan. Without it, followup and firm_offer overlap.
  let nextAction: NextAction;
  if (ballInCourt === 'us') nextAction = 'reply';
  else if (followupDue) nextAction = 'followup';
  else if (hasEverReplied) nextAction = 'firm_offer';
  else nextAction = 'wait';

  return {
    ballInCourt,
    silenceDays,
    followupDue,
    firstContactAt,
    hasEverReplied,
    messageCount: real.length,
    nextAction,
  };
}

/** Human label for the banner and the list, in French. */
export const NEXT_ACTION_LABEL: Record<NextAction, string> = {
  first_mail: 'Premier mail à écrire',
  reply: 'Il attend ta réponse',
  followup: 'Relance due',
  firm_offer: 'Envoyer une offre ferme datée',
  wait: 'Rien à faire, en attente de sa réponse',
};
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `cd ~/ibanforge/frontend && npm test -- situation`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/ibanforge
git add frontend/lib/crm/situation.ts frontend/lib/crm/situation.test.ts
git commit -m "feat(crm): derive ball-in-court, silence and next action from a thread"
```

---

## Task 4 : `build-contacts.ts` — la source unique de données

**Files:**
- Create: `frontend/lib/crm/build-contacts.ts`
- Create: `frontend/lib/crm/build-contacts.test.ts`

**Interfaces:**
- Consumes: `Contact`, `Message`, `ProspectSourcing` de `@/lib/crm/types` ; `threadIsUnread` de `@/lib/thread-unread` ; `enrichEmail` de `@/lib/company-enrichment`.
- Produces:
  - `buildContacts(input: BuildInput): Contact[]` — fonction pure, testable.
  - `fetchCrmData(): Promise<BuildInput | null>` — l'accès réseau, non testé.
  - `INTERNAL_RE` — exporté pour réutilisation par la page.

**Règle de fusion :** une adresse qui a une clé API produit un `Contact` de nature `client`. Si cette même adresse est aussi dans la table prospects, ses données de sourcing sont attachées au client et **aucun contact de nature prospect n'est produit** pour elle.

- [ ] **Step 1: Écrire les tests**

`frontend/lib/crm/build-contacts.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { buildContacts, type BuildInput } from './build-contacts';

const base: BuildInput = {
  keys: [],
  prospects: [],
  messages: [],
  activityByKey: {},
  reads: {},
  months: ['2026-06', '2026-07'],
};

const keyRow = (email: string, over: Record<string, unknown> = {}) => ({
  key_prefix: `ifk_${email.split('@')[0]}`,
  email,
  monthly_limit: 200,
  active: 1,
  created_at: '2026-06-01 10:00:00',
  used: 0,
  used_prev: 0,
  used_all_time: 5,
  last_active_month: '2026-07',
  credits_total: null,
  credits_remaining: null,
  paid: 0,
  series: [1, 2],
  ...over,
});

const prospectRow = (id: string, email: string | null, over: Record<string, unknown> = {}) => ({
  id,
  company: `Société ${id}`,
  segment: 'editeurs',
  website: null,
  country: 'CH',
  what_they_do: null,
  fit_reason: null,
  buying_signal: null,
  signal_source_url: null,
  contact_name: null,
  contact_role: null,
  contact_email: email,
  email_source_url: null,
  personalization_hook: null,
  confidence: 'high',
  status: 'a_mailer',
  mail_subject_en: 'Hello',
  mail_body_en: 'Body',
  mail_subject_fr: null,
  mail_body_fr: null,
  recommended_lang: 'en',
  source: null,
  ...over,
});

describe('buildContacts', () => {
  it('produces one client contact per meaningful key', () => {
    const out = buildContacts({ ...base, keys: [keyRow('alpha@example.com')] });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('client');
    expect(out[0].id).toBe('alpha@example.com');
  });

  it('drops internal and test accounts', () => {
    const out = buildContacts({
      ...base,
      keys: [keyRow('someone@ibanforge.com'), keyRow('test-buyer@example.com')],
    });
    expect(out).toHaveLength(0);
  });

  it('drops a key with no usage, no payment and no mail', () => {
    const out = buildContacts({ ...base, keys: [keyRow('quiet@example.com', { used_all_time: 0 })] });
    expect(out).toHaveLength(0);
  });

  it('produces a prospect contact for a prospect with no key', () => {
    const out = buildContacts({ ...base, prospects: [prospectRow('p1', 'lead@example.com')] });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('prospect');
  });

  it('merges a prospect who became a client into a single client contact', () => {
    const out = buildContacts({
      ...base,
      keys: [keyRow('both@example.com')],
      prospects: [prospectRow('p2', 'both@example.com')],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('client');
    expect(out[0].kind === 'client' ? out[0].sourcing?.prospectId : null).toBe('p2');
  });

  it('keeps a prospect with no contact email', () => {
    const out = buildContacts({ ...base, prospects: [prospectRow('p3', null, { status: 'a_enrichir' })] });
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe('');
  });

  it('excludes rejected prospects', () => {
    const out = buildContacts({ ...base, prospects: [prospectRow('p4', 'no@example.com', { status: 'rejete' })] });
    expect(out).toHaveLength(0);
  });

  it('attaches messages by lowercased email and separates the draft', () => {
    const out = buildContacts({
      ...base,
      prospects: [prospectRow('p5', 'Lead@Example.com')],
      messages: [
        { customer_email: 'lead@example.com', direction: 'out', msg_date: '2026-07-01T10:00', subject: 'a', snippet: null, counterparty: null },
        { customer_email: 'lead@example.com', direction: 'draft', msg_date: '2026-07-20T10:00', subject: 'd', snippet: null, counterparty: null },
      ],
    });
    expect(out[0].messages).toHaveLength(1);
    expect(out[0].draft?.subject).toBe('d');
  });

  it('sorts messages by date ascending', () => {
    const out = buildContacts({
      ...base,
      prospects: [prospectRow('p6', 'lead6@example.com')],
      messages: [
        { customer_email: 'lead6@example.com', direction: 'in', msg_date: '2026-07-05T10:00', subject: 'second', snippet: null, counterparty: null },
        { customer_email: 'lead6@example.com', direction: 'out', msg_date: '2026-07-01T10:00', subject: 'first', snippet: null, counterparty: null },
      ],
    });
    expect(out[0].messages.map((m) => m.subject)).toEqual(['first', 'second']);
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd ~/ibanforge/frontend && npm test -- build-contacts`
Expected: FAIL — `Cannot find module './build-contacts'`

- [ ] **Step 3: Écrire l'implémentation**

`frontend/lib/crm/build-contacts.ts`. Reprendre `INTERNAL_RE` et la logique de « meaningful » à l'identique depuis `customers/page.tsx:41` et `:122` — c'est un déplacement, pas une réécriture, pour ne pas changer qui apparaît dans la liste.

```ts
import { enrichEmail } from '@/lib/company-enrichment';
import { threadIsUnread } from '@/lib/thread-unread';
import type { Contact, Message, ProspectSourcing, ReadyMail } from './types';

/** Mailbox used for a contact we have never emailed. */
const COLD_ACCOUNT = 'claude-alain@ibanforge.com';
/** Mailbox that carries the existing warm threads. */
const WARM_ACCOUNT = 'cammac@bluewin.ch';

/** Internal, test and founder-owned addresses never appear in the CRM. */
export const INTERNAL_RE =
  /(@ibanforge\.com|@example\.com|@test\.|test-|-test|smoke|audit|^ca-[a-z]+-?\d*@proton\.me|^credits-buyer$|^stripe-buyer$|^playground|cammac@bluewin\.ch|cam@ogens\.ch|ptibootch@|gpt-store@)/i;

export interface KeyRow {
  key_prefix: string;
  email: string;
  monthly_limit: number | null;
  active: number;
  created_at: string;
  used: number;
  used_prev: number;
  used_all_time: number;
  last_active_month: string | null;
  credits_total: number | null;
  credits_remaining: number | null;
  paid: number;
  series: number[];
}

export interface ProspectRow {
  id: string;
  company: string;
  segment: string | null;
  website: string | null;
  country: string | null;
  what_they_do: string | null;
  fit_reason: string | null;
  buying_signal: string | null;
  signal_source_url: string | null;
  contact_name: string | null;
  contact_role: string | null;
  contact_email: string | null;
  email_source_url: string | null;
  personalization_hook: string | null;
  confidence: string | null;
  status: string;
  mail_subject_en: string | null;
  mail_body_en: string | null;
  mail_subject_fr: string | null;
  mail_body_fr: string | null;
  recommended_lang: string | null;
  source: string | null;
}

export interface MessageRow extends Message {
  customer_email: string;
}

export interface ActivityRow {
  endpoints: Array<{ path: string; count: number }>;
  days: Array<{ day: string; count: number }>;
}

export interface BuildInput {
  keys: KeyRow[];
  prospects: ProspectRow[];
  messages: MessageRow[];
  activityByKey: Record<string, ActivityRow>;
  reads: Record<string, string>;
  months: string[];
}

function sourcingOf(r: ProspectRow): ProspectSourcing {
  return {
    prospectId: r.id,
    segment: r.segment,
    whatTheyDo: r.what_they_do,
    fitReason: r.fit_reason,
    buyingSignal: r.buying_signal,
    signalSourceUrl: r.signal_source_url,
    contactName: r.contact_name,
    contactRole: r.contact_role,
    emailSourceUrl: r.email_source_url,
    personalizationHook: r.personalization_hook,
    confidence: r.confidence,
    status: r.status,
    source: r.source,
  };
}

function readyMailOf(r: ProspectRow): ReadyMail | null {
  if (!r.mail_body_en && !r.mail_body_fr) return null;
  return {
    subjectEn: r.mail_subject_en,
    bodyEn: r.mail_body_en,
    subjectFr: r.mail_subject_fr,
    bodyFr: r.mail_body_fr,
    recommendedLang: r.recommended_lang === 'fr' ? 'fr' : 'en',
  };
}

/**
 * Turn the four admin payloads into one contact list. Pure so it can be tested
 * without the network; the fetching lives in fetchCrmData below.
 */
export function buildContacts(input: BuildInput): Contact[] {
  const threads = new Map<string, Message[]>();
  for (const m of input.messages) {
    const key = m.customer_email.toLowerCase();
    const arr = threads.get(key);
    if (arr) arr.push(m);
    else threads.set(key, [m]);
  }

  const split = (email: string) => {
    const all = (threads.get(email) ?? [])
      .slice()
      .sort((a, b) => (a.msg_date ?? '').localeCompare(b.msg_date ?? ''));
    return {
      messages: all.filter((m) => m.direction !== 'draft'),
      draft: all.filter((m) => m.direction === 'draft').at(-1) ?? null,
    };
  };

  const prospectByEmail = new Map<string, ProspectRow>();
  for (const p of input.prospects) {
    if (p.contact_email) prospectByEmail.set(p.contact_email.toLowerCase(), p);
  }

  const out: Contact[] = [];
  const claimed = new Set<string>();

  for (const row of input.keys) {
    if (INTERNAL_RE.test(row.email)) continue;
    const id = row.email.toLowerCase();
    const { messages, draft } = split(id);
    const isPaid = row.credits_total != null;
    // Same rule as the previous Clients page: hide keys that never did anything.
    const meaningful = isPaid || row.used_all_time > 0 || messages.length > 0 || draft != null;
    if (!meaningful) continue;

    claimed.add(id);
    const enriched = enrichEmail(row.email);
    const matching = prospectByEmail.get(id);

    out.push({
      kind: 'client',
      id,
      email: row.email,
      company: matching?.company ?? enriched.company,
      country: matching?.country ?? enriched.country,
      website: matching?.website ?? enriched.website,
      messages,
      draft,
      unread: threadIsUnread(messages, input.reads[id]),
      account: messages.length > 0 ? WARM_ACCOUNT : COLD_ACCOUNT,
      apiKey: {
        keyPrefix: row.key_prefix,
        paid: isPaid,
        creditsTotal: row.credits_total,
        creditsRemaining: row.credits_remaining,
        monthlyLimit: row.monthly_limit,
        usedAllTime: row.used_all_time,
        lastActiveMonth: row.last_active_month,
      },
      usage: {
        series: row.series ?? [],
        months: input.months,
        days: input.activityByKey[row.key_prefix]?.days ?? [],
        endpoints: input.activityByKey[row.key_prefix]?.endpoints ?? [],
      },
      ...(matching ? { sourcing: sourcingOf(matching) } : {}),
    });
  }

  for (const p of input.prospects) {
    if (p.status === 'rejete') continue;
    const id = p.contact_email ? p.contact_email.toLowerCase() : '';
    if (id && claimed.has(id)) continue; // already emitted as a client
    const { messages, draft } = id ? split(id) : { messages: [], draft: null };

    out.push({
      kind: 'prospect',
      id: id || `prospect:${p.id}`,
      email: p.contact_email ?? '',
      company: p.company,
      country: p.country,
      website: p.website,
      messages,
      draft,
      unread: id ? threadIsUnread(messages, input.reads[id]) : false,
      account: COLD_ACCOUNT,
      sourcing: sourcingOf(p),
      readyMail: readyMailOf(p),
    });
  }

  return out;
}

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

/** Fetch the four admin payloads. Returns null when the API is unreachable. */
export async function fetchCrmData(): Promise<BuildInput | null> {
  if (!ADMIN_SECRET) return null;
  const h = { headers: { 'X-Admin-Secret': ADMIN_SECRET }, cache: 'no-store' as const };
  const [k, p, m, a, tr] = await Promise.all([
    fetch(`${API_URL}/v1/admin/keys`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`${API_URL}/v1/admin/prospects`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`${API_URL}/v1/admin/email-messages`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`${API_URL}/v1/admin/client-activity`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`${API_URL}/v1/admin/thread-reads`, h).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (!k && !p) return null;
  return {
    keys: (k?.keys ?? []) as KeyRow[],
    prospects: (p?.prospects ?? []) as ProspectRow[],
    messages: (m?.messages ?? []) as MessageRow[],
    activityByKey: (a?.by_key ?? {}) as Record<string, ActivityRow>,
    reads: (tr?.reads ?? {}) as Record<string, string>,
    months: (k?.months ?? []) as string[],
  };
}
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `cd ~/ibanforge/frontend && npm test -- build-contacts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Faire pointer `thread-unread` sur les nouveaux types**

Dans `frontend/lib/thread-unread.ts`, remplacer la première ligne par :

```ts
import type { Message } from '@/lib/crm/types';
```

et la signature par `export function threadIsUnread(messages: Message[], lastReadAt?: string | null): boolean`. Le corps ne change pas. Cela coupe la dépendance vers le composant qu'on va supprimer.

- [ ] **Step 6: Vérifier que rien n'est cassé**

Run: `cd ~/ibanforge/frontend && npx tsc --noEmit && npm test`
Expected: aucune erreur, 25 tests au vert.

- [ ] **Step 7: Commit**

```bash
cd ~/ibanforge
git add frontend/lib/crm/build-contacts.ts frontend/lib/crm/build-contacts.test.ts frontend/lib/thread-unread.ts
git commit -m "feat(crm): build one contact list from keys, prospects and messages"
```

---

## Task 5 : Le fil et le bandeau de situation

**Files:**
- Create: `frontend/components/crm/situation-band.tsx`
- Create: `frontend/components/crm/thread.tsx`

**Interfaces:**
- Consumes: `Contact`, `Message`, `Situation` de `@/lib/crm/types` ; `situationOf`, `NEXT_ACTION_LABEL` de `@/lib/crm/situation` ; `splitQuoted` de `@/lib/crm/quoted`.
- Produces:
  - `<SituationBand situation={Situation} />`
  - `<Thread messages={Message[]} draftSlot?={React.ReactNode} />`

**Référence visuelle :** maquette option C, `.superpowers/brainstorm/68534-1785004412/content/fil-discussion.html`.

- [ ] **Step 1: Écrire le bandeau**

`frontend/components/crm/situation-band.tsx`. Composant serveur possible (pas d'état), donc pas de `'use client'`.

```tsx
import type { Situation } from '@/lib/crm/types';
import { NEXT_ACTION_LABEL } from '@/lib/crm/situation';

const BALL = {
  us: { label: '⚠ À TOI DE JOUER', fg: '#fca5a5', bg: '#7f1d1d33', border: '#7f1d1d' },
  them: { label: 'En attente de sa réponse', fg: '#93c5fd', bg: '#1e3a5f33', border: '#1e3a5f' },
  none: { label: 'Jamais contacté', fg: '#a1a1aa', bg: '#27272a', border: '#3f3f46' },
} as const;

export function SituationBand({ situation: s }: { situation: Situation }) {
  const b = BALL[s.ballInCourt];
  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{ backgroundColor: b.bg, borderColor: b.border }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: b.fg }}>
            {b.label}
          </span>
          {s.silenceDays !== null && (
            <span className="text-xs text-[var(--fg-2)]">
              silence depuis <strong>{s.silenceDays} j</strong>
            </span>
          )}
        </div>
        <span className="text-[10px] text-[var(--fg-4)]">
          {s.firstContactAt ? `1er contact ${s.firstContactAt.slice(0, 10)} · ` : ''}
          {s.messageCount} message{s.messageCount > 1 ? 's' : ''}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] text-amber-300">→ {NEXT_ACTION_LABEL[s.nextAction]}</p>
    </div>
  );
}
```

- [ ] **Step 2: Écrire le fil en bulles**

`frontend/components/crm/thread.tsx`. Client component : le repli des citations et la bascule de traduction sont de l'état local. Reprendre la logique de traduction de `crm-workspace.tsx:248-301` (détection `lang` valide, `snippet_fr`, bouton « voir l'original »), et l'appliquer à l'intérieur de la bulle.

```tsx
'use client';

import { useState } from 'react';
import type { Message } from '@/lib/crm/types';
import { splitQuoted } from '@/lib/crm/quoted';

const LANG_LABEL: Record<string, string> = {
  fr: 'français', en: 'anglais', de: 'allemand', it: 'italien', es: 'espagnol', pt: 'portugais',
  nl: 'néerlandais', zh: 'chinois', ru: 'russe', ar: 'arabe', ja: 'japonais', pl: 'polonais',
  sv: 'suédois', da: 'danois', no: 'norvégien', fi: 'finnois', tr: 'turc', el: 'grec', he: 'hébreu',
  cs: 'tchèque', uk: 'ukrainien', ro: 'roumain', hu: 'hongrois',
};

function Bubble({ m }: { m: Message }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  const mine = m.direction === 'out';
  const validLang = !!(m.lang && /^[a-z]{2,3}$/.test(m.lang) && m.lang !== 'und');
  const hasFr = !!(validLang && m.lang !== 'fr' && m.snippet_fr);
  const source = hasFr && !showOriginal ? (m.snippet_fr ?? '') : (m.body || m.snippet || '');
  const { fresh, quoted } = splitQuoted(source);

  return (
    <div className={mine ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={[
          'max-w-[78%] rounded-xl px-3 py-2 text-xs leading-relaxed',
          mine
            ? 'rounded-br-sm bg-amber-500/15 text-amber-100'
            : 'rounded-bl-sm bg-blue-500/15 text-blue-100',
        ].join(' ')}
      >
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-[var(--fg-4)]">
          <span className={mine ? 'text-amber-400' : 'text-blue-400'}>{mine ? 'toi' : 'lui'}</span>
          <span>{m.msg_date}</span>
          {validLang && (
            <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[9px] text-violet-300">
              🌐 {(m.lang && LANG_LABEL[m.lang]) || m.lang}
              {hasFr && !showOriginal ? ' · traduit' : ''}
            </span>
          )}
        </div>
        {m.subject && <p className="mb-0.5 font-medium text-[var(--fg-1)]">{m.subject}</p>}
        <p className="whitespace-pre-wrap">{fresh}</p>
        {quoted && (
          <>
            <button
              type="button"
              onClick={() => setShowQuoted(!showQuoted)}
              className="mt-1.5 text-[10px] text-[var(--fg-4)] hover:text-[var(--fg-2)]"
            >
              {showQuoted ? 'masquer' : `afficher les ${quoted.split('\n').length} lignes citées`}
            </button>
            {showQuoted && (
              <p className="mt-1 whitespace-pre-wrap border-l-2 border-[var(--ink-5)] pl-2 text-[10px] italic text-[var(--fg-5)]">
                {quoted}
              </p>
            )}
          </>
        )}
        {hasFr && (
          <button
            type="button"
            onClick={() => setShowOriginal(!showOriginal)}
            className="mt-1 block text-[10px] text-violet-400 hover:text-violet-300"
          >
            {showOriginal ? 'voir la traduction' : "voir l'original"}
          </button>
        )}
      </div>
    </div>
  );
}

export function Thread({ messages, draftSlot }: { messages: Message[]; draftSlot?: React.ReactNode }) {
  if (messages.length === 0 && !draftSlot) {
    return (
      <p className="py-6 text-center text-sm text-[var(--fg-5)]">
        Aucun échange pour l’instant. Le mail que tu envoies s’ajoute ici, et les réponses remontent
        automatiquement (synchro des boîtes toutes les 15 min).
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      {messages.map((m, i) => (
        <Bubble key={m.id ?? i} m={m} />
      ))}
      {draftSlot}
    </div>
  );
}
```

- [ ] **Step 3: Vérifier la compilation**

Run: `cd ~/ibanforge/frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4: Commit**

```bash
cd ~/ibanforge
git add frontend/components/crm/situation-band.tsx frontend/components/crm/thread.tsx
git commit -m "feat(crm): bubble thread with collapsed quotes and a situation banner"
```

---

## Task 6 : Liste, en-tête, page unifiée et navigation

**Files:**
- Create: `frontend/components/crm/contact-list.tsx`
- Create: `frontend/components/crm/contact-header.tsx`
- Create: `frontend/components/crm/crm-app.tsx`
- Create: `frontend/app/[locale]/dashboard/(protected)/contacts/page.tsx`
- Modify: `frontend/components/dashboard/top-nav.tsx`
- Modify: `frontend/messages/fr.json`, `en.json`, `de.json`

**Interfaces:**
- Consumes: `buildContacts`, `fetchCrmData` (tâche 4) ; `SituationBand`, `Thread` (tâche 5) ; `situationOf` (tâche 3).
- Produces:
  - `<CrmApp contacts={Contact[]} />` — la prop `sentToday` est ajoutée à la tâche 9, le composeur à la tâche 7b.
  - `<ContactList contacts={Contact[]} selectedId={string | null} onSelect={(id: string) => void} />`
  - `<ContactHeader contact={Contact} />`

**Filtres avec compteurs, vocabulaire unique** (remplace les deux jeux divergents) : `Aujourd'hui`, `Tous`, `Relances dues`, `Prospects`, `Clients`. Chacun affiche son compte.

- [ ] **Step 1: Écrire la liste**

`frontend/components/crm/contact-list.tsx`, client component. Le tri place les non-lus en tête, puis les fils où on a la balle, puis les relances dues, puis le reste. Un filtre est une fonction `(c: Contact, s: Situation) => boolean`, définie une fois et réutilisée pour le compteur et pour le filtrage — c'est ce qui garantit que le compteur ne peut pas mentir.

```tsx
'use client';

import { useMemo, useState } from 'react';
import type { Contact, Situation } from '@/lib/crm/types';
import { situationOf } from '@/lib/crm/situation';

export type FilterKey = 'today' | 'all' | 'followup' | 'prospects' | 'clients';

const FILTERS: Array<{ key: FilterKey; label: string; test: (c: Contact, s: Situation) => boolean }> = [
  { key: 'today', label: "Aujourd'hui", test: (_c, s) => s.ballInCourt === 'us' || s.followupDue },
  { key: 'all', label: 'Tous', test: () => true },
  { key: 'followup', label: 'Relances dues', test: (_c, s) => s.followupDue },
  { key: 'prospects', label: 'Prospects', test: (c) => c.kind === 'prospect' },
  { key: 'clients', label: 'Clients', test: (c) => c.kind === 'client' },
];

export function ContactList({
  contacts,
  selectedId,
  onSelect,
}: {
  contacts: Contact[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState<FilterKey>('today');
  const [q, setQ] = useState('');

  const withSituation = useMemo(
    () => contacts.map((c) => ({ c, s: situationOf(c.messages) })),
    [contacts],
  );

  const counts = useMemo(() => {
    const out = {} as Record<FilterKey, number>;
    for (const f of FILTERS) out[f.key] = withSituation.filter(({ c, s }) => f.test(c, s)).length;
    return out;
  }, [withSituation]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const f = FILTERS.find((x) => x.key === filter)!;
    return withSituation
      .filter(({ c, s }) => f.test(c, s))
      .filter(({ c }) => !term || `${c.company ?? ''} ${c.email}`.toLowerCase().includes(term))
      .sort((a, b) => {
        if (a.c.unread !== b.c.unread) return a.c.unread ? -1 : 1;
        const rank = (s: Situation) => (s.ballInCourt === 'us' ? 0 : s.followupDue ? 1 : 2);
        if (rank(a.s) !== rank(b.s)) return rank(a.s) - rank(b.s);
        return (b.s.silenceDays ?? 0) - (a.s.silenceDays ?? 0);
      });
  }, [withSituation, filter, q]);

  return (
    <div className="flex h-full flex-col rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/40">
      <div className="space-y-2 border-b border-[var(--ink-4)]/60 p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher…"
          className="w-full rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)] px-3 py-1.5 text-sm text-[var(--fg-1)] placeholder:text-[var(--fg-5)] focus:border-amber-500/40 focus:outline-none"
        />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                filter === f.key ? 'bg-amber-500/15 text-amber-400' : 'text-[var(--fg-4)] hover:text-[var(--fg-2)]'
              }`}
            >
              {f.label}
              <span className="ml-1 opacity-70">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {shown.length === 0 && <p className="p-4 text-sm text-[var(--fg-5)]">Aucun contact.</p>}
        {shown.map(({ c, s }) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className={`flex w-full flex-col gap-1 border-b border-[var(--ink-4)]/40 px-3 py-2.5 text-left transition-colors ${
              c.id === selectedId ? 'bg-[var(--ink-4)]/60' : c.unread ? 'bg-blue-500/10' : 'hover:bg-[var(--ink-4)]/30'
            }`}
          >
            <div className="flex items-center gap-2">
              {c.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
              <span className="truncate text-sm font-medium text-[var(--fg-1)]">{c.company ?? c.email}</span>
              <span className="ml-auto shrink-0 text-[9px] uppercase text-[var(--fg-5)]">
                {c.kind === 'client' ? 'client' : 'prospect'}
              </span>
            </div>
            <span className="pl-4 text-[10px] text-[var(--fg-5)]">
              {s.ballInCourt === 'us'
                ? `balle chez toi · ${s.silenceDays ?? 0} j`
                : s.followupDue
                  ? `relance due · ${s.silenceDays} j`
                  : s.nextAction === 'first_mail'
                    ? 'jamais contacté'
                    : `en attente · ${s.silenceDays ?? 0} j`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Écrire l'en-tête de contact**

`frontend/components/crm/contact-header.tsx`. Affiche l'identité, puis le bloc de la nature du contact. Un client issu de la prospection affiche **les deux** blocs. Réutilise `UsageChart` de `@/components/dashboard/usage-chart` pour la courbe client.

```tsx
import type { Contact } from '@/lib/crm/types';
import { UsageChart } from '@/components/dashboard/usage-chart';

export function ContactHeader({ contact: c }: { contact: Contact }) {
  return (
    <div className="border-b border-[var(--ink-4)]/60 pb-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-white">{c.company ?? c.email || 'Sans nom'}</h2>
            {c.website && (
              <a href={c.website} target="_blank" rel="noreferrer" className="text-xs text-amber-400 hover:underline">
                site ↗
              </a>
            )}
          </div>
          <p className="mt-0.5 text-xs text-[var(--fg-4)]">
            {c.email || 'pas d’email vérifié'}
            {c.country ? ` · ${c.country}` : ''}
          </p>
        </div>
        {c.kind === 'client' && (
          <div className="flex items-center gap-4 text-right">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[var(--fg-5)]">
                {c.apiKey.paid ? 'Crédits' : 'Quota'}
              </p>
              <p className="font-mono text-sm text-[var(--fg-2)]">
                {c.apiKey.paid
                  ? `${(c.apiKey.creditsTotal ?? 0) - (c.apiKey.creditsRemaining ?? 0)}/${c.apiKey.creditsTotal ?? 0}`
                  : `${c.apiKey.usedAllTime}/${c.apiKey.monthlyLimit ?? 200}`}
              </p>
            </div>
            <UsageChart days={c.usage.days} series={c.usage.series} months={c.usage.months} />
          </div>
        )}
      </div>

      {c.sourcing && (
        <div className="mt-3 rounded-lg border border-[var(--ok)]/20 bg-[var(--ok)]/5 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-[var(--ok)]/70">Signal d’achat</p>
          <p className="mt-0.5 text-sm text-[var(--fg-1)]">{c.sourcing.buyingSignal || '—'}</p>
          {c.sourcing.personalizationHook && (
            <p className="mt-1 text-[11px] text-[var(--fg-4)]">
              <span className="text-[var(--fg-3)]">Accroche :</span> {c.sourcing.personalizationHook}
            </p>
          )}
          {c.sourcing.signalSourceUrl && (
            <a
              href={c.sourcing.signalSourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-[11px] text-[var(--ok)] hover:underline"
            >
              preuve ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Écrire l'assemblage**

`frontend/components/crm/crm-app.tsx`, client component. Marque le fil comme lu à l'ouverture, exactement comme le faisait `crm-workspace.tsx:99-110`. La colonne de gauche du rail arrive à la tâche 9 : pour l'instant, deux colonnes.

```tsx
'use client';

import { useState } from 'react';
import type { Contact } from '@/lib/crm/types';
import { situationOf } from '@/lib/crm/situation';
import { ContactList } from './contact-list';
import { ContactHeader } from './contact-header';
import { SituationBand } from './situation-band';
import { Thread } from './thread';

export function CrmApp({ contacts }: { contacts: Contact[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readLocal, setReadLocal] = useState<Set<string>>(new Set());

  const selected = contacts.find((c) => c.id === selectedId) ?? null;

  function open(id: string) {
    setSelectedId(id);
    const c = contacts.find((x) => x.id === id);
    if (c?.unread && !readLocal.has(id) && c.email) {
      setReadLocal((prev) => new Set(prev).add(id));
      fetch('/api/crm/thread-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: c.email }),
      }).catch(() => {});
    }
  }

  const view = contacts.map((c) => (readLocal.has(c.id) ? { ...c, unread: false } : c));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
      <ContactList contacts={view} selectedId={selectedId} onSelect={open} />
      <div className="flex max-h-[76vh] flex-col rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/40 p-4">
        {!selected ? (
          <div className="flex h-64 items-center justify-center text-sm text-[var(--fg-5)]">
            Sélectionne un contact à gauche.
          </div>
        ) : (
          <>
            <ContactHeader contact={selected} />
            <div className="mt-3">
              <SituationBand situation={situationOf(selected.messages)} />
            </div>
            <div className="mt-3 flex-1 overflow-y-auto pr-1">
              <Thread messages={selected.messages} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Écrire la page**

`frontend/app/[locale]/dashboard/(protected)/contacts/page.tsx`. **Lis d'abord** `frontend/node_modules/next/dist/docs/01-app/` sur les pages et composants serveur.

```tsx
import { StatCardV2 } from '@/components/dashboard/stat-card-v2';
import { CrmApp } from '@/components/crm/crm-app';
import { buildContacts, fetchCrmData } from '@/lib/crm/build-contacts';
import { situationOf } from '@/lib/crm/situation';

export default async function ContactsPage() {
  const data = await fetchCrmData();

  if (!data) {
    return (
      <div className="rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-8 text-center">
        <p className="font-medium text-[var(--fg-2)]">Données indisponibles</p>
        <p className="mt-1 text-sm text-[var(--fg-4)]">ADMIN_SECRET non configuré, ou API injoignable.</p>
      </div>
    );
  }

  const contacts = buildContacts(data);
  const situations = contacts.map((c) => situationOf(c.messages));
  const ballWithUs = situations.filter((s) => s.ballInCourt === 'us').length;
  const followupDue = situations.filter((s) => s.followupDue).length;
  const prospects = contacts.filter((c) => c.kind === 'prospect').length;
  const clients = contacts.filter((c) => c.kind === 'client').length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-white">Contacts</h1>
        <p className="mt-1 text-sm text-[var(--fg-4)]">{contacts.length} contacts suivis</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCardV2 title="Tu as la balle" value={String(ballWithUs)} accentColor="#3b82f6" hint="Fils dont le dernier message est entrant : ils attendent ta réponse." />
        <StatCardV2 title="Relances dues" value={String(followupDue)} accentColor="#f59e0b" hint="Plus de 10 jours sans réponse depuis ton dernier mail." />
        <StatCardV2 title="Prospects" value={String(prospects)} accentColor="#22c55e" hint="Contacts sans clé API." />
        <StatCardV2 title="Clients" value={String(clients)} accentColor="#a855f7" hint="Contacts qui ont une clé API." />
      </div>

      <CrmApp contacts={contacts} />
    </div>
  );
}
```

- [ ] **Step 5: Mettre à jour la navigation et les traductions**

Dans les trois fichiers `frontend/messages/{fr,en,de}.json`, sous `dashboard.topNav`, ajouter la clé `contacts` : `"Contacts"` en fr et en, `"Kontakte"` en de. Ne pas retirer `customers` et `prospects` (d'autres textes peuvent les utiliser).

Dans `frontend/components/dashboard/top-nav.tsx`, remplacer les deux onglets par un seul :

```tsx
const onContacts = pathname.includes('/dashboard/contacts');
const onOverview = !onContacts;

const TABS = [
  { key: 'overview', href: `/${locale}/dashboard`, label: t('topNav.overview'), active: onOverview },
  { key: 'contacts', href: `/${locale}/dashboard/contacts`, label: t('topNav.contacts'), active: onContacts },
];
```

- [ ] **Step 6: Vérifier**

Run: `cd ~/ibanforge/frontend && npx tsc --noEmit && npm run lint && npm test`
Expected: aucune erreur, 25 tests au vert.

- [ ] **Step 7: Commit**

```bash
cd ~/ibanforge
git add frontend/components/crm/ frontend/app/\[locale\]/dashboard/\(protected\)/contacts/ frontend/components/dashboard/top-nav.tsx frontend/messages/
git commit -m "feat(crm): unified contacts page with counted filters and one detail panel"
```

---

## Task 7a : Rendre le dépôt IMAP optionnel (dépôt `tabornio`)

**Files:**
- Modify: `~/tabornio/backend/app/api/crm.py:37-42` (le modèle) et `:142-184` (l'endpoint)

**Interfaces:**
- Produces: `POST /api/crm/generate-draft` accepte désormais `deposit: bool = true`. Quand `deposit` vaut `false`, l'endpoint génère et renvoie sans écrire dans la boîte, et `deposited_in` vaut `null`.

**Pourquoi :** `generate_draft` appelle `_deposit()` sans condition. Tant que ce n'est pas changé, le CRM ne peut pas générer un brouillon natif sans salir aussi le dossier Brouillons de la boîte. Le défaut reste `true` : aucun appelant existant ne casse.

- [ ] **Step 1: Ajouter le champ au modèle**

Dans `GenerateDraftRequest`, après `context` :

```python
    deposit: bool = True  # False: generate only, the CRM stores its own draft
```

- [ ] **Step 2: Rendre le dépôt conditionnel**

Remplacer le bloc de dépôt de `generate_draft` par :

```python
    drafts = None
    if body.deposit:
        from_addr = f"Claude-Alain Martin <{acc.email_address}>"
        drafts = await anyio.to_thread.run_sync(
            _deposit, acc, password, body.to, subject, email_en, body.in_reply_to, from_addr
        )

    return {
        "subject": subject,
        "email_en": email_en,
        "translation_fr": translation_fr,
        "deposited_in": drafts,
        "account": body.account,
    }
```

- [ ] **Step 3: Vérifier que la génération marche encore**

Run, depuis le Mac, avec le secret lu en ligne (ne jamais l'écrire dans un fichier) :

```bash
cd ~/tabornio && python -c "import ast,sys; ast.parse(open('backend/app/api/crm.py').read()); print('syntaxe OK')"
```

Expected: `syntaxe OK`

- [ ] **Step 4: Commit et déployer**

```bash
cd ~/tabornio
git add backend/app/api/crm.py
git commit -m "feat(crm): allow generate-draft to skip the IMAP deposit"
git push
ssh ubuntu@83.228.246.158 'cd ~/tabornio && git pull --ff-only && docker compose up -d --build'
```

- [ ] **Step 5: Vérifier en live**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://tabornio.ch/api/crm/generate-draft -X POST \
  -H 'Content-Type: application/json' -d '{}'
```

Expected: `401` (pas de secret) — prouve que l'endpoint répond et que le service a redémarré.

---

## Task 7b : Le composeur amarré et le brouillon

**Files:**
- Create: `frontend/components/crm/draft-card.tsx`
- Create: `frontend/components/crm/composer-dock.tsx`
- Modify: `frontend/components/crm/crm-app.tsx`

**Interfaces:**
- Consumes: `/api/crm/send`, `/api/crm/draft-message` (POST et DELETE), `/api/crm/generate-draft` — tous existants, inchangés côté Next.
- Produces:
  - `<DraftCard contact={Contact} draft={Message} />`
  - `<ComposerDock contact={Contact} situation={Situation} />`

**Point clé :** tout appel à `/api/crm/generate-draft` passe maintenant `deposit: false`. Le résultat est enregistré via `/api/crm/draft-message`, qui crée la ligne `direction='draft'`. Plus aucun brouillon ne part dans la boîte mail.

- [ ] **Step 1: Écrire la carte de brouillon**

`frontend/components/crm/draft-card.tsx`. Reprendre `DraftCard` de `crm-workspace.tsx:334-484` à l'identique quant au comportement (envoyer, modifier, enregistrer, supprimer, `router.refresh()`), en changeant seulement le type de `client: CrmClient` vers `contact: Contact` et l'accès `c.email` → `contact.email`. Conserver le message de succès et la gestion de `busy`.

- [ ] **Step 2: Écrire le composeur**

`frontend/components/crm/composer-dock.tsx`, client component, rendu en bas du panneau et hors de la zone qui défile. Trois états : repos, aperçu généré, édition libre.

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Contact, Situation } from '@/lib/crm/types';
import { NEXT_ACTION_LABEL } from '@/lib/crm/situation';

interface GenResult {
  subject: string;
  email_en: string;
  translation_fr: string;
  account: string;
}

export function ComposerDock({ contact: c, situation: s }: { contact: Contact; situation: Situation }) {
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [fr, setFr] = useState<string | null>(null);
  const [busy, setBusy] = useState<false | 'gen' | 'send' | 'draft'>(false);
  const [msg, setMsg] = useState<string | null>(null);

  // A prospect never contacted starts from its pre-written mail.
  function loadReadyMail() {
    if (c.kind !== 'prospect' || !c.readyMail) return;
    const fr = c.readyMail.recommendedLang === 'fr';
    setSubject((fr ? c.readyMail.subjectFr : c.readyMail.subjectEn) ?? '');
    setBody((fr ? c.readyMail.bodyFr : c.readyMail.bodyEn) ?? '');
  }

  async function generate() {
    setBusy('gen');
    setMsg(null);
    const brief = [
      `Contact: ${c.company ?? c.email}`,
      c.sourcing?.whatTheyDo ? `What they do: ${c.sourcing.whatTheyDo}` : '',
      c.sourcing?.personalizationHook ? `Hook: ${c.sourcing.personalizationHook}` : '',
      `Goal: ${NEXT_ACTION_LABEL[s.nextAction]}`,
      c.messages.length
        ? `Thread so far:\n${c.messages.slice(-4).map((m) => `[${m.direction === 'in' ? 'them' : 'me'} ${m.msg_date ?? ''}] ${m.snippet ?? ''}`).join('\n')}`
        : 'No prior email: cold first touch.',
    ]
      .filter(Boolean)
      .join('\n');
    try {
      const r = await fetch('/api/crm/generate-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // deposit:false — the CRM keeps its own draft, nothing lands in the mailbox.
        body: JSON.stringify({ account: c.account, to: c.email, subject: subject || `IBANforge`, context: brief, deposit: false }),
      });
      const d = (await r.json()) as GenResult & { error?: string; message?: string };
      if (!r.ok) setMsg(d.message || d.error || 'Échec de la génération');
      else {
        setSubject(d.subject);
        setBody(d.email_en);
        setFr(d.translation_fr);
      }
    } catch {
      setMsg('Erreur réseau');
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    // One draft per contact: saving overwrites. Ask before losing the previous one.
    if (c.draft && !window.confirm('Un brouillon existe déjà pour ce contact. Le remplacer ?')) return;
    setBusy('draft');
    try {
      const r = await fetch('/api/crm/draft-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: c.email, subject, body, account: c.account }),
      });
      setMsg(r.ok ? '💾 Brouillon enregistré, il t’attend dans le fil.' : 'Échec de l’enregistrement');
      if (r.ok) router.refresh();
    } catch {
      setMsg('Erreur réseau');
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy('send');
    try {
      const r = await fetch('/api/crm/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: c.account, to: c.email, subject, body }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg(
          `${d.message || d.error || 'Échec de l’envoi'} — vérifie le fil AVANT de renvoyer : le mail a pu partir quand même.`,
        );
      } else {
        setSubject('');
        setBody('');
        setFr(null);
        setMsg('✅ Envoyé, ajouté au fil.');
        router.refresh();
      }
    } catch {
      setMsg('Erreur réseau — vérifie le fil AVANT de renvoyer.');
    } finally {
      setBusy(false);
    }
  }

  const canSend = !!c.email && !!subject.trim() && !!body.trim() && busy === false;

  return (
    <div className="mt-3 border-t border-[var(--ink-4)]/60 pt-3">
      {!c.email ? (
        <p className="text-[11px] text-amber-400/80">
          Pas d’email vérifié : envoi impossible. On ne devine jamais une adresse.
        </p>
      ) : (
        <>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Objet"
            className="mb-2 w-full rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)] px-3 py-1.5 text-sm text-[var(--fg-1)] focus:border-amber-500/40 focus:outline-none"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder="Écris, ou fais générer une relance."
            className="w-full rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)] p-3 text-xs leading-relaxed text-[var(--fg-1)] focus:border-amber-500/40 focus:outline-none"
          />
          {fr && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[10px] text-blue-400">Traduction FR (pour toi seul)</summary>
              <p className="mt-1 whitespace-pre-wrap text-[11px] text-[var(--fg-3)]">{fr}</p>
            </details>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={generate} disabled={busy !== false} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50">
              {busy === 'gen' ? '… génération' : '✍️ Générer'}
            </button>
            {c.kind === 'prospect' && c.readyMail && (
              <button type="button" onClick={loadReadyMail} className="rounded-lg border border-[var(--ink-5)] px-3 py-1.5 text-xs text-[var(--fg-2)] hover:bg-[var(--ink-4)]">
                📄 Mail pré-rédigé
              </button>
            )}
            <button type="button" onClick={saveDraft} disabled={busy !== false || !body.trim()} className="rounded-lg border border-[var(--ink-5)] px-3 py-1.5 text-xs text-[var(--fg-2)] hover:bg-[var(--ink-4)] disabled:opacity-50">
              {busy === 'draft' ? '…' : '📝 Brouillon'}
            </button>
            <button type="button" onClick={send} disabled={!canSend} className="ml-auto rounded-lg bg-green-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-green-500 disabled:opacity-50">
              {busy === 'send' ? '… envoi' : 'Envoyer'}
            </button>
          </div>
          {msg && <p className="mt-2 text-[11px] text-[var(--fg-2)]">{msg}</p>}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Brancher dans `crm-app.tsx`**

Dans le panneau de détail, sous la zone qui défile, ajouter `<ComposerDock contact={selected} situation={situationOf(selected.messages)} />`, et passer `draftSlot={selected.draft ? <DraftCard contact={selected} draft={selected.draft} /> : null}` au `<Thread/>`.

- [ ] **Step 4: Vérifier**

Run: `cd ~/ibanforge/frontend && npx tsc --noEmit && npm run lint && npm test`
Expected: aucune erreur.

- [ ] **Step 5: Commit**

```bash
cd ~/ibanforge
git add frontend/components/crm/composer-dock.tsx frontend/components/crm/draft-card.tsx frontend/components/crm/crm-app.tsx
git commit -m "feat(crm): docked composer with CRM-native drafts only, no IMAP deposit"
```

---

## Task 8 : Retirer l'ancien CRM

**Files:**
- Modify: `frontend/app/[locale]/dashboard/(protected)/customers/page.tsx` → redirection
- Modify: `frontend/app/[locale]/dashboard/(protected)/prospects/page.tsx` → redirection
- Delete: `frontend/components/dashboard/crm-workspace.tsx`, `prospects-workspace.tsx`, `generate-mail-button.tsx`, `customer-thread.tsx`

- [ ] **Step 1: Transformer les deux pages en redirections**

Contenu identique dans les deux fichiers (adapter le nom de la fonction) :

```tsx
import { redirect } from 'next/navigation';

export default async function CustomersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/dashboard/contacts`);
}
```

- [ ] **Step 2: Vérifier qu'aucun import ne subsiste**

Run:

```bash
cd ~/ibanforge/frontend && grep -rn "crm-workspace\|prospects-workspace\|generate-mail-button\|customer-thread" --include="*.tsx" --include="*.ts" app components lib
```

Expected: aucune sortie. S'il en reste, corriger avant de supprimer.

- [ ] **Step 3: Supprimer les fichiers**

```bash
cd ~/ibanforge
git rm frontend/components/dashboard/crm-workspace.tsx \
       frontend/components/dashboard/prospects-workspace.tsx \
       frontend/components/dashboard/generate-mail-button.tsx \
       frontend/components/dashboard/customer-thread.tsx
```

- [ ] **Step 4: Vérifier que tout compile et se construit**

Run: `cd ~/ibanforge/frontend && npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: build réussi.

- [ ] **Step 5: Commit et déployer**

```bash
cd ~/ibanforge
git add frontend/app/\[locale\]/dashboard/\(protected\)/customers/page.tsx frontend/app/\[locale\]/dashboard/\(protected\)/prospects/page.tsx
git commit -m "refactor(crm): drop the two legacy workspaces, redirect the old routes"
git fetch && git rebase origin/main && git push
```

⚠️ Rappel : `ibanforge.com` a un alias figé, le déploiement Vercel ne suit pas `git push`. Le dashboard vit sur le déploiement Vercel : vérifier l'URL de production après le push et promouvoir manuellement si nécessaire.

- [ ] **Step 6: Vérifier en live**

Ouvrir `/dashboard/contacts` sur le déploiement, vérifier : la liste s'affiche avec des compteurs, un clic ouvre un fil en bulles, le bandeau annonce qui a la balle, le composeur est en bas et ne bouge pas quand le fil défile.

---

# LOT 2 — La file du jour

## Task 9 : Rail permanent et compteur d'envois

**Files:**
- Create: `frontend/components/crm/today-rail.tsx`
- Modify: `frontend/components/crm/crm-app.tsx`, `frontend/app/[locale]/dashboard/(protected)/contacts/page.tsx`
- Create: `frontend/lib/crm/sent-today.ts`, `frontend/lib/crm/sent-today.test.ts`

**Interfaces:**
- Produces:
  - `countSentToday(messages: MessageRow[], today?: Date): number`
  - `<TodayRail contacts={Contact[]} sentToday={number} selectedId={string | null} onSelect={(id: string) => void} />`

- [ ] **Step 1: Écrire le test du compteur**

`frontend/lib/crm/sent-today.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { countSentToday } from './sent-today';
import type { MessageRow } from './build-contacts';

const TODAY = new Date('2026-07-25T22:00:00Z');
const row = (direction: 'in' | 'out' | 'draft', msg_date: string): MessageRow => ({
  customer_email: 'a@example.com',
  direction,
  msg_date,
  subject: null,
  snippet: null,
  counterparty: null,
});

describe('countSentToday', () => {
  it('counts only outbound messages dated today', () => {
    const n = countSentToday(
      [row('out', '2026-07-25T08:00'), row('out', '2026-07-25T20:00'), row('out', '2026-07-24T20:00'), row('in', '2026-07-25T09:00')],
      TODAY,
    );
    expect(n).toBe(2);
  });

  it('ignores drafts dated today', () => {
    expect(countSentToday([row('draft', '2026-07-25T10:00')], TODAY)).toBe(0);
  });

  it('returns zero on an empty list', () => {
    expect(countSentToday([], TODAY)).toBe(0);
  });
});
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `cd ~/ibanforge/frontend && npm test -- sent-today`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Écrire le compteur**

`frontend/lib/crm/sent-today.ts` :

```ts
import type { MessageRow } from './build-contacts';

/** Daily send cap: warn from SOFT, block at HARD. Roadmap says 5-8 a day, 10 max. */
export const SOFT_CAP = 8;
export const HARD_CAP = 10;

/** Number of real outbound mails dated today. Drafts never count. */
export function countSentToday(messages: MessageRow[], today: Date = new Date()): number {
  const day = today.toISOString().slice(0, 10);
  return messages.filter((m) => m.direction === 'out' && (m.msg_date ?? '').slice(0, 10) === day).length;
}
```

- [ ] **Step 4: Lancer pour voir passer**

Run: `cd ~/ibanforge/frontend && npm test -- sent-today`
Expected: PASS, 3 tests.

- [ ] **Step 5: Écrire le rail**

`frontend/components/crm/today-rail.tsx`. Référence visuelle : `navigation.html`, option B.

```tsx
'use client';

import { useMemo } from 'react';
import type { Contact } from '@/lib/crm/types';
import { situationOf } from '@/lib/crm/situation';
import { HARD_CAP, SOFT_CAP } from '@/lib/crm/sent-today';

const SHOWN = 5;

function Section({
  label,
  count,
  rows,
  selectedId,
  onSelect,
  tone,
}: {
  label: string;
  count: number;
  rows: Array<{ id: string; name: string; days: number | null }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  tone: string;
}) {
  if (count === 0) return null;
  return (
    <div className="mb-3">
      <p className="mb-1 flex items-center gap-1.5 text-[9px] uppercase tracking-wide text-[var(--fg-5)]">
        {label}
        <span className="rounded-full px-1.5 py-0.5 text-[8px] font-bold" style={{ backgroundColor: `${tone}26`, color: tone }}>
          {count}
        </span>
      </p>
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onSelect(r.id)}
          className={`mb-0.5 flex w-full items-center justify-between gap-1 rounded px-1.5 py-1 text-left text-[10px] transition-colors ${
            r.id === selectedId ? 'bg-[var(--ink-4)] text-white' : 'bg-[var(--ink-3)]/40 text-[var(--fg-2)] hover:bg-[var(--ink-4)]/60'
          }`}
        >
          <span className="truncate">{r.name}</span>
          {r.days !== null && (
            <span className="shrink-0 tabular-nums" style={{ color: r.days > 10 ? '#ef4444' : '#8b8b93' }}>
              {r.days} j
            </span>
          )}
        </button>
      ))}
      {count > rows.length && (
        <p className="pl-1.5 text-[9px] text-[var(--fg-5)]">+ {count - rows.length} autres</p>
      )}
    </div>
  );
}

export function TodayRail({
  contacts,
  sentToday,
  selectedId,
  onSelect,
}: {
  contacts: Contact[];
  sentToday: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { ours, due } = useMemo(() => {
    const withS = contacts.map((c) => ({ c, s: situationOf(c.messages) }));
    // Oldest silence first: the fil that has waited longest is the most at risk.
    const bySilence = (a: { s: { silenceDays: number | null } }, b: { s: { silenceDays: number | null } }) =>
      (b.s.silenceDays ?? 0) - (a.s.silenceDays ?? 0);
    return {
      ours: withS.filter(({ s }) => s.ballInCourt === 'us').sort(bySilence),
      due: withS.filter(({ s }) => s.followupDue).sort(bySilence),
    };
  }, [contacts]);

  const row = ({ c, s }: { c: Contact; s: { silenceDays: number | null } }) => ({
    id: c.id,
    name: c.company ?? c.email,
    days: s.silenceDays,
  });

  const capColor = sentToday >= HARD_CAP ? '#ef4444' : sentToday >= SOFT_CAP ? '#f59e0b' : '#8b8b93';

  return (
    <div className="rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-amber-400">Aujourd’hui</p>
      <p className="mb-2.5 text-[9px]" style={{ color: capColor }}>
        {sentToday} envoyé{sentToday > 1 ? 's' : ''} / plafond {HARD_CAP}
      </p>

      <Section label="Tu as la balle" count={ours.length} rows={ours.slice(0, SHOWN).map(row)} selectedId={selectedId} onSelect={onSelect} tone="#3b82f6" />
      <Section label="Relances dues" count={due.length} rows={due.slice(0, SHOWN).map(row)} selectedId={selectedId} onSelect={onSelect} tone="#f59e0b" />

      {ours.length === 0 && due.length === 0 && (
        <p className="py-4 text-center text-[10px] text-[var(--fg-5)]">Rien en attente. Journée propre.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Brancher**

Dans `contacts/page.tsx`, calculer `const sentToday = countSentToday(data.messages)` et le passer à `<CrmApp contacts={contacts} sentToday={sentToday} />`. Dans `crm-app.tsx`, passer la grille à `lg:grid-cols-[170px_260px_1fr]` et insérer `<TodayRail …/>` en première colonne.

- [ ] **Step 7: Vérifier et commiter**

Run: `cd ~/ibanforge/frontend && npx tsc --noEmit && npm run lint && npm test && npm run build`

```bash
cd ~/ibanforge
git add frontend/lib/crm/sent-today.ts frontend/lib/crm/sent-today.test.ts frontend/components/crm/today-rail.tsx frontend/components/crm/crm-app.tsx frontend/app/\[locale\]/dashboard/\(protected\)/contacts/page.tsx
git commit -m "feat(crm): permanent daily work rail with a send counter"
git fetch && git rebase origin/main && git push
```

---

# LOT 3 — Les garde-fous

## Task 10 : `guardrails.ts`

**Files:**
- Create: `frontend/lib/crm/guardrails.ts`
- Create: `frontend/lib/crm/guardrails.test.ts`

**Interfaces:**
- Consumes: `GuardrailIssue`, `GuardrailReport` de `@/lib/crm/types` ; `SOFT_CAP`, `HARD_CAP` de `./sent-today`.
- Produces: `checkDraft(input: CheckInput): GuardrailReport` où

```ts
interface CheckInput {
  body: string;
  sentToday: number;
  isFirstTouch: boolean; // premier mail à froid : la désinscription est exigée
}
```

- [ ] **Step 1: Écrire les tests**

`frontend/lib/crm/guardrails.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { checkDraft } from './guardrails';

const ok = 'Bonjour, une phrase courte et utile pour vous. Dites-moi si cela vous parle. Claude-Alain Martin, IBANforge, https://ibanforge.com. Répondez STOP pour ne plus recevoir de message.';

const codes = (r: ReturnType<typeof checkDraft>) => r.issues.map((i) => i.code);

describe('checkDraft', () => {
  it('accepts a clean followup', () => {
    const r = checkDraft({ body: 'Une relance courte et polie, sans lien ni fioriture, qui pose une seule question claire.', sentToday: 2, isFirstTouch: false });
    expect(r.blocking).toBe(false);
    expect(codes(r)).not.toContain('em_dash');
  });

  it('blocks on an em dash', () => {
    const r = checkDraft({ body: 'Bonjour — voici la suite.', sentToday: 0, isFirstTouch: false });
    expect(r.blocking).toBe(true);
    expect(codes(r)).toContain('em_dash');
  });

  it('blocks at the hard daily cap', () => {
    const r = checkDraft({ body: 'Une relance courte et polie qui pose une question.', sentToday: 10, isFirstTouch: false });
    expect(r.blocking).toBe(true);
    expect(codes(r)).toContain('daily_cap');
  });

  it('warns but does not block from the soft cap', () => {
    const r = checkDraft({ body: 'Une relance courte et polie qui pose une question.', sentToday: 8, isFirstTouch: false });
    expect(r.blocking).toBe(false);
    expect(codes(r)).toContain('daily_high');
  });

  it('warns when a followup runs long', () => {
    const r = checkDraft({ body: 'mot '.repeat(120), sentToday: 0, isFirstTouch: false });
    expect(codes(r)).toContain('length');
    expect(r.blocking).toBe(false);
  });

  it('uses the first-touch length window on a cold mail', () => {
    const r = checkDraft({ body: `${'mot '.repeat(110)} https://ibanforge.com se désinscrire`, sentToday: 0, isFirstTouch: true });
    expect(codes(r)).not.toContain('length');
  });

  it('warns on more than one link', () => {
    const r = checkDraft({ body: 'Voir https://a.example.com et https://b.example.com pour la suite du dossier.', sentToday: 0, isFirstTouch: false });
    expect(codes(r)).toContain('too_many_links');
  });

  it('warns when a cold mail has no opt-out', () => {
    const r = checkDraft({ body: `${'mot '.repeat(100)}`, sentToday: 0, isFirstTouch: true });
    expect(codes(r)).toContain('no_optout');
  });

  it('does not require an opt-out on a followup', () => {
    const r = checkDraft({ body: 'Une relance courte et polie qui pose une question.', sentToday: 0, isFirstTouch: false });
    expect(codes(r)).not.toContain('no_optout');
  });

  it('warns on a spam word', () => {
    const r = checkDraft({ body: 'Offre gratuite garantie sans engagement, cliquez vite pour en profiter maintenant.', sentToday: 0, isFirstTouch: false });
    expect(codes(r)).toContain('spam_word');
  });

  it('accepts the clean cold template', () => {
    const r = checkDraft({ body: ok, sentToday: 0, isFirstTouch: true });
    expect(r.blocking).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `cd ~/ibanforge/frontend && npm test -- guardrails`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Écrire l'implémentation**

`frontend/lib/crm/guardrails.ts` :

```ts
import type { GuardrailIssue, GuardrailReport } from './types';
import { HARD_CAP, SOFT_CAP } from './sent-today';

export interface CheckInput {
  body: string;
  sentToday: number;
  /** A cold first touch: stricter length window, opt-out required. */
  isFirstTouch: boolean;
}

const FOLLOWUP_WORDS = { min: 40, max: 90 };
const FIRST_TOUCH_WORDS = { min: 90, max: 140 };

/** Short list, deliberately: a long list produces noise and gets ignored. */
const SPAM_WORDS = [
  'gratuit', 'garanti', 'sans engagement', 'cliquez', 'offre exceptionnelle',
  'free trial', 'guaranteed', 'act now', 'limited time', 'click here',
];

const OPTOUT_HINTS = ['désinscri', 'desinscri', 'ne plus recevoir', 'opt out', 'opt-out', 'unsubscribe', 'stop'];

const LINK_RE = /https?:\/\/\S+/g;

/**
 * Pre-send checks. Blocking issues disable the send button; the UI still offers
 * an explicit two-click override, because these protect the domain reputation
 * without taking the decision away from the operator.
 */
export function checkDraft({ body, sentToday, isFirstTouch }: CheckInput): GuardrailReport {
  const issues: GuardrailIssue[] = [];
  const lower = body.toLowerCase();

  if (body.includes('—')) {
    issues.push({
      code: 'em_dash',
      level: 'blocking',
      message: 'Tiret cadratin détecté. C’est un marqueur IA : remplace-le par une virgule, un point ou des parenthèses.',
    });
  }

  if (sentToday >= HARD_CAP) {
    issues.push({
      code: 'daily_cap',
      level: 'blocking',
      message: `Plafond du jour atteint (${sentToday}/${HARD_CAP}). Au-delà, tu joues la réputation du domaine.`,
    });
  } else if (sentToday >= SOFT_CAP) {
    issues.push({
      code: 'daily_high',
      level: 'warning',
      message: `${sentToday} mails déjà partis aujourd’hui. La cadence visée est de 5 à 8.`,
    });
  }

  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  const window = isFirstTouch ? FIRST_TOUCH_WORDS : FOLLOWUP_WORDS;
  if (words > 0 && (words < window.min || words > window.max)) {
    issues.push({
      code: 'length',
      level: 'warning',
      message: `${words} mots. La cible ${isFirstTouch ? 'pour un premier mail' : 'pour une relance'} est ${window.min}-${window.max}.`,
    });
  }

  const links = body.match(LINK_RE) ?? [];
  if (links.length > 1) {
    issues.push({
      code: 'too_many_links',
      level: 'warning',
      message: `${links.length} liens. Un seul suffit, au-delà le filtre anti-spam se méfie.`,
    });
  }

  if (isFirstTouch && !OPTOUT_HINTS.some((h) => lower.includes(h))) {
    issues.push({
      code: 'no_optout',
      level: 'warning',
      message: 'Pas de sortie proposée. Un premier mail à froid doit offrir de ne plus être contacté.',
    });
  }

  const hit = SPAM_WORDS.find((w) => lower.includes(w));
  if (hit) {
    issues.push({ code: 'spam_word', level: 'warning', message: `Mot à risque : « ${hit} ».` });
  }

  return { issues, blocking: issues.some((i) => i.level === 'blocking') };
}
```

- [ ] **Step 4: Lancer pour voir passer**

Run: `cd ~/ibanforge/frontend && npm test -- guardrails`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/ibanforge
git add frontend/lib/crm/guardrails.ts frontend/lib/crm/guardrails.test.ts
git commit -m "feat(crm): pre-send guardrails, blocking on em dashes and the daily cap"
```

---

## Task 11 : Brancher les garde-fous sur le composeur

**Files:**
- Modify: `frontend/components/crm/composer-dock.tsx`, `frontend/components/crm/crm-app.tsx`

- [ ] **Step 1: Passer `sentToday` jusqu'au composeur**

`crm-app.tsx` reçoit déjà `sentToday` (tâche 9) : le transmettre à `<ComposerDock sentToday={sentToday} />`.

- [ ] **Step 2: Évaluer et afficher**

Dans `composer-dock.tsx`, ajouter la prop `sentToday: number`, puis :

```tsx
const report = checkDraft({
  body,
  sentToday,
  isFirstTouch: s.nextAction === 'first_mail',
});
const [forced, setForced] = useState(false);
const canSend = !!c.email && !!subject.trim() && !!body.trim() && busy === false && (!report.blocking || forced);
```

Sous le textarea, la liste des contrôles :

```tsx
{report.issues.length > 0 && (
  <ul className="mt-1.5 space-y-0.5">
    {report.issues.map((i) => (
      <li key={i.code} className={`text-[10px] ${i.level === 'blocking' ? 'text-red-400' : 'text-amber-400/90'}`}>
        {i.level === 'blocking' ? '🔴' : '🟠'} {i.message}
      </li>
    ))}
  </ul>
)}
{report.blocking && !forced && (
  <button type="button" onClick={() => setForced(true)} className="mt-1 text-[10px] text-[var(--fg-5)] underline hover:text-[var(--fg-3)]">
    forcer l’envoi malgré le blocage
  </button>
)}
```

Remettre `forced` à `false` après un envoi réussi et à chaque changement de contact (utiliser `key={selected.id}` sur `<ComposerDock/>` dans `crm-app.tsx` pour que l'état se réinitialise tout seul).

- [ ] **Step 3: Vérifier et commiter**

Run: `cd ~/ibanforge/frontend && npx tsc --noEmit && npm run lint && npm test && npm run build`

```bash
cd ~/ibanforge
git add frontend/components/crm/composer-dock.tsx frontend/components/crm/crm-app.tsx
git commit -m "feat(crm): wire the guardrails into the composer with a deliberate override"
git fetch && git rebase origin/main && git push
```

- [ ] **Step 4: Vérifier en live**

Coller un tiret cadratin dans le composeur : le bouton doit se désactiver et le lien de forçage apparaître.

---

# LOT 4 — Les angles de relance

## Task 12 : Endpoint d'angles (dépôt `tabornio`)

**Files:**
- Modify: `~/tabornio/backend/app/api/crm.py`

**Interfaces:**
- Produces: `POST /api/crm/relance-angles`, en-tête `X-CRM-Secret`.
  - Corps : `{ "thread": "...", "contact": "..." }`
  - Réponse : `{ "angles": [{ "key": "...", "title": "...", "hint": "..." }] }`, 2 à 3 entrées.

- [ ] **Step 1: Ajouter le modèle et l'endpoint**

À la suite de `generate_draft` dans `crm.py` :

```python
class RelanceAnglesRequest(BaseModel):
    contact: str   # who they are, in one line
    thread: str    # the last few messages, compacted


_ANGLES_SYSTEM = (
    "You advise Claude-Alain Martin, solo founder of IBANforge (a Swiss IBAN/BIC "
    "validation and payment-compliance API), on how to follow up a prospect who "
    "has gone quiet. Propose 2 or 3 DIFFERENT angles for a SHORT follow-up (2 "
    "sentences). One of them must always be a graceful exit that lets the "
    "prospect close the thread. Never use an em dash. Answer in French. "
    'Return STRICT JSON only: {"angles": [{"key": "slug", "title": "5 words max", '
    '"hint": "one sentence on what the mail would say"}]}'
)


@router.post("/relance-angles")
async def relance_angles(
    body: RelanceAnglesRequest,
    x_crm_secret: str | None = Header(default=None),
):
    if not settings.CRM_DRAFT_SECRET or x_crm_secret != settings.CRM_DRAFT_SECRET:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unauthorized")
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "anthropic key not configured")

    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    resp = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=700,
        system=_ANGLES_SYSTEM,
        messages=[{"role": "user", "content": f"Contact: {body.contact}\n\nThread:\n{body.thread}"}],
    )
    raw = resp.content[0].text.strip()
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "angles returned no JSON")
    data = json.loads(raw[start : end + 1])
    angles = [
        {
            "key": str(a.get("key") or "")[:40],
            "title": _strip_em_dashes(str(a.get("title") or ""))[:60],
            "hint": _strip_em_dashes(str(a.get("hint") or ""))[:200],
        }
        for a in (data.get("angles") or [])[:3]
        if a.get("title")
    ]
    if not angles:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "no usable angle")
    return {"angles": angles}
```

- [ ] **Step 2: Vérifier la syntaxe**

Run: `cd ~/tabornio && python -c "import ast; ast.parse(open('backend/app/api/crm.py').read()); print('syntaxe OK')"`
Expected: `syntaxe OK`

- [ ] **Step 3: Commit et déployer**

```bash
cd ~/tabornio
git add backend/app/api/crm.py
git commit -m "feat(crm): propose follow-up angles from a thread"
git push
ssh ubuntu@83.228.246.158 'cd ~/tabornio && git pull --ff-only && docker compose up -d --build'
```

- [ ] **Step 4: Vérifier en live**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://tabornio.ch/api/crm/relance-angles \
  -H 'Content-Type: application/json' -d '{"contact":"x","thread":"y"}'
```

Expected: `401`.

---

## Task 13 : Choix de l'angle dans le composeur

**Files:**
- Create: `frontend/app/api/crm/relance-angles/route.ts`
- Modify: `frontend/components/crm/composer-dock.tsx`

- [ ] **Step 1: Écrire le proxy**

`frontend/app/api/crm/relance-angles/route.ts` — copie exacte de la structure de `generate-draft/route.ts`, seule l'URL amont change :

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

const TABORNIO_URL = process.env.TABORNIO_CRM_URL || 'https://tabornio.ch';
const SECRET = process.env.CRM_DRAFT_SECRET || '';

/** Authenticated proxy: ask the VPS for 2-3 follow-up angles. Keeps the secret server-side. */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!SECRET) {
    return NextResponse.json({ error: 'not_configured', message: 'CRM_DRAFT_SECRET manquant côté serveur' }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  try {
    const r = await fetch(`${TABORNIO_URL}/api/crm/relance-angles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CRM-Secret': SECRET },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await r.json().catch(() => ({ error: 'bad_upstream_response' }));
    return NextResponse.json(data, { status: r.status });
  } catch {
    return NextResponse.json({ error: 'upstream_failed', message: 'Endpoint VPS injoignable' }, { status: 502 });
  }
}
```

- [ ] **Step 2: Ajouter l'étape d'angle**

Dans `composer-dock.tsx`, `generate()` prend un argument optionnel et un nouveau bouton passe d'abord par les angles quand une relance est due.

```tsx
interface Angle {
  key: string;
  title: string;
  hint: string;
}

const [angles, setAngles] = useState<Angle[] | null>(null);

async function askAngles() {
  setBusy('angles');
  setMsg(null);
  try {
    const r = await fetch('/api/crm/relance-angles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact: `${c.company ?? c.email}${c.sourcing?.whatTheyDo ? `, ${c.sourcing.whatTheyDo}` : ''}`,
        thread: c.messages
          .slice(-4)
          .map((m) => `[${m.direction === 'in' ? 'them' : 'me'} ${m.msg_date ?? ''}] ${m.snippet ?? ''}`)
          .join('\n'),
      }),
    });
    const d = await r.json();
    if (!r.ok) setMsg(`${d.message || d.error || 'Angles indisponibles'}. Tu peux générer sans angle.`);
    else setAngles(d.angles as Angle[]);
  } catch {
    setMsg('Erreur réseau. Tu peux générer sans angle.');
  } finally {
    setBusy(false);
  }
}
```

`generate()` accepte maintenant l'angle et l'ajoute au brief. Modifier sa signature et la construction du brief :

```tsx
async function generate(angle?: Angle) {
  setBusy('gen');
  setMsg(null);
  setAngles(null);
  const brief = [
    `Contact: ${c.company ?? c.email}`,
    c.sourcing?.whatTheyDo ? `What they do: ${c.sourcing.whatTheyDo}` : '',
    c.sourcing?.personalizationHook ? `Hook: ${c.sourcing.personalizationHook}` : '',
    `Goal: ${NEXT_ACTION_LABEL[s.nextAction]}`,
    // Internal brief, never sent: the angle is passed verbatim to steer the draft.
    angle ? `Angle to take: ${angle.title}. ${angle.hint}` : '',
    angle ? 'This is a FOLLOW-UP: at most 2 sentences, one new angle, no recap of the previous mail.' : '',
    c.messages.length
      ? `Thread so far:\n${c.messages.slice(-4).map((m) => `[${m.direction === 'in' ? 'them' : 'me'} ${m.msg_date ?? ''}] ${m.snippet ?? ''}`).join('\n')}`
      : 'No prior email: cold first touch.',
  ]
    .filter(Boolean)
    .join('\n');
  // …le reste de la fonction ne change pas
}
```

Au-dessus du textarea, la liste des angles quand elle existe :

```tsx
{angles && (
  <div className="mb-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2">
    <p className="mb-1.5 text-[10px] uppercase tracking-wide text-amber-400/80">Quel angle ?</p>
    {angles.map((a) => (
      <button
        key={a.key}
        type="button"
        onClick={() => generate(a)}
        className="mb-1 block w-full rounded-md px-2 py-1.5 text-left text-[11px] text-[var(--fg-2)] transition-colors hover:bg-amber-500/10"
      >
        <span className="font-semibold text-amber-300">{a.title}</span>
        <span className="block text-[10px] text-[var(--fg-4)]">{a.hint}</span>
      </button>
    ))}
    <button type="button" onClick={() => setAngles(null)} className="text-[10px] text-[var(--fg-5)] hover:text-[var(--fg-3)]">
      annuler
    </button>
  </div>
)}
```

Enfin, le bouton de génération choisit sa voie selon la situation :

```tsx
<button
  type="button"
  onClick={() => (s.nextAction === 'followup' ? askAngles() : generate())}
  disabled={busy !== false}
  className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
>
  {busy === 'angles' ? '… angles' : busy === 'gen' ? '… génération' : s.nextAction === 'followup' ? '✍️ Relancer' : '✍️ Générer'}
</button>
```

Élargir le type de `busy` à `false | 'gen' | 'send' | 'draft' | 'angles'`. En cas d'échec des angles, `generate()` reste accessible : la rédaction libre n'est jamais bloquée.

- [ ] **Step 3: Vérifier et commiter**

Run: `cd ~/ibanforge/frontend && npx tsc --noEmit && npm run lint && npm test && npm run build`

```bash
cd ~/ibanforge
git add frontend/app/api/crm/relance-angles/ frontend/components/crm/composer-dock.tsx
git commit -m "feat(crm): pick a follow-up angle before the draft is written"
git fetch && git rebase origin/main && git push
```

- [ ] **Step 4: Vérifier en live**

Ouvrir un contact en relance due, cliquer « Générer » : deux ou trois angles doivent apparaître, dont une sortie propre. Choisir un angle produit un mail court dans la langue du fil.

---

## Vérification finale

- [ ] `cd ~/ibanforge/frontend && npm test` — 39 tests au vert (quoted 7, situation 9, build-contacts 9, sent-today 3, guardrails 11)
- [ ] `npm run build` réussit
- [ ] `grep -rn "crm-workspace\|prospects-workspace" frontend/app frontend/components frontend/lib` ne renvoie rien
- [ ] `/dashboard/customers` et `/dashboard/prospects` redirigent vers `/dashboard/contacts`
- [ ] Aucun brouillon ne se dépose plus dans le dossier Brouillons de la boîte lors d'une génération
- [ ] Le dépôt public ne contient aucun nom de contact réel. Construire la liste des noms à chercher depuis la base (jamais l'écrire dans un fichier du dépôt) :

```bash
cd ~/ibanforge
ADMIN_SECRET=$(railway variables --kv | sed -n 's/^ADMIN_SECRET=//p')
NAMES=$(curl -s -H "X-Admin-Secret: $ADMIN_SECRET" https://api.ibanforge.com/v1/admin/prospects \
  | jq -r '[.prospects[].company] | join("|")')
git log -p --since=2026-07-25 -- frontend docs | grep -icF -e "$NAMES" || echo 0
```

Attendu : `0`. Attention aux faux positifs : `toHaveLength` contient la chaîne « haveL ». Utiliser `-F` et des noms complets.

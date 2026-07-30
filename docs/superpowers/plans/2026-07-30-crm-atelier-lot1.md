# CRM atelier, lot 1 : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les trois colonnes du CRM par deux volets, et séparer le parcours de réponse du parcours de démarchage, sans toucher à l'API.

**Architecture:** Toute la logique part dans des modules purs de `frontend/lib/crm/` (intention d'écriture, portée des garde-fous, projection des lignes de liste), consommés par des composants d'affichage minces. La configuration vitest n'inclut que `lib/**` et `app/**`, donc ce déplacement est ce qui rend le lot vérifiable : un composant non testable ne doit contenir aucune décision.

**Tech Stack:** Next.js 16.2.4 (App Router), React 19.2.4, TypeScript strict, Tailwind v4 avec variables maison, next-intl, vitest en environnement `node`.

**Spec de référence :** `docs/superpowers/specs/2026-07-29-crm-mail-integration-design.md`
**Maquette validée :** `.superpowers/brainstorm/27605-1785346294/content/ecran-v3.html` (non versionnée, locale).

## Global Constraints

- **Ce dépôt est public.** Aucun nom de client, aucune adresse réelle, aucun chiffre commercial dans le code, les commentaires, les tests ou les messages de commit. Fixtures inventées : `acme@example.com`, `Société Alpha`.
- **Next.js 16 diffère de ce que tu connais.** Avant d'écrire du routage, un `page.tsx` ou un composant serveur, lire le guide correspondant dans `frontend/node_modules/next/dist/docs/01-app/`. Consigne de `frontend/AGENTS.md`, non facultative.
- **Zéro tiret cadratin dans toute prose destinée à sortir**, interface comprise. Virgule, point, deux-points ou parenthèses.
- **Aucun badge, aucune pastille.** Contrainte explicite du propriétaire. Un état se dit en mots ; l'urgence passe par la couleur du texte et un filet vertical fin.
- **Langue :** code, variables et commentaires en anglais. Textes d'interface en français.
- **TypeScript strict, pas de `any`** sauf cas justifié par un commentaire.
- **Commits conventionnels** (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`).
- **Sessions parallèles actives sur `~/ibanforge`.** Travailler dans le worktree `.claude/worktrees/crm-ux`. Faire `git fetch && git rebase origin/main` avant chaque push, et **ne jamais `git add -A`** : ajouter les fichiers un par un.
- **Ne pas modifier `src/`** (API Hono). Ce lot est entièrement frontend.
- Commandes : `cd frontend && npm test` (vitest), `npm run lint`, `npm run build`.

---

## Structure des fichiers

**Créés, modules purs (`frontend/lib/crm/`)**

| Fichier | Responsabilité |
|---|---|
| `intent.ts` | Déduire `'reply' \| 'outbound'` de `ballInCourt`, jamais des messages bruts. |
| `intent.test.ts` | Tests du dessus. |
| `mail-rows.ts` | Filtres avec compteurs, tri, et projection d'un `Contact` en ligne à trois niveaux. |
| `mail-rows.test.ts` | Tests du dessus. |

**Créés, composants (`frontend/components/crm/`)**

| Fichier | Responsabilité |
|---|---|
| `mail-list.tsx` | Colonne de gauche. Affiche ce que `mail-rows.ts` a calculé. Aucune décision. |
| `reply-sheet.tsx` | Zone de rédaction superposée, parcours de réponse seul. |
| `outbound-sheet.tsx` | Rédaction de prospection. Reçoit le contenu actuel de `composer-dock.tsx`. |

**Modifiés**

| Fichier | Changement |
|---|---|
| `frontend/lib/crm/types.ts` | Ajout du code `empty_body` à `GuardrailIssue`. |
| `frontend/lib/crm/guardrails.ts` | `intent` dans `CheckInput`, portée par règle, règle `empty_body`, entrée `BLOCK_LABEL`. |
| `frontend/lib/crm/guardrails.test.ts` | Tests de portée. |
| `frontend/components/crm/crm-app.tsx` | Deux volets au lieu de trois colonnes. |
| `frontend/app/[locale]/dashboard/(protected)/contacts/page.tsx` | Retrait du podium, des six cartes et du bandeau campagnes. |
| `frontend/app/[locale]/dashboard/(protected)/page.tsx` | Accueil des six cartes et du podium. |

**Supprimés**

| Fichier | Motif |
|---|---|
| `frontend/components/crm/today-rail.tsx` | Filtre déguisé en colonne. Son tri migre dans `mail-rows.ts`. |
| `frontend/components/crm/contact-list.tsx` | Remplacé par `mail-list.tsx`. |
| `frontend/components/crm/composer-dock.tsx` | Scindé en `reply-sheet.tsx` et `outbound-sheet.tsx`. |

---

## Task 1 : l'intention d'écriture

**Files:**
- Create: `frontend/lib/crm/intent.ts`
- Test: `frontend/lib/crm/intent.test.ts`

**Interfaces:**
- Consumes: `Situation` depuis `./types`.
- Produces: `export type Intent = 'reply' | 'outbound'` et `export function intentOf(situation: Situation | undefined): Intent`.

**Pourquoi une `Situation` et non les messages.** Une première version lisait le
dernier message de `Contact.messages`. C'est faux : `build-contacts.ts` n'y filtre que
les brouillons, donc l'automation des help desks y reste, et `automated.ts` documente
le dégât mesuré le 27/07/2026, près d'un tiers des entrants étant des robots qui
« fabriquaient » des réponses. Lire le tableau brut aurait compté un accusé de
réception automatique comme une réponse humaine, et donc désarmé `no_optout` et
`daily_cap` sur un fil où personne n'a écrit. `situationOf` filtre déjà l'automation,
exige une date lisible et trie sur l'instant plutôt que sur la chaîne. `ballInCourt`
porte donc exactement la décision cherchée, et la dériver au lieu de la recalculer
empêche les deux de se contredire sur le même écran.

- [ ] **Step 1 : écrire le test qui échoue**

Créer `frontend/lib/crm/intent.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { intentOf } from './intent';
import type { Situation } from './types';

function situation(ballInCourt: Situation['ballInCourt']): Situation {
  return {
    ballInCourt,
    silenceDays: 3,
    followupDue: false,
    firstContactAt: '2026-07-01',
    hasEverReplied: true,
    messageCount: 2,
    nextAction: 'wait',
  };
}

describe('intentOf', () => {
  it('answers reply when the ball is in our court', () => {
    expect(intentOf(situation('us'))).toBe('reply');
  });

  it('answers outbound while we are the ones waiting', () => {
    expect(intentOf(situation('them'))).toBe('outbound');
  });

  it('answers outbound when nobody holds the ball, which is a first touch', () => {
    expect(intentOf(situation('none'))).toBe('outbound');
  });

  it('answers outbound on a missing situation rather than throwing', () => {
    // The page builds one situation per contact id, so an absent one is a
    // programming error rather than data. Declining to claim a reply is the safe
    // direction: it keeps every prospecting guardrail armed instead of silently
    // disarming them on a thread we know nothing about.
    expect(intentOf(undefined)).toBe('outbound');
  });
});
```

- [ ] **Step 2 : lancer le test pour vérifier qu'il échoue**

Run: `cd frontend && npx vitest run lib/crm/intent.test.ts`
Expected: FAIL, `Failed to resolve import "./intent"`.

- [ ] **Step 3 : écrire l'implémentation minimale**

Créer `frontend/lib/crm/intent.ts` :

```ts
import type { Situation } from './types';

/** Which of the two writing paths applies. Never asked, always derived. */
export type Intent = 'reply' | 'outbound';

/**
 * Reply when the ball is in our court, which is `situationOf`'s way of saying the
 * other side wrote last and is waiting.
 *
 * Derived from the situation rather than from `Contact.messages` on purpose. That
 * array keeps help-desk automation: build-contacts.ts filters drafts out of it and
 * nothing else. situationOf already drops automated messages, requires a readable
 * date, and orders on the instant instead of the raw string. Reading the array here
 * would have counted a robot's acknowledgement as a human reply, disarming the
 * prospecting guardrails on a thread nobody answered, and would have contradicted
 * the situation band shown three centimetres above the composer.
 *
 * An absent situation answers `outbound`, which keeps every guardrail armed.
 */
export function intentOf(situation: Situation | undefined): Intent {
  return situation?.ballInCourt === 'us' ? 'reply' : 'outbound';
}
```

- [ ] **Step 4 : lancer le test pour vérifier qu'il passe**

Run: `cd frontend && npx vitest run lib/crm/intent.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5 : commiter**

```bash
cd /Users/claude-alainmartin/ibanforge/.claude/worktrees/crm-ux
git add frontend/lib/crm/intent.ts frontend/lib/crm/intent.test.ts
git commit -m "feat(crm): derive whether we are replying or reaching out"
```

---

## Task 2 : donner une portée aux garde-fous

**Files:**
- Modify: `frontend/lib/crm/types.ts` (union `GuardrailIssue['code']`, autour de la ligne 129)
- Modify: `frontend/lib/crm/guardrails.ts` (`CheckInput` ligne 5, `BLOCK_LABEL` ligne 51, `checkDraft` ligne 150)
- Test: `frontend/lib/crm/guardrails.test.ts` (fichier existant, ajouter un bloc)

**Interfaces:**
- Consumes: `Intent` depuis `./intent` (Task 1).
- Produces: `CheckInput` gagne un champ requis `intent: Intent`. Tout appelant existant de `checkDraft` doit le fournir ; les appelants sont mis à jour aux Tasks 6 et 7.

- [ ] **Step 1 : écrire les tests qui échouent**

Ajouter à la fin de `frontend/lib/crm/guardrails.test.ts` :

```ts
describe('guardrail scope by intent', () => {
  /**
   * A body built to trip every prospecting rule at once: far too short for the
   * cold windows, three links, no opt-out, and a spam word.
   */
  const TRIPWIRE = 'Gratuit. Voir https://a.example https://b.example https://c.example';

  it('fires no prospecting rule on a reply', () => {
    const report = checkDraft({
      body: TRIPWIRE,
      sentToday: 99,
      isFirstTouch: true,
      intent: 'reply',
    });
    const codes = report.issues.map((i) => i.code);
    expect(codes).not.toContain('length');
    expect(codes).not.toContain('too_many_links');
    expect(codes).not.toContain('no_optout');
    expect(codes).not.toContain('spam_word');
    expect(codes).not.toContain('daily_cap');
    expect(codes).not.toContain('daily_high');
    expect(codes).not.toContain('repeat_previous');
    expect(codes).not.toContain('same_subject');
  });

  it('still fires those rules on an outbound', () => {
    const report = checkDraft({
      body: TRIPWIRE,
      sentToday: 99,
      isFirstTouch: true,
      intent: 'outbound',
    });
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain('length');
    expect(codes).toContain('too_many_links');
    expect(codes).toContain('no_optout');
    expect(codes).toContain('daily_cap');
  });

  it('blocks an em dash in both intentions, because that rule is about all sent prose', () => {
    for (const intent of ['reply', 'outbound'] as const) {
      const report = checkDraft({
        body: `Bonjour ${EM_DASH} merci de votre message.`,
        sentToday: 0,
        isFirstTouch: false,
        intent,
      });
      expect(report.issues.map((i) => i.code)).toContain('em_dash');
      expect(report.blocking).toBe(true);
    }
  });

  it('blocks an empty body in both intentions', () => {
    for (const intent of ['reply', 'outbound'] as const) {
      const report = checkDraft({ body: '   \n ', sentToday: 0, isFirstTouch: false, intent });
      expect(report.issues.map((i) => i.code)).toContain('empty_body');
      expect(report.blocking).toBe(true);
    }
  });

  it('gives every blocking code a short label for the override control', () => {
    // Pinned rather than left to be noticed: a blocking rule with no entry puts
    // a raw code such as `empty_body` in front of the operator.
    for (const code of ['em_dash', 'daily_cap', 'empty_body'] as const) {
      expect(BLOCK_LABEL[code]).toBeTruthy();
    }
  });
});
```

Vérifier que l'import en tête du fichier de test comprend bien `BLOCK_LABEL` et `EM_DASH` en plus de `checkDraft` ; les ajouter s'ils manquent.

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run: `cd frontend && npx vitest run lib/crm/guardrails.test.ts`
Expected: FAIL. Erreurs de type sur `intent` inconnu dans `CheckInput`, et `empty_body` absent de l'union.

- [ ] **Step 3 : ajouter le code d'anomalie**

Dans `frontend/lib/crm/types.ts`, ajouter `empty_body` à l'union, juste après `em_dash` :

```ts
export interface GuardrailIssue {
  code:
    | 'em_dash'
    | 'empty_body'
    | 'daily_cap'
    | 'daily_high'
    | 'length'
    | 'too_many_links'
    | 'no_optout'
    | 'spam_word'
    | 'repeat_previous'
    | 'same_subject';
  level: 'blocking' | 'warning';
  message: string;
}
```

- [ ] **Step 4 : déclarer l'intention dans l'entrée**

Dans `frontend/lib/crm/guardrails.ts`, ajouter l'import et le champ :

```ts
import type { Intent } from './intent';
```

Puis dans `CheckInput`, après `body` :

```ts
  /**
   * Which writing path this is. Derived by intent.ts, never asked.
   *
   * Required rather than optional with a default: a caller that forgets it
   * would silently get the prospecting rule set on a reply, which is the exact
   * defect this field exists to remove. A compile error is the cheaper failure.
   */
  intent: Intent;
```

- [ ] **Step 5 : ajouter l'étiquette du nouveau bloquant**

Dans `BLOCK_LABEL` :

```ts
export const BLOCK_LABEL: Partial<Record<GuardrailIssue['code'], string>> = {
  em_dash: 'tiret cadratin',
  empty_body: 'message vide',
  daily_cap: 'plafond du jour',
};
```

- [ ] **Step 6 : appliquer la portée dans `checkDraft`**

Déstructurer `intent` dans la signature :

```ts
export function checkDraft({
  body,
  subject,
  sentToday,
  isFirstTouch,
  previous,
  intent,
}: CheckInput): GuardrailReport {
```

Juste après le bloc `em_dash` (celui qui pousse le code `em_dash`), insérer la règle du corps vide :

```ts
  /**
   * Both intentions. Sending an empty mail is never what was meant, and it is
   * the one mistake a fast reply path makes easy: the sheet opens focused, and
   * a stray Enter would otherwise send nothing at all.
   */
  if (!body.trim()) {
    issues.push({
      code: 'empty_body',
      level: 'blocking',
      message: 'Le message est vide.',
    });
  }
```

Puis envelopper **tout le reste des règles**, du bloc `daily_cap` jusqu'au bloc `same_subject` inclus, dans une seule condition :

```ts
  /**
   * Everything below is prospecting hygiene: cadence against a domain's
   * reputation, a length window tuned for a cold mail, an opt-out a stranger is
   * owed, and repetition against the last mail we sent unprompted.
   *
   * None of it applies to a reply. Answering a question in two sentences is not
   * a mail that is too short, and someone who just wrote to us does not need to
   * be offered a way to stop being contacted.
   */
  if (intent === 'outbound') {
    // ... les blocs existants, sans changement de contenu, décalés d'un niveau
  }
```

Ne modifier aucun message, aucun seuil, aucune constante. Seule l'indentation change.

- [ ] **Step 7 : lancer la suite complète pour vérifier**

Run: `cd frontend && npm test`
Expected: les nouveaux tests passent. Des erreurs de compilation subsistent aux appelants de `checkDraft` (`composer-dock.tsx`, `draft-card.tsx`), qui n'ont pas encore d'`intent`. C'est attendu et réparé aux Tasks 6 et 7.

- [ ] **Step 8 : réparer les appelants a minima**

Dans `frontend/components/crm/composer-dock.tsx` et `frontend/components/crm/draft-card.tsx`, à chaque appel de `checkDraft`, ajouter :

```ts
      intent: intentOf(situation),
```

avec `import { intentOf } from '@/lib/crm/intent';` en tête. Les deux composants reçoivent déjà `situation` en propriété, il n'y a rien à faire remonter. Ce sont des fichiers en sursis (Tasks 6 et 7), l'ajout sert seulement à garder le dépôt compilable entre deux commits.

- [ ] **Step 9 : vérifier que tout compile et passe**

Run: `cd frontend && npm test && npm run lint && npm run build`
Expected: tests verts, lint propre, build réussi.

- [ ] **Step 10 : commiter**

```bash
git add frontend/lib/crm/types.ts frontend/lib/crm/guardrails.ts frontend/lib/crm/guardrails.test.ts frontend/components/crm/composer-dock.tsx frontend/components/crm/draft-card.tsx
git commit -m "feat(crm): prospecting guardrails no longer fire on a reply

A reply of two sentences was being measured against a cold mail's length
window, asked for an opt-out line, and counted against the day's sending cap.
Each rule now declares the intention it applies to. em_dash keeps both: it is
the owner's rule on all sent prose, not a prospecting rule. An empty body
joins it as blocking, because a reply sheet that opens focused makes sending
nothing easy."
```

---

## Task 3 : la logique de la colonne de gauche

**Files:**
- Create: `frontend/lib/crm/mail-rows.ts`
- Test: `frontend/lib/crm/mail-rows.test.ts`

**Interfaces:**
- Consumes: `Contact`, `Situation` depuis `./types` ; `ballWithUs`, `followupDue` depuis `./buckets` ; `isArchived` depuis `./archived`.
- Produces:
  - `export type MailFilterKey = 'reply' | 'followup' | 'new' | 'clients' | 'all'`
  - `export interface MailRow { id: string; who: string; subject: string; preview: string; age: string; urgent: boolean; unread: boolean }`
  - `export interface MailFilter { key: MailFilterKey; label: string; count: number }`
  - `export function mailFilters(input: RowsInput): MailFilter[]`
  - `export function mailRows(input: RowsInput, active: MailFilterKey): MailRow[]`
  - `export interface RowsInput { contacts: Contact[]; situations: Record<string, Situation | undefined>; snoozed: Record<string, boolean> }`

- [ ] **Step 1 : écrire les tests qui échouent**

Créer `frontend/lib/crm/mail-rows.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { mailFilters, mailRows, type RowsInput } from './mail-rows';
import type { Contact, Message, Situation } from './types';

function message(direction: Message['direction'], subject: string, snippet: string, msg_date: string): Message {
  return { direction, msg_date, subject, snippet, counterparty: 'acme@example.com' };
}

function client(id: string, company: string, messages: Message[]): Contact {
  return {
    kind: 'client',
    id,
    email: id,
    company,
    country: 'CH',
    website: null,
    messages,
    draft: null,
    unread: false,
    account: 'desk@example.com',
    apiKey: {
      keyPrefix: 'ifk_test',
      paid: false,
      creditsTotal: null,
      creditsRemaining: null,
      monthlyLimit: 200,
      usedAllTime: 4,
      lastActiveMonth: '2026-07',
      createdAt: '2026-01-01',
      isNew: false,
    },
    usage: { series: [], months: [], days: [], endpoints: [] },
  };
}

function situation(over: Partial<Situation>): Situation {
  // 'wait' rather than 'none': NextAction is
  // 'first_mail' | 'reply' | 'followup' | 'firm_offer' | 'wait', and there is no
  // 'none'. No cast here on purpose, so a future change to Situation breaks this
  // fixture at compile time instead of silently.
  return {
    ballInCourt: 'none',
    silenceDays: null,
    followupDue: false,
    firstContactAt: null,
    hasEverReplied: false,
    messageCount: 0,
    nextAction: 'wait',
    ...over,
  };
}

const alpha = client('alpha@example.com', 'Société Alpha', [
  message('out', 'Prise de contact', 'Bonjour, je vous écris au sujet de', '2026-07-01'),
  message('in', 'Prise de contact', 'Merci, une question sur le format', '2026-07-28'),
]);
const beta = client('beta@example.com', 'Société Beta', [
  message('out', 'Relance', 'Je reviens vers vous', '2026-06-01'),
]);

const input: RowsInput = {
  contacts: [alpha, beta],
  situations: {
    'alpha@example.com': situation({ ballInCourt: 'us', silenceDays: 2 }),
    'beta@example.com': situation({ followupDue: true, silenceDays: 40 }),
  },
  snoozed: {},
};

describe('mailFilters', () => {
  it('puts the one that demands an answer first', () => {
    expect(mailFilters(input)[0]?.key).toBe('reply');
  });

  it('counts what its own filter would show, so a count cannot lie', () => {
    for (const filter of mailFilters(input)) {
      expect(mailRows(input, filter.key)).toHaveLength(filter.count);
    }
  });
});

describe('mailRows', () => {
  it('projects three readable levels per row', () => {
    const [row] = mailRows(input, 'reply');
    expect(row?.who).toBe('Société Alpha');
    expect(row?.subject).toBe('Prise de contact');
    expect(row?.preview).toBe('Merci, une question sur le format');
    expect(row?.age).toBe('2 j');
  });

  it('labels the age from the situation, never from a clock', () => {
    // Three branches of user-visible French text. Untested, a wrong label would
    // reach the column and only be noticed by reading it there.
    const withDays = (silenceDays: number | null) => ({
      ...input,
      contacts: [alpha],
      situations: { 'alpha@example.com': situation({ ballInCourt: 'us', silenceDays }) },
    });
    expect(mailRows(withDays(0), 'reply')[0]?.age).toBe("aujourd'hui");
    expect(mailRows(withDays(1), 'reply')[0]?.age).toBe('1 j');
    expect(mailRows(withDays(null), 'reply')[0]?.age).toBe('');
  });

  it('sorts the reply filter by longest silence first', () => {
    // The only real contribution of the removed day rail, kept as a behaviour
    // of this filter rather than as a column of its own.
    const two = { ...input, situations: {
      'alpha@example.com': situation({ ballInCourt: 'us', silenceDays: 2 }),
      'beta@example.com': situation({ ballInCourt: 'us', silenceDays: 40 }),
    } };
    expect(mailRows(two, 'reply').map((r) => r.id)).toEqual(['beta@example.com', 'alpha@example.com']);
  });

  it('puts an unread thread above a longer silence', () => {
    // The regression this rule exists for, in its worst form: the fresh reply
    // has the SHORTEST silence of the two, so silence-first alone buries the one
    // row the filter is meant to raise. Contacts are handed in already in the
    // wrong order, so a comparator that ignores unread keeps them there.
    const fresh = { ...alpha, unread: true };
    const two = {
      ...input,
      contacts: [beta, fresh],
      situations: {
        'alpha@example.com': situation({ ballInCourt: 'us', silenceDays: 0 }),
        'beta@example.com': situation({ ballInCourt: 'us', silenceDays: 40 }),
      },
    };
    expect(mailRows(two, 'reply').map((r) => r.id)).toEqual(['alpha@example.com', 'beta@example.com']);
  });

  it('carries unread onto the row under every filter', () => {
    // Projected outside "À répondre" too, so the same thread reads the same way
    // wherever it is met. Both values asserted: a field hard-wired to true would
    // pass a one-sided test.
    const one = { ...input, contacts: [{ ...alpha, unread: true }] };
    expect(mailRows(one, 'all')[0]?.unread).toBe(true);
    expect(mailRows({ ...input, contacts: [alpha] }, 'all')[0]?.unread).toBe(false);
  });

  it('breaks ties on id so the server and the browser agree', () => {
    // Contacts handed in REVERSED against the expected answer. Array.sort is
    // stable, so an input already in the answer's order would let a comparator
    // that returns 0 on a tie pass this test while deciding nothing.
    const tied = {
      ...input,
      contacts: [beta, alpha],
      situations: {
        'alpha@example.com': situation({ ballInCourt: 'us', silenceDays: 5 }),
        'beta@example.com': situation({ ballInCourt: 'us', silenceDays: 5 }),
      },
    };
    expect(mailRows(tied, 'reply').map((r) => r.id)).toEqual(['alpha@example.com', 'beta@example.com']);
  });

  it('sorts every other filter by most recent first', () => {
    // alpha's last message is dated 2026-07-28, beta's 2026-06-01. Reversed on
    // input for the same reason as above: a comparator sorting oldest first must
    // fail here rather than hide behind sort stability. This is the order of
    // "Tous", so nothing else pins it.
    const both = { ...input, contacts: [beta, alpha] };
    expect(mailRows(both, 'all').map((r) => r.id)).toEqual(['alpha@example.com', 'beta@example.com']);
  });

  it('marks urgent by filter, not by contact', () => {
    // The very same contact is urgent under "À répondre" and not under "Tous".
    // Urgency is what the active filter means, which is what keeps the accent
    // colour meaning something.
    expect(mailRows(input, 'reply')[0]?.urgent).toBe(true);
    expect(mailRows(input, 'all').some((r) => r.urgent)).toBe(false);
  });

  it('falls back to the email when a contact has no company', () => {
    const nameless = { ...input, contacts: [{ ...alpha, company: null }] };
    expect(mailRows(nameless, 'all')[0]?.who).toBe('alpha@example.com');
  });

  it('says so in words when a thread has no subject yet', () => {
    const bare = { ...input, contacts: [{ ...beta, messages: [] }] };
    expect(mailRows(bare, 'all')[0]?.subject).toBe('Aucun échange');
  });
});
```

- [ ] **Step 2 : lancer les tests pour vérifier qu'ils échouent**

Run: `cd frontend && npx vitest run lib/crm/mail-rows.test.ts`
Expected: FAIL, `Failed to resolve import "./mail-rows"`.

- [ ] **Step 3 : écrire l'implémentation**

Créer `frontend/lib/crm/mail-rows.ts` :

```ts
import { isArchived } from './archived';
import { ballWithUs, followupDue } from './buckets';
import type { Contact, Message, Situation } from './types';

export type MailFilterKey = 'reply' | 'followup' | 'new' | 'clients' | 'all';

export interface RowsInput {
  contacts: Contact[];
  situations: Record<string, Situation | undefined>;
  snoozed: Record<string, boolean>;
}

export interface MailRow {
  id: string;
  who: string;
  subject: string;
  preview: string;
  age: string;
  urgent: boolean;
  unread: boolean;
}

export interface MailFilter {
  key: MailFilterKey;
  label: string;
  count: number;
}

/**
 * One predicate per filter, used BOTH to count and to select. That shape is
 * inherited from the list this replaces and is the whole point: a filter cannot
 * advertise a number the rows then fail to show, because there is no second copy
 * of the rule to drift from.
 *
 * The two bucket rules come from buckets.ts rather than being spelled out again,
 * which extends the guarantee one ring outwards: the page's own counters read
 * those very functions.
 *
 * `urgent` is a property of the filter, not of the contact. Everything under
 * "À répondre" deserves the accent colour by definition; nothing under "Tous"
 * does, or the colour would stop meaning anything.
 */
const FILTERS: Array<{
  key: MailFilterKey;
  label: string;
  urgent: boolean;
  test: (c: Contact, s: Situation | undefined, snoozed: boolean) => boolean;
}> = [
  { key: 'reply', label: 'À répondre', urgent: true, test: ballWithUs },
  { key: 'followup', label: 'Relances', urgent: false, test: followupDue },
  {
    key: 'new',
    label: 'Nouveaux',
    urgent: false,
    test: (c) => c.kind === 'client' && c.apiKey.isNew,
  },
  { key: 'clients', label: 'Clients', urgent: false, test: (c) => c.kind === 'client' },
  { key: 'all', label: 'Tous', urgent: false, test: () => true },
];

function pick(input: RowsInput, key: MailFilterKey): Contact[] {
  const filter = FILTERS.find((f) => f.key === key);
  if (!filter) return [];
  return input.contacts.filter((c) => {
    const s = input.situations[c.id];
    // Archived rows surface only under "Tous". They were set aside on purpose,
    // and one reappearing in a work filter undoes the gesture. ballWithUs and
    // followupDue already exclude them; this covers the filters that do not.
    if (key !== 'all' && isArchived(c, s)) return false;
    return filter.test(c, s, input.snoozed[c.id] ?? false);
  });
}

/** The last message carrying the field, searched from the end. */
function lastWith(messages: Message[], field: 'subject' | 'snippet' | 'msg_date'): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const value = messages[i]?.[field];
    if (value) return value;
  }
  return null;
}

/**
 * Days come from the situation, never computed here. `msg_date` carries no
 * timezone and this module runs on the server before the subtree is hydrated, so
 * a UTC server and a browser in Zurich would print two different labels for the
 * same row.
 */
function ageLabel(s: Situation | undefined): string {
  const days = s?.silenceDays;
  if (days === null || days === undefined) return '';
  if (days <= 0) return "aujourd'hui";
  return `${days} j`;
}

function toRow(c: Contact, s: Situation | undefined, urgent: boolean): MailRow {
  return {
    id: c.id,
    // The email is the fallback, not a placeholder: an address is something the
    // operator can act on, whereas "sans nom" is not.
    who: c.company || c.email,
    subject: lastWith(c.messages, 'subject') ?? 'Aucun échange',
    preview: lastWith(c.messages, 'snippet') ?? '',
    age: ageLabel(s),
    urgent,
    // Projected on every filter, not just "À répondre", so a thread nobody has
    // opened reads the same wherever it is met. `crm-app.tsx` already clears the
    // flag optimistically the moment a row is opened, machinery that had been
    // left running with nothing on the other end of it.
    unread: c.unread,
  };
}

export function mailFilters(input: RowsInput): MailFilter[] {
  return FILTERS.map((f) => ({
    key: f.key,
    label: f.label,
    count: pick(input, f.key).length,
  }));
}

function byId(a: Contact, b: Contact): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function mailRows(input: RowsInput, active: MailFilterKey): MailRow[] {
  const filter = FILTERS.find((f) => f.key === active);
  if (!filter) return [];

  const sorted = [...pick(input, active)].sort((a, b) => {
    if (active === 'reply') {
      // Unread wins outright, ahead of silence. Both rules existed before this
      // module and only one of them survived the first draft, which inverted the
      // filter: a reply that landed this morning has zero days of silence, so
      // longest-silence-first sent it to the bottom of the very filter meant to
      // catch it. The list this replaces compared unread first for that reason.
      if (a.unread !== b.unread) return a.unread ? -1 : 1;
      // Then longest silence: the thread that has waited longest is closest to
      // being lost. This is the one thing the removed day rail did that the list
      // did not, so it survives here as this filter's behaviour.
      const gap =
        (input.situations[b.id]?.silenceDays ?? 0) - (input.situations[a.id]?.silenceDays ?? 0);
      if (gap !== 0) return gap;
      return byId(a, b);
    }
    const dateA = lastWith(a.messages, 'msg_date') ?? '';
    const dateB = lastWith(b.messages, 'msg_date') ?? '';
    // ISO-ish strings compare correctly as strings, and comparing them as
    // strings is what keeps this function free of a Date, for the reason
    // ageLabel gives.
    if (dateA !== dateB) return dateA < dateB ? 1 : -1;
    return byId(a, b);
  });

  return sorted.map((c) => toRow(c, input.situations[c.id], filter.urgent));
}
```

- [ ] **Step 4 : lancer les tests pour vérifier qu'ils passent**

Run: `cd frontend && npx vitest run lib/crm/mail-rows.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5 : commiter**

```bash
git add frontend/lib/crm/mail-rows.ts frontend/lib/crm/mail-rows.test.ts
git commit -m "feat(crm): one tested module decides what the mail list shows

Filters, counts, sort and row projection in one place, with the guarantee the
old list carried: one predicate per filter, used both to count and to select,
so a count cannot advertise rows the list then fails to show. The day rail's
longest-silence-first sort survives here as the behaviour of the first filter."
```

---

## Task 4 : la colonne de gauche

**Files:**
- Create: `frontend/components/crm/mail-list.tsx`
- Delete: `frontend/components/crm/today-rail.tsx`, `frontend/components/crm/contact-list.tsx`
- Modify: `frontend/components/crm/crm-app.tsx`

**Interfaces:**
- Consumes: `mailFilters`, `mailRows`, `MailFilterKey`, `MailRow`, `RowsInput` (Task 3).
- Produces: `export function MailList(props: { input: RowsInput; selectedId: string | null; onSelect: (id: string) => void }): JSX.Element`. Le filtre actif est un état local du composant, initialisé à `'reply'`.

- [ ] **Step 1 : écrire le composant**

Créer `frontend/components/crm/mail-list.tsx` :

```tsx
'use client';

import { useState } from 'react';
import {
  mailFilters,
  mailRows,
  type MailFilterKey,
  type RowsInput,
} from '@/lib/crm/mail-rows';

/**
 * The left column. Holds no rule of its own: it asks mail-rows.ts what the
 * filters and the rows are, and draws them. That split is what makes this half
 * of the screen testable, since the vitest config covers lib/ and app/ only.
 *
 * Deliberately without a single capsule or badge: the owner's constraint. An
 * active filter is lighter, bolder and underlined; urgency is the accent colour
 * plus a thin rule down the left edge.
 */
export function MailList({
  input,
  selectedId,
  onSelect,
}: {
  input: RowsInput;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // 'reply' rather than 'all': the column opens on what the day owes. Local
  // state, because nothing outside this column needs to know which filter is on.
  const [active, setActive] = useState<MailFilterKey>('reply');
  const filters = mailFilters(input);
  const rows = mailRows(input, active);

  return (
    <div className="flex min-w-0 flex-col border-r border-[var(--ink-4)]/60 bg-[var(--ink-2)]/40">
      <div className="flex flex-wrap gap-4 border-b border-[var(--ink-4)]/60 px-4 pt-3">
        {filters.map((f) => {
          const on = f.key === active;
          const accent = f.key === 'reply';
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setActive(f.key)}
              className={[
                'border-b-2 pb-[9px] text-[12.5px] whitespace-nowrap',
                on ? 'font-semibold' : '',
                accent ? 'text-[var(--accent)]' : on ? 'text-[var(--fg-1)]' : 'text-[var(--fg-3)]',
                on ? (accent ? 'border-b-[var(--accent)]' : 'border-b-[var(--fg-3)]') : 'border-transparent',
              ].join(' ')}
            >
              {f.label} <span className="ml-1 tabular-nums opacity-75">{f.count}</span>
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12.5px] text-[var(--fg-3)]">
            Rien dans ce filtre.
          </p>
        ) : (
          rows.map((r) => {
            const on = r.id === selectedId;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelect(r.id)}
                className={[
                  'block w-full border-l-2 px-3.5 py-2.5 text-left',
                  on ? 'bg-white/5' : '',
                  r.urgent
                    ? on
                      ? 'border-l-[var(--accent)]'
                      : 'border-l-[var(--accent)]/45'
                    : on
                      ? 'border-l-[var(--fg-3)]'
                      : 'border-transparent',
                ].join(' ')}
              >
                <span className="flex items-baseline justify-between gap-2.5">
                  {/* min-w-0 as well as truncate: a flex child will not shrink
                      below its content without it, and `who` falls back to the
                      email address, which is one unbreakable token. The title
                      gives the full value back on hover, since clipping is the
                      only thing a 296px column can do with it. */}
                  <span
                    title={r.who}
                    className={`min-w-0 truncate text-[13px] text-[var(--fg-1)] ${
                      r.unread || on ? 'font-semibold' : ''
                    }`}
                  >
                    {r.who}
                  </span>
                  <span
                    className={`shrink-0 text-[11.5px] tabular-nums ${
                      r.urgent ? 'text-[var(--accent)]' : 'text-[var(--fg-3)]'
                    }`}
                  >
                    {r.age}
                  </span>
                </span>
                <span
                  className={`mt-0.5 block truncate text-xs ${
                    r.unread ? 'font-medium text-[var(--fg-1)]' : 'text-[var(--fg-2)]'
                  }`}
                >
                  {r.subject}
                </span>
                <span className="mt-px block truncate text-[11.5px] text-[var(--fg-3)]">
                  {r.preview}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
```

Avant d'écrire, vérifier que les variables `--ink-2`, `--ink-4`, `--fg-1`, `--fg-2`, `--fg-3` et `--accent` existent bien dans le thème :

Run: `cd frontend && grep -rn "\-\-accent\|\-\-fg-3" app/globals.css | head -5`

Si `--accent` n'existe pas sous ce nom, utiliser celui du thème et le noter dans le commit plutôt que d'introduire une couleur en dur.

- [ ] **Step 2 : brancher dans `crm-app.tsx` et supprimer les deux anciens**

Remplacer la grille à trois colonnes par deux volets :

```tsx
<div className="grid min-w-0 grid-cols-1 gap-0 lg:grid-cols-[296px_1fr]">
```

Remplacer `<TodayRail .../>` et `<ContactList .../>` par un seul `<MailList input={{ contacts: view, situations, snoozed }} selectedId={selectedId} onSelect={open} />`. Supprimer les deux imports et les deux fichiers.

- [ ] **Step 3 : vérifier que rien ne référence plus les fichiers supprimés**

Run: `cd frontend && grep -rn "today-rail\|contact-list" --include="*.tsx" --include="*.ts" . | grep -v node_modules`
Expected: aucune sortie.

- [ ] **Step 4 : vérifier que tout compile et passe**

Run: `cd frontend && npm test && npm run lint && npm run build`
Expected: tests verts, lint propre, build réussi.

- [ ] **Step 5 : vérifier à l'écran**

Run: `cd frontend && PORT=3111 npm start`
Ouvrir `http://127.0.0.1:3111` et se connecter au tableau de bord. Ne jamais ouvrir en `file://`.
Vérifier : deux volets, filtres en texte souligné sans capsule, trois niveaux par ligne, filet doré sur les lignes urgentes.

- [ ] **Step 6 : commiter**

```bash
git add frontend/components/crm/mail-list.tsx frontend/components/crm/crm-app.tsx
git rm frontend/components/crm/today-rail.tsx frontend/components/crm/contact-list.tsx
git commit -m "feat(crm): one list column instead of two that showed the same set

The day rail displayed the top five of the very set the neighbouring list
filtered in full, fifteen centimetres away, for 170px of permanent width. Its
sort is what was worth keeping and it moved into the first filter."
```

---

## Task 5 : la zone de réponse superposée

**Files:**
- Create: `frontend/components/crm/reply-sheet.tsx`
- Modify: `frontend/components/crm/crm-app.tsx`

**Interfaces:**
- Consumes: `intentOf` (Task 1), `checkDraft` avec `intent` (Task 2), `Contact`, `Situation`.
- Produces: `export function ReplySheet(props: { contact: Contact; situation?: Situation; sentToday: number; open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element`.

- [ ] **Step 1 : écrire le composant**

`'use client'`. Doit être **claveté sur l'identifiant du contact** par l'appelant (`key={selected.id}`), pour la raison déjà documentée dans `composer-dock.tsx` : un texte laissé dans la zone ne doit jamais suivre l'opérateur vers le contact suivant et partir chez lui.

Comportement :

- Replié, une seule ligne : « Répondre à `prénom` » et un bouton `Envoyer` en contour seul.
- Déplié, positionné en `absolute inset-x-0 bottom-0` du volet de droite, avec `border-t`, un fond `var(--ink-2)` et une ombre portée vers le haut. **Le fil au-dessus conserve sa hauteur.** C'est le point du lot : ne jamais retirer de place à la lecture.
- Zone de texte vide au montage. Pas d'angle, pas de mode à choisir.
- Une action secondaire en texte : « Proposer un texte ». La génération est un outil, pas un couloir.
- **Pas de bouton « Joindre ».** Il figurait dans la première version de cette tâche et il ne pouvait rien faire : `/api/crm/send` ne relaie que `{account, to, subject, body}`, et les seules pièces jointes du dépôt sont celles qu'on télécharge à la réception, côté lot 2. Un bouton qui ne fait rien est pire que pas de bouton dans l'écran dont toute la raison d'être est de retirer du frottement. Si l'envoi de pièces jointes devient un besoin, il commence par le relais, pas par l'interface.
- Les anomalies de `checkDraft({ ..., intent: 'reply' })` s'affichent sous la zone. Avec la Task 2, seules `em_dash` et `empty_body` peuvent apparaître.
- **`empty_body` n'est jamais affiché**, seulement compté dans `blocking`. Filtrer sur le code, `blocks.filter((b) => b.code !== 'empty_body')`, et ne rien changer au rapport lui-même. Une feuille qui vient de s'ouvrir est vide par construction ; lui faire dire « Le message est vide. » avant que l'opérateur ait tapé un caractère, c'est reprocher un état normal. Le bouton `Envoyer` grisé le dit déjà, et pour un champ vide c'est la seule explication nécessaire. Le garde-fou reste entier côté envoi : c'est l'affichage qui se tait, pas la règle.
- `Envoyer` désactivé quand `report.blocking`.
- Sur échec d'envoi, le texte reste dans la zone et le message d'erreur s'affiche. Aucun texte perdu.

- [ ] **Step 2 : brancher dans `crm-app.tsx` selon l'intention**

```tsx
{intentOf(situation) === 'reply' ? (
  <ReplySheet key={selected.id} contact={selected} situation={situation} sentToday={sentToday} open={composerOpen} onOpenChange={setComposerOpen} />
) : (
  <OutboundSheet key={selected.id} contact={selected} situation={situation} sentToday={sentToday} open={composerOpen} onOpenChange={setComposerOpen} />
)}
```

`OutboundSheet` n'existe pas encore : garder temporairement `<ComposerDock .../>` dans la branche `else` et le remplacer à la Task 6.

- [ ] **Step 3 : vérifier que tout compile et passe**

Run: `cd frontend && npm test && npm run lint && npm run build`
Expected: tests verts, lint propre, build réussi.

- [ ] **Step 4 : vérifier à l'écran**

Run: `cd frontend && PORT=3111 npm start`
Ouvrir un contact dont le dernier message est entrant. Vérifier : la zone s'ouvre par-dessus, les derniers messages restent lisibles, aucun choix d'angle, aucun avertissement de longueur, aucune demande de désinscription. Puis ouvrir un contact jamais contacté et vérifier que l'ancien parcours complet apparaît.

- [ ] **Step 5 : commiter**

```bash
git add frontend/components/crm/reply-sheet.tsx frontend/components/crm/crm-app.tsx
git commit -m "feat(crm): replying is its own path, and it overlays instead of shrinking

A 370px header plus a 265px composer inside a 76vh panel left the thread zero
pixels, on an ordinary window. The reply sheet is positioned over the foot of
the pane, so the last messages stay readable while the answer is typed."
```

---

## Task 6 : la rédaction de prospection

**Files:**
- Create: `frontend/components/crm/outbound-sheet.tsx`
- Delete: `frontend/components/crm/composer-dock.tsx`
- Modify: `frontend/components/crm/crm-app.tsx`

**Interfaces:**
- Consumes: tout ce que `composer-dock.tsx` consommait déjà.
- Produces: `export function OutboundSheet(props: { contact: Contact; situation?: Situation; sentToday: number; open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element`, même signature que `ReplySheet`.

- [ ] **Step 1 : déplacer le contenu**

Créer `outbound-sheet.tsx` avec le contenu de `composer-dock.tsx`, en retirant uniquement le parcours de réponse (l'entrée « écrire de zéro » reste : elle sert aussi en prospection). Concrètement, le seul morceau à retirer est la clause `s?.nextAction === 'reply'` du brief de génération, ligne 235 de `composer-dock.tsx`, qui n'a plus d'objet ici : ce composant ne reçoit que des contacts dont la balle est dans leur camp.

**Ne pas passer `intent: 'outbound'` en dur.** Une première version de cette tâche le demandait ; c'était une erreur. `useGuardrails` reçoit déjà `situation` et dérive l'intention lui-même via `intentOf` (`guardrails-ui.tsx:118`), exactement comme le fait l'aiguillage de `crm-app.tsx`. Les deux lisent `ballInCourt`, donc ils s'accordent par construction. Écrire l'intention en dur créerait une seconde source de vérité capable de diverger en silence de celle qui a décidé quel composant afficher, ce qui est précisément le défaut que la Task 1 existe pour empêcher. `ReplySheet` ne le fait pas non plus.

Conserver tel quel : la sélection d'angle, le chargement du mail pré-écrit du prospect, les garde-fous complets, le dépôt en brouillon natif, et le commentaire expliquant pourquoi `deposit: false` (le dépôt IMAP mettait le brouillon là où le CRM ne le voit pas, l'envoi partait hors de `recordSent()` et laissait un trou dans la chronologie).

Adopter la même position superposée que `ReplySheet` : le fil ne perd pas sa hauteur en prospection non plus.

- [ ] **Step 2 : remplacer la branche `else` et supprimer l'ancien**

Dans `crm-app.tsx`, remplacer `<ComposerDock .../>` par `<OutboundSheet .../>`, retirer l'import, supprimer le fichier.

- [ ] **Step 3 : vérifier qu'il ne reste aucune référence**

Run: `cd frontend && grep -rn "composer-dock\|ComposerDock" --include="*.tsx" --include="*.ts" . | grep -v node_modules`
Expected: aucune sortie.

- [ ] **Step 4 : vérifier que tout compile et passe**

Run: `cd frontend && npm test && npm run lint && npm run build`
Expected: tests verts, lint propre, build réussi.

- [ ] **Step 5 : commiter**

```bash
git add frontend/components/crm/outbound-sheet.tsx frontend/components/crm/crm-app.tsx
git rm frontend/components/crm/composer-dock.tsx
git commit -m "refactor(crm): split the 829-line composer along the line that matters

One file carried three entry paths, angle selection, the full guardrail set and
the send. Two files now carry one intention each, and the prospecting one keeps
every rule it had."
```

---

## Task 7 : rendre la page à son travail

**Files:**
- Modify: `frontend/app/[locale]/dashboard/(protected)/contacts/page.tsx` (retrait, lignes 193 à 239)
- Modify: `frontend/app/[locale]/dashboard/(protected)/page.tsx` (accueil)
- Modify: `frontend/components/crm/crm-app.tsx` (hauteur)

**Interfaces:**
- Consumes: `StatCardV2`, `TopUsersToday`, `FunnelPanel`, et les calculs déjà présents dans `contacts/page.tsx`.
- Produces: aucune nouvelle interface.

- [ ] **Step 1 : déplacer les six cartes, le podium et le bandeau**

Retirer de `contacts/page.tsx` le `<TopUsersToday>`, la grille des six `<StatCardV2>` et le `<FunnelPanel>`, avec les calculs qui ne servent qu'à eux. Les porter dans `dashboard/(protected)/page.tsx`. Ne pas dupliquer un calcul : s'il sert aux deux pages, le déplacer dans `frontend/lib/crm/` et l'importer des deux côtés.

Garder sur la page Contacts, au-dessus du CRM, une seule ligne de contexte : le titre, le nombre de contacts suivis, le nombre qui attend une réponse, le nombre de relances dues, et le compte d'envois du jour. Le premier en couleur d'accent, les autres en gris. Aucune carte.

Le compte d'envois s'écrit `{sentToday} envoyé{sentToday > 1 ? 's' : ''} aujourd'hui`, la valeur venant du `sentToday` déjà calculé ligne 142 de la page. C'est le seul affichage de la cadence : le rail supprimé en tâche 4 le portait (`today-rail.tsx:196` avant suppression) et rien ne l'a repris, si bien que le garde-fou ne parle plus qu'au moment d'un envoi refusé, alors que la règle d'exploitation est de 5 à 10 par jour. Passer en couleur d'accent à partir de `SOFT_CAP` (importé de `@/lib/crm/guardrails`, jamais réécrit en dur) pour que la cadence se voie avant la décision d'écrire, pas après. Pas de capsule : du texte gris qui devient ambre.

- [ ] **Step 2 : deux corrections d'une ligne, trouvées en revue**

Les deux appartiennent à la géométrie et à la justesse du fil, donc elles se règlent ici plutôt qu'à la revue finale.

1. Dans `outbound-sheet.tsx`, `OUTBOUND_SHEET_PX` vaut 256 et la somme réelle est 264. Le commentaire affirme que les deux lignes de corps sont la seule différence avec la feuille de réponse ; le champ objet diffère aussi (`py-1 text-xs` soit 26 px côté réponse, `py-1.5 text-sm` soit 34 px ici, hérité du dock). Le contenu déborde donc d'environ 7 px et le bas de la sixième ligne de saisie est rogné dès l'ouverture, exactement ce que le commentaire prétend écarter. Porter la constante à 264 et corriger la phrase, ou aligner l'objet sur la forme compacte du frère. La réserve de défilement du parent se recalcule seule, elle est dérivée.

2. Dans `reply-sheet.tsx`, `replySubject` remonte tous les messages pour trouver l'objet à préremplir, robots compris, alors que `thread-tail.ts:189` saute `isAutomated` pour choisir le mail auquel répondre. Un accusé de réception automatique arrivé après le mail humain fait donc préremplir « Re: » suivi de l'objet du robot pendant que le brief de génération, lui, vise le bon mail. Sauter `isAutomated(m)` dans la boucle.

- [ ] **Step 3 : rendre la hauteur au fil**

Dans `crm-app.tsx`, remplacer `max-h-[76vh]` par une hauteur calculée depuis le haut réel du volet, la barre de contexte étant désormais la seule chose au-dessus :

```tsx
className="flex min-w-0 flex-col h-[calc(100vh-9rem)]"
```

Cette valeur ne peut pas être mesurée dans ce worktree, qui n'a ni login au tableau de bord ni secret d'administration. Elle est donc posée par le calcul et vérifiée à la revue visuelle de fin de lot, sur un preview. La poser en une seule constante commentée, pas dispersée.

- [ ] **Step 4 : vérifier que tout compile et passe**

Run: `cd frontend && npm test && npm run lint && npm run build`
Expected: tests verts, lint propre, build réussi.

- [ ] **Step 5 : prouver l'égalité des nombres sans écran**

Le vrai risque du déplacement n'est pas la mise en page, c'est que les deux pages divergent sur un nombre. Il se traite sans navigateur : tout calcul qui sert aux deux pages doit vivre dans un seul module de `frontend/lib/crm/` et être importé des deux côtés. **Aucun calcul dupliqué, aucune constante recopiée.** Après le déplacement, lister dans le rapport chaque nombre affiché par les deux pages avec le module qui le produit. Si un nombre n'a qu'une seule origine, il ne peut pas diverger, et la question est close sans regarder l'écran.

- [ ] **Step 6 : commiter**

```bash
git add frontend/app/\[locale\]/dashboard/\(protected\)/contacts/page.tsx frontend/app/\[locale\]/dashboard/\(protected\)/page.tsx frontend/components/crm/crm-app.tsx
git commit -m "feat(crm): the work comes first on the page that is for working

Contacts stacked a podium, six figure cards and a campaign band before the CRM,
about 640px before the first conversation. Watching and working are two
gestures; they now live on two pages."
```

Ne pas pousser, ne pas rebaser : la branche part en revue complète après cette tâche, et c'est le coordinateur qui la pousse une fois la revue passée. Des sessions parallèles travaillent sur ce dépôt, un rebase lancé au milieu du lot ferait plus de mal que de bien.

---

## Ce que le lot 1 ne fait pas

- Les fils restent groupés par adresse. Le chaînage par identifiant de message est au lot 2, faute de `message_id` dans le type `Message` actuel.
- Pas de pièces jointes, pas de recherche plein texte, pas d'indicateur de fraîcheur : lot 2.
- La recherche de la barre du haut reste celle d'aujourd'hui, sur les contacts chargés. Elle ne devient globale qu'au lot 2.
- Aucun accès depuis un téléphone. La forme est pensée pour un écran large.

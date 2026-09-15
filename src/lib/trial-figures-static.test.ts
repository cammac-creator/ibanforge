import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Le chiffre de l'essai dans la PROSE, celle qu'aucune constante n'alimente.
 *
 * Le garde frère (`trial-figures.test.ts`) pilote les vraies routes et tient les
 * surfaces servies par du code. Ici ce sont des fichiers lus au disque : les
 * docs, les deux `llms.txt` statiques, les deux README et les articles qui
 * citent l'essai. Aucune constante ne les atteint, donc le chiffre y est écrit à
 * la main, en trois langues, parfois en toutes lettres et parfois en ordinal
 * (« le onzième appel »).
 *
 * 🚨 Écrit en PLAFOND de lignes encore à migrer, et pas en assertion d'absence,
 * pour une raison de fait : au 15/09/2026 ces fichiers disent encore dix. Les
 * réécrire appartient au lot des textes humains, et un garde rouge à l'arrivée
 * n'aurait laissé que deux issues — toucher au périmètre de quelqu'un d'autre,
 * ou se désarmer. Le plafond, lui, mesure la dette, empêche qu'elle grossisse,
 * et descend à zéro quand les textes passent. Même doctrine que
 * `src/routes/static-claims.test.ts`.
 *
 * ⚠️ Ce qui est interdit TOUT DE SUITE et sans plafond : « partagé par toutes
 * les instances », dans les trois langues. Cette phrase n'est ni prouvable
 * aujourd'hui (un conteneur, un volume à attachement unique) ni tenable demain
 * (SQLite sur un volume ne suit pas une seconde réplique) : elle casserait
 * exactement le jour où elle compterait. Et la deuxième personne dans un
 * message d'épuisement, parce qu'un préfixe /64 partagé rend « vous avez
 * utilisé » faux pour l'appelant qui le lit.
 */

const ROOT = join(import.meta.dirname, '..', '..');

/**
 * La table, explicite et fermée. Elle exclut délibérément :
 *   - `CHANGELOG.md`, qui décrit le passé (même doctrine que
 *     `example-emails.test.ts`) ;
 *   - `docs/internal/**`, gitignoré et jamais servi ;
 *   - l'article `2026-07-03-mcp-server-in-production-what-breaks.mdx`, qui parle
 *     de sessions MCP oubliées « im Speicher » et qui a raison.
 */
const FILES = [
  'frontend/public/llms.txt',
  'frontend/public/llms-full.txt',
  'README.md',
  'mcp/README.md',
  ...['en', 'fr', 'de'].flatMap((lang) =>
    ['index', 'api-keys', 'onboarding', 'mcp'].map(
      (name) => `frontend/content/${lang}/docs/${name}.mdx`,
    ),
  ),
  ...['en', 'fr', 'de'].map(
    (lang) => `frontend/content/${lang}/blog/2026-09-07-bankleitzahl-pruefen-per-api.mdx`,
  ),
];

/** Une ligne qui parle de l'essai. Les autres ne regardent pas ce garde. */
const ABOUT_THE_TRIAL =
  /no key|sans clé|ohne Schlüssel|keyless|trial|essai|Testphase|Kostprobe|dégustation|taster/i;

/**
 * Le chiffre écrit en toutes lettres.
 *
 * 🚨 Le groupe final est OBLIGATOIRE, et c'est tout le piège : avec un groupe
 * optionnel, le motif se réduit à « zehn » suivi d'un mot, donc il attrape
 * « zehn Minuten » — une phrase juste, présente sur la même ligne que « ohne
 * Schlüssel » dans trois fichiers allemands. Un garde qui rougit sur une phrase
 * vraie se fait désarmer, et c'est ainsi qu'on perd un garde.
 */
const SPELLED_OUT = [
  /\bten (calls|checks|times|validations)\b/i,
  /\bdix (appels|vérifications|fois|validations)\b/i,
  /\bzehn (Aufrufe?n?|Prüfungen|Validierungen)\b|\bzehnmal am Tag\b/i,
];

/** L'ordinal « limite + 1 » : « Ab dem 11. Aufruf am Tag ». */
const ORDINALS = [
  /Ab dem \d+\. Aufruf am Tag/,
  /\b\d+(th|st|nd|rd) call of the day\b/i,
  /au \d+(e|ème) appel/i,
];

/**
 * Le chiffre en chiffres, sur une ligne qui parle de l'essai.
 *
 * Volontairement large : il compte la dette plutôt que de la juger. 10 et 25
 * seulement, et jamais un nombre décimal ou un millier ($0.005, 200, 100).
 */
const NUMERIC = /(?<![.,\d])(10|25)(?![.,]?\d)/;

/**
 * « Compté en mémoire, par instance ».
 *
 * 🚨 Le texte allemand réel est « im Arbeitsspeicher je Serverinstanz » : un
 * motif écrit « im Speicher » et « pro Instanz » ne l'attrape pas. Les deux
 * formes réelles sont dans ce motif, et « im Speicher » nu en est absent
 * exprès (voir l'exclusion de l'article sur les sessions MCP).
 */
const MEMORY_CLAIM = /in memory|per instance|par instance|Arbeitsspeicher|Serverinstanz/i;

/** La phrase qui ne doit exister nulle part, dans aucune des trois langues. */
const SHARING_CLAIM =
  /shared by every instance|partagé par toutes les instances|von allen Instanzen geteilt/i;

/**
 * La deuxième personne dans un message d'épuisement.
 *
 * ⚠️ La fenêtre est de 40 caractères et non de 20 : « Sie haben die 25 Aufrufe
 * von heute verbraucht » en fait 24 entre les deux moitiés, donc la forme courte
 * laissait passer la phrase allemande la plus probable.
 */
const SECOND_PERSON = /vous avez utilisé|Sie haben .{0,40}(verbraucht|genutzt)/i;

interface Tally {
  spelled: string[];
  ordinal: string[];
  numeric: string[];
  memory: string[];
  sharing: string[];
  secondPerson: string[];
}

function tally(): Tally {
  const out: Tally = {
    spelled: [],
    ordinal: [],
    numeric: [],
    memory: [],
    sharing: [],
    secondPerson: [],
  };
  for (const file of FILES) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    text.split('\n').forEach((line, i) => {
      const ref = `${file}:${i + 1}`;
      if (SHARING_CLAIM.test(line)) out.sharing.push(ref);
      if (SECOND_PERSON.test(line)) out.secondPerson.push(ref);
      if (!ABOUT_THE_TRIAL.test(line)) return;
      if (SPELLED_OUT.some((p) => p.test(line))) out.spelled.push(ref);
      if (ORDINALS.some((p) => p.test(line))) out.ordinal.push(ref);
      if (NUMERIC.test(line)) out.numeric.push(ref);
      if (MEMORY_CLAIM.test(line)) out.memory.push(ref);
    });
  }
  return out;
}

describe('la prose statique de l’essai', () => {
  it('ne promet JAMAIS un compteur partagé par toutes les instances', () => {
    const found = tally().sharing;
    expect(found, found.join('\n')).toEqual([]);
  });

  it('ne dit jamais à l’appelant qu’il a lui-même dépensé', () => {
    // Le seau est un préfixe /64 haché : plusieurs abonnés d'un même /64
    // partagent une franchise, et depuis le portage un redéploiement ne remet
    // plus le compteur à zéro. « Cette adresse », jamais « vous ».
    const found = tally().secondPerson;
    expect(found, found.join('\n')).toEqual([]);
  });

  it('ne laisse pas augmenter le nombre de lignes encore à migrer', () => {
    const found = tally();
    // Budgets mesurés sur cette branche le 15/09/2026, à l'état où le lot 4
    // laisse les textes. Ces nombres ne remontent JAMAIS ; le lot des textes
    // humains les fait descendre, jusqu'à zéro au raccordement.
    const BUDGET = { spelled: 8, ordinal: 1, numeric: 23, memory: 6 } as const;
    for (const key of ['spelled', 'ordinal', 'numeric', 'memory'] as const) {
      expect(found[key].length, `${key}\n${found[key].join('\n')}`).toBeLessThanOrEqual(
        BUDGET[key],
      );
    }
  });
});

/**
 * Les motifs se testent eux-mêmes.
 *
 * Un garde de prose ne peut pas s'appuyer sur « il a trouvé quelque chose » :
 * le jour où les textes seront justes, il ne trouvera plus rien, et c'est le
 * but. Ce qui reste vérifiable est que chaque motif attrape ce qu'il doit et
 * laisse passer ce qu'il ne doit pas — le patron de
 * `src/routes/static-claims.test.ts`.
 */
describe('les motifs eux-mêmes', () => {
  it.each([
    'ten calls a day with no key',
    'dix vérifications par jour et par adresse sans clé',
    'zehn Prüfungen pro Tag und Adresse ohne Schlüssel',
    'zehnmal am Tag pro Adresse, ohne Schlüssel',
  ])('repère le chiffre en toutes lettres : %s', (line) => {
    expect(SPELLED_OUT.some((p) => p.test(line))).toBe(true);
  });

  it.each([
    // 🚨 Les quatre lignes allemandes réelles qui ont fait rougir la première
    // version de ce motif : « zehn Minuten » sur la même ligne que « ohne
    // Schlüssel ». Le motif doit les laisser passer.
    'In zehn Minuten ohne Schlüssel einsatzbereit',
    'Der Schlüssel ist in zehn Minuten da, ohne Karte',
    'ten thousand BIC entries',
    'HTTP 200 means success',
  ])('ne confond pas une autre phrase avec le chiffre : %s', (line) => {
    expect(SPELLED_OUT.some((p) => p.test(line))).toBe(false);
  });

  it.each([
    'and gezählt wird im Arbeitsspeicher je Serverinstanz',
    'the allowance is counted in memory per server instance',
    'le décompte vit en mémoire, par instance de serveur',
  ])('repère la promesse « en mémoire » réelle : %s', (line) => {
    expect(MEMORY_CLAIM.test(line)).toBe(true);
  });

  it.each([
    'The count is shared by every instance',
    'le décompte est partagé par toutes les instances',
    'Der Zähler wird von allen Instanzen geteilt',
  ])('repère la promesse qui ne doit pas exister : %s', (line) => {
    expect(SHARING_CLAIM.test(line)).toBe(true);
  });

  it.each(['Ab dem 26. Aufruf am Tag', 'the 26th call of the day', 'au 26e appel'])(
    'repère un ordinal écrit à la main : %s',
    (line) => {
      expect(ORDINALS.some((p) => p.test(line))).toBe(true);
    },
  );

  it.each(['$0.005 per call', '200 requests a month', '1,100+ Swiss entries', '100 req/min'])(
    'ne compte pas un autre nombre comme le plafond : %s',
    (line) => {
      expect(NUMERIC.test(line)).toBe(false);
    },
  );

  it.each([
    'Vous avez utilisé les 25 validations sans clé du jour',
    'Sie haben die 25 Aufrufe von heute verbraucht',
  ])('repère la deuxième personne dans un message d’épuisement : %s', (line) => {
    expect(SECOND_PERSON.test(line)).toBe(true);
  });

  it.each([
    'Cette adresse a utilisé les 25 validations sans clé du jour',
    'Diese Adresse hat die 25 Aufrufe von heute verbraucht',
  ])('laisse passer la formule impersonnelle : %s', (line) => {
    expect(SECOND_PERSON.test(line)).toBe(false);
  });
});

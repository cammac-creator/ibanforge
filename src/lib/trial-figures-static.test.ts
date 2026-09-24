import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { REST_TRIAL_WEEKLY_LIMIT, TRIAL_FREE_KEY_HINT } from './trial.js';
import { MCP_SESSIONS_PER_IP_DAY, MCP_WEEKLY_LIMIT } from './mcp-limits.js';
import { DAILY_KEY_CREATION_LIMIT } from './key-creation-guard.js';

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
 * Écrit d'abord en PLAFOND de lignes encore à migrer (15/09/2026 : ces fichiers
 * disaient encore dix, et les réécrire appartenait au lot des textes humains).
 * Le 24/09/2026 ce lot est passé : plus aucune ligne ne dit dix, en chiffres,
 * en lettres ou en ordinal. Les plafonds sont donc descendus à ZÉRO et sont
 * devenus des égalités, et le compte des lignes chiffrées, qui mesurait des
 * copies à tenir, est remplacé par ce qu'il protégeait.
 *
 * Le même jour, Claude-Alain a passé l'essai de 25 par JOUR à 25 par SEMAINE.
 * Deux gardes en découlent : aucune ligne sur l'essai ne relie plus un chiffre
 * au jour (« a day », « par jour », « pro Tag »), hors les deux autres quotas
 * du jour qui vivent dans les mêmes pages ; et chaque plafond de la semaine
 * écrit à la main est celui que le code applique. Le jour où la constante ou
 * l'unité change, chaque copie rougit ici et nomme sa ligne.
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
  // Ajoutés le 24/09/2026 : les pages qui citent l'essai et qu'aucun garde ne
  // lisait. L'article suisse du 14.09 disait « dix par jour » depuis dix jours.
  ...['en', 'fr', 'de'].flatMap((lang) =>
    [
      'errors',
      'iban-validate',
      'iban-batch',
      'pay-as-an-agent',
      'ch-clearing',
      'compliance',
      'recipes',
    ].map((name) => `frontend/content/${lang}/docs/${name}.mdx`),
  ),
  ...['en', 'fr', 'de'].flatMap((lang) =>
    ['2026-09-07-bankleitzahl-pruefen-per-api', '2026-09-14-schweizer-iban-pruefen'].map(
      (slug) => `frontend/content/${lang}/blog/${slug}.mdx`,
    ),
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
 * Un plafond DU JOUR écrit en chiffres : le nombre, puis, sans autre chiffre
 * entre les deux, l'unité du jour dans l'une des trois langues.
 *
 * « Sans autre chiffre entre les deux » est ce qui empêche une phrase juste de
 * rougir : « 25 par mois sur toutes les routes. Sans clé : 25 validations par
 * jour » ne relie au jour que le second 25. Deux autres quotas du jour vivent
 * dans les mêmes pages et gardent leur propre chiffre : l'ouverture de sessions
 * MCP, reconnue à « session », et la création de clés (3 par réseau et par
 * jour), reconnue à « per network ». Depuis le soir du 24/09/2026, l'accès MCP
 * sans clé n'en fait plus partie : il se compte à la semaine (voir plus bas).
 */
const DAILY_FIGURE =
  /(?<![.,\d$/])(\d+)(?![.,]?\d)(?![kK])[^\d\n]{0,40}?(?:\ba day\b|\bper day\b|\/day\b|par jour|pro Tag|am Tag)/gi;
const ABOUT_MCP = /\bMCP\b|tool calls?|appels? d'outil|Tool-Aufrufe?/i;
/**
 * Un plafond DE LA SEMAINE écrit en chiffres, même construction : le nombre,
 * puis l'unité de la semaine, sans autre chiffre entre les deux.
 */
const WEEKLY_FIGURE =
  /(?<![.,\d$/])(\d+)(?![.,]?\d)(?![kK])[^\d\n]{0,40}?(?:\ba week\b|\bper week\b|\/week\b|\bin the week\b|\bof the week\b|par semaine|de la semaine|dans la semaine|pro Woche|der Woche|in der Woche)/gi;
const ABOUT_SESSIONS = /\bsessions?\b|Sitzung/i;
const OTHER_DAILY_QUOTAS: Array<{ about: RegExp; value: number }> = [
  { about: ABOUT_SESSIONS, value: MCP_SESSIONS_PER_IP_DAY },
  {
    about: /keys? per network|clés? par réseau|Schlüssel pro Netz/i,
    value: DAILY_KEY_CREATION_LIMIT,
  },
];

/**
 * L'essai quotidien dit SANS chiffre (relecture du 24/09/2026, D18).
 *
 * Les deux motifs chiffrés ci-dessus commencent par `(\d+)` : « on the keyless
 * trial the counters are daily and that field reads `day` » et « the keyless
 * daily allowance described above » leur ont échappé, dans trois langues, sur
 * des pages que ce garde lit. Celui-ci lit les mots.
 *
 * « journalier » et non « journali » : « journalisé » et « journaux » vivent
 * sur les mêmes pages. Les deux exemptions du motif chiffré valent ici aussi :
 * une ligne du MCP hébergé (compté au jour, et c'est juste) et une ligne sur la
 * création de clés par réseau (« … per network per day … today »).
 */
const DAILY_WORDS =
  /\bdaily (allowance|trial|quota)\b|\bdaily\b[^.\n]{0,20}\b(allowance|trial)\b|counters are daily|reads `day`|vaut `day`|trägt `day`|journalier|quotidien|t[aä]glich|Zähler pro Tag|\btoday\b|midnight UTC|aujourd.hui|minuit|\bheute\b|Mitternacht/i;
const PER_NETWORK = /per network|par réseau|pro Netz/i;

/**
 * Le plafond MCP dit au jour sans chiffre : « the daily limit », « la limite du
 * jour », « Tageslimit ». Lu seulement sur une ligne qui parle du MCP.
 */
const MCP_DAILY_WORDS =
  /\bdaily\b|\bper day\b|\ba day\b|par jour|quotidien|journali[eè]r|pro Tag|am Tag|und Tag\b|t[aä]glich|Tages(limit|kontingent)/i;

/** Une ligne sur le MCP qui le compte encore au jour (sessions et clés à part). */
function saysMcpDaily(line: string): boolean {
  if (!ABOUT_MCP.test(line) || ABOUT_SESSIONS.test(line) || PER_NETWORK.test(line)) return false;
  return (
    [...line.matchAll(DAILY_FIGURE)].length > 0 ||
    DAILY_WORDS.test(line) ||
    MCP_DAILY_WORDS.test(line)
  );
}

/**
 * Exempté nommément : le README du paquet npm `ibanforge-mcp` (`mcp/`, hors du
 * périmètre de la PR 235) dit encore l'essai quotidien. Il se corrige avec la
 * prochaine publication du paquet, qui est le geste de Claude-Alain : retirer
 * alors cette exemption, le garde doit rester vert sans elle.
 */
const DAILY_WORDS_EXEMPT = new Set(['mcp/README.md']);

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
  /** Every daily figure written by hand on a line about the trial. */
  daily: Array<{ ref: string; value: number; other: boolean }>;
  /** Every weekly figure written by hand on a line about the trial. */
  weekly: Array<{ ref: string; value: number; mcp: boolean }>;
  /**
   * Since the evening of 24/09/2026 the keyless MCP allowance is weekly: on ANY
   * line about MCP, trial words or not, a daily figure or a daily word is wrong,
   * sessions aside. « 10 free tool calls per day » (pay-as-an-agent) said no
   * « no key » and escaped the trial scan.
   */
  mcpDaily: string[];
  /** A daily trial said in words, with no figure. */
  dailyWords: string[];
  memory: string[];
  sharing: string[];
  secondPerson: string[];
}

function tally(): Tally {
  const out: Tally = {
    spelled: [],
    ordinal: [],
    daily: [],
    weekly: [],
    dailyWords: [],
    mcpDaily: [],
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
      // Les ordinaux sont propres à l'essai : lus sur toutes les lignes. « Ab
      // dem 11. Aufruf am Tag » a survécu dix jours sur une ligne qui ne disait
      // ni « Kostprobe » ni « ohne Schlüssel ».
      if (ORDINALS.some((p) => p.test(line))) out.ordinal.push(ref);
      // Même exemption nommée que les mots du jour : le README du paquet npm
      // se corrige avec sa prochaine publication.
      if (!DAILY_WORDS_EXEMPT.has(file) && saysMcpDaily(line))
        out.mcpDaily.push(`${ref}: ${line.trim().slice(0, 120)}`);
      // L'exemple de démarrage est désormais exporté depuis le contrat. Seule
      // la ligne EXACTE est exemptée ; onboarding-parity.test.ts contrôle le
      // bloc complet dans les trois langues. Le plafond de prose ne remonte pas.
      // Même exemption pour la page Prise en main (audit du 16/09/2026) : sa
      // ligne d'exemple est désormais la constante servie, mot pour mot.
      if (
        /\/docs\/(index|onboarding)\.mdx$/.test(file) &&
        line.trim() === `"free_key": ${JSON.stringify(TRIAL_FREE_KEY_HINT)},`
      )
        return;
      if (!ABOUT_THE_TRIAL.test(line)) return;
      if (SPELLED_OUT.some((p) => p.test(line))) out.spelled.push(ref);
      for (const m of line.matchAll(DAILY_FIGURE)) {
        const value = Number(m[1]);
        const other = OTHER_DAILY_QUOTAS.some((q) => q.value === value && q.about.test(line));
        out.daily.push({ ref, value, other });
      }
      for (const m of line.matchAll(WEEKLY_FIGURE))
        out.weekly.push({ ref, value: Number(m[1]), mcp: ABOUT_MCP.test(line) });
      if (
        !DAILY_WORDS_EXEMPT.has(file) &&
        DAILY_WORDS.test(line) &&
        !ABOUT_MCP.test(line) &&
        !PER_NETWORK.test(line)
      ) {
        out.dailyWords.push(ref);
      }
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

  it('n’écrit plus le plafond en toutes lettres, en ordinal, ni « en mémoire »', () => {
    // Budgets du 15/09/2026 : 8, 1 et 6. Descendus à zéro le 24/09/2026 avec
    // la réécriture des articles et des pages de doc ; ils ne remontent plus.
    const found = tally();
    for (const key of ['spelled', 'ordinal', 'memory'] as const) {
      expect(found[key], `${key}\n${found[key].join('\n')}`).toEqual([]);
    }
  });

  it('ne relie plus jamais le chiffre de l’essai au jour (a day, par jour, pro Tag)', () => {
    // 🚨 Le garde du 24/09/2026 : l'essai se compte à la semaine. Sur une
    // ligne qui parle de l'essai, le seul chiffre du jour permis est celui
    // d'un AUTRE quota du jour (MCP hébergé, création de clés), reconnu à sa
    // ligne et à sa valeur.
    const { daily } = tally();
    const wrong = daily
      .filter(({ other }) => !other)
      .map(({ ref, value }) => `${ref}: ${value} par jour`);
    expect(wrong, wrong.join('\n')).toEqual([]);
  });

  it('ne compte jamais plus l’accès MCP au jour, en chiffres ni en mots (sessions à part)', () => {
    const { mcpDaily } = tally();
    expect(mcpDaily, mcpDaily.join('\n')).toEqual([]);
  });

  it('ne dit pas non plus l’essai quotidien en toutes lettres (daily, today, `day`)', () => {
    const { dailyWords } = tally();
    expect(dailyWords, dailyWords.join('\n')).toEqual([]);
  });

  it('écrit le plafond de la semaine que le code applique, sur chaque ligne qui le cite', () => {
    const { weekly } = tally();
    // Une ligne sur le MCP peut porter le chiffre de l'accès MCP sans clé ;
    // toute autre ligne, celui de l'essai REST. Égaux aujourd'hui, séparés dans
    // le code, et ce test rougira le jour où l'un bouge sans l'autre.
    const wrong = weekly
      .filter(
        ({ value, mcp }) =>
          value !== REST_TRIAL_WEEKLY_LIMIT && !(mcp && value === MCP_WEEKLY_LIMIT),
      )
      .map(({ ref, value }) => `${ref}: ${value}`);
    expect(wrong, wrong.join('\n')).toEqual([]);
    // Un balayage qui ne voit rien ne prouve rien : l'essai est cité, en
    // chiffres, dans les trois langues de plusieurs pages.
    expect(weekly.length).toBeGreaterThan(10);
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

  const dailyValues = (line: string): number[] =>
    [...line.matchAll(DAILY_FIGURE)].map((m) => Number(m[1]));

  it.each([
    ['No key at all: up to 25 IBAN validations a day per address', [25]],
    ['the keyless trial serves up to 10 calls a day per address', [10]],
    ["l'essai sans clé sert jusqu'à 25 appels par jour et par adresse", [25]],
    ['bis zu 25-mal pro Tag für die Adresse', [25]],
    ['First 10/day per IP free, no key', [10]],
  ] as const)('lit le plafond du jour écrit à la main : %s', (line, values) => {
    expect(dailyValues(line)).toEqual(values);
  });

  it.each([
    '$0.005 per call',
    '200 requests a month',
    '1,100+ Swiss entries',
    '100 req/min',
    // Le 25 du mois, puis le 25 du jour : seul le second est un plafond du jour.
    'it starts at 25 a month, on every endpoint.',
    '25k credits for $80, valid every day',
    '(IPv6 counted per /64) are served in full',
  ])('ne prend pas un autre nombre pour le plafond du jour : %s', (line) => {
    expect(dailyValues(line)).toEqual([]);
  });

  it('ne relie au jour que le chiffre qui le précède directement', () => {
    expect(
      dailyValues('Unclaimed, it starts at 25 a month. No key at all: up to 25 validations a day.'),
    ).toEqual([25]);
  });

  const weeklyValues = (line: string): number[] =>
    [...line.matchAll(WEEKLY_FIGURE)].map((m) => Number(m[1]));

  it.each([
    ['No key at all: up to 25 IBAN validations a week per address', [25]],
    ['Past 25 calls in the week the endpoint answers 402', [25]],
    ["l'essai sans clé sert jusqu'à 25 appels par semaine et par adresse", [25]],
    ['Au-delà des 25 appels de la semaine, prenez la clé', [25]],
    ['bis zu 25-mal pro Woche für die Adresse', [25]],
    ['Nach den 25 Aufrufen der Woche holen Sie sich den Schlüssel', [25]],
  ] as const)('lit le plafond de la semaine écrit à la main : %s', (line, values) => {
    expect(weeklyValues(line)).toEqual(values);
  });

  it.each([
    'it starts at 25 a month, on every endpoint.',
    'reset on Monday 00:00 UTC',
    '10 MCP tool calls/day per source address',
  ])('ne prend pas un autre nombre pour le plafond de la semaine : %s', (line) => {
    expect(weeklyValues(line)).toEqual([]);
  });

  it.each([
    // Les quatre lignes réelles qui ont échappé au motif chiffré.
    '`month` is the calendar month (`YYYY-MM`); on the keyless trial the counters are daily and that field reads `day`.',
    "sur l'essai sans clé, les compteurs sont journaliers et ce champ vaut `day`.",
    'beim Test ohne Schlüssel zählen die Zähler pro Tag, und das Feld trägt `day`.',
    'the same call still works within the keyless daily allowance described above: a `trial` block',
  ])('repère l’essai quotidien dit sans chiffre : %s', (line) => {
    expect(DAILY_WORDS.test(line)).toBe(true);
  });

  it.each([
    // Justes, et laissées passer par les exemptions ou par le motif lui-même.
    'At most 3 free keys per network per day — existing keys keep working. Need more capacity today? No key needed for x402.',
    'The MCP taster keeps answering after its daily allowance, with no key at all.',
    'Until 24 September 2026 the keyless trial was daily; it is counted by the week.',
    'Il peut être journalisé sans risque, même sans clé.',
  ])('laisse passer une phrase juste : %s', (line) => {
    const caught = DAILY_WORDS.test(line) && !ABOUT_MCP.test(line) && !PER_NETWORK.test(line);
    expect(caught).toBe(false);
  });

  it('reconnaît une ligne du MCP', () => {
    expect(ABOUT_MCP.test('The MCP server gives 10 free tool calls per day')).toBe(true);
    expect(ABOUT_MCP.test('the keyless trial serves up to 25 calls a day')).toBe(false);
  });

  it.each([
    // Les trois lignes réelles d'avant le 24/09/2026 au soir.
    '- The [MCP server](/docs/mcp) gives 10 free tool calls per day — enough to check the data quality on your own IBANs.',
    "Transport HTTP streamable, **10 appels d'outils gratuits par IP et par jour**, sans aucune clé",
    'Streamable-HTTP-Transport, **10 kostenlose Tool-Aufrufe pro IP und Tag**, ganz ohne Schlüssel',
    'The HTTP MCP transport has its own allowance, counted by the day: 10 tool calls/day per source address',
  ])('attrape l’accès MCP compté au jour : %s', (line) => {
    expect(saysMcpDaily(line)).toBe(true);
  });

  it.each([
    'Streamable HTTP transport, **25 free tool calls a week per source address**, no key at all',
    'Daily MCP session limit reached (30 new sessions/day).',
    'At most 3 free keys per network per day, whatever MCP client asks.',
  ])('laisse passer l’accès MCP à la semaine, et les sessions : %s', (line) => {
    expect(saysMcpDaily(line)).toBe(false);
  });

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

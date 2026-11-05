/**
 * « De la citation au client » : la carte du bulletin du lundi, sur huit semaines suisses.
 *
 * Aucune donnée nouvelle : un classement de champs déjà enregistrés (`signup_attribution`
 * pour l'origine, `lineage_facts` et `key_purchases` par la préparation du tableau des
 * portes, `web_events` pour les clics).
 *
 * ## Ce qui n'est pas mesuré, et le reste
 *
 * Le site n'enregistre aucune visite : `web_events` n'a que des clics sur des éléments
 * marqués, sans identifiant. Le nombre de personnes arrivées depuis une IA n'existe donc
 * pas (`arrivals_measured: false`), et les clics restent à part, un volume. Le compter
 * demanderait une nouvelle collecte : ce n'est pas à ce fichier d'en décider.
 *
 * ## Une lecture par semaine de CRÉATION
 *
 * Contrairement au tableau des portes, qui range chaque colonne à la semaine de son
 * événement, chaque ligne suit ici les clés nées cette semaine-là, et ce qu'elles ont fait
 * depuis : la ligne se lit de gauche à droite, et une semaine passée peut encore gagner un
 * appel ou un paiement.
 *
 * ## Inconnu n'est pas une IA, non mesuré n'est pas zéro
 *
 * Une clé sans référent ni étiquette est `unknown_keys`, jamais une IA. Une semaine d'avant
 * le début d'une mesure vaut `null`, jamais 0. Les dates de début sont lues à l'exécution.
 */
import { getStatsDB } from './db.js';
import { getPeopleLineages } from './door-board.js';
import {
  AI_ASSISTANTS,
  aiAssistantOf,
  entryReferrerCategory,
  type AiAssistant,
} from './entry-categories.js';
import { parseDbUtc, sqliteUtc, swissWeekShift, type SwissWeek } from './swiss-week.js';
import { clicksByReferrer, oldestWebEventAt } from './web-events.js';

export const CITATION_WEEKS = 8;

/** Une semaine est couverte par une mesure en entier, en partie, ou pas du tout. */
export type MeasureCoverage = 'full' | 'partial' | 'none';

export interface CitationSteps {
  /** Clés nées depuis une IA ; null quand l'origine n'était pas encore enregistrée. */
  keys: number | null;
  /** Parmi elles, celles qui ont obtenu un premier appel réussi, à ce jour. */
  used: number | null;
  /** Parmi elles, celles qui ont au moins un paiement au registre, à ce jour. */
  paid: number | null;
}

export interface CitationWeek extends CitationSteps {
  week: string;
  monday: string;
  sunday: string;
  coverage: { keys: MeasureCoverage; used: MeasureCoverage; paid: MeasureCoverage };
  /** Toutes les clés de personnes nées cette semaine, pour situer la part des IA. */
  all_keys: number | null;
  /** Parmi elles, celles sans référent ni étiquette : ni IA, ni autre site. */
  unknown_keys: number | null;
  /** Des actions, pas des personnes ; null avant la plus ancienne ligne gardée. */
  site_clicks: number | null;
}

export interface CitationAssistant extends CitationSteps {
  assistant: AiAssistant;
}

export interface BulletinCitation {
  state: 'read';
  /** Le site ne compte aucune visite : le nombre de personnes arrivées n'existe pas. */
  arrivals_measured: false;
  /** La plus récente d'abord ; la première est la semaine du bulletin. */
  weeks: CitationWeek[];
  /** Sur les semaines mesurées de `weeks`. La somme des lignes vaut le total des semaines. */
  assistants: CitationAssistant[];
  /** Le début de chaque mesure, UTC ; null quand elle n'a encore rien écrit. */
  since: {
    keys: string | null;
    used: string | null;
    paid: string | null;
    site_clicks: string | null;
  };
}

function coverageOf(week: SwissWeek, sinceMs: number | null): MeasureCoverage {
  if (sinceMs === null || week.endMs <= sinceMs) return 'none';
  return week.startMs >= sinceMs ? 'full' : 'partial';
}

/** La plus tardive de deux dates de début ; inconnue dès que l'une l'est. */
function laterOf(a: string | null, b: string | null): string | null {
  if (a === null || b === null) return null;
  return (parseDbUtc(a) ?? 0) >= (parseDbUtc(b) ?? 0) ? a : b;
}

export function readCitation(bulletinWeek: SwissWeek, nowMs: number): BulletinCitation {
  const db = getStatsDB();
  const weeks: SwissWeek[] = [];
  for (let i = 0; i < CITATION_WEEKS; i++) weeks.push(swissWeekShift(bulletinWeek, i));
  const oldest = weeks[weeks.length - 1];

  const keysSince = (
    db.prepare('SELECT min(created_at) AS t FROM signup_attribution').get() as { t: string | null }
  ).t;
  const firstCallsSince = (
    db.prepare('SELECT min(birth_at) AS t FROM lineage_facts WHERE backfilled = 0').get() as {
      t: string | null;
    }
  ).t;
  // Chaque étape classe les clés par leur origine : aucune ne commence avant celle-là.
  const usedSince = laterOf(keysSince, firstCallsSince);
  const clicksSince = oldestWebEventAt();
  const keysSinceMs = parseDbUtc(keysSince);
  const usedSinceMs = parseDbUtc(usedSince);
  const clicksSinceMs = parseDbUtc(clicksSince);

  // L'origine écrite juste après la clé : une journée de marge suffit aux deux bouts.
  const origins = new Map<string, { referrer: string | null; utm_source: string | null }>();
  for (const r of db
    .prepare(
      `SELECT key_prefix, referrer, utm_source FROM signup_attribution
        WHERE created_at >= ? AND created_at < ?`,
    )
    .all(
      sqliteUtc(oldest.startMs - 86_400_000),
      sqliteUtc(bulletinWeek.endMs + 86_400_000),
    ) as Array<{
    key_prefix: string;
    referrer: string | null;
    utm_source: string | null;
  }>) {
    origins.set(r.key_prefix, { referrer: r.referrer, utm_source: r.utm_source });
  }

  type Tally = { all: number; unknown: number; ai: Record<AiAssistant, CitationCount> };
  type CitationCount = { keys: number; used: number; paid: number };
  const emptyCount = (): CitationCount => ({ keys: 0, used: 0, paid: 0 });
  const tallies = weeks.map((): Tally => ({
    all: 0,
    unknown: 0,
    ai: {
      chatgpt: emptyCount(),
      perplexity: emptyCount(),
      gemini: emptyCount(),
      copilot: emptyCount(),
      claude: emptyCount(),
    },
  }));

  for (const l of getPeopleLineages({ now: nowMs })) {
    if (l.birthMs === null) continue;
    const index = weeks.findIndex((w) => l.birthMs! >= w.startMs && l.birthMs! < w.endMs);
    if (index < 0) continue;
    const tally = tallies[index];
    tally.all += 1;
    // La naissance d'abord ; une rotation ne réécrit pas l'origine.
    const prefix = l.prefixes.find((p) => origins.has(p));
    const origin = prefix ? origins.get(prefix) : undefined;
    const assistant = aiAssistantOf(origin?.referrer, origin?.utm_source);
    if (!assistant) {
      if (!origin?.utm_source && entryReferrerCategory(origin?.referrer) === 'unknown') {
        tally.unknown += 1;
      }
      continue;
    }
    const cell = tally.ai[assistant];
    cell.keys += 1;
    if (l.firstSuccessMs !== null) cell.used += 1;
    if (l.firstPaidMs !== null) cell.paid += 1;
  }

  const rows: CitationWeek[] = weeks.map((w, i) => {
    const tally = tallies[i];
    const coverage = {
      keys: coverageOf(w, keysSinceMs),
      used: coverageOf(w, usedSinceMs),
      paid: coverageOf(w, keysSinceMs),
    };
    const cells = AI_ASSISTANTS.map((a) => tally.ai[a]);
    const sum = (pick: (c: CitationCount) => number): number =>
      cells.reduce((total, c) => total + pick(c), 0);
    const clicksCoverage = coverageOf(w, clicksSinceMs);
    return {
      week: w.label,
      monday: w.monday,
      sunday: w.sunday,
      coverage,
      keys: coverage.keys === 'none' ? null : sum((c) => c.keys),
      used: coverage.used === 'none' ? null : sum((c) => c.used),
      paid: coverage.paid === 'none' ? null : sum((c) => c.paid),
      all_keys: coverage.keys === 'none' ? null : tally.all,
      unknown_keys: coverage.keys === 'none' ? null : tally.unknown,
      site_clicks:
        clicksCoverage === 'none'
          ? null
          : clicksByReferrer(sqliteUtc(w.startMs), sqliteUtc(w.endMs)).reduce(
              (total, r) => total + (aiAssistantOf(r.referrer, null) ? r.count : 0),
              0,
            ),
    };
  });

  const assistants: CitationAssistant[] = AI_ASSISTANTS.map((assistant) => {
    const over = (
      pick: (c: CitationCount) => number,
      step: keyof CitationWeek['coverage'],
    ): number | null => {
      const measured = rows
        .map((row, i) => ({ row, i }))
        .filter(({ row }) => row.coverage[step] !== 'none');
      if (measured.length === 0) return null;
      return measured.reduce((total, { i }) => total + pick(tallies[i].ai[assistant]), 0);
    };
    return {
      assistant,
      keys: over((c) => c.keys, 'keys'),
      used: over((c) => c.used, 'used'),
      paid: over((c) => c.paid, 'paid'),
    };
  });

  return {
    state: 'read',
    arrivals_measured: false,
    weeks: rows,
    assistants,
    since: {
      keys: keysSince,
      used: usedSince,
      paid: keysSince,
      site_clicks: clicksSince,
    },
  };
}

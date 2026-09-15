/**
 * Cohort radar — pure logic.
 *
 * The CRM builds one dossier per address, so a burst of automated signups shows
 * up as N fake "customers" polluting every business reading. Regrouping them
 * under one synthetic contact was a manual gesture until now; this module is the
 * part that decides, from creation rows alone, WHICH signups form one cohort.
 *
 * Why the client library string is the anchor: signups are counted per network,
 * and a client presenting a fresh address for each signup makes every one of them
 * look like a first-time visitor. The library string it sends does not change
 * between those signups, so it links them back together.
 *
 * Why the decision is never taken on one address: a pseudonymous address is a
 * perfectly ordinary customer here (several paying ones use one). So a single
 * odd-looking address proves nothing — only a GROUP does: same client, same
 * short window, and a majority of addresses sharing the machine-made shape.
 */

/** A signup as recorded at creation time. */
export interface CreationRow {
  key_prefix: string | null;
  user_agent: string | null;
  email: string | null;
  created_at: string;
}

export interface CohortWindow {
  /** How far back to look, in hours. */
  hours: number;
  /** How many signups from one client in that window before it forms a cohort. */
  minKeys: number;
}

/**
 * Three nested windows rather than one threshold: a single "N per 15 minutes"
 * rule is blind to the slow variant (a signup every few minutes never trips it),
 * and a single weekly rule reacts far too late to a burst.
 */
export const COHORT_WINDOWS: CohortWindow[] = [
  { hours: 0.25, minKeys: 5 },
  { hours: 24, minKeys: 8 },
  { hours: 24 * 7, minKeys: 15 },
];

/** Share of a group's addresses that must look machine-made for it to qualify. */
export const MIN_MACHINE_SHAPE_RATIO = 0.6;

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

/**
 * Does this local part look machine-made rather than chosen by a person?
 *
 * Deliberately conservative — it is only ever used to measure a PROPORTION
 * inside an already-grouped set, never to judge one address on its own:
 *  - a person's address almost always carries a digit, a dot, a dash or an
 *    underscore; a generated one here was pure lowercase letters;
 *  - human words alternate vowels and consonants. A long consonant run, or
 *    almost no vowels at all, is the signature of a random draw.
 */
export function looksMachineMade(localPart: string): boolean {
  const s = localPart.toLowerCase();
  if (s.length < 8) return false;
  if (!/^[a-z]+$/.test(s)) return false;

  let vowels = 0;
  let run = 0;
  let longestRun = 0;
  for (const ch of s) {
    if (VOWELS.has(ch)) {
      vowels++;
      run = 0;
    } else {
      run++;
      if (run > longestRun) longestRun = run;
    }
  }
  return longestRun >= 4 || vowels / s.length < 0.25;
}

export function localPartOf(email: string): string {
  const at = email.indexOf('@');
  return at === -1 ? email : email.slice(0, at);
}

export interface Cohort {
  /** The client library string shared by every signup in the cohort. */
  userAgent: string;
  keyPrefixes: string[];
  /** Which window triggered it, for the report. */
  windowHours: number;
  machineShapeRatio: number;
  firstSeen: string;
  lastSeen: string;
}

/**
 * Find the cohorts among these creation rows.
 *
 * `now` is injected rather than read from the clock so the decision is
 * reproducible in tests and in a replay.
 *
 * Rows without a client library string are skipped entirely: with nothing to
 * link them, grouping them would mean grouping strangers together.
 */
/** SQLite datetime('now') writes "YYYY-MM-DD HH:MM:SS" in UTC; the space must
 *  become a T (and the zone be explicit) or Date reads it as local time and the
 *  window silently shifts by the machine's offset. Returns NaN on a bad value. */
function toMs(created_at: string): number {
  return new Date(`${created_at.replace(' ', 'T')}Z`).getTime();
}

/** Une rafale : la fenêtre qui a déclenché, et son ÉTENDUE réelle. */
export interface Burst {
  window: CohortWindow;
  startMs: number;
  endMs: number;
  keys: number;
}

/**
 * La plus longue rafale ININTERROMPUE, pour la première fenêtre qui déclenche.
 *
 * Appelée sur les horodatages de TOUTES les créations anonymes de la fenêtre,
 * sans regroupement préalable : elle décide qu'une rafale EXISTE, et l'ancre
 * décide seulement QUI tombe dedans. C'est ce qui la rend non fabricable par
 * l'appelant — un nombre de lignes n'est pas une valeur d'en-tête.
 *
 * Deux temps :
 *  1. déclenchement : un indice `hi` QUALIFIE quand sa fenêtre glissante porte
 *     au moins `minKeys` créations ;
 *  2. étendue : les indices qualifiants CONSÉCUTIFS forment une suite, qui va
 *     du `lo` de son premier indice au dernier indice qualifiant. Un indice non
 *     qualifiant COUPE la suite : c'est ce qui interdit d'agréger deux rafales
 *     séparées par une accalmie.
 *
 * 🚨 Rendre le DÉCLENCHEUR au lieu de l'ÉTENDUE est le piège de cette fonction.
 * Sur une ferme de 164 clés en 137 s, la fenêtre de 30 s atteint 15 clés au bout
 * de 12,5 s : rendre `[sortedMs[lo], sortedMs[hi]]` à cet instant donnerait un
 * rayon de 15 clés sur 164, dont la réparation évidente serait précisément
 * d'élargir à tout le groupe de l'ancre, c'est-à-dire l'incident du 20/08.
 *
 * On rend la suite la PLUS LONGUE, jamais la première : sur une ferme précédée
 * d'une fausse alerte courte, c'est la ferme qui doit définir le rayon.
 */
export function findBurst(sortedMs: number[], windows: CohortWindow[]): Burst | null {
  for (const w of windows) {
    const span = w.hours * 60 * 60 * 1000;
    let lo = 0;
    let runFrom = -1;
    let runTo = -1;
    let bestFrom = -1;
    let bestTo = -1;
    for (let hi = 0; hi < sortedMs.length; hi++) {
      while (sortedMs[hi] - sortedMs[lo] > span) lo++;
      if (hi - lo + 1 >= w.minKeys) {
        if (runFrom === -1) runFrom = lo; // le `lo` du PREMIER indice qualifiant
        runTo = hi;
      } else if (runFrom !== -1) {
        if (runTo - runFrom > bestTo - bestFrom) {
          bestFrom = runFrom;
          bestTo = runTo;
        }
        runFrom = -1;
        runTo = -1;
      }
    }
    if (runFrom !== -1 && runTo - runFrom > bestTo - bestFrom) {
      bestFrom = runFrom;
      bestTo = runTo;
    }
    if (bestFrom !== -1) {
      return {
        window: w,
        startMs: sortedMs[bestFrom],
        endMs: sortedMs[bestTo],
        keys: bestTo - bestFrom + 1,
      };
    }
  }
  return null;
}

/**
 * Does any SLIDING window of `hours` hold at least `minKeys` of these
 * timestamps? Returns the tightest matching window (they are tried narrowest
 * first, a tight burst being the stronger signal).
 *
 * Anchoring on the current tick instead — [now−15min, now] — would miss a
 * five-signup burst that finished twenty minutes before the hourly pass, and
 * that burst would then also fall under the wider thresholds. A slide over the
 * loaded history catches it whenever it happened.
 *
 * Délègue à `findBurst` depuis le lot 6 : le prédicat « une fenêtre qualifie »
 * est le même, et la passe e-mail n'a besoin que de la définition de la fenêtre.
 * Deux boucles coulissantes séparées auraient dérivé l'une de l'autre.
 */
function burstWindow(sortedMs: number[], windows: CohortWindow[]): CohortWindow | null {
  return findBurst(sortedMs, windows)?.window ?? null;
}

export function findCohorts(
  rows: CreationRow[],
  now: Date,
  windows: CohortWindow[] = COHORT_WINDOWS,
): Cohort[] {
  const maxHours = Math.max(...windows.map((w) => w.hours));
  const since = now.getTime() - maxHours * 60 * 60 * 1000;

  const usable = rows.filter(
    (r): r is CreationRow & { user_agent: string; key_prefix: string; email: string } =>
      typeof r.user_agent === 'string' &&
      r.user_agent.length > 0 &&
      typeof r.key_prefix === 'string' &&
      r.key_prefix.length > 0 &&
      typeof r.email === 'string' &&
      r.email.includes('@') &&
      !Number.isNaN(toMs(r.created_at)) &&
      toMs(r.created_at) >= since,
  );

  const byClient = new Map<string, Array<(typeof usable)[number]>>();
  for (const row of usable) {
    const list = byClient.get(row.user_agent);
    if (list) list.push(row);
    else byClient.set(row.user_agent, [row]);
  }

  const found: Cohort[] = [];
  for (const [userAgent, group] of byClient) {
    // The whole group's shape decides IF this is a cohort: same client, a burst,
    // and a machine-made majority. The shared quality bar guards against a busy
    // but human client.
    const machine = group.filter((r) => looksMachineMade(localPartOf(r.email)));
    const ratio = machine.length / group.length;
    if (ratio < MIN_MACHINE_SHAPE_RATIO) continue;

    const window = burstWindow(
      group.map((r) => toMs(r.created_at)).sort((a, b) => a - b),
      windows,
    );
    if (!window) continue;

    // But only the machine-shaped addresses are actually regrouped: the human
    // minority inside a poisoned or shared-client batch keeps its own dossier
    // and its normal monthly quota. Precision over recall — missing part of a
    // burst is cheap, catching a real customer is not.
    const machineTimes = machine.map((r) => r.created_at).sort();
    found.push({
      userAgent,
      keyPrefixes: [...new Set(machine.map((r) => r.key_prefix))],
      windowHours: window.hours,
      machineShapeRatio: Math.round(ratio * 100) / 100,
      firstSeen: machineTimes[0],
      lastSeen: machineTimes[machineTimes.length - 1],
    });
  }

  return found.sort((a, b) => b.keyPrefixes.length - a.keyPrefixes.length);
}

/**
 * Address used for a cohort's single dossier. The `.invalid` top-level domain
 * can never resolve, so no automated mail can ever be sent to it — the cohort
 * stays visible in the CRM without becoming a mail target.
 */
export function cohortAddress(userAgent: string, day: string): string {
  const slug = userAgent
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return `${slug || 'client'}-${day}@cohorte.invalid`;
}

// ---------------------------------------------------------------------------
// Palier ANONYME (chantier « clé sans e-mail », lot 6)
//
// Deux temps, et le premier est AVEUGLE À L'ANCRE : la rafale globale décide
// qu'un abus EXISTE (findBurst sur toutes les lignes), l'ancre décide seulement
// QUI tombe dedans (groupAnonymousCohorts). Grouper d'abord par ancre, puis
// chercher la rafale dans le groupe, se contournait pour sept chaînes de
// caractères : sept User-Agents à 14 clés par 30 s donnent 98 clés en 30 s sans
// qu'aucun groupe n'atteigne jamais son plancher.
// ---------------------------------------------------------------------------

/**
 * Fenêtres de la rafale ANONYME, mesurées sur TOUTES les créations anonymes de
 * la fenêtre de chargement, sans aucun regroupement préalable.
 *
 * Volontairement plus serrées que COHORT_WINDOWS, en cadence et en taille. La
 * cadence est sous-humaine et c'est le point : le maximum quotidien honnête
 * mesuré tient sur les doigts d'une main et le p99 horaire vaut 1. Quinze
 * inscriptions en trente secondes n'est pas un pic de découverte, c'est une
 * boucle.
 *
 * Pourquoi PAS « 5 clés en 5 minutes » : le jour d'un article ou d'une mise en
 * avant, cinq inscriptions en cinq minutes est la DÉFINITION d'un pic, et c'est
 * précisément le seul jour où ce module agit.
 */
export const ANON_BURST_WINDOWS: CohortWindow[] = [
  { hours: 30 / 3600, minKeys: 15 }, // 15 clés en 30 s, toutes ancres confondues
  { hours: 5 / 60, minKeys: 30 }, // 30 clés en 5 min, toutes ancres confondues
  // La ferme qui ÉTALE : une création toutes les trois minutes ne forme jamais
  // une rafale de trente secondes, et sans cette ligne elle sortait de la passe
  // avant tout regroupement, quel que soit son User-Agent (revue adversariale du
  // 15/09, lentille contournement, constat R7). Soixante clés en six heures, la
  // fenêtre de chargement entière : dix par heure, le seuil du disjoncteur, sur
  // toute la fenêtre — un pic de découverte honnête ne tient pas six heures.
  { hours: 6, minKeys: 60 },
];

/**
 * Plancher d'une ancre DANS la rafale, pour qu'elle puisse être coupée.
 *
 * 🚨 CE NOMBRE EST UN ARBITRAGE ENTRE DEUX PANNES OPPOSÉES, et il faut lire les
 * deux avant de le toucher :
 *
 *  - LE MONTER (à 8 ou 15) rouvre l'évasion par dilution : la ferme répartit ses
 *    clés sur assez de chaînes d'UA pour que chaque groupe reste sous le
 *    plancher, et plus rien n'est coupé. Ne pas « resserrer » ce nombre en
 *    croyant durcir le module : on le désarme.
 *
 *  - LE BAISSER (à 2, ou pire à 1) rend l'empoisonnement gratuit : l'attaquant
 *    déclenche la rafale globale sous sa propre chaîne, plante une clé sous
 *    `curl/8.7.1`, et la première clé honnête née dans la même demi-minute sous
 *    cette chaîne meurt avec elle.
 *
 * Ce plancher porte aussi, à lui seul, l'exigence « jamais si la clé est seule
 * de son User-Agent dans la fenêtre » : un groupe de 1 est sous 3.
 */
export const ANON_ANCHOR_MIN_KEYS = 3;

/**
 * Réseaux distincts exigés dans une cohorte pour qu'elle soit coupée
 * automatiquement (exigence E4 bis, portée du disjoncteur sur la révocation).
 *
 * 🚨 C'est le MÊME nombre que le seuil de diversité d'armement du disjoncteur,
 * et c'est délibéré : le lot 5 l'IMPORTE d'ici, il ne le redéclare pas. Quatre
 * définitions indépendantes de la constante 200 existent déjà dans ce dépôt ;
 * une cinquième autorité sur un seuil de sécurité serait la même faute au carré.
 *
 * Sans cette clause, l'empoisonnement de cohorte coûte UNE machine : l'attaquant
 * plante deux clés sous une chaîne générique depuis chez lui, et le nouveau venu
 * honnête né dans la même demi-minute tombe avec elles. Avec elle, il lui faut
 * cinq réseaux distincts. Le dégât d'une coupe est irréversible, celui d'une
 * cohorte rapportée mais non coupée ne l'est pas : à égalité de doute, on
 * rapporte.
 *
 * 🚨 Conséquence assumée sur l'ancre secondaire : une cohorte `ip:` porte UN
 * seul ip_hash par construction, donc la passe automatique ne la coupe JAMAIS.
 * C'est le bon comportement, pas un effet de bord : un ip_hash unique est aussi
 * la signature d'un NAT d'entreprise, d'une université ou d'un CGNAT
 * d'opérateur, derrière lequel des inconnus sans rapport partagent une adresse.
 * Une ferme mono-IP reste vue, nommée et rapportée, et se coupe à la main par
 * POST /v1/admin/cohorts/cut, où un humain porte la décision.
 */
export const BREAKER_MIN_DISTINCT_SOURCES = 5;

/**
 * Fenêtre glissante du compteur global du disjoncteur, en minutes.
 *
 * Déclarée ici parce que la seconde borne du rayon en a besoin
 * (`armed_at - BREAKER_WINDOW_MINUTES`, clause 1) et que le lot 6 précède le
 * lot 5. Même règle que ci-dessus : le lot 5 l'importe, il ne la redéclare pas.
 */
export const BREAKER_WINDOW_MINUTES = 60;

/** Jours pendant lesquels une ancre reste protégée, une fois ses preuves acquises. */
export const ANCHOR_TRUST_DAYS = 30;
/** Clés claimed|paid distinctes exigées sous une ancre pour la protéger. */
export const ANCHOR_TRUST_MIN_KEYS = 3;
/** ip_hash distincts parmi elles. */
export const ANCHOR_TRUST_MIN_SOURCES = 3;
/** Écart, en jours, entre la plus vieille et la plus récente de ces clés. */
export const ANCHOR_TRUST_MIN_SPREAD_DAYS = 7;

/**
 * Coupes maximales par passe, et par appel de la route manuelle.
 *
 * 🚨 Le motif n'est pas théorique : better-sqlite3 est SYNCHRONE et Node est
 * mono-fil. Une passe qui boucle sans borne sur les candidats de six heures de
 * chargement bloque la boucle d'événements pendant toutes ses transactions, et
 * l'API ne sert plus personne, clients payants compris. Le reste est rapporté en
 * `anon_pending` et repris au tick suivant.
 *
 * Le même nombre plafonne POST /v1/admin/cohorts/cut : deux budgets différents
 * (automatique par tick, manuel par appel), volontairement liés, pour qu'un
 * réglage ne s'applique jamais à un seul des deux chemins.
 */
export const ANON_REVOCATIONS_PER_TICK_MAX = 500;
/** Taille d'un lot transactionnel, entre deux points de respiration. */
export const ANON_REVOCATION_BATCH = 100;

/**
 * Ticks consécutifs pendant lesquels une cohorte doit être vue avant la première
 * coupe d'un épisode.
 *
 * Ce que cela coûte : cinq minutes de retard sur la coupe, sous alerte, sur des
 * unités NON DÉPENSÉES. Ce que cela achète : un empoisonnement doit être
 * maintenu deux ticks, et une cohorte née d'une coïncidence (un lot de tests,
 * une migration, un robot qui réessaie) disparaît d'elle-même avant la coupe.
 */
export const ANON_CONFIRM_TICKS = 2;

/**
 * Ancienneté d'une histoire de réseau qui exempte une clé du rayon (clause 9).
 *
 * Une clé dont l'ip_hash porte une création ANTÉRIEURE de plus de 24 h au début
 * de la rafale vient d'un réseau qui a une histoire, pas d'un proxy neuf.
 *
 * 🚨 Sa portée est honnête et étroite : elle protège l'intégrateur QUI REVIENT,
 * pas le nouveau venu, et le nouveau venu est exactement la population que ce
 * chantier existe pour gagner. Elle coûte à l'attaquant un jour de patience et
 * une clé par proxy. Elle est gardée parce qu'elle coûte une jointure.
 */
export const ANON_NETWORK_HISTORY_HOURS = 24;

/** Sentinelle écrite par tout chemin de frappe sans empreinte réseau. */
export const UNKNOWN_SOURCE = 'unknown';

/**
 * Une date lue depuis SQLite, en millisecondes.
 *
 * 🚨 Exportée exprès, pour qu'aucun module neuf ne réécrive le geste
 * `replace(' ', 'T') + 'Z'` de son côté. `datetime('now')` écrit
 * "YYYY-MM-DD HH:MM:SS" en UTC, sans zone ; `new Date()` lit alors une heure
 * LOCALE et la fenêtre glisse silencieusement du fuseau de la machine, sans
 * qu'aucun test ne rougisse. Trois modules de ce chantier calculent des fenêtres
 * glissantes sur ces horodatages, et c'est ici que le geste vit une seule fois.
 */
export function creationMs(created_at: string): number {
  return toMs(created_at);
}

/** L'inverse : un instant au format exact que `datetime('now')` écrit, en UTC. */
export function toSqliteUtc(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/** Une création anonyme chargée par le radar, telle qu'elle sort du SQL. */
export interface AnonCreationRow {
  /**
   * Le préfixe qui porte la LIGNE DE NAISSANCE, c'est-à-dire
   * `key_creations.key_prefix`.
   *
   * 🚨 Ce n'est PAS `api_keys.origin_prefix`, et les deux ne se valent jamais :
   * cette colonne-là est `NULL` pour une clé qui n'a jamais tourné, alors que ce
   * champ-ci porte toujours une valeur — le préfixe courant quand la clé n'a
   * jamais tourné, celui de la clé d'origine sinon. Le chargeur les réconcilie
   * par `COALESCE(k.origin_prefix, k.key_prefix) = c.key_prefix`. Nommer ce champ
   * `origin_prefix` faisait porter deux sens à un mot dans le seul module où la
   * lignée referme une évasion.
   */
  birth_prefix: string;
  key_prefix: string;
  key_hash: string;
  user_agent: string | null;
  ip_hash: string;
  created_at: string;
  /**
   * Première création jamais vue depuis ce réseau, ou null pour la sentinelle.
   * Sert la clause 9, et rien d'autre.
   */
  ip_first_seen: string | null;
}

/** Une cohorte anonyme : son ancre, et UNIQUEMENT les lignes de son rayon. */
export interface AnonCohort {
  /** 'ua:<user_agent>' ou 'ip:<ip_hash>'. */
  anchor: string;
  rows: AnonCreationRow[];
  /** ip_hash distincts dans le rayon : la garde de diversité (E4 bis). */
  distinctSources: number;
}

/**
 * Cette ligne est-elle dans le rayon de cette rafale ?
 *
 * Les bornes temporelles ont UNE seule autorité, en deux endroits explicites :
 * le WHERE du chargeur SQL et cette fonction. Un filtre d'ancienneté de plus
 * dans le regroupement masquerait la borne de rayon et rendrait son test
 * faussement vert.
 *
 * Trois conditions, dans l'ordre où elles coupent :
 *  1a. née DANS [burst.startMs, burst.endMs] — jamais l'historique complet d'un
 *      User-Agent, qui est l'incident du 20/08 ;
 *  1b. née après `armed_at - BREAKER_WINDOW_MINUTES` quand un épisode est connu.
 *      C'est cette seconde borne qui protège l'intégrateur honnête sous `node`,
 *      chaîne sous laquelle des centaines d'adresses de trafic légitime passent ;
 *   9. réseau sans histoire. Un ip_hash dont la plus ancienne création précède la
 *      rafale de plus de ANON_NETWORK_HISTORY_HOURS sort du rayon.
 */
export function withinRadius(
  row: AnonCreationRow,
  burst: Burst,
  armedAtMs: number | null,
): boolean {
  const at = toMs(row.created_at);
  if (Number.isNaN(at)) return false;
  if (at < burst.startMs || at > burst.endMs) return false;
  if (armedAtMs !== null && at < armedAtMs - BREAKER_WINDOW_MINUTES * 60 * 1000) return false;
  if (row.ip_first_seen) {
    const first = toMs(row.ip_first_seen);
    if (!Number.isNaN(first) && first <= burst.startMs - ANON_NETWORK_HISTORY_HOURS * 3600 * 1000) {
      return false;
    }
  }
  return true;
}

/**
 * Regroupe par ancre les lignes qui sont DANS le rayon d'une rafale déjà trouvée.
 *
 * MIN_MACHINE_SHAPE_RATIO n'est PAS appliqué ici : sans e-mail, il n'y a pas
 * d'adresse à juger. C'est le texte exact de la décision, et c'est la seule
 * garde de la passe e-mail qui disparaît sur ce palier.
 *
 * Ancre secondaire : les lignes SANS user_agent sont regroupées par ip_hash.
 * Elles ne peuvent pas l'être par UA, et une ferme mono-IP tomberait sinon dans
 * un angle mort. Une ligne n'entre jamais dans les deux groupes.
 *
 * 🚨 ip_hash = 'unknown' NE FAIT JAMAIS ANCRE. C'est la sentinelle écrite par
 * tout chemin de frappe sans empreinte : le mint admin, la frappe sous nonce, et
 * la quarantaine de sites d'appel de test. Quinze clés ainsi frappées en trente
 * secondes formeraient une cohorte `ip:unknown` dont rien ne dit qu'elles ont
 * quoi que ce soit en commun, et elles seraient coupées ensemble. Effet
 * secondaire immédiat dans la CI : la suite partage une base, et toute clé
 * anonyme laissée par un autre fichier de test tomberait sous cette ancre. Une
 * ligne sans UA et sans réseau exploitable reste COMPTÉE par la rafale globale
 * mais ne peut jamais faire cohorte.
 */
export function groupAnonymousCohorts(
  rows: AnonCreationRow[],
  burst: Burst,
  armedAtMs: number | null = null,
): AnonCohort[] {
  const byAnchor = new Map<string, AnonCreationRow[]>();
  for (const row of rows) {
    if (!withinRadius(row, burst, armedAtMs)) continue;
    let anchor: string | null = null;
    if (typeof row.user_agent === 'string' && row.user_agent.length > 0) {
      anchor = `ua:${row.user_agent}`;
    } else if (row.ip_hash && row.ip_hash !== UNKNOWN_SOURCE) {
      anchor = `ip:${row.ip_hash}`;
    }
    if (anchor === null) continue;
    const list = byAnchor.get(anchor);
    if (list) list.push(row);
    else byAnchor.set(anchor, [row]);
  }

  return [...byAnchor.entries()]
    .map(([anchor, group]) => ({
      anchor,
      rows: group,
      distinctSources: new Set(group.map((r) => r.ip_hash).filter((h) => h && h !== UNKNOWN_SOURCE))
        .size,
    }))
    .sort((a, b) => b.rows.length - a.rows.length);
}

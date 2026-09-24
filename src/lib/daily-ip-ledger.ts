import type { Statement } from 'better-sqlite3';
import { getStatsDB } from './db.js';
import { opsFail } from './ops-alert.js';
import {
  REST_TRIAL_WEEKLY_LIMIT,
  TRIAL_LEDGER_MAX_ROWS_PER_DAY,
  TRIAL_WEEKLY_MAX_ROWS,
  trialWeekStart,
} from './trial.js';
import { MCP_WEEKLY_LIMIT } from './mcp-limits.js';

/**
 * Le compteur derrière chaque franchise gratuite mesurée par source : les
 * appels d'outils MCP, les ouvertures de session MCP, et l'essai REST sans clé
 * sur POST /v1/iban/validate.
 *
 * 🚨 Depuis le 24/09/2026, l'essai REST se DÉCIDE à la semaine (25 appels par
 * semaine ISO en UTC, table `trial_weekly`, section « La semaine de l'essai »
 * en bas de ce fichier), et les appels d'outils MCP aussi (décision du même
 * jour, 22 h 05 : 25 unités par semaine et par source, seau `<h>` nu, distinct
 * du seau `rest:<h>` de l'essai REST). Leurs lignes quotidiennes restent
 * écrites ici, pour la trace `trial_daily`, les deux fenêtres glissantes et la
 * surface d'administration : elles mesurent, elles ne décident plus rien. Seul
 * le plafond des OUVERTURES de session MCP (`init:<h>`) reste quotidien et
 * passe toujours par `countDailyUnits`, inchangée.
 *
 * Porté d'une Map de niveau module vers la table `trial_ledger` de
 * stats.sqlite le 15/09/2026. Ce que cela achète, précisément : le décompte
 * SURVIT AU REDÉPLOIEMENT. Ce n'était pas le cas avant, et un service qui
 * publie plusieurs fois par jour rendait à chaque source une franchise neuve à
 * chaque fois.
 *
 * 🚨 Ce que cela n'achète PAS : le partage entre instances. Le service tourne
 * sur un seul conteneur contre un volume Railway à attachement unique
 * (railway.toml, `numReplicas = 1` relevé le 15/09/2026) — il n'y a donc jamais
 * eu de seconde instance avec qui partager, et s'il y en avait une un jour,
 * SQLite sur un volume ne suivrait pas. Ne jamais écrire « partagé par toutes
 * les instances » nulle part : écrire « survit au redéploiement ».
 *
 * Chaque appelant passe une clé NAMESPACÉE construite sur la SOURCE, pas sur
 * l'adresse : `rest:<h>`, `init:<h>`, `<h>` nu pour les appels d'outils MCP, où
 * <h> vaut hashIp(normalizeIpForGuard(ip)) — l'IPv6 repliée sur son /64
 * d'abord, puis hachée avec le sel du service. Compter des adresses entières
 * remettrait à un seul abonné IPv6 un nombre non borné de franchises
 * (key-creation-guard.ts:45-60), et cette table ne doit pas porter d'adresse en
 * clair quand request_log et key_creations n'en portent que le haché.
 *
 * Deux familles n'atteignent jamais la table : `evt:*` (déduplication de
 * télémétrie) et tout seau `unknown` (le seau partagé de repli fermé, qui doit
 * rester un frein local et non un verrou durable d'une journée entière).
 */

/** Ce que rend une dépense. */
export interface DailyCount {
  /** Faux dès que la dépense du jour a franchi le plafond. */
  allowed: boolean;
  /** Unités dépensées aujourd'hui Y COMPRIS cet appel — continue de croître. */
  used: number;
  remaining: number;
  /** Vrai quand le registre n'a pu être ni lu ni écrit du tout. */
  degraded?: true;
}

/** Ce que le disjoncteur (lot 5) lira pour armer son alerte sur cette porte. */
export interface TrialWindow {
  /** Seaux `rest:` distincts dans la fenêtre. */
  buckets: number;
  /** Unités dépensées par ces seaux, comptées jusqu'au franchissement. */
  units: number;
}

/** Une journée agrégée de `trial_daily`, telle que la surface d'admin la sert. */
export interface TrialDailyRow {
  day: string;
  rest_buckets: number;
  rest_units_counted: number;
  rest_attempts_uncounted: number;
  rest_over_limit: number;
  peak_hour_buckets: number;
  mcp_buckets: number;
  mcp_units: number;
  init_buckets: number;
  shield_minutes: number;
  created_at: string | null;
}

/**
 * Seaux qui ne vont JAMAIS en base : télémétrie, et le seau partagé des
 * appelants non plaçables.
 *
 * Les `evt:*` ne servent qu'à ne compter un événement qu'une fois par adresse
 * et par jour ; une perte au redéploiement coûte au pire un doublon sur le
 * tableau de bord, et les garder en mémoire divise par deux le volume
 * d'écriture du chemin anonyme.
 *
 * Les `unknown` sont plus importants : en base, `(jour, 'rest:unknown')` serait
 * une ligne durable jusqu'à minuit UTC qu'aucun redéploiement ne rattrape, donc
 * vingt-six requêtes sans adresse plaçable fermeraient l'essai de la journée
 * pour TOUS les appelants que le proxy ne sait pas placer. Le seau partagé n'a
 * de sens que comme frein local.
 *
 * ⚠️ Un seau haché ne peut pas déclencher ce motif par accident : il vaut 16
 * caractères de [0-9a-f], éventuellement précédés de `rest:` ou `init:`. `^evt:`
 * exige un `:` en quatrième position, qu'un hexadécimal n'a pas ; `unknown$`
 * exige les lettres k, n, w, qui ne sont pas hexadécimales. Le `$` est
 * obligatoire : sans lui, `rest:unknown-host.example` échapperait à la base.
 */
const MEMORY_ONLY = /^evt:|^(?:rest:|init:)?unknown$/;

/** `count` est le nombre d'unités du jour ; `date` le jour UTC concerné. */
const memoryCounts = new Map<string, { count: number; date: string }>();

/**
 * Seaux dont on SAIT qu'ils ont dépassé, aujourd'hui. Purement local.
 *
 * Sans cette marque, un appelant déjà exclu imposerait un UPSERT synchrone par
 * requête dans le fichier qui porte `api_keys`, les crédits et les traces de
 * paiement — le limiteur global autorise 100 req/min/IP, soit 144 000 écritures
 * par jour pour une seule source refusée. Le coût serveur d'un refusé reste
 * donc zéro, comme avant le portage.
 */
const overLimit = new Map<string, { day: string; used: number; limit: number }>();

/**
 * Tentatives court-circuitées de la journée, pour `trial_daily`.
 *
 * 🚨 C'est un PLANCHER, jamais un total : le compteur vit en mémoire (perdu à
 * tout redémarrage) et il est vidé par le premier balayage, donc la valeur
 * d'hier n'est juste que si le premier tick horaire après minuit a bien fait
 * son `snapshotTrialDay(hier)` avant `sweepDailyLedger()`. La colonne dit « au
 * moins ceci ».
 */
let uncountedAttemptsToday = { day: '', n: 0 };

/**
 * Contre-pression de volume : au-delà du plafond dur, on cesse d'INSÉRER.
 *
 * Réévalué une fois par tick horaire, jamais par requête : le COUNT(*) est un
 * balayage de plage et le risque de disque est lent. Le risque rapide, le débit
 * d'écriture d'un refusé, est déjà fermé par `overLimit`.
 */
let ledgerFull = false;
let ledgerFullDay = '';

/**
 * Garde anti-tempête de l'alerte, EN MÉMOIRE et pas dans `kv_state` : l'état
 * d'ops-alert est écrit dans stats.sqlite, c'est-à-dire précisément l'objet en
 * panne quand cette alerte part.
 */
let lastLedgerAlertMs = 0;
const LEDGER_ALERT_GAP_MS = 60 * 60 * 1000;

/** Le jour UTC, dans la forme que `date('now')` produit. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Un horodatage SQLite (« YYYY-MM-DD HH:MM:SS », UTC, sans zone) en
 * millisecondes.
 *
 * 🚨 Sans le `T` et le `Z`, `new Date()` lit cette chaîne en heure LOCALE : la
 * fenêtre glisse du décalage de la machine, et aucun test ne rougit. Même geste
 * que `src/lib/cohort-radar.ts:105-110`.
 */
function sqliteMs(ts: string): number {
  return new Date(`${ts.replace(' ', 'T')}Z`).getTime();
}

/**
 * Taille d'un lot de purge, et plafond d'itérations par tick : 5 000 lignes par
 * instruction, 40 passes, soit 200 000 lignes par tick. C'est aussi ce qui fixe
 * `TRIAL_LEDGER_MAX_ROWS_PER_DAY` : un plafond de lignes supérieur à ce qu'un
 * tick peut vider produirait une table qui ne se vide jamais.
 */
const PURGE_BATCH = 5000;
const PURGE_MAX_PASSES = 40;

// ── Requêtes préparées ───────────────────────────────────────────────────────
// Mémoïsées au niveau module, parce que ceci devient le chemin d'écriture le
// plus chaud du service et qu'une requête recompilée à chaque appel se paie sur
// toutes les validations anonymes. `resetDailyLedgerStatements()` est câblée
// dans `closeAll()` : une requête préparée conservée à travers une fermeture
// répondrait depuis une connexion morte.

let _spend: Statement | null = null;
let _refund: Statement | null = null;
let _window: Statement | null = null;
let _activity: Statement | null = null;
let _rollup: Statement | null = null;
let _snapshot: Statement | null = null;
let _purge: Statement | null = null;
let _shield: Statement | null = null;
let _exists: Statement | null = null;
let _countDay: Statement | null = null;
let _peak: Statement | null = null;
let _daily: Statement | null = null;

export function resetDailyLedgerStatements(): void {
  resetWeeklyStatements();
  _spend = null;
  _refund = null;
  _window = null;
  _activity = null;
  _rollup = null;
  _snapshot = null;
  _purge = null;
  _shield = null;
  _exists = null;
  _countDay = null;
  _peak = null;
  _daily = null;
}

function spendStmt(): Statement {
  // 🚨 `first_seen` n'est JAMAIS dans le DO UPDATE, `last_seen` l'est toujours :
  // c'est la seule ligne qui produit les deux signaux (apparition, activité).
  // Les deux horodatages sont posés par SQLite, jamais par toISOString().
  // RETURNING rend le nouveau total dans la même instruction : pas de lecture
  // puis écriture, donc pas de fenêtre de concurrence pour une même source.
  if (!_spend) {
    _spend = getStatsDB().prepare(
      `INSERT INTO trial_ledger (day, bucket, units, first_seen, last_seen)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(day, bucket) DO UPDATE SET units = units + excluded.units,
                                              last_seen = excluded.last_seen
       RETURNING units`,
    );
  }
  return _spend;
}

function refundStmt(): Statement {
  // Trois propriétés conservées du registre en mémoire : plancher à zéro,
  // jamais de création de ligne (UPDATE, pas d'UPSERT), jamais de résurrection
  // d'hier (`day` est le jour courant). Et `last_seen` n'est PAS réécrit : un
  // remboursement n'est pas une dépense et ne doit pas maintenir un seau
  // « actif » aux yeux de countTrialActivitySince.
  if (!_refund) {
    _refund = getStatsDB().prepare(
      'UPDATE trial_ledger SET units = MAX(units - ?, 0) WHERE day = ? AND bucket = ?',
    );
  }
  return _refund;
}

function windowStmt(): Statement {
  if (!_window) {
    _window = getStatsDB().prepare(
      `SELECT COUNT(*) AS buckets, COALESCE(SUM(units), 0) AS units
         FROM trial_ledger
        WHERE day >= ? AND bucket LIKE 'rest:%' AND first_seen >= datetime('now', ?)`,
    );
  }
  return _window;
}

function activityStmt(): Statement {
  if (!_activity) {
    _activity = getStatsDB().prepare(
      `SELECT COUNT(*) AS buckets, COALESCE(SUM(units), 0) AS units
         FROM trial_ledger
        WHERE day >= ? AND bucket LIKE 'rest:%' AND last_seen >= datetime('now', ?)`,
    );
  }
  return _activity;
}

function rollupStmt(): Statement {
  // Une seule requête pour les trois familles de seaux : le préfixe dit la
  // porte, et un CASE par famille évite trois balayages de la même plage.
  if (!_rollup) {
    _rollup = getStatsDB().prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN bucket LIKE 'rest:%' THEN 1 ELSE 0 END), 0) AS rest_buckets,
         COALESCE(SUM(CASE WHEN bucket LIKE 'rest:%' THEN units ELSE 0 END), 0) AS rest_units,
         COALESCE(SUM(CASE WHEN bucket LIKE 'rest:%' AND units > ? THEN 1 ELSE 0 END), 0) AS rest_over,
         COALESCE(SUM(CASE WHEN bucket LIKE 'init:%' THEN 1 ELSE 0 END), 0) AS init_buckets,
         COALESCE(SUM(CASE WHEN bucket NOT LIKE 'rest:%' AND bucket NOT LIKE 'init:%' THEN 1 ELSE 0 END), 0) AS mcp_buckets,
         COALESCE(SUM(CASE WHEN bucket NOT LIKE 'rest:%' AND bucket NOT LIKE 'init:%' THEN units ELSE 0 END), 0) AS mcp_units
       FROM trial_ledger WHERE day = ?`,
    );
  }
  return _rollup;
}

function snapshotStmt(): Statement {
  // 🚨 `shield_minutes` n'est JAMAIS dans la liste : elle appartient au
  // disjoncteur (lot 5), et un agrégat ne doit pas écraser ce qu'un autre
  // écrivain y a poussé. Symétriquement, bumpTrialDayShieldMinutes ne touche
  // jamais les colonnes d'agrégat. Un DO NOTHING serait faux ici : il figerait
  // à zéro la ligne d'attente que le disjoncteur crée pendant la journée.
  if (!_snapshot) {
    _snapshot = getStatsDB().prepare(
      `INSERT INTO trial_daily (day, rest_buckets, rest_units_counted, rest_attempts_uncounted,
                                rest_over_limit, peak_hour_buckets, mcp_buckets, mcp_units,
                                init_buckets)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET rest_buckets            = excluded.rest_buckets,
                                      rest_units_counted      = excluded.rest_units_counted,
                                      rest_attempts_uncounted = excluded.rest_attempts_uncounted,
                                      rest_over_limit         = excluded.rest_over_limit,
                                      peak_hour_buckets       = excluded.peak_hour_buckets,
                                      mcp_buckets             = excluded.mcp_buckets,
                                      mcp_units               = excluded.mcp_units,
                                      init_buckets            = excluded.init_buckets`,
    );
  }
  return _snapshot;
}

function purgeStmt(): Statement {
  // 🚨 Pas de `DELETE ... LIMIT` : cette forme n'est compilée que si
  // better-sqlite3 a été construit avec SQLITE_ENABLE_UPDATE_DELETE_LIMIT, ce
  // que le dépôt ne vérifie nulle part. `IN (SELECT ... LIMIT n)` est portable.
  // Ce que la borne achète : la durée d'un tick cesse d'être fonction du volume
  // déposé par un attaquant.
  if (!_purge) {
    _purge = getStatsDB().prepare(
      `DELETE FROM trial_ledger
        WHERE (day, bucket) IN (
          SELECT day, bucket FROM trial_ledger WHERE day < ? LIMIT ${PURGE_BATCH}
        )`,
    );
  }
  return _purge;
}

function shieldStmt(): Statement {
  if (!_shield) {
    _shield = getStatsDB().prepare(
      `INSERT INTO trial_daily (day, rest_buckets, rest_units_counted, rest_attempts_uncounted,
                                rest_over_limit, peak_hour_buckets, mcp_buckets, mcp_units,
                                init_buckets, shield_minutes)
       VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0, ?)
       ON CONFLICT(day) DO UPDATE SET shield_minutes = shield_minutes + excluded.shield_minutes`,
    );
  }
  return _shield;
}

function existsStmt(): Statement {
  if (!_exists) {
    _exists = getStatsDB().prepare(
      'SELECT 1 AS hit FROM trial_ledger WHERE day = ? AND bucket = ?',
    );
  }
  return _exists;
}

function countDayStmt(): Statement {
  if (!_countDay) {
    _countDay = getStatsDB().prepare('SELECT COUNT(*) AS n FROM trial_ledger WHERE day = ?');
  }
  return _countDay;
}

function peakStmt(): Statement {
  if (!_peak) {
    _peak = getStatsDB().prepare(
      `SELECT first_seen FROM trial_ledger
        WHERE day = ? AND bucket LIKE 'rest:%'
        ORDER BY first_seen`,
    );
  }
  return _peak;
}

function dailyStmt(): Statement {
  if (!_daily) {
    _daily = getStatsDB().prepare('SELECT * FROM trial_daily ORDER BY day DESC LIMIT ?');
  }
  return _daily;
}

/**
 * Une panne de registre se dit une fois par heure, et jamais en relisant la
 * base pour savoir si elle va bien : le `catch` est la seule sonde.
 */
function reportLedgerFailure(err: unknown): void {
  const now = Date.now();
  if (now - lastLedgerAlertMs < LEDGER_ALERT_GAP_MS) return;
  lastLedgerAlertMs = now;
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[trial-ledger] registre indisponible:', msg);
  void opsFail(
    'trial:ledger',
    `Registre des franchises d'essai illisible : ${msg}. ` +
      "Les appels sans clé retombent sur le paiement (cause trial_unavailable) ; aucune réponse n'est fausse.",
  );
}

/** Le compteur de secours : celui que le service avait avant le portage. */
function countInMemory(key: string, units: number, limit: number): DailyCount {
  const day = today();
  const entry = memoryCounts.get(key);
  if (!entry || entry.date !== day) {
    memoryCounts.set(key, { count: units, date: day });
    return { allowed: units <= limit, used: units, remaining: Math.max(0, limit - units) };
  }
  entry.count += units;
  return {
    allowed: entry.count <= limit,
    used: entry.count,
    remaining: Math.max(0, limit - entry.count),
  };
}

/**
 * La bascule de secours, pour l'appelant qui ne peut pas se permettre un
 * fail-open : l'ouverture de session MCP, dont le plafond par adresse est la
 * seule borne que le magasin plafonné ne remplace pas (SEC-01, 01/09/2026).
 * Sous panne de base, on compte par instance — exactement le comportement
 * d'avant ce chantier : on ne dégrade pas en dessous de l'existant.
 */
export function countDailyUnitsInMemory(key: string, units: number, limit: number): DailyCount {
  return countInMemory(key, units, limit);
}

function refundInMemory(key: string, units: number): void {
  const entry = memoryCounts.get(key);
  if (!entry || entry.date !== today()) return;
  entry.count = Math.max(0, entry.count - units);
}

function bumpUncounted(day: string, units: number): void {
  if (uncountedAttemptsToday.day !== day) uncountedAttemptsToday = { day, n: 0 };
  uncountedAttemptsToday.n += units;
}

/**
 * Dépenser `units` sur la franchise journalière de `key`, et dire si ça passe.
 *
 * La dépense a lieu même quand elle ne passe pas, exprès : un appelant refusé
 * qui garderait son créneau serait libre de rejouer la requête bon marché toute
 * la journée, et `used` est ce que le message de refus cite.
 *
 * 🚨 Ne lève jamais, quoi qu'il arrive à la base. Sur échec, la réponse porte
 * `degraded: true` et l'appelant doit dire « indisponible », jamais « plafond
 * atteint » : sans cette distinction, une panne de base ferait mentir trois
 * messages d'un coup.
 */
export function countDailyUnits(key: string, units: number, limit: number): DailyCount {
  if (MEMORY_ONLY.test(key)) return countInMemory(key, units, limit);
  const day = today();

  // Court-circuit : ce seau a déjà franchi SON plafond aujourd'hui. On répond de
  // mémoire et on ne touche pas la base. La ligne en base garde la valeur
  // atteinte au franchissement (d'où le nom `trial_daily.rest_units_counted`) ;
  // `used` continue de croître EN MÉMOIRE pour que le message du 402 reste vrai
  // au premier ordre.
  //
  // 🚨 Cette branche ne renvoie PAS `degraded`, même pendant une panne de base :
  // le refus est exact, et le transformer en « indisponible » rendrait les
  // journaux moins lisibles, pas plus. C'est un choix, pas un oubli.
  //
  // ⚠️ `seen.limit === limit` est indispensable : la limite effective changera
  // quand le disjoncteur s'armera (lot 5), et un seau marqué sous une limite de
  // 5 resterait refusé après le retour à 25.
  const seen = overLimit.get(key);
  if (seen && seen.day === day && seen.limit === limit) {
    seen.used += units;
    // Même garde que le chemin de la semaine (relecture du 24/09/2026, D2) :
    // `rest_attempts_uncounted` est une colonne de l'essai REST, et ce chemin ne
    // reçoit plus que des ouvertures de session MCP (`init:`).
    if (key.startsWith('rest:')) bumpUncounted(day, units);
    return { allowed: false, used: seen.used, remaining: 0 };
  }

  try {
    // Le plafond de volume se relâche de lui-même au changement de jour : la
    // purge de minuit libère la place, et sans cette remise à zéro personne ne
    // rouvrirait la porte.
    if (ledgerFull && ledgerFullDay !== day) ledgerFull = false;
    if (ledgerFull && !(existsStmt().get(day, key) as { hit: number } | undefined)) {
      // Le seau EXISTANT continue d'être servi par la base (une lecture sur la
      // clé primaire) ; un seau NOUVEAU est compté en mémoire, donc il ne fait
      // plus grossir le fichier qui porte les clés.
      return countInMemory(key, units, limit);
    }
    const row = spendStmt().get(day, key, units) as { units: number };
    const used = row.units;
    if (used > limit) overLimit.set(key, { day, used, limit });
    return { allowed: used <= limit, used, remaining: Math.max(0, limit - used) };
  } catch (err) {
    reportLedgerFailure(err);
    return { allowed: false, used: limit + units, remaining: 0, degraded: true };
  }
}

/**
 * Rendre un créneau, pour la raison qui fait rembourser un créneau de quota sur
 * un 4xx : une franchise dont l'appelant n'a tiré aucune réponse est une
 * franchise que personne n'a dépensée.
 *
 * 🚨 Avale son erreur en silence : un remboursement perdu coûte une unité, une
 * exception coûterait un 500 sur une réponse déjà produite (le middleware
 * rembourse APRÈS `await next()`).
 *
 * ⚠️ La première ligne est la MÊME que celle de countDailyUnits. Sans elle,
 * `refundDailyUnits('rest:unknown', 1)` lancerait un UPDATE sur une ligne qui
 * n'existe pas, sans erreur et sans effet, alors que la dépense correspondante a
 * été comptée en mémoire : le seau partagé des non plaçables ne serait jamais
 * remboursé.
 */
export function refundDailyUnits(key: string, units = 1): void {
  if (MEMORY_ONLY.test(key)) return refundInMemory(key, units);
  // L'ordre compte : la marque part AVANT l'UPDATE, pour qu'une panne de base ne
  // laisse pas un seau marqué que plus rien ne peut démarquer. Sans cette
  // suppression, un remboursement qui ramène le compte sous la limite ne
  // rouvrirait jamais la franchise.
  overLimit.delete(key);
  try {
    refundStmt().run(units, today(), key);
  } catch {
    /* silence délibéré : voir l'en-tête de cette fonction */
  }
}

/**
 * Purger les DEUX supports : les lignes de `trial_ledger` antérieures à
 * aujourd'hui, ET les entrées mémoire (déduplication de télémétrie, seaux
 * `unknown`, marques de dépassement, compteur de tentatives court-circuitées)
 * dont la date n'est plus celle du jour. Renvoie la somme des deux comptes.
 *
 * 🚨 Le balayage mémoire n'est pas décoratif : le portage aurait introduit une
 * fuite non bornée en laissant les entrées `evt:*` s'accumuler sur un conteneur
 * qui vit des semaines.
 *
 * Ne lève jamais : renvoie 0 et signale par opsFail.
 */
export function sweepDailyLedger(): number {
  const day = today();
  let swept = 0;
  for (const [key, val] of memoryCounts) {
    if (val.date !== day) {
      memoryCounts.delete(key);
      swept += 1;
    }
  }
  for (const [key, val] of overLimit) {
    if (val.day !== day) {
      overLimit.delete(key);
      swept += 1;
    }
  }
  if (uncountedAttemptsToday.day && uncountedAttemptsToday.day !== day) {
    uncountedAttemptsToday = { day: '', n: 0 };
  }
  // Le scalaire anti-tempête fait partie des structures à balayer : une valeur
  // vieille d'une heure n'a plus rien à garder.
  if (Date.now() - lastLedgerAlertMs > LEDGER_ALERT_GAP_MS) lastLedgerAlertMs = 0;
  swept += sweepWeeklyMemory();
  try {
    const stmt = purgeStmt();
    for (let pass = 0; pass < PURGE_MAX_PASSES; pass += 1) {
      const gone = stmt.run(day).changes;
      swept += gone;
      if (gone === 0) break;
    }
    // La semaine passée de l'essai REST, dans le même tick et avec la même
    // borne : toutes ses lignes expirent d'un coup le lundi, et le plafond
    // `TRIAL_WEEKLY_MAX_ROWS` est ce qu'un tick sait vider.
    const weekStmt = weekPurgeStmt();
    const week = trialWeekStart();
    for (let pass = 0; pass < PURGE_MAX_PASSES; pass += 1) {
      const gone = weekStmt.run(week).changes;
      swept += gone;
      if (gone === 0) break;
    }
  } catch (err) {
    reportLedgerFailure(err);
    return 0;
  }
  return swept;
}

/**
 * Relire le volume du jour et armer ou désarmer la contre-pression.
 *
 * Appelée par le tick horaire, jamais par requête. Résolution d'une heure
 * assumée : entre deux ticks la croissance reste bornée par le limiteur global
 * à 100 req/min/IP, pas par « rien ».
 *
 * `maxRows` n'existe que pour le test : poser 200 000 lignes dans une suite
 * coûterait plus cher que ce que le mécanisme vaut. La production appelle sans
 * argument et lit la constante.
 */
export function reviewLedgerVolume(
  maxRows: number = TRIAL_LEDGER_MAX_ROWS_PER_DAY,
  maxWeekRows: number = TRIAL_WEEKLY_MAX_ROWS,
): void {
  const day = today();
  try {
    const rows = (countDayStmt().get(day) as { n: number }).n;
    const full = rows >= maxRows;
    if (full && !ledgerFull) {
      void opsFail(
        'trial:volume',
        `Registre d'essai au plafond de lignes pour ${day} (${rows}). ` +
          'Les seaux déjà connus restent servis depuis la base, les seaux neufs sont comptés en mémoire.',
      );
    }
    ledgerFull = full;
    ledgerFullDay = day;
  } catch (err) {
    reportLedgerFailure(err);
  }
  reviewWeeklyVolume(maxWeekRows);
}

/**
 * Seam de test : `DELETE FROM trial_ledger`, ET les quatre structures mémoire.
 *
 * ⚠️ Il efface les TROIS espaces de noms, pas seulement celui de l'appelant : un
 * test qui remet l'essai REST à zéro remet aussi les appels d'outils MCP et les
 * ouvertures de session de ce worker.
 */
export function resetDailyLedger(): void {
  memoryCounts.clear();
  overLimit.clear();
  uncountedAttemptsToday = { day: '', n: 0 };
  ledgerFull = false;
  ledgerFullDay = '';
  lastLedgerAlertMs = 0;
  resetWeeklyMemory();
  try {
    getStatsDB().exec('DELETE FROM trial_ledger; DELETE FROM trial_weekly');
  } catch {
    /* une base absente n'a rien à effacer */
  }
}

/**
 * Seam de test : ce qu'un redémarrage du conteneur oublie, et rien d'autre.
 *
 * Vide les structures mémoire (marques de dépassement, compteurs de repli,
 * tentatives court-circuitées, contre-pression) et garde les tables, pour
 * prouver ce qu'un redéploiement fait réellement. `closeAll()` seul ne le
 * prouve pas : il ferme la connexion mais laisse la mémoire du module.
 */
export function forgetLedgerMemory(): void {
  memoryCounts.clear();
  overLimit.clear();
  uncountedAttemptsToday = { day: '', n: 0 };
  ledgerFull = false;
  ledgerFullDay = '';
  resetWeeklyMemory();
}

/** Le jour UTC d'il y a `minutes` minutes, pour rester sur la plage de la clé. */
function dayMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString().slice(0, 10);
}

/**
 * Seaux d'essai APPARUS dans la fenêtre (`first_seen`). Ne lève jamais.
 *
 * Mesure l'arrivée de sources neuves — une rotation de proxys, et rien d'autre.
 */
export function countTrialBucketsSince(minutes: number): TrialWindow {
  try {
    const row = windowStmt().get(dayMinutesAgo(minutes), `-${minutes} minutes`) as TrialWindow;
    return { buckets: row.buckets, units: row.units };
  } catch (err) {
    reportLedgerFailure(err);
    return { buckets: 0, units: 0 };
  }
}

/**
 * Seaux d'essai ACTIFS dans la fenêtre (`last_seen`). Ne lève jamais.
 *
 * 🚨 C'est le seul des deux signaux qu'un amorçage lent ne contourne pas : 164
 * sources apparues une par heure puis libérées d'un coup sont invisibles à
 * `countTrialBucketsSince` et visibles ici.
 */
export function countTrialActivitySince(minutes: number): TrialWindow {
  try {
    const row = activityStmt().get(dayMinutesAgo(minutes), `-${minutes} minutes`) as TrialWindow;
    return { buckets: row.buckets, units: row.units };
  } catch (err) {
    reportLedgerFailure(err);
    return { buckets: 0, units: 0 };
  }
}

/** Le même compte depuis minuit UTC, pour la surface d'administration. */
export function countTrialBucketsToday(): TrialWindow {
  try {
    const row = rollupStmt().get(REST_TRIAL_WEEKLY_LIMIT, today()) as {
      rest_buckets: number;
      rest_units: number;
    };
    return { buckets: row.rest_buckets, units: row.rest_units };
  } catch (err) {
    reportLedgerFailure(err);
    return { buckets: 0, units: 0 };
  }
}

/**
 * Le vrai maximum glissant de sources apparues sur 60 minutes.
 *
 * ⚠️ Un maximum par heure calendaire serait FAUX : une rafale à cheval sur deux
 * heures rondes se compterait deux fois à moitié. Et l'échantillonnage par le
 * tick horaire du disjoncteur sous-estimerait un pic honnête de vingt minutes,
 * donc poserait le futur seuil trop bas, donc ferait tomber le plafond dégradé
 * sur des développeurs honnêtes.
 *
 * ⚠️ Pas d'auto-jointure SQL : quadratique sur une table qu'un attaquant
 * remplit. Balayage linéaire à deux pointeurs après un tri que l'index de la
 * clé primaire donne gratuitement, une fois par jour.
 *
 * 🚨 La conversion `sqliteMs` est obligatoire ici : l'écart de 60 minutes se
 * calcule en millisecondes, et une chaîne SQLite lue telle quelle par
 * `new Date()` décale la fenêtre du fuseau de la machine.
 */
function peakHourBuckets(day: string): number {
  const rows = peakStmt().all(day) as Array<{ first_seen: string }>;
  const stamps = rows.map((r) => sqliteMs(r.first_seen));
  const hour = 60 * 60 * 1000;
  let best = 0;
  let from = 0;
  for (let i = 0; i < stamps.length; i += 1) {
    while (stamps[i] - stamps[from] > hour) from += 1;
    best = Math.max(best, i - from + 1);
  }
  return best;
}

/**
 * Agréger une journée dans `trial_daily`. Appelée AVANT la purge. Idempotente.
 *
 * 🚨 Sort sans écrire quand la journée ne compte aucun seau : la fonction tourne
 * toutes les heures et la purge efface la matière juste après, donc sans ce
 * court-circuit le passage suivant recalculerait des zéros sur une table vide et
 * écraserait la seule trace qui survit.
 *
 * ⚠️ `uncountedAttemptsToday` doit être lu ICI, avant `sweepDailyLedger()`.
 * Inverser les deux perd `rest_attempts_uncounted` tous les jours, en silence.
 *
 * ⚠️ Depuis l'essai à la semaine (24/09/2026), `rest_over_limit` compte les
 * sources dont la ligne DU JOUR dépasse le plafond de l'essai, c'est-à-dire
 * celles qui ont épuisé la semaine entière en une journée. Une source refusée
 * mercredi pour une semaine épuisée lundi ne fait plus de ligne mercredi : ses
 * tentatives vont dans `rest_attempts_uncounted`. Le calcul n'a pas changé, sa
 * lecture si.
 *
 * Ne lève jamais : perdre une ligne d'agrégat ne doit pas empêcher la purge.
 */
export function snapshotTrialDay(day: string): void {
  try {
    const row = rollupStmt().get(REST_TRIAL_WEEKLY_LIMIT, day) as {
      rest_buckets: number;
      rest_units: number;
      rest_over: number;
      init_buckets: number;
      mcp_buckets: number;
      mcp_units: number;
    };
    // Les trois familles, pas seulement REST : une journée purement MCP a aussi
    // droit à sa trace, et le court-circuit d'idempotence reste entier.
    if (row.rest_buckets === 0 && row.mcp_buckets === 0 && row.init_buckets === 0) return;
    const uncounted = uncountedAttemptsToday.day === day ? uncountedAttemptsToday.n : 0;
    snapshotStmt().run(
      day,
      row.rest_buckets,
      row.rest_units,
      uncounted,
      row.rest_over,
      peakHourBuckets(day),
      row.mcp_buckets,
      row.mcp_units,
      row.init_buckets,
    );
  } catch (err) {
    reportLedgerFailure(err);
  }
}

/**
 * Poussée par le tick du disjoncteur (lot 5) quand il constate N minutes de plus
 * sous alerte.
 *
 * Le registre n'importe TOUJOURS PAS le disjoncteur : c'est le disjoncteur qui
 * écrit dans la trace, pas la trace qui lit le disjoncteur. Un UPSERT et non un
 * UPDATE, parce que ces minutes se constatent AVANT que la journée soit close :
 * la ligne d'attente à zéro sera remplie le lendemain par snapshotTrialDay.
 * Ne lève jamais.
 */
export function bumpTrialDayShieldMinutes(day: string, minutes: number): void {
  try {
    shieldStmt().run(day, minutes);
  } catch (err) {
    reportLedgerFailure(err);
  }
}

/**
 * Les N derniers jours agrégés, pour GET /v1/admin/trial.
 *
 * Sans cette lecture, `trial_daily` serait écrite et jamais lue — et c'est
 * `peak_hour_buckets` qui donnera le seuil du plafond dégradé, donc la table
 * doit être consultable. Ne lève jamais.
 */
export function getTrialDaily(days: number): TrialDailyRow[] {
  const bounded = Math.min(Math.max(Math.trunc(days) || 1, 1), 90);
  try {
    return dailyStmt().all(bounded) as TrialDailyRow[];
  } catch (err) {
    reportLedgerFailure(err);
    return [];
  }
}

// ── La semaine de l'essai REST (24/09/2026) ──────────────────────────────────
//
// Claude-Alain a ramené l'essai sans clé de 25 appels par JOUR à 25 par SEMAINE
// et par source. La semaine est la semaine ISO en UTC : elle s'ouvre le lundi à
// 00:00 UTC, pour tout le monde à la fois (`trialWeekStart`, src/lib/trial.ts).
//
// Pourquoi une table à part (`trial_weekly`) plutôt que la somme des lignes
// quotidiennes `rest:<h>` depuis le lundi :
//
//   1. `snapshotTrialDay(hier)` repasse toutes les heures et ne s'abstient que
//      sur une journée VIDE. Des lignes REST gardées sept jours la rendraient
//      non vide : le tick de 01 h réécrirait `mcp_buckets`, `init_buckets` et
//      `rest_attempts_uncounted` à zéro (lignes MCP déjà purgées, compteur
//      mémoire déjà vidé), chaque jour, sans un test rouge.
//   2. La clé primaire de `trial_ledger` est (day, bucket) : une somme par
//      source sur la semaine y serait un balayage de toute la semaine, sur le
//      chemin le plus chaud du service.
//
// Donc : la DÉCISION lit `trial_weekly`, clé (week, bucket), une lecture sur la
// clé primaire ; la ligne quotidienne `rest:<h>` continue d'être écrite dans la
// même transaction, pour la trace, les fenêtres glissantes et l'administration,
// qui mesurent exactement comme avant.
//
// Les appels d'outils MCP passent par cette section depuis la décision du même
// soir (accès MCP sans clé : 25 unités par semaine et par source). Leur seau est
// le haché nu `<h>`, celui de l'essai REST `rest:<h>` : deux allocations dans la
// même table, qui ne se partagent jamais. Ce qui reste propre à l'essai REST est
// filtré sur le préfixe `rest:` : la trace des tentatives court-circuitées
// (`rest_attempts_uncounted`) et le total de la semaine de l'administration
// (`countTrialWeek`). Les ouvertures de session MCP (`init:<h>`) ne touchent
// jamais cette section : leur plafond reste quotidien.
//
// Mêmes propriétés que le registre du jour, section par section : jamais
// d'exception, `degraded` sur panne de base, marque de dépassement en mémoire
// (un refusé ne coûte aucune écriture), seaux `unknown` en mémoire, plafond de
// lignes, purge bornée, remise à zéro de test.

/** Les seaux comptés en mémoire cette semaine : `unknown`, ou table pleine. */
const weeklyMemory = new Map<string, { count: number; week: string }>();

/** Seaux dont on SAIT qu'ils ont dépassé la semaine. Purement local. */
const weeklyOverLimit = new Map<string, { week: string; used: number; limit: number }>();

/** Contre-pression de volume de la table de la semaine. */
let weeklyFull = false;
let weeklyFullWeek = '';

let _weekSpend: Statement | null = null;
let _weekRefund: Statement | null = null;
let _weekExists: Statement | null = null;
let _weekCount: Statement | null = null;
let _weekPurge: Statement | null = null;
let _weekTotals: Statement | null = null;
let _weekTx:
  ((week: string, day: string, key: string, units: number, writeDay: boolean) => number) | null =
  null;

function resetWeeklyStatements(): void {
  _weekSpend = null;
  _weekRefund = null;
  _weekExists = null;
  _weekCount = null;
  _weekPurge = null;
  _weekTotals = null;
  _weekTx = null;
}

function resetWeeklyMemory(): void {
  weeklyMemory.clear();
  weeklyOverLimit.clear();
  weeklyFull = false;
  weeklyFullWeek = '';
}

function weekSpendStmt(): Statement {
  if (!_weekSpend) {
    _weekSpend = getStatsDB().prepare(
      `INSERT INTO trial_weekly (week, bucket, units) VALUES (?, ?, ?)
       ON CONFLICT(week, bucket) DO UPDATE SET units = units + excluded.units
       RETURNING units`,
    );
  }
  return _weekSpend;
}

function weekRefundStmt(): Statement {
  // Comme le remboursement du jour : plancher à zéro, jamais de création de
  // ligne, jamais la semaine d'avant.
  if (!_weekRefund) {
    _weekRefund = getStatsDB().prepare(
      'UPDATE trial_weekly SET units = MAX(units - ?, 0) WHERE week = ? AND bucket = ?',
    );
  }
  return _weekRefund;
}

function weekExistsStmt(): Statement {
  if (!_weekExists) {
    _weekExists = getStatsDB().prepare(
      'SELECT 1 AS hit FROM trial_weekly WHERE week = ? AND bucket = ?',
    );
  }
  return _weekExists;
}

function weekCountStmt(): Statement {
  if (!_weekCount) {
    _weekCount = getStatsDB().prepare('SELECT COUNT(*) AS n FROM trial_weekly WHERE week = ?');
  }
  return _weekCount;
}

function weekPurgeStmt(): Statement {
  // Même forme portable que la purge du jour : pas de `DELETE ... LIMIT`.
  if (!_weekPurge) {
    _weekPurge = getStatsDB().prepare(
      `DELETE FROM trial_weekly
        WHERE (week, bucket) IN (
          SELECT week, bucket FROM trial_weekly WHERE week < ? LIMIT ${PURGE_BATCH}
        )`,
    );
  }
  return _weekPurge;
}

function weekTotalsStmt(): Statement {
  // Une requête pour les deux familles de la table, comme le rollup du jour :
  // le préfixe dit la porte. Sans ce partage, le total de l'essai REST aurait
  // additionné les appels MCP dès qu'ils sont passés à la semaine.
  if (!_weekTotals) {
    _weekTotals = getStatsDB().prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN bucket LIKE 'rest:%' THEN 1 ELSE 0 END), 0) AS rest_buckets,
         COALESCE(SUM(CASE WHEN bucket LIKE 'rest:%' THEN units ELSE 0 END), 0) AS rest_units,
         COALESCE(SUM(CASE WHEN bucket LIKE 'rest:%' AND units > ? THEN 1 ELSE 0 END), 0) AS rest_over,
         COALESCE(SUM(CASE WHEN bucket NOT LIKE 'rest:%' THEN 1 ELSE 0 END), 0) AS mcp_buckets,
         COALESCE(SUM(CASE WHEN bucket NOT LIKE 'rest:%' THEN units ELSE 0 END), 0) AS mcp_units,
         COALESCE(SUM(CASE WHEN bucket NOT LIKE 'rest:%' AND units > ? THEN 1 ELSE 0 END), 0) AS mcp_over
         FROM trial_weekly WHERE week = ?`,
    );
  }
  return _weekTotals;
}

/**
 * La dépense de la semaine ET la ligne du jour, en une transaction : un seul
 * engagement pour les deux écritures, et jamais une trace qui compte un appel
 * que la semaine n'a pas compté. `writeDay` vaut faux quand le registre du jour
 * est plein et ne connaît pas encore ce seau : la trace perd la source, comme
 * avant, la décision ne perd rien.
 */
function weekTx(): (
  week: string,
  day: string,
  key: string,
  units: number,
  writeDay: boolean,
) => number {
  if (!_weekTx) {
    _weekTx = getStatsDB().transaction(
      (week: string, day: string, key: string, units: number, writeDay: boolean): number => {
        const row = weekSpendStmt().get(week, key, units) as { units: number };
        if (writeDay) spendStmt().get(day, key, units);
        return row.units;
      },
    );
  }
  return _weekTx;
}

function countWeekInMemory(key: string, units: number, limit: number, week: string): DailyCount {
  const entry = weeklyMemory.get(key);
  if (!entry || entry.week !== week) {
    weeklyMemory.set(key, { count: units, week });
    return { allowed: units <= limit, used: units, remaining: Math.max(0, limit - units) };
  }
  entry.count += units;
  return {
    allowed: entry.count <= limit,
    used: entry.count,
    remaining: Math.max(0, limit - entry.count),
  };
}

function refundWeekInMemory(key: string, units: number, week: string): void {
  const entry = weeklyMemory.get(key);
  if (!entry || entry.week !== week) return;
  entry.count = Math.max(0, entry.count - units);
}

/**
 * Dépenser `units` sur la franchise de la SEMAINE de `key` (essai REST sans
 * clé, seau `rest:<h>` ; appels d'outils MCP sans clé, seau `<h>`), et dire si
 * ça passe. Même contrat que `countDailyUnits` : la dépense a
 * lieu même refusée, `used` inclut cet appel et continue de croître, et la
 * fonction ne lève jamais (`degraded: true` sur panne de base).
 *
 * `used` et `remaining` sont ceux de la SEMAINE. La ligne du jour de la même
 * source reçoit la même dépense, pour la trace, tant que la semaine n'est pas
 * dépassée ; au-delà, les tentatives vont en mémoire et dans
 * `rest_attempts_uncounted`, exactement comme un refusé du jour avant.
 *
 * `now` est passé par l'appelant qui annonce aussi la remise à zéro : la
 * semaine qui compte l'appel et celle dont il cite la fin doivent être la
 * même, y compris le dimanche à 23:59:59.
 */
export function countWeeklyTrialUnits(
  key: string,
  units: number,
  limit: number,
  now: Date = new Date(),
): DailyCount {
  const week = trialWeekStart(now);
  const day = now.toISOString().slice(0, 10);
  if (MEMORY_ONLY.test(key)) return countWeekInMemory(key, units, limit, week);

  // Court-circuit du refusé : aucune écriture, ni dans la semaine ni dans le
  // jour. ⚠️ `seen.limit === limit`, pour la même raison que le registre du jour.
  const seen = weeklyOverLimit.get(key);
  if (seen && seen.week === week && seen.limit === limit) {
    seen.used += units;
    // `rest_attempts_uncounted` est une colonne de l'essai REST : un refus MCP
    // de la semaine n'a rien à y faire, et il durerait jusqu'au lundi.
    if (key.startsWith('rest:')) bumpUncounted(day, units);
    return { allowed: false, used: seen.used, remaining: 0 };
  }

  try {
    if (weeklyFull && weeklyFullWeek !== week) weeklyFull = false;
    if (ledgerFull && ledgerFullDay !== day) ledgerFull = false;
    const writeDay = !ledgerFull || !!(existsStmt().get(day, key) as { hit: number } | undefined);
    if (weeklyFull && !(weekExistsStmt().get(week, key) as { hit: number } | undefined)) {
      // La table de la semaine est pleine et ne connaît pas ce seau : la
      // décision se prend en mémoire, mais la TRACE du jour garde la source,
      // sous la seule condition du registre du jour, exactement comme le chemin
      // en base ci-dessous (relecture du 24/09/2026, D3). Sans cela, pendant
      // une rotation de sources, c'est-à-dire précisément quand elle compte, la
      // source disparaissait de la trace, des fenêtres et de l'administration.
      // Même règle que le chemin en base : l'appel qui franchit le plafond est
      // encore écrit, les suivants passent par la marque et vont dans
      // `rest_attempts_uncounted`.
      //
      // ⚠️ Deux limites connues, tenues pour acceptables parce que ce seuil
      // n'est atteint que sous une rotation massive, qui déclenche l'alerte
      // `trial:volume-week` : une source comptée en mémoire retrouve une
      // semaine neuve à chaque redémarrage, et `weeklyMemory` n'est vidée que
      // le lundi (pas de taille maximale).
      const counted = countWeekInMemory(key, units, limit, week);
      if (writeDay) spendStmt().get(day, key, units);
      if (!counted.allowed) weeklyOverLimit.set(key, { week, used: counted.used, limit });
      return counted;
    }
    const used = weekTx()(week, day, key, units, writeDay);
    if (used > limit) weeklyOverLimit.set(key, { week, used, limit });
    return { allowed: used <= limit, used, remaining: Math.max(0, limit - used) };
  } catch (err) {
    reportLedgerFailure(err);
    return { allowed: false, used: limit + units, remaining: 0, degraded: true };
  }
}

/**
 * Rendre un créneau de la semaine (et de la ligne du jour), sur un 4xx du
 * handler. Avale son erreur en silence, comme `refundDailyUnits`, et pour la
 * même raison : la réponse est déjà produite.
 */
export function refundWeeklyTrialUnits(key: string, units = 1): void {
  const now = new Date();
  const week = trialWeekStart(now);
  if (MEMORY_ONLY.test(key)) return refundWeekInMemory(key, units, week);
  weeklyOverLimit.delete(key);
  refundWeekInMemory(key, units, week);
  try {
    weekRefundStmt().run(units, week, key);
    refundStmt().run(units, now.toISOString().slice(0, 10), key);
  } catch {
    /* silence délibéré : voir refundDailyUnits */
  }
}

/** Vider la mémoire des semaines passées. Appelée par `sweepDailyLedger`. */
function sweepWeeklyMemory(): number {
  const week = trialWeekStart();
  let swept = 0;
  for (const [key, val] of weeklyMemory) {
    if (val.week !== week) {
      weeklyMemory.delete(key);
      swept += 1;
    }
  }
  for (const [key, val] of weeklyOverLimit) {
    if (val.week !== week) {
      weeklyOverLimit.delete(key);
      swept += 1;
    }
  }
  return swept;
}

/** Armer ou désarmer la contre-pression de la table de la semaine. */
function reviewWeeklyVolume(maxRows: number): void {
  const week = trialWeekStart();
  try {
    const rows = (weekCountStmt().get(week) as { n: number }).n;
    const full = rows >= maxRows;
    if (full && !weeklyFull) {
      void opsFail(
        'trial:volume-week',
        `Compteur de la semaine de l'essai au plafond de lignes pour la semaine du ${week} (${rows}). ` +
          'Les seaux déjà connus restent servis depuis la base, les seaux neufs sont comptés en mémoire.',
      );
    }
    weeklyFull = full;
    weeklyFullWeek = week;
  } catch (err) {
    reportLedgerFailure(err);
  }
}

/** Les totaux d'une porte sur la semaine en cours. */
export interface WeekTotals {
  week: string;
  buckets: number;
  units: number;
  over_limit: number;
}

function weekTotals(): { rest: WeekTotals; mcp: WeekTotals } {
  const week = trialWeekStart();
  try {
    const row = weekTotalsStmt().get(REST_TRIAL_WEEKLY_LIMIT, MCP_WEEKLY_LIMIT, week) as {
      rest_buckets: number;
      rest_units: number;
      rest_over: number;
      mcp_buckets: number;
      mcp_units: number;
      mcp_over: number;
    };
    return {
      rest: { week, buckets: row.rest_buckets, units: row.rest_units, over_limit: row.rest_over },
      mcp: { week, buckets: row.mcp_buckets, units: row.mcp_units, over_limit: row.mcp_over },
    };
  } catch (err) {
    reportLedgerFailure(err);
    const empty = { week, buckets: 0, units: 0, over_limit: 0 };
    return { rest: empty, mcp: { ...empty } };
  }
}

/** La semaine en cours de l'essai REST, pour l'administration. Ne lève jamais. */
export function countTrialWeek(): WeekTotals {
  return weekTotals().rest;
}

/** La semaine en cours de l'accès MCP sans clé, pour l'administration. Ne lève jamais. */
export function countMcpWeek(): WeekTotals {
  return weekTotals().mcp;
}

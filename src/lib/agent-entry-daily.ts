/**
 * Les deux portes par lesquelles une identité d'AGENT arrive, comptées par jour
 * (chantier « mesure agents », 15/09/2026).
 *
 * ## Pourquoi un agrégat, et pas une lecture de l'existant
 *
 * `device_codes` est purgée à **24 h** (`DEVICE_CODE_RETENTION_HOURS`) : ses
 * lignes DISPARAISSENT. Tout indicateur du rail device calculé après coup
 * depuis cette table rendrait « hier : rien », sans erreur et sans test rouge.
 * Le rail MCP distant est pire : ses sessions et ses appels d'outils ne vivent
 * que dans la mémoire du conteneur et dans `request_log`, qui porte le chemin
 * `/mcp` mais PAS le nom de l'outil — `request_api_key` y est indiscernable
 * d'une validation d'IBAN par outil.
 *
 * Donc : deux tables d'agrégats, incrémentées AU MOMENT OÙ LA DÉCISION EST
 * PRISE, jamais recalculées depuis une table qui sera vide.
 *
 * ## 🚨 Ce qui est écrit, et ce qui ne l'est jamais
 *
 * Des COMPTES. Aucune adresse, même hachée, aucun User-Agent, aucun
 * `user_code`, aucun `device_code`, aucune clé. C'est cette pauvreté qui
 * autorise ces tables à vivre sans politique de rétention, comme `trial_daily`
 * à côté : une colonne qui porterait la source individuelle d'un appelant y
 * ferait vivre un identifiant plus longtemps que les douze mois de
 * `request_log`, qui est l'endroit prévu pour l'attribution fine et qui, lui, a
 * une politique.
 *
 * La colonne `source` de `device_grant_daily` est pour la même raison réduite à
 * trois valeurs par `normalizeDeviceDoor` : la source d'un grant est une chaîne
 * LIBRE choisie par l'appelant, et la stocker telle quelle rendrait la table
 * non bornée.
 *
 * ## La discipline du chemin chaud
 *
 * Doctrine du lot 6, et elle s'applique ici plus qu'ailleurs : ces fonctions
 * sont appelées depuis les routes qui remettent une clé. **Un écrit de mesure
 * ne transforme jamais un 200 en 500**, et surtout il ne fait pas perdre sa clé
 * à un porteur. Tout est sous try/catch, la plainte est bornée à une par
 * minute, et aucune de ces fonctions ne rend un booléen dont un appelant
 * pourrait dépendre.
 *
 * Coût : un `INSERT ... ON CONFLICT` sur une table d'une à trois lignes par
 * jour, WITHOUT ROWID, donc une écriture de page. Au plus une par décision
 * humaine (approbation, refus, retrait) et au plus une par requête `/mcp`.
 */
import { getStatsDB } from './db.js';
import { type DeviceDoor, deviceDoorSql, normalizeDeviceDoor } from './lineage-clients.js';

/** Les colonnes de compteur de `device_grant_daily`, dans l'ordre de la table. */
export type DeviceGrantCounter =
  | 'opened'
  | 'rate_limited'
  | 'approved_anonymous'
  | 'approved_email'
  | 'denied'
  | 'expired'
  | 'delivered';

export const DEVICE_GRANT_COUNTERS: readonly DeviceGrantCounter[] = [
  'opened',
  'rate_limited',
  'approved_anonymous',
  'approved_email',
  'denied',
  'expired',
  'delivered',
] as const;

/** Les colonnes de compteur de `mcp_remote_daily`. */
export type McpRemoteCounter = 'sessions' | 'tool_calls' | 'key_requests';

export const MCP_REMOTE_COUNTERS: readonly McpRemoteCounter[] = [
  'sessions',
  'tool_calls',
  'key_requests',
] as const;

/** Dernière plainte journalisée, pour n'en écrire qu'une par minute. */
let lastComplaintMs = 0;

function complain(err: unknown): void {
  const now = Date.now();
  if (now - lastComplaintMs < 60_000) return;
  lastComplaintMs = now;
  console.error(
    '[agent-entry] écriture de mesure en échec :',
    err instanceof Error ? err.message : err,
  );
}

/** Pour les tests : reparler sans attendre la minute. */
export function resetAgentEntryComplaints(): void {
  lastComplaintMs = 0;
}

/**
 * Un compteur du rail device, sur le jour UTC courant.
 *
 * 🚨 `date('now')` et non une date calculée en JS : toutes les dates de ce
 * fichier viennent de SQLite, en UTC. Une date prise dans le fuseau de la
 * machine rangerait deux heures de trafic dans le mauvais jour, sans erreur.
 *
 * Le nom de colonne est interpolé, et il ne peut l'être que depuis le type
 * `DeviceGrantCounter` : aucune valeur reçue d'une requête n'atteint cette
 * chaîne. Le garde de type est ce qui remplace ici une liaison de paramètre,
 * SQLite ne permettant pas de lier un nom de colonne.
 */
export function bumpDeviceGrantDaily(
  counter: DeviceGrantCounter,
  source: string | null | undefined,
  by = 1,
): void {
  if (!Number.isFinite(by) || by <= 0) return;
  const door: DeviceDoor = normalizeDeviceDoor(source);
  try {
    getStatsDB()
      .prepare(
        `INSERT INTO device_grant_daily (day, source, ${counter})
         VALUES (date('now'), ?, ?)
         ON CONFLICT(day, source) DO UPDATE SET ${counter} = ${counter} + excluded.${counter}`,
      )
      .run(door, Math.floor(by));
  } catch (err) {
    complain(err);
  }
}

/**
 * Le compteur d'approbation, choisi par le palier de la clé frappée.
 *
 * Deux colonnes et non une avec un discriminant : c'est la seule question que
 * ce rail doit trancher — combien d'humains ont cliqué « donne-lui la clé »
 * sans rien donner, et combien ont ajouté une adresse. Un palier inattendu
 * compte comme anonyme plutôt que de ne rien compter : perdre une approbation
 * serait pire que l'attribuer à la branche majoritaire, et l'écart se lit sur
 * `delivered`.
 */
export function bumpDeviceGrantApproval(
  tier: string | null | undefined,
  source: string | null | undefined,
): void {
  bumpDeviceGrantDaily(tier === 'email' ? 'approved_email' : 'approved_anonymous', source);
}

/**
 * Les expirations que la purge vient de trancher, agrégées par porte EN UNE
 * INSTRUCTION.
 *
 * 🚨 À appeler AVANT l'UPDATE qui pose `status = 'expired'`, avec le MÊME
 * prédicat : après, les lignes ne sont plus 'pending' ni 'approved' et le
 * compte serait nul. L'ordre est sûr parce que better-sqlite3 est synchrone et
 * Node mono-fil : entre ce SELECT et l'UPDATE de l'appelant, il n'y a aucun
 * point de reprise où une autre requête pourrait s'insérer — c'est l'argument
 * que `device-grant.ts` fait déjà valoir pour « la clé est remise exactement
 * une fois ».
 *
 * `expired` compte donc « expirations TRANCHÉES par la purge ce jour-là », pas
 * « grants dont le TTL est passé ». Un grant expiré la veille au soir et
 * tranché au premier passage du matin compte le matin. C'est la conséquence
 * assumée d'un compteur incrémenté à la décision ; l'alternative, recalculer
 * depuis `device_codes`, ne survit pas à la rétention de 24 h.
 */
export function bumpDeviceGrantExpiries(predicateSql: string): void {
  try {
    getStatsDB()
      .prepare(
        `INSERT INTO device_grant_daily (day, source, expired)
         SELECT date('now'), ${deviceDoorSql('source')}, COUNT(*)
           FROM device_codes
          WHERE ${predicateSql}
          GROUP BY ${deviceDoorSql('source')}
         ON CONFLICT(day, source) DO UPDATE SET expired = expired + excluded.expired`,
      )
      .run();
  } catch (err) {
    complain(err);
  }
}

/**
 * Le haut de l'entonnoir MCP distant, sur le jour UTC courant.
 *
 * 🚨 Ces trois compteurs sont des APPELS SANS IDENTITÉ : la surface MCP HTTP
 * sert sans clé, donc aucune de ces lignes n'est rattachable à une lignée. Le
 * funnel les publie dans un bloc à part avec cette note, et c'est exactement le
 * « traiter cette mesure explicitement » que demande la passation du 15/09 —
 * pas une activation de plus dans un dénominateur où elle n'a rien à faire.
 *
 * Une seule écriture par requête `/mcp`, les trois compteurs à la fois : la
 * table n'a qu'une ligne par jour, et trois UPSERT sur la même page seraient
 * trois fois le même coût.
 */
export function bumpMcpRemoteDaily(delta: {
  sessions?: number;
  toolCalls?: number;
  keyRequests?: number;
}): void {
  const sessions = positive(delta.sessions);
  const toolCalls = positive(delta.toolCalls);
  const keyRequests = positive(delta.keyRequests);
  if (sessions + toolCalls + keyRequests === 0) return;
  try {
    getStatsDB()
      .prepare(
        `INSERT INTO mcp_remote_daily (day, sessions, tool_calls, key_requests)
         VALUES (date('now'), ?, ?, ?)
         ON CONFLICT(day) DO UPDATE SET
           sessions     = sessions     + excluded.sessions,
           tool_calls   = tool_calls   + excluded.tool_calls,
           key_requests = key_requests + excluded.key_requests`,
      )
      .run(sessions, toolCalls, keyRequests);
  } catch (err) {
    complain(err);
  }
}

function positive(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** Une journée du rail device, telle que le funnel la somme. */
export interface DeviceGrantDailyRow {
  day: string;
  source: DeviceDoor;
  opened: number;
  rate_limited: number;
  approved_anonymous: number;
  approved_email: number;
  denied: number;
  expired: number;
  delivered: number;
}

/** Une journée du rail MCP distant. */
export interface McpRemoteDailyRow {
  day: string;
  sessions: number;
  tool_calls: number;
  key_requests: number;
}

/**
 * Les journées d'un intervalle de JOURS, bornes incluses.
 *
 * 🚨 Des jours et non des instants : ces tables sont à la granularité du jour
 * UTC, alors que la fenêtre du funnel est à la seconde. Le funnel le DIT dans
 * ses notes plutôt que de faire semblant : sur une fenêtre qui commence à midi,
 * ces compteurs portent aussi la matinée.
 */
export function readDeviceGrantDaily(fromDay: string, toDay: string): DeviceGrantDailyRow[] {
  return getStatsDB()
    .prepare(
      `SELECT day, source, opened, rate_limited, approved_anonymous, approved_email,
              denied, expired, delivered
         FROM device_grant_daily
        WHERE day >= ? AND day <= ?
        ORDER BY day, source`,
    )
    .all(fromDay, toDay) as DeviceGrantDailyRow[];
}

export function readMcpRemoteDaily(fromDay: string, toDay: string): McpRemoteDailyRow[] {
  return getStatsDB()
    .prepare(
      `SELECT day, sessions, tool_calls, key_requests
         FROM mcp_remote_daily
        WHERE day >= ? AND day <= ?
        ORDER BY day`,
    )
    .all(fromDay, toDay) as McpRemoteDailyRow[];
}

/**
 * Le tableau des portes (plan d'audit du 22.09.2026, semaine 2).
 *
 * Par porte d'entrée et par semaine, cinq comptes de CLÉS, jamais de requêtes :
 * clés créées, clés qui ont obtenu leur premier appel réussi, clés relancées,
 * clés qui ont appelé dans les sept jours suivant leur relance, clés qui ont
 * payé. Plus un nombre suivi à part : les utilisateurs gratuits actifs à 200 par
 * mois, face au seuil de 50 que Claude-Alain a fixé le 22.09.2026 pour
 * réévaluer le plafond gratuit. Celui-là compte des PERSONNES (la décision dit
 * « utilisateurs »), avec le nombre de clés à côté.
 *
 * ## Une seule fonction pour la page et pour le résumé du lundi
 *
 * `getDoorBoard` est lue par la route d'administration (donc par la page du
 * tableau de bord) ET par le résumé qui part seul le lundi : les quatre nombres
 * du résumé sont ceux de `last_week`, calculés ici et nulle part ailleurs.
 *
 * ## Les unités, une fois pour toutes
 *
 * - **Une clé, c'est une lignée** : la clé née et ses rotations. `/v1/keys/rotate`
 *   frappe une ligne nouvelle dans `api_keys`, mais personne n'est arrivé : la
 *   compter comme une clé créée gonflerait la porte d'un client qui ne fait que
 *   changer de secret. Le registre des achats et la mesure du premier appel
 *   parlent déjà en lignées (`lineage_hash`).
 * - **Chaque colonne compte à la semaine de l'ÉVÉNEMENT** : la création, le
 *   premier appel réussi, la relance, le premier paiement. Une semaine close ne
 *   bouge donc presque plus : « a appelé après la relance » se complète pendant
 *   les sept jours qui suivent, et une clé qui change d'état après coup la fait
 *   bouger (passage en payant, remboursement, ferme regroupée par le radar des
 *   cohortes), comme des données arrivées en retard. Chaque clé compte au plus
 *   une fois par colonne, sur toute l'histoire : la colonne « créées », toutes
 *   lignes additionnées, vaut donc le parc externe du jour. C'est ce que dit
 *   `control`, une COHÉRENCE INTERNE (même règle des deux côtés, vraie par
 *   construction), pas une preuve : la preuve est le recoupement indépendant.
 * - **La porte d'une clé** est l'origine écrite à sa naissance (`api_keys.source`,
 *   voir `key-origins.ts`), pour toutes ses colonnes. Les clés d'avant le
 *   marquage (PR 220, 23.09.2026) n'en ont pas : elles vont dans « inconnue »,
 *   jamais devinées.
 * - **Des personnes, et une ligne à part** (29.09.2026) : les créations
 *   automatiques d'un robot d'exploration (section « Les créations
 *   automatiques » plus bas) ne comptent dans aucune colonne ni aucune porte.
 *   Elles forment, semaine par semaine, une ligne nommée à part, jamais
 *   supprimée, et le contrôle du parc les additionne à la colonne « créées ».
 *
 * ## Ce que la réponse ne contient jamais
 *
 * Des agrégats seulement : aucune adresse, aucun hachage, aucun préfixe de clé.
 */
import type DatabaseType from 'better-sqlite3';
import { getStatsDB } from './db.js';
import { isInternalBuyer } from './pack-sales.js';
import { KEY_ORIGIN_DOORS, KEY_ORIGIN_TAGS } from './key-origins.js';
import { FREE_TIER_MONTHLY_LIMIT, type KeyTier } from './tiers.js';
import { normalizeEmail } from './email-norm.js';
import {
  dayMonth,
  parseDbUtc,
  sqliteUtc,
  swissWeekOf,
  swissWeekShift,
  zurichDayTime,
  zurichLocalToUtcMs,
  type SwissWeek,
} from './swiss-week.js';

const DAY_MS = 86_400_000;

export const DOOR_BOARD_DEFAULT_WEEKS = 10;
export const DOOR_BOARD_MIN_WEEKS = 2;
export const DOOR_BOARD_MAX_WEEKS = 52;

/**
 * Décision de Claude-Alain du 22.09.2026 au soir : le plafond gratuit de 200
 * requêtes par mois ne bouge pas, et se réévalue « quand il y aura plus de 50
 * utilisateurs gratuits à 200/mois ». Strictement plus de 50.
 */
export const FREE_USERS_THRESHOLD = 50;

/** La fenêtre des utilisateurs gratuits actifs : les 30 jours qui finissent le dimanche. */
export const FREE_ACTIVE_WINDOW_DAYS = 30;

/** Le délai dans lequel une clé relancée « a appelé après la relance ». */
export const NUDGE_FOLLOWUP_DAYS = 7;

// ─── Le parc externe, défini UNE fois ───────────────────────────────────────

/**
 * LA définition d'une clé externe, pour tout ce module : la page, le résumé du
 * lundi et le contrôle du parc la lisent ici et nulle part ailleurs.
 *
 * Interne, et donc hors du tableau :
 *   - une clé que nous avons émise nous-mêmes (`issued_by_us`), quelle que soit
 *     son adresse ;
 *   - un compte interne, de test, de sonde ou de ferme regroupée, selon la règle
 *     des montants du tableau de bord (`isInternalBuyer`, `pack-sales.ts`), qui
 *     réunit les deux règles du dépôt (`isInternalEmail` et le `isInternal` du
 *     radar de cycle de vie, celui que l'audit a rejoué pour compter le parc).
 *
 * 🚨 Les acheteurs sans adresse (`credits-buyer`, `stripe-buyer`) restent
 * EXTERNES : un agent qui paie un pack sans donner d'adresse est un client, et
 * le compter comme interne effacerait de la colonne « a payé » exactement le
 * client sur lequel ce service parie. C'est ce que `isInternalBuyer` fait déjà.
 */
export function isExternalKeyRow(row: {
  email: string | null;
  issued_by_us: number | null;
}): boolean {
  if (row.issued_by_us) return false;
  return !isInternalBuyer(row.email ?? '');
}

const REGISTERED = new WeakSet<object>();

/**
 * La même règle, exposée à SQL comme `door_board_external(email, issued_by_us)`,
 * pour que le contrôle du parc soit compté par un autre chemin que le tableau
 * (un regroupement SQL, pas la boucle qui range les clés dans les semaines).
 */
function registerExternalFn(db: DatabaseType.Database): void {
  if (REGISTERED.has(db)) return;
  db.function('door_board_external', { deterministic: true }, (email: unknown, issued: unknown) =>
    isExternalKeyRow({
      email: typeof email === 'string' ? email : null,
      issued_by_us: Number(issued) || 0,
    })
      ? 1
      : 0,
  );
  REGISTERED.add(db);
}

// ─── Les portes ─────────────────────────────────────────────────────────────

/** Une clé née avant que chaque porte n'écrive son origine (PR 220, 23.09.2026). */
export const UNKNOWN_DOOR = '(inconnue)';
/** Une origine déclarée par l'appelant, hors du vocabulaire connu. */
export const OTHER_DOOR = '(autre)';

/**
 * Le nom lisible de chaque porte, en français comme le reste du tableau de
 * bord. Toute porte ou étiquette de `key-origins.ts` doit avoir le sien : un
 * test y veille, pour qu'une porte ajoutée là-bas ne s'affiche pas en code brut.
 */
export const DOOR_LABELS_FR: Readonly<Record<string, string>> = {
  'site-home': 'Accueil du site',
  'site-signup': 'Site, formulaire de clé',
  'site-pricing': 'Page des tarifs',
  'site-register': 'Pages des codes bancaires',
  'site-docs': 'Documentation',
  'site-dashboard': 'Espace compte du site',
  'site-api-page': 'Page « API de validation IBAN »',
  'web-device': 'Agent validé dans un navigateur',
  'mcp-device': 'Agent MCP distant',
  'mcp-stdio-device': 'Agent MCP local (npx)',
  'api-direct': 'API directe, sans navigateur',
  'stripe-pack': 'Pack acheté par carte',
  'stripe-subscription': 'Abonnement par carte',
  'x402-pack': 'Pack acheté en USDC',
  admin: 'Clé créée à la main',
  'github-readme': 'README GitHub',
  'npm-mcp': 'Paquet npm MCP',
  'sdk-ts': 'SDK TypeScript',
  'sdk-py': 'SDK Python',
  'sdk-java': 'SDK Java',
  'sdk-dotnet': 'SDK .NET',
  n8n: 'Connecteur n8n',
  'mcp-registry': 'Registre MCP officiel',
  smithery: 'Smithery',
  glama: 'Glama',
  'api-trial': 'Essai sans clé épuisé',
  [UNKNOWN_DOOR]: 'Inconnue (clé d’avant le marquage)',
  [OTHER_DOOR]: 'Autre origine déclarée',
};

const KNOWN_ORIGINS: ReadonlySet<string> = new Set([
  ...Object.keys(KEY_ORIGIN_DOORS),
  ...Object.keys(KEY_ORIGIN_TAGS),
]);

/**
 * La porte d'une clé, depuis son origine écrite. Bornée à la lecture : une
 * origine déclarée hors du vocabulaire tombe dans `(autre)`, pour qu'un appelant
 * qui invente une origine à chaque clé ne fasse pas grossir la réponse.
 */
export function doorOf(source: string | null | undefined): string {
  if (source === null || source === undefined || source.trim() === '') return UNKNOWN_DOOR;
  return KNOWN_ORIGINS.has(source) ? source : OTHER_DOOR;
}

export function doorLabel(door: string): string {
  return DOOR_LABELS_FR[door] ?? door;
}

// ─── La forme de la réponse ─────────────────────────────────────────────────

export interface DoorCounts {
  created: number;
  first_success: number;
  nudged: number;
  /** Relancées cette semaine-là, et qui ont appelé dans les sept jours suivants. */
  called_after_nudge: number;
  /** Relancées cette semaine-là, sans appel encore, dont les sept jours courent toujours. */
  followup_pending: number;
  paid: number;
}

export interface DoorRow extends DoorCounts {
  door: string;
  label: string;
}

export type WeekKind = 'current' | 'complete' | 'before' | 'undated';

/**
 * La ligne à part des créations automatiques. Une seule colonne : par
 * définition, ces clés n'ont jamais servi, jamais payé, et n'ont pas d'adresse
 * à relancer.
 */
export interface AutomatedLine {
  label: string;
  created: number;
}

export interface WeekRow {
  /** `AAAA-Wss`, ou `before` (avant la première semaine montrée), ou `undated`. */
  key: string;
  kind: WeekKind;
  title: string;
  monday: string | null;
  sunday: string | null;
  /** Des personnes : les créations automatiques n'y sont jamais. */
  totals: DoorCounts;
  /** Les portes de cette ligne, sans les portes à zéro partout. */
  doors: DoorRow[];
  /** Les créations automatiques de la semaine, à part. */
  automated: AutomatedLine;
}

export interface FreeUsers {
  threshold: number;
  /**
   * Ce que le seuil compte : des personnes (adresses normalisées distinctes,
   * `normalizeEmail`, la règle « une personne, une clé gratuite » du dépôt).
   * Décision de la session principale du 25.09.2026, sur la lettre de celle de
   * Claude-Alain du 22.09 (« 50 utilisateurs ») ; le nombre de clés est donné à
   * côté, pour la comparaison avec la base de l'audit, qui comptait des clés.
   */
  threshold_counts: 'people';
  window_days: number;
  /** Dates civiles suisses, bornes incluses : les 30 jours qui finissent le dimanche. */
  window: { from: string; to: string };
  /** Personnes actives sur la fenêtre : le nombre du résumé du lundi, celui que lit le seuil. */
  active_people: number;
  /** Les clés derrière ces personnes (une personne peut en tenir plusieurs). */
  active_keys: number;
  /** Le mois civil (UTC), définition du 22.09 : le mois passé, puis le mois en cours à ce jour. */
  calendar: Array<{ month: string; people: number; keys: number; to_date: boolean }>;
  /** Ce qui a dépassé le seuil (en personnes), s'il a été dépassé. Vide sinon. */
  crossed_by: Array<{ basis: 'window' | 'month'; month: string | null; people: number }>;
  crossed: boolean;
}

export interface LastWeek {
  week: string;
  title: string;
  monday: string;
  sunday: string;
  /**
   * Les quatre nombres du résumé du lundi (`free_active` en personnes), et le
   * nombre de clés qui accompagne le quatrième.
   */
  numbers: {
    created: number;
    first_success: number;
    paid: number;
    free_active: number;
    free_active_keys: number;
    /** Les créations automatiques de la semaine, hors de `created`. */
    automated: number;
  };
  nudged: number;
  called_after_nudge: number;
  followup_pending: number;
  /** Les portes en tête de la colonne « créées », à égalité s'il y en a plusieurs. */
  top_doors: Array<{ door: string; label: string; created: number }>;
  /** La phrase du résumé, la même sur la page. */
  sentence: string;
}

/**
 * Une COHÉRENCE INTERNE, pas une preuve : les deux côtés lisent la même règle
 * (`isExternalKeyRow`) et le même regroupement, donc l'égalité est vraie par
 * construction. Elle montre que le rangement dans les semaines ne perd ni ne
 * double aucune clé ; elle ne dit pas que la règle est juste. La preuve du
 * mandat (« le total des colonnes égale le parc externe du jour ») vient du
 * recoupement indépendant joué sur la production.
 */
export interface DoorBoardControl {
  /**
   * Tout ce que le tableau range : la colonne « créées », toutes lignes et
   * toutes portes additionnées, PLUS la ligne à part des créations
   * automatiques. C'est ce total qui doit égaler le parc externe.
   */
  created_total: number;
  /** La colonne « créées » seule : des personnes. */
  people_created: number;
  /** La ligne à part des créations automatiques, toute l'histoire. */
  automated: number;
  /** Le parc externe du jour, compté par un regroupement SQL, avec la même règle. */
  external_fleet: number;
  equal: boolean;
  /** `created_total - external_fleet` ; 0 quand tout va bien. */
  gap: number;
  /** Les lignes de `api_keys` derrière ces lignées (rotations comprises). */
  external_key_rows: number;
}

export interface DoorBoard {
  observed_at: string;
  observed_at_zurich: string;
  weeks_shown: number;
  weeks: WeekRow[];
  /** Les semaines montrées (en cours et closes), porte par porte. */
  by_door: DoorRow[];
  /** Toutes les lignes, avant et sans date comprises : toute l'histoire, en personnes. */
  totals: DoorCounts;
  /** Les créations automatiques de toute l'histoire, à part. */
  automated: AutomatedLine;
  control: DoorBoardControl;
  free_users: FreeUsers;
  last_week: LastWeek;
  definitions: Record<string, string>;
}

export interface DoorBoardOptions {
  /** Semaines montrées, la semaine en cours comprise. Bornée à [2, 52]. */
  weeks?: number | null;
  /** Horloge injectable, pour les tests. */
  now?: number;
}

export const DOOR_BOARD_DEFINITIONS: Readonly<Record<string, string>> = {
  cle:
    'Une clé, c’est une clé et ses rotations : changer de secret ne crée pas de clé nouvelle. ' +
    'Nombres de clés, jamais de requêtes.',
  externe:
    'Hors du tableau : les clés émises par nous, et les comptes internes, de test, de sonde ou de ' +
    'ferme regroupée. Les acheteurs sans adresse restent des clients.',
  semaine:
    'Du lundi 00:00 au dimanche 23:59, heure suisse. Chaque colonne compte une clé à la semaine ' +
    'où la chose lui est arrivée, une seule fois dans toute l’histoire. Une semaine close peut ' +
    'encore bouger si une clé change d’état après coup (passage en payant, remboursement, ferme ' +
    'regroupée) ou si des données arrivent en retard.',
  porte:
    'L’origine écrite à la création de la clé, depuis le 23.09.2026. « Inconnue » pour les clés ' +
    'd’avant, jamais devinée.',
  premier_appel: 'Le premier appel métier réussi (réponse 2xx) de la clé.',
  relancee: 'La relance d’activation, un seul message par adresse, est partie et a été remise.',
  appel_apres_relance:
    'La clé a appelé l’API, quel qu’en soit le résultat, dans les sept jours qui suivent sa ' +
    'relance. Compté à la semaine de la relance ; en cours tant que les sept jours courent.',
  paye:
    'Le premier paiement de la clé : pack par carte, pack en USDC ou abonnement. Un paiement ' +
    'remboursé ou contesté ne compte pas ; le paiement à l’appel en USDC, sans clé, n’est pas ici.',
  gratuits:
    'Utilisateurs gratuits actifs : les personnes (adresses distinctes, la règle « une personne, ' +
    'une clé gratuite ») dont une clé externe au palier e-mail, avec l’allocation gratuite de ' +
    '200 requêtes par mois (ni abonnement ni plafond relevé), a appelé au moins une fois sur les ' +
    '30 jours qui finissent le dimanche de la semaine passée. Le seuil de 50 compte ces ' +
    'personnes ; le nombre de clés est donné à côté. Le mois civil, définition du 22.09, aussi.',
  automatique:
    'Robot d’exploration, créations sans suite : les clés anonymes prises sans navigateur ' +
    '(porte « API directe ») qui n’ont jamais reçu une seule réponse réussie, quand leur réseau ' +
    'en a pris au moins trois de ce genre en sept jours. Elles sont comptées à part, jamais ' +
    'effacées, et ne sont pas des personnes. Une clé seule sans suite reste une personne ; une ' +
    'telle clé qui sert ou qui est réclamée redevient une personne.',
  controle:
    'Cohérence interne : la colonne « créées » et la ligne à part des créations automatiques, ' +
    'toutes semaines et toutes portes additionnées, égalent le parc externe compté par la même ' +
    'règle. Elle montre que le tableau ne perd ni ne double aucune clé ; elle ne dit pas que la ' +
    'règle elle-même est juste.',
};

// ─── Les issues de paiement ─────────────────────────────────────────────────

/**
 * Les issues qui disent qu'une lignée a payé : un pack par carte ou en USDC
 * crédité (`credited`, `minted`, `minted_fallback`), un pack dont le litige
 * s'est refermé sans perte (`reinstated`, 26.09.2026), ou un abonnement posé
 * sur une clé existante (`attached`, lot B2). C'est la liste privée
 * `PAID_OUTCOMES_SQL` de `key-purchases.ts` ; un test la tient alignée sur
 * `isSaleOutcome`. Un pack remboursé ou contesté change d'issue
 * (`refunded`, `disputed`) et sort de lui-même.
 */
export const PAID_OUTCOMES: readonly string[] = [
  'credited',
  'minted',
  'minted_fallback',
  'reinstated',
  'attached',
];

// ─── Le calcul ──────────────────────────────────────────────────────────────

interface KeyRow {
  id: number;
  key_hash: string;
  key_prefix: string;
  email: string | null;
  issued_by_us: number | null;
  created_at: string | null;
  source: string | null;
  lineage: string;
  tier: string | null;
  monthly_limit: number | null;
  no_recredit: number | null;
  email_norm: string | null;
}

interface Lineage {
  id: string;
  rows: KeyRow[];
  external: boolean;
  birthMs: number | null;
  door: string;
  /** L'état COURANT de la clé (sa ligne la plus récente) porte l'allocation gratuite. */
  freeAllowance: boolean;
  /**
   * La personne derrière la clé : l'adresse normalisée de son état courant
   * (`email_norm`, sinon `normalizeEmail`, la règle « une personne, une clé
   * gratuite » du dépôt). Une clé sans adresse reste une personne à elle seule.
   */
  person: string;
}

function emptyCounts(): DoorCounts {
  return {
    created: 0,
    first_success: 0,
    nudged: 0,
    called_after_nudge: 0,
    followup_pending: 0,
    paid: 0,
  };
}

function addCounts(into: DoorCounts, from: DoorCounts): void {
  into.created += from.created;
  into.first_success += from.first_success;
  into.nudged += from.nudged;
  into.called_after_nudge += from.called_after_nudge;
  into.followup_pending += from.followup_pending;
  into.paid += from.paid;
}

function isEmpty(c: DoorCounts): boolean {
  return (
    c.created === 0 &&
    c.first_success === 0 &&
    c.nudged === 0 &&
    c.called_after_nudge === 0 &&
    c.followup_pending === 0 &&
    c.paid === 0
  );
}

function sortDoors(rows: DoorRow[]): DoorRow[] {
  return rows.sort(
    (a, b) =>
      b.created - a.created ||
      b.first_success - a.first_success ||
      b.paid - a.paid ||
      a.label.localeCompare(b.label, 'fr'),
  );
}

function weekNumber(label: string): string {
  return label.slice(-2).replace(/^0/, '');
}

export function weekTitle(week: SwissWeek): string {
  return `Semaine ${weekNumber(week.label)} · ${dayMonth(week.monday)} au ${dayMonth(week.sunday)}`;
}

function clampWeeks(raw: number | null | undefined): number {
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return DOOR_BOARD_DEFAULT_WEEKS;
  return Math.min(DOOR_BOARD_MAX_WEEKS, Math.max(DOOR_BOARD_MIN_WEEKS, Math.floor(raw)));
}

/** Toutes les lignées de `api_keys`, avec leur naissance, leur porte et leur état. */
function loadLineages(db: DatabaseType.Database): Map<string, Lineage> {
  const rows = db
    .prepare(
      `SELECT id, key_hash, key_prefix, email, issued_by_us, created_at, source,
              COALESCE(lineage_hash, key_hash) AS lineage, tier, monthly_limit, no_recredit,
              email_norm
         FROM api_keys
        ORDER BY id`,
    )
    .all() as KeyRow[];
  const byLineage = new Map<string, KeyRow[]>();
  for (const r of rows) {
    const list = byLineage.get(r.lineage);
    if (list) list.push(r);
    else byLineage.set(r.lineage, [r]);
  }
  const out = new Map<string, Lineage>();
  for (const [id, list] of byLineage) {
    // La naissance : la ligne la plus ancienne. Une date illisible passe après
    // toutes les autres, et l'identifiant départage deux lignes de même seconde.
    const birth = [...list].sort((a, b) => {
      const am = parseDbUtc(a.created_at) ?? Number.POSITIVE_INFINITY;
      const bm = parseDbUtc(b.created_at) ?? Number.POSITIVE_INFINITY;
      return am - bm || a.id - b.id;
    })[0];
    const current = list[list.length - 1];
    const tier = current.tier ?? '';
    out.set(id, {
      id,
      rows: list,
      // 🚨 Une seule ligne interne rend la lignée interne : une rotation recopie
      // l'adresse et `issued_by_us`, et un regroupement de ferme ne réécrit que
      // les lignes qu'il a vues. Le doute tombe du côté de l'exclusion.
      external: list.every((r) => isExternalKeyRow(r)),
      birthMs: parseDbUtc(birth.created_at),
      door: doorOf(birth.source),
      freeAllowance:
        (tier === 'email' || tier === 'claimed') &&
        (current.monthly_limit ?? FREE_TIER_MONTHLY_LIMIT) === FREE_TIER_MONTHLY_LIMIT &&
        !current.no_recredit,
      person: current.email_norm || normalizeEmail(current.email) || `sans-adresse:${id}`,
    });
  }
  return out;
}

/**
 * Les préfixes qui ont au moins une ligne dans `request_log` sur la fenêtre.
 *
 * 🚨 BORNÉ À LA FENÊTRE, sans index nouveau (relecture du 25.09.2026, D3).
 * `request_log` n'a que des index à une colonne ; un `key_prefix IN (…) AND
 * created_at BETWEEN …` part de l'index des préfixes et relit TOUT l'historique
 * conservé de chaque préfixe (jusqu'à douze mois) pour tester la date, et
 * l'API entière attend pendant ce temps. Ici, la fenêtre devient deux bornes
 * d'`id`, trouvées sur l'index de `created_at` (`ORDER BY created_at, id
 * LIMIT 1`, jamais `MIN(id)`, que SQLite pourrait résoudre en relisant les
 * lignes anciennes), puis chaque préfixe est cherché sur l'index des préfixes
 * entre ces deux `id` : une recherche bornée, qui ne grandit pas avec
 * l'historique. Suppose des `id` croissants avec l'heure, ce qui est le cas :
 * chaque ligne est datée par `datetime('now')` à son insertion. La date reste
 * testée, pour que la réponse soit exacte dans l'intervalle. Les trois requêtes
 * sont exportées pour qu'un test tienne leur plan d'exécution.
 */
export const LOG_FIRST_ID_AT_OR_AFTER_SQL =
  'SELECT id FROM request_log WHERE created_at >= ? ORDER BY created_at, id LIMIT 1';
export const LOG_PREFIX_BETWEEN_IDS_SQL =
  'SELECT 1 AS hit FROM request_log WHERE key_prefix = ? AND id >= ? AND id < ? ' +
  'AND created_at >= ? AND created_at < ? LIMIT 1';
export const LOG_PREFIX_FROM_ID_SQL =
  'SELECT 1 AS hit FROM request_log WHERE key_prefix = ? AND id >= ? ' +
  'AND created_at >= ? AND created_at < ? LIMIT 1';

function prefixesSeen(
  db: DatabaseType.Database,
  prefixes: string[],
  fromMs: number,
  toMs: number,
): Set<string> {
  const seen = new Set<string>();
  const unique = [...new Set(prefixes)];
  if (unique.length === 0 || toMs <= fromMs) return seen;
  const from = sqliteUtc(fromMs);
  const to = sqliteUtc(toMs);
  const firstFrom = db.prepare(LOG_FIRST_ID_AT_OR_AFTER_SQL);
  const low = firstFrom.get(from) as { id: number } | undefined;
  if (!low) return seen;
  // Aucune ligne après la fin de la fenêtre (une relance de moins de sept
  // jours, par exemple) : la borne haute reste ouverte.
  const high = firstFrom.get(to) as { id: number } | undefined;
  const probe = db.prepare(high ? LOG_PREFIX_BETWEEN_IDS_SQL : LOG_PREFIX_FROM_ID_SQL);
  for (const prefix of unique) {
    const hit = high
      ? probe.get(prefix, low.id, high.id, from, to)
      : probe.get(prefix, low.id, from, to);
    if (hit) seen.add(prefix);
  }
  return seen;
}

// ─── Les créations automatiques ─────────────────────────────────────────────

/**
 * « Robot d'exploration, créations sans suite » (29.09.2026).
 *
 * Un robot d'exploration d'API lit la description OpenAPI et appelle chaque
 * route qu'elle décrit, `POST /v1/keys/generate` comprise, sans corps : chaque
 * passage frappe une clé anonyme par la porte `api-direct`, que rien n'utilise
 * ensuite. Comptées comme des personnes, ces clés gonflaient la colonne
 * « créées », la phrase du lundi et le bulletin.
 *
 * ## La règle, par lignée, toutes conditions réunies
 *
 *   1. externe (la règle du parc, inchangée) ;
 *   2. née par la porte `api-direct` : ni navigateur, ni origine déclarée ;
 *   3. anonyme sur toutes ses lignes : jamais réclamée, aucune adresse ;
 *   4. jamais servie : ni premier appel métier réussi, ni paiement, ni aucune
 *      réponse 2xx dans le journal des appels, sur aucun de ses préfixes (une
 *      route hors métier compte : `lineage_facts` ne voit que le métier) ;
 *   5. née d'un réseau (`key_creations.ip_hash`, jamais le seau `unknown`) qui a
 *      frappé au moins trois clés remplissant 2 à 4 dans une fenêtre de sept
 *      jours contenant la sienne.
 *
 * Ce qui reste une personne : une clé qui a servi, ne serait-ce qu'une fois
 * (4, jugée clé par clé, même sur un réseau très actif) ; une clé seule sans
 * suite (5 en demande trois) ; une clé à adresse ou réclamée (3) ; toute clé
 * prise dans un navigateur (2). Seules les clés qui remplissent 2 à 4 comptent
 * vers le seuil de 5 : les clés à adresse d'un réseau partagé n'y comptent pas.
 *
 * La fenêtre glisse : les deux premières clés d'une rafale passent à part dès
 * que la troisième arrive. La semaine en cours peut donc encore bouger après
 * coup, comme pour un premier appel arrivé en retard.
 *
 * ## La mémoire, qui n'efface jamais
 *
 * `key_creations` est purgée après 30 jours (`recordKeyCreation`) : sans
 * mémoire, la preuve réseau d'une clé disparaîtrait avec sa ligne de naissance,
 * et la clé reviendrait parmi les personnes d'une semaine close. La lignée est
 * donc notée dans `door_board_automated` dès que la preuve réseau est vue, et la
 * note ne remplace QUE la condition 5 : 1 à 4 sont relues à chaque calcul, et
 * une clé notée qui sert ou qui est réclamée redevient une personne. Une note
 * n'est jamais effacée parce que la preuve vivante retombe : les voisines d'une
 * rafale sont purgées avant la clé du milieu, dont le compte tomberait sous
 * trois. La note ne porte aucun hachage d'adresse.
 *
 * Limite assumée : une création que personne n'a jamais calculée pendant ses 30
 * premiers jours (ni la page, ni le résumé du lundi, ni le bulletin) n'a pas
 * de note et reste une personne. C'est le côté sûr.
 */
export const AUTOMATED_LABEL_FR = 'Robot d’exploration, créations sans suite';

/** La porte d'une création sans navigateur ni origine déclarée. */
export const AUTOMATED_DOOR = 'api-direct';
const AUTOMATED_TIER: KeyTier = 'anonymous';
/** Au moins trois créations du même réseau… */
export const AUTOMATED_MIN_CREATIONS = 3;
/** …dans une fenêtre de sept jours. */
export const AUTOMATED_WINDOW_DAYS = 7;
/** Le seau que `recordKeyCreation` écrit quand l'adresse manque : jamais un réseau. */
export const UNKNOWN_NETWORK = 'unknown';

/**
 * Une réponse 2xx, une seule, sur un préfixe : sans borne de date, donc sans
 * relire l'historique d'une clé qui a servi (le premier 2xx trouvé arrête la
 * recherche), et sans ligne du tout pour une clé jamais présentée. Exportée
 * pour qu'un test tienne son plan d'exécution (index des préfixes).
 */
export const LOG_PREFIX_SERVED_SQL =
  'SELECT 1 AS hit FROM request_log WHERE key_prefix = ? AND status >= 200 AND status < 300 LIMIT 1';

/** Les naissances rattachées à un réseau connu (30 jours au plus, la purge de la table). */
export const AUTOMATED_BIRTHS_SQL =
  'SELECT key_prefix, ip_hash, created_at FROM key_creations ' +
  'WHERE key_prefix IS NOT NULL AND ip_hash IS NOT NULL AND ip_hash <> ?';

const MEMO_ENSURED = new WeakSet<object>();

function automatedMemo(db: DatabaseType.Database): DatabaseType.Database {
  if (MEMO_ENSURED.has(db)) return db;
  // Pas de contre-apostrophe ni de point d'interrogation dans ces commentaires
  // SQL : ils vivent dans un gabarit JS.
  db.exec(`
    CREATE TABLE IF NOT EXISTS door_board_automated (
      -- La lignée (key_hash de la clé née). Aucune adresse, même hachée.
      lineage_hash TEXT PRIMARY KEY,
      -- Le premier calcul qui a vu la preuve réseau, UTC, format datetime(now).
      marked_at    TEXT NOT NULL
    );
  `);
  MEMO_ENSURED.add(db);
  return db;
}

/** Les lignées notées. Une mémoire illisible rend l'ensemble vide : le côté des personnes. */
function readAutomatedMemo(db: DatabaseType.Database): Set<string> {
  try {
    return new Set(
      (
        automatedMemo(db).prepare('SELECT lineage_hash FROM door_board_automated').all() as Array<{
          lineage_hash: string;
        }>
      ).map((r) => r.lineage_hash),
    );
  } catch {
    return new Set();
  }
}

/** Ajoute des notes, sans jamais en retirer. Un échec d'écriture ne coûte pas le tableau. */
function writeAutomatedMemo(db: DatabaseType.Database, ids: string[], nowMs: number): void {
  if (ids.length === 0) return;
  try {
    const insert = automatedMemo(db).prepare(
      'INSERT OR IGNORE INTO door_board_automated (lineage_hash, marked_at) VALUES (?, ?)',
    );
    const at = sqliteUtc(nowMs);
    db.transaction(() => {
      for (const id of ids) insert.run(id, at);
    })();
  } catch (err) {
    console.error(
      '[door-board] mémoire des créations automatiques non écrite :',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Les lignées externes qui sont des créations automatiques, selon la règle
 * ci-dessus. Les conditions sans requête d'abord, le journal des appels en
 * dernier et seulement pour les candidates.
 */
function findAutomated(
  db: DatabaseType.Database,
  external: Lineage[],
  lineageOfPrefix: Map<string, string>,
  firstSuccess: Map<string, number>,
  firstPaid: Map<string, number>,
  nowMs: number,
): Set<string> {
  const found = new Set<string>();
  // 2, 3 et la part de 4 qui se lit sans le journal.
  const eligible = new Map<string, Lineage>();
  for (const l of external) {
    if (l.door !== AUTOMATED_DOOR) continue;
    if (!l.rows.every((r) => r.tier === AUTOMATED_TIER)) continue;
    if (firstSuccess.has(l.id) || firstPaid.has(l.id)) continue;
    eligible.set(l.id, l);
  }
  if (eligible.size === 0) return found;

  // Le reste de 4 : une réponse 2xx sur l'un de ses préfixes, cherchée une fois.
  const servedProbe = db.prepare(LOG_PREFIX_SERVED_SQL);
  const neverServedCache = new Map<string, boolean>();
  const neverServed = (id: string): boolean => {
    let answer = neverServedCache.get(id);
    if (answer === undefined) {
      const rows = eligible.get(id)?.rows ?? [];
      answer = !rows.some((r) => servedProbe.get(r.key_prefix) !== undefined);
      neverServedCache.set(id, answer);
    }
    return answer;
  };

  // 5, la preuve vivante : les naissances candidates, réseau par réseau.
  const byNetwork = new Map<string, Map<string, number>>();
  for (const r of db.prepare(AUTOMATED_BIRTHS_SQL).all(UNKNOWN_NETWORK) as Array<{
    key_prefix: string;
    ip_hash: string;
    created_at: string | null;
  }>) {
    const id = lineageOfPrefix.get(r.key_prefix);
    const ms = parseDbUtc(r.created_at);
    if (id === undefined || ms === null || !eligible.has(id) || !neverServed(id)) continue;
    let births = byNetwork.get(r.ip_hash);
    if (!births) {
      births = new Map();
      byNetwork.set(r.ip_hash, births);
    }
    // Une lignée compte une fois pour son réseau, à sa naissance la plus ancienne.
    const seen = births.get(id);
    if (seen === undefined || ms < seen) births.set(id, ms);
  }
  const proven = new Set<string>();
  const windowMs = AUTOMATED_WINDOW_DAYS * DAY_MS;
  for (const births of byNetwork.values()) {
    const sorted = [...births.entries()].sort((a, b) => a[1] - b[1]);
    // Pour chaque début, la plus grande fenêtre de sept jours qui en part.
    let end = 0;
    for (let start = 0; start < sorted.length; start++) {
      if (end < start) end = start;
      while (end + 1 < sorted.length && sorted[end + 1][1] - sorted[start][1] < windowMs) end++;
      if (end - start + 1 >= AUTOMATED_MIN_CREATIONS) {
        for (let i = start; i <= end; i++) proven.add(sorted[i][0]);
      }
    }
  }

  // La note supplée la preuve réseau purgée ; 1 à 4 restent relues.
  const remembered = readAutomatedMemo(db);
  for (const id of eligible.keys()) {
    if (proven.has(id) || (remembered.has(id) && neverServed(id))) found.add(id);
  }
  writeAutomatedMemo(
    db,
    [...proven].filter((id) => !remembered.has(id)),
    nowMs,
  );
  return found;
}

interface AutomatedDetection {
  lineages: Map<string, Lineage>;
  external: Lineage[];
  lineageOfPrefix: Map<string, string>;
  firstSuccess: Map<string, number>;
  firstPaid: Map<string, number>;
  automatedIds: Set<string>;
}

/**
 * La préparation commune entre `getDoorBoard` et `getAutomatedKeyPrefixes` :
 * les lignées, le parc externe, les deux événements que `findAutomated` doit
 * connaître et les créations automatiques elles-mêmes. Un seul appel de ce
 * module fait ce calcul, pour que les deux fonctions ne puissent jamais
 * diverger sur qui est un robot, et pour qu'aucune des deux requêtes SQL
 * qu'il ouvre ne soit écrite deux fois dans ce fichier.
 */
function detectAutomated(db: DatabaseType.Database, nowMs: number): AutomatedDetection {
  const lineages = loadLineages(db);
  const external = [...lineages.values()].filter((l) => l.external);
  const lineageOfPrefix = new Map<string, string>();
  for (const l of lineages.values()) {
    for (const r of l.rows) lineageOfPrefix.set(r.key_prefix, l.id);
  }

  const firstSuccess = new Map<string, number>();
  for (const r of db
    .prepare(
      `SELECT lineage_hash, first_success_at FROM lineage_facts WHERE first_success_at IS NOT NULL`,
    )
    .all() as Array<{ lineage_hash: string; first_success_at: string }>) {
    const ms = parseDbUtc(r.first_success_at);
    if (ms !== null) firstSuccess.set(r.lineage_hash, ms);
  }

  const paidOutcomes = PAID_OUTCOMES.map(() => '?').join(', ');
  const firstPaid = new Map<string, number>();
  for (const r of db
    .prepare(
      `SELECT lineage_hash, MIN(created_at) AS first_at FROM key_purchases
        WHERE outcome IN (${paidOutcomes}) AND COALESCE(issued_by_us, 0) = 0
        GROUP BY lineage_hash`,
    )
    .all(...PAID_OUTCOMES) as Array<{ lineage_hash: string; first_at: string }>) {
    const ms = parseDbUtc(r.first_at);
    if (ms !== null) firstPaid.set(r.lineage_hash, ms);
  }

  const automatedIds = findAutomated(db, external, lineageOfPrefix, firstSuccess, firstPaid, nowMs);
  return { lineages, external, lineageOfPrefix, firstSuccess, firstPaid, automatedIds };
}

/**
 * Les préfixes de clé des lignées classées « création automatique » (robot
 * d'exploration, jamais servies, cf. `findAutomated` ci-dessus), pour un
 * appelant qui doit les écarter d'un classement par porte ou par source sans
 * avoir besoin du tableau entier — voir `weekly-facts.ts`, `top_sources`.
 *
 * Sert au calcul, jamais à une réponse HTTP : l'en-tête de ce module promet
 * qu'aucune sortie du tableau des portes ne porte un préfixe de clé, et cette
 * fonction reste hors de `DoorBoard`.
 */
export function getAutomatedKeyPrefixes(opts: DoorBoardOptions = {}): Set<string> {
  const db = getStatsDB();
  const nowMs = opts.now ?? Date.now();
  const { lineages, automatedIds } = detectAutomated(db, nowMs);
  const prefixes = new Set<string>();
  for (const id of automatedIds) {
    for (const r of lineages.get(id)?.rows ?? []) prefixes.add(r.key_prefix);
  }
  return prefixes;
}

/** Un nombre et son nom accordé : 0 et 1 au singulier, comme en français. */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n <= 1 ? one : many}`;
}

const MONTHS_FR = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** `AAAA-MM` en toutes lettres : « octobre ». */
export function monthNameFr(month: string): string {
  return MONTHS_FR[Number(month.slice(5, 7)) - 1] ?? month;
}

/**
 * La phrase du résumé du lundi, la même sur la page. Une seule phrase, sans
 * tiret long : la porte en tête, les relances quand il y en a eu, les
 * créations automatiques à part quand il y en a eu, et le seuil des
 * utilisateurs gratuits quand il est franchi.
 */
export function buildSentence(week: Omit<LastWeek, 'sentence'>, free: FreeUsers): string {
  const total = week.numbers.created;
  const automated = week.numbers.automated;
  let head: string;
  if (total === 0 || week.top_doors.length === 0) {
    // Les clés du robot sont externes : « aucune clé externe » les nierait.
    head =
      automated > 0
        ? 'Aucune clé n’a été créée par une personne la semaine passée'
        : 'Aucune clé externe n’a été créée la semaine passée';
  } else if (week.top_doors.length === 1) {
    const top = week.top_doors[0];
    head =
      top.created === total
        ? `Toutes les clés de la semaine passée viennent de la porte « ${top.label} »`
        : `La porte « ${top.label} » a donné le plus de clés (${top.created} sur ${total})`;
  } else if (week.top_doors.length === 2) {
    const [first, second] = week.top_doors;
    head = `Les portes « ${first.label} » et « ${second.label} » ont donné le plus de clés (${first.created} chacune sur ${total})`;
  } else {
    // Au-delà de deux, la liste des noms noierait la phrase : le tableau les donne.
    const each = week.top_doors[0].created;
    head = `${week.top_doors.length} portes sont à égalité en tête, avec ${plural(each, 'clé', 'clés')} chacune sur ${total}`;
  }
  let nudges = '';
  if (week.nudged > 0) {
    const called = week.called_after_nudge;
    nudges =
      `, ${plural(week.nudged, 'relance partie', 'relances parties')}` +
      ` (${called} suivie${called > 1 ? 's' : ''} d’un appel sous sept jours` +
      (week.followup_pending > 0 ? `, ${week.followup_pending} encore dans ce délai` : '') +
      ')';
  }
  const apart =
    automated > 0
      ? ` ; à part, ${AUTOMATED_LABEL_FR.charAt(0).toLowerCase()}${AUTOMATED_LABEL_FR.slice(1)} : ${automated}`
      : '';
  let threshold = '';
  if (free.crossed) {
    const first = free.crossed_by[0];
    let where = 'sur les 30 jours finissant dimanche';
    if (first.basis === 'month' && first.month) {
      const toDate = free.calendar.find((m) => m.month === first.month)?.to_date;
      where = `en ${monthNameFr(first.month)}${toDate ? ' à ce jour' : ''}`;
    }
    threshold =
      ` ; seuil franchi : ${first.people} utilisateurs gratuits actifs à 200 par mois` +
      ` (des personnes, pas des clés) ${where}, plus de ${free.threshold} :` +
      ' le plafond gratuit est à réévaluer (décision du 22.09)';
  }
  return `${head}${nudges}${apart}${threshold}.`;
}

/** Le mois UTC `AAAA-MM` d'un instant, et celui d'avant. */
function monthOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

export function getDoorBoard(opts: DoorBoardOptions = {}): DoorBoard {
  const db = getStatsDB();
  const nowMs = opts.now ?? Date.now();
  const weeksShown = clampWeeks(opts.weeks);

  const current = swissWeekOf(nowMs);
  const shown: SwissWeek[] = [];
  for (let i = 0; i < weeksShown; i++) shown.push(swissWeekShift(current, i));
  const oldest = shown[shown.length - 1];
  const previous = shown[1];

  // ── Les clés, en lignées, le parc externe et les créations automatiques ───
  // Même préparation que `getAutomatedKeyPrefixes` : voir `detectAutomated`,
  // qui rend aussi les deux événements datés dont la relance et les personnes
  // ont encore besoin plus bas (`firstSuccess`, `firstPaid`), pour qu'aucune
  // des deux requêtes ne soit écrite deux fois dans ce fichier.
  const { lineages, external, lineageOfPrefix, firstSuccess, firstPaid, automatedIds } =
    detectAutomated(db, nowMs);
  const lineageOfHash = new Map<string, string>();
  for (const l of lineages.values()) {
    for (const r of l.rows) lineageOfHash.set(r.key_hash, l.id);
  }

  // La relance remise, la plus ancienne par lignée. `delivered = 0` est une
  // relance réservée dont l'envoi a échoué : personne ne l'a reçue.
  const nudgedAt = new Map<string, number>();
  for (const r of db
    .prepare(`SELECT key_prefix, sent_at FROM activation_nudges WHERE delivered = 1`)
    .all() as Array<{ key_prefix: string; sent_at: string }>) {
    const lineage = lineageOfPrefix.get(r.key_prefix);
    const ms = parseDbUtc(r.sent_at);
    if (!lineage || ms === null) continue;
    const seen = nudgedAt.get(lineage);
    if (seen === undefined || ms < seen) nudgedAt.set(lineage, ms);
  }

  // ── Les créations automatiques, sorties des personnes, gardées à part ─────
  const people = external.filter((l) => !automatedIds.has(l.id));

  // ── Le rangement : une ligne par semaine montrée, puis « avant » et « sans date »
  type Bucket = { counts: Map<string, DoorCounts> };
  const buckets = new Map<string, Bucket>();
  const bucketKey = (ms: number | null): string => {
    if (ms === null) return 'undated';
    if (ms < oldest.startMs) return 'before';
    // Un instant postérieur à la semaine en cours (horloge décalée) reste dans
    // la semaine en cours plutôt que de sortir du tableau et du contrôle.
    if (ms >= current.startMs) return current.label;
    for (const w of shown) if (ms >= w.startMs && ms < w.endMs) return w.label;
    return 'before';
  };
  const bump = (ms: number | null, door: string, field: keyof DoorCounts): void => {
    const key = bucketKey(ms);
    let b = buckets.get(key);
    if (!b) {
      b = { counts: new Map() };
      buckets.set(key, b);
    }
    let c = b.counts.get(door);
    if (!c) {
      c = emptyCounts();
      b.counts.set(door, c);
    }
    c[field] += 1;
  };

  const automatedByBucket = new Map<string, number>();
  for (const id of automatedIds) {
    const key = bucketKey(lineages.get(id)?.birthMs ?? null);
    automatedByBucket.set(key, (automatedByBucket.get(key) ?? 0) + 1);
  }

  for (const l of people) {
    bump(l.birthMs, l.door, 'created');
    const success = firstSuccess.get(l.id);
    if (success !== undefined) bump(success, l.door, 'first_success');
    const paid = firstPaid.get(l.id);
    if (paid !== undefined) bump(paid, l.door, 'paid');
    const nudged = nudgedAt.get(l.id);
    if (nudged !== undefined) {
      bump(nudged, l.door, 'nudged');
      const until = nudged + NUDGE_FOLLOWUP_DAYS * DAY_MS;
      const prefixes = l.rows.map((r) => r.key_prefix);
      const called = prefixesSeen(db, prefixes, nudged, until).size > 0;
      if (called) bump(nudged, l.door, 'called_after_nudge');
      else if (nowMs < until) bump(nudged, l.door, 'followup_pending');
    }
  }

  const rowFor = (key: string, kind: WeekKind, week: SwissWeek | null, title: string): WeekRow => {
    const doors: DoorRow[] = [];
    const totals = emptyCounts();
    for (const [door, c] of buckets.get(key)?.counts ?? new Map<string, DoorCounts>()) {
      if (isEmpty(c)) continue;
      doors.push({ door, label: doorLabel(door), ...c });
      addCounts(totals, c);
    }
    return {
      key,
      kind,
      title,
      monday: week?.monday ?? null,
      sunday: week?.sunday ?? null,
      totals,
      doors: sortDoors(doors),
      automated: { label: AUTOMATED_LABEL_FR, created: automatedByBucket.get(key) ?? 0 },
    };
  };

  const weeks: WeekRow[] = shown.map((w, i) =>
    rowFor(w.label, i === 0 ? 'current' : 'complete', w, weekTitle(w)),
  );
  weeks.push(rowFor('before', 'before', null, `Avant le ${dayMonth(oldest.monday)}`));
  if (buckets.has('undated') || automatedByBucket.has('undated')) {
    weeks.push(rowFor('undated', 'undated', null, 'Date inconnue'));
  }

  const totals = emptyCounts();
  let automatedTotal = 0;
  for (const w of weeks) {
    addCounts(totals, w.totals);
    automatedTotal += w.automated.created;
  }

  const doorTotals = new Map<string, DoorCounts>();
  for (const w of weeks) {
    if (w.kind !== 'current' && w.kind !== 'complete') continue;
    for (const d of w.doors) {
      let c = doorTotals.get(d.door);
      if (!c) {
        c = emptyCounts();
        doorTotals.set(d.door, c);
      }
      addCounts(c, d);
    }
  }
  const byDoor = sortDoors(
    [...doorTotals.entries()].map(([door, c]) => ({ door, label: doorLabel(door), ...c })),
  );

  // ── Le contrôle : la colonne « créées » contre le parc compté à part ──────
  registerExternalFn(db);
  const fleet = db
    .prepare(
      `SELECT COUNT(*) AS lineages, COALESCE(SUM(n), 0) AS rows FROM (
         SELECT COALESCE(lineage_hash, key_hash) AS lineage, COUNT(*) AS n,
                MIN(door_board_external(email, issued_by_us)) AS ext
           FROM api_keys
          GROUP BY lineage)
        WHERE ext = 1`,
    )
    .get() as { lineages: number; rows: number };
  // Les créations automatiques sont hors des personnes, jamais hors du parc :
  // la ligne à part s'additionne à la colonne « créées » pour l'égaler.
  const ranked = totals.created + automatedTotal;
  const control: DoorBoardControl = {
    created_total: ranked,
    people_created: totals.created,
    automated: automatedTotal,
    external_fleet: fleet.lineages,
    equal: ranked === fleet.lineages,
    gap: ranked - fleet.lineages,
    external_key_rows: fleet.rows,
  };

  // ── Les utilisateurs gratuits actifs à 200 par mois ───────────────────────
  //
  // Le nombre du lundi porte sur une fenêtre CLOSE, les 30 jours qui finissent
  // le dimanche de la semaine passée : il ne bouge plus après l'envoi, et il ne
  // retombe pas près de zéro le premier lundi d'un mois, comme le ferait le
  // mois civil en cours. Le mois civil, définition du 22.09, est donné à côté.
  const free = external.filter((l) => l.freeAllowance);
  const windowEnd = previous.endMs;
  const sunday = Date.parse(`${previous.sunday}T00:00:00Z`);
  const fromDay = new Date(sunday - (FREE_ACTIVE_WINDOW_DAYS - 1) * DAY_MS);
  const windowStart = zurichLocalToUtcMs(
    fromDay.getUTCFullYear(),
    fromDay.getUTCMonth() + 1,
    fromDay.getUTCDate(),
  );
  const freePrefixes = free.flatMap((l) => l.rows.map((r) => r.key_prefix));
  const seenInWindow = prefixesSeen(db, freePrefixes, windowStart, windowEnd);
  const activeInWindow = new Set<string>();
  for (const p of seenInWindow) {
    const lineage = lineageOfPrefix.get(p);
    if (lineage) activeInWindow.add(lineage);
  }
  // Des clés aux personnes : une personne qui tient deux clés gratuites actives
  // compte une fois pour le seuil (décision du 22.09 : « 50 utilisateurs »).
  const peopleOf = (ids: Iterable<string>): number => {
    const people = new Set<string>();
    for (const id of ids) {
      const l = lineages.get(id);
      if (l) people.add(l.person);
    }
    return people.size;
  };

  const freeIds = new Set(free.map((l) => l.id));
  const thisMonth = monthOf(nowMs);
  const lastMonth = previousMonth(thisMonth);
  const activeInMonth = (month: string): Set<string> => {
    const ids = new Set<string>();
    for (const r of db
      .prepare(`SELECT key_hash FROM api_usage WHERE month = ? AND count > 0`)
      .all(month) as Array<{ key_hash: string }>) {
      const lineage = lineageOfHash.get(r.key_hash);
      if (lineage && freeIds.has(lineage)) ids.add(lineage);
    }
    return ids;
  };
  const calendar = [lastMonth, thisMonth].map((month) => {
    const ids = activeInMonth(month);
    return { month, people: peopleOf(ids), keys: ids.size, to_date: month === thisMonth };
  });
  const activePeople = peopleOf(activeInWindow);
  const crossedBy: FreeUsers['crossed_by'] = [];
  if (activePeople > FREE_USERS_THRESHOLD) {
    crossedBy.push({ basis: 'window', month: null, people: activePeople });
  }
  for (const m of calendar) {
    if (m.people > FREE_USERS_THRESHOLD) {
      crossedBy.push({ basis: 'month', month: m.month, people: m.people });
    }
  }
  const freeUsers: FreeUsers = {
    threshold: FREE_USERS_THRESHOLD,
    threshold_counts: 'people',
    window_days: FREE_ACTIVE_WINDOW_DAYS,
    window: { from: fromDay.toISOString().slice(0, 10), to: previous.sunday },
    active_people: activePeople,
    active_keys: activeInWindow.size,
    calendar,
    crossed_by: crossedBy,
    crossed: crossedBy.length > 0,
  };

  // ── La semaine passée : les quatre nombres et la phrase ───────────────────
  const lastRow = weeks[1];
  const maxCreated = lastRow.doors.reduce((m, d) => Math.max(m, d.created), 0);
  const topDoors =
    maxCreated > 0
      ? lastRow.doors
          .filter((d) => d.created === maxCreated)
          .map((d) => ({ door: d.door, label: d.label, created: d.created }))
      : [];
  const partial: Omit<LastWeek, 'sentence'> = {
    week: previous.label,
    title: weekTitle(previous),
    monday: previous.monday,
    sunday: previous.sunday,
    numbers: {
      created: lastRow.totals.created,
      first_success: lastRow.totals.first_success,
      paid: lastRow.totals.paid,
      free_active: freeUsers.active_people,
      free_active_keys: freeUsers.active_keys,
      automated: lastRow.automated.created,
    },
    nudged: lastRow.totals.nudged,
    called_after_nudge: lastRow.totals.called_after_nudge,
    followup_pending: lastRow.totals.followup_pending,
    top_doors: topDoors,
  };

  return {
    observed_at: sqliteUtc(nowMs),
    observed_at_zurich: zurichDayTime(nowMs),
    weeks_shown: weeksShown,
    weeks,
    by_door: byDoor,
    totals,
    automated: { label: AUTOMATED_LABEL_FR, created: automatedTotal },
    control,
    free_users: freeUsers,
    last_week: { ...partial, sentence: buildSentence(partial, freeUsers) },
    definitions: { ...DOOR_BOARD_DEFINITIONS },
  };
}

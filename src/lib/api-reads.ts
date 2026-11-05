/**
 * Le comptage agrégé de `request_log` sur une fenêtre courte : qui a lu quoi, en familles.
 *
 * ## Rien de brut ne peut sortir
 *
 * Le chemin et l'agent utilisateur n'atteignent le `SELECT` qu'à travers deux fonctions
 * qui rendent une valeur de liste fermée, et le `GROUP BY` porte sur ces valeurs. Une ligne
 * de la réponse ne peut donc contenir ni chemin, ni agent, et la requête ne lit ni
 * l'empreinte d'adresse, ni le préfixe de clé (seulement sa présence).
 *
 * ## Le coût
 *
 * better-sqlite3 est synchrone et l'API tient sur un seul processus : une lecture lente gèle
 * tous les clients. La requête commence donc par la date, que le planificateur sert par
 * `idx_request_log_date`, et la fenêtre est limitée à sept jours. Aucun index n'est ajouté
 * (voir le budget de taille dans `db.ts`) ; un test tient le plan d'exécution.
 *
 * Nos propres outils ne sont pas retirés : ce comptage dit ce qui a été servi, et un témoin
 * pris juste avant une fenêtre de test mesure le bruit de fond.
 */
import type DatabaseType from 'better-sqlite3';
import { getStatsDB } from './db.js';

export const API_READS_MAX_WINDOW_DAYS = 7;

export const PATH_FAMILIES = [
  'validation',
  'lot',
  'bic',
  'demonstration',
  'demonstration_pays',
  'llms',
  'openapi',
  'racine_v1',
  'mcp',
  'autre',
] as const;
export type PathFamily = (typeof PATH_FAMILIES)[number];

export const CLIENT_FAMILIES = [
  'chatgpt',
  'perplexity',
  'google',
  'curl',
  'navigateur',
  'aucun',
  'autre',
] as const;
export type ClientFamily = (typeof CLIENT_FAMILIES)[number];

export const METHOD_CLASSES = ['GET', 'POST', 'HEAD', 'OPTIONS', 'autre'] as const;
export const STATUS_CLASSES = ['2xx', '3xx', '4xx', '5xx', 'autre'] as const;

const under = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);

/**
 * `/v1/demo/DE` et `/v1/demo/:other` sont une seule famille, ce qui suit `/v1/demo/` n'étant
 * jamais lu. `/mcp:…` : les chemins virtuels que `src/app.ts` écrit pour les appels d'outils.
 */
export function pathFamily(raw: unknown): PathFamily {
  if (typeof raw !== 'string') return 'autre';
  if (under(raw, '/v1/iban/validate')) return 'validation';
  if (under(raw, '/v1/iban/batch')) return 'lot';
  if (under(raw, '/v1/bic')) return 'bic';
  if (raw === '/v1/demo') return 'demonstration';
  if (raw.startsWith('/v1/demo/')) return 'demonstration_pays';
  if (raw === '/llms.txt') return 'llms';
  if (raw.includes('openapi')) return 'openapi';
  if (raw === '/v1') return 'racine_v1';
  if (under(raw, '/mcp') || raw.startsWith('/mcp:')) return 'mcp';
  return 'autre';
}

/** L'ordre compte : ChatGPT-User et Googlebot s'annoncent aussi par « Mozilla ». */
export function clientFamily(raw: unknown): ClientFamily {
  if (typeof raw !== 'string' || !raw.trim()) return 'aucun';
  const agent = raw.toLowerCase();
  if (agent.includes('chatgpt') || agent.includes('openai')) return 'chatgpt';
  if (agent.includes('perplexity')) return 'perplexity';
  if (agent.includes('google') || agent.includes('gemini')) return 'google';
  if (agent.includes('curl')) return 'curl';
  if (agent.startsWith('mozilla')) return 'navigateur';
  return 'autre';
}

export function methodClass(raw: unknown): (typeof METHOD_CLASSES)[number] {
  return raw === 'GET' || raw === 'POST' || raw === 'HEAD' || raw === 'OPTIONS' ? raw : 'autre';
}

export function statusClass(raw: unknown): (typeof STATUS_CLASSES)[number] {
  if (typeof raw !== 'number') return 'autre';
  if (raw >= 200 && raw < 300) return '2xx';
  if (raw >= 300 && raw < 400) return '3xx';
  if (raw >= 400 && raw < 500) return '4xx';
  if (raw >= 500 && raw < 600) return '5xx';
  return 'autre';
}

const REGISTERED = new WeakSet<object>();

export function registerApiReadsFunctions(db: DatabaseType.Database): void {
  if (REGISTERED.has(db)) return;
  db.function('api_reads_path', { deterministic: true }, pathFamily);
  db.function('api_reads_client', { deterministic: true }, clientFamily);
  db.function('api_reads_method', { deterministic: true }, methodClass);
  db.function('api_reads_status', { deterministic: true }, statusClass);
  REGISTERED.add(db);
}

/** Exportée pour qu'un test tienne son plan d'exécution (index de la date). */
export const API_READS_SQL = `
  SELECT api_reads_path(path) AS path_family,
         api_reads_method(method) AS method,
         api_reads_status(status) AS status_class,
         (key_prefix IS NOT NULL) AS with_key,
         api_reads_client(user_agent) AS client_family,
         COUNT(*) AS count
    FROM request_log
   WHERE created_at >= ? AND created_at < ?
   GROUP BY 1, 2, 3, 4, 5
   ORDER BY count DESC, 1, 2, 3, 4, 5`;

export interface ApiReadsRow {
  path_family: PathFamily;
  method: (typeof METHOD_CLASSES)[number];
  status_class: (typeof STATUS_CLASSES)[number];
  with_key: boolean;
  client_family: ClientFamily;
  count: number;
}

export interface ApiReads {
  window: { from: string; to: string };
  /** Toutes les lignes de la fenêtre : la somme des `count`. */
  total: number;
  rows: ApiReadsRow[];
}

export type WindowResult =
  | { ok: true; from: string; to: string }
  | { ok: false; error: 'invalid_window' | 'window_too_long' };

const INSTANT = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})Z?$/;

/**
 * Un instant UTC au format de `datetime('now')`, ou null. Jamais l'ISO reçu tel quel : son
 * `T` est supérieur à l'espace, et toute comparaison avec `created_at` serait fausse. Le
 * passage par `Date` refuse une date qui n'existe pas, comme le 31 février.
 */
function instantOf(raw: string | undefined): { sql: string; ms: number } | null {
  const m = raw === undefined ? null : INSTANT.exec(raw);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}Z`);
  if (!Number.isFinite(ms)) return null;
  const sql = `${m[1]} ${m[2]}`;
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ') === sql ? { sql, ms } : null;
}

/** `from` inclus, `to` exclu. Sept jours pile passent, une seconde de plus non. */
export function resolveApiReadsWindow(
  from: string | undefined,
  to: string | undefined,
): WindowResult {
  const a = instantOf(from);
  const b = instantOf(to);
  if (!a || !b || b.ms <= a.ms) return { ok: false, error: 'invalid_window' };
  if (b.ms - a.ms > API_READS_MAX_WINDOW_DAYS * 86_400_000) {
    return { ok: false, error: 'window_too_long' };
  }
  return { ok: true, from: a.sql, to: b.sql };
}

export function getApiReads(from: string, to: string): ApiReads {
  const db = getStatsDB();
  registerApiReadsFunctions(db);
  const rows = (
    db.prepare(API_READS_SQL).all(from, to) as Array<
      Omit<ApiReadsRow, 'with_key'> & { with_key: number }
    >
  ).map((r) => ({ ...r, with_key: r.with_key === 1 }));
  return {
    window: { from, to },
    total: rows.reduce((sum, r) => sum + r.count, 0),
    rows,
  };
}

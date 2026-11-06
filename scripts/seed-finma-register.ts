import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { RESTRICTED_FLOORS, restrictedTable } from '../src/lib/restricted-family.js';

/**
 * Le registre public de la FINMA pour le contrôle de conformité d'un IBAN suisse :
 * quelle catégorie d'autorisation il porte pour l'établissement du numéro de banque.
 * Chaîne privée seulement (membre `finma_register`, src/lib/restricted-family.ts) :
 * jamais dans `data/compliance.sqlite`, et sans lecture dans le robot public.
 *
 * ## Le rapprochement, par identifiants et jamais par un nom
 *
 * IID (fichier de SIX) -> BIC11 de cette ligne -> LEI (annuaire, une seule valeur)
 * -> IDE (GLEIF, `registeredAs`) -> IDE du registre, en égalité stricte. Un nom ne
 * rattache jamais rien, même identique, et le rapprochement approché est interdit
 * ici. Les noms servent seulement à ÉCARTER :
 * - un BIC porté par plusieurs noms SIX (un BIC partagé rattacherait une banque à
 *   l'entité juridique d'une autre) ;
 * - un IDE réclamé par plusieurs noms réellement différents (casse et ponctuation
 *   mises à part) : le LEI d'une ligne de l'annuaire peut être faux, on l'a mesuré ;
 * - une succursale sans LEI, rattachée à son siège seulement si elle porte le même
 *   nom que lui (`head_office_lei_to_uid`).
 *
 * Une ligne non rattachée dit seulement « non vérifié », jamais « non autorisé » :
 * voir src/lib/finma-register.ts.
 *
 * ## Ce qui n'entre pas
 *
 * Seuls l'IDE et le libellé officiel sont lus dans le flux : ni nom, ni adresse, ni
 * statut de liste d'alerte, ni catégorie inventée par la collecte. Les gestionnaires
 * de fortune et leurs organismes de surveillance sont écartés dès la lecture : un
 * organisme de surveillance (LEFin) n'est pas un organisme d'autorégulation, et rien
 * ici ne doit laisser croire le contraire.
 *
 * ## Une source en panne ne bloque pas les listes de sanctions
 *
 * Refusée ou injoignable, la source laisse la copie précédente reprise telle quelle,
 * sa date d'origine gardée : passé le délai de src/lib/finma-register.ts, la réponse
 * retombe d'elle-même sur « non vérifié ». Sans copie précédente, le membre reste
 * absent. La fonction ne lève jamais : ce passage porte aussi l'ONU et l'EPC.
 */

/** La source, un flux en lecture d'OpenSwissData ; remplaçable pour les essais. */
export const FINMA_REGISTER_DEFAULT_URL = 'https://www.openswissdata.com/api/v1/finma/licences';
const GLEIF_RECORDS_URL = 'https://api.gleif.org/api/v1/lei-records';

/** Les catégories du flux retenues. Le reste, gestionnaires de fortune d'abord, n'entre pas. */
const KEPT_ENTITY_TYPES: ReadonlySet<string> = new Set(['bank', 'fintech', 'securities_firm']);

/** Sous ce nombre de lignes, le flux est tronqué : la copie précédente reste servie. */
export const FEED_MIN_ROWS = 300;
/** Au-delà, une copie relue n'est plus fraîche : la source elle-même a cessé de collecter. */
const FEED_MAX_AGE_DAYS = 14;

/** Les statuts GLEIF d'un enregistrement dont l'identité reste valable. */
const VALID_LEI_STATUSES: ReadonlySet<string> = new Set([
  'ISSUED',
  'LAPSED',
  'PENDING_TRANSFER',
  'PENDING_ARCHIVAL',
]);

const LEI_BATCH_SIZE = 100;
const UID_FORMAT = /^CHE-\d{3}\.\d{3}\.\d{3}$/;
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const REQUEST_TIMEOUT_MS = 60_000;

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export interface ClearingLine {
  iid: string;
  name: string;
  bic: string | null;
  headquarters_iid: string | null;
}

export interface FinmaLicence {
  uid: string;
  licence_type: string;
  licence_type_de: string | null;
  licence_type_fr: string | null;
  licence_type_it: string | null;
}

export interface FinmaFeed {
  asOf: string;
  licences: FinmaLicence[];
}

export type FinmaMatchedBy = 'lei_to_uid' | 'head_office_lei_to_uid';

export interface FinmaRegisterRow extends FinmaLicence {
  iid: string;
  matched_by: FinmaMatchedBy;
  as_of: string;
}

export interface FinmaRegisterOutcome {
  state: 'fresh' | 'carried_over' | 'absent';
  rows: number;
  as_of: string | null;
}

function bic11(bic: string): string {
  return bic.length === 11 ? bic : `${bic}XXX`;
}

/** Deux écritures d'un même nom : la casse, les accents et la ponctuation ne comptent pas. */
function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Le rapprochement lui-même, sans réseau ni base : voir l'en-tête du fichier. */
export function buildFinmaRegisterRows(input: {
  lines: readonly ClearingLine[];
  bicLei: ReadonlyMap<string, ReadonlySet<string>>;
  leiUid: ReadonlyMap<string, string>;
  licences: readonly FinmaLicence[];
  asOf: string;
}): FinmaRegisterRow[] {
  const { lines, bicLei, leiUid, licences, asOf } = input;
  const licencesByUid = new Map<string, FinmaLicence[]>();
  for (const licence of licences) {
    const own = licencesByUid.get(licence.uid);
    if (own) own.push(licence);
    else licencesByUid.set(licence.uid, [licence]);
  }

  const namesByBic = new Map<string, Set<string>>();
  for (const { bic, name } of lines) {
    if (!bic) continue;
    const key = bic11(bic);
    const names = namesByBic.get(key) ?? new Set<string>();
    names.add(name.trim());
    namesByBic.set(key, names);
  }

  // Chaque ligne, par son propre BIC.
  const direct = new Map<string, string>();
  for (const { iid, bic } of lines) {
    if (!bic) continue;
    const key = bic11(bic);
    if ((namesByBic.get(key)?.size ?? 0) > 1) continue;
    const leis = bicLei.get(key);
    if (leis?.size !== 1) continue;
    const uid = leiUid.get([...leis][0]);
    if (uid && licencesByUid.has(uid)) direct.set(iid, uid);
  }

  // Un IDE réclamé par plusieurs noms réellement différents est écarté en entier.
  const byIid = new Map(lines.map((l) => [l.iid, l]));
  const namesByUid = new Map<string, Set<string>>();
  for (const [iid, uid] of direct) {
    const names = namesByUid.get(uid) ?? new Set<string>();
    names.add(nameKey(byIid.get(iid)?.name ?? ''));
    namesByUid.set(uid, names);
  }
  for (const [iid, uid] of [...direct]) {
    if ((namesByUid.get(uid)?.size ?? 0) > 1) direct.delete(iid);
  }

  const rows: FinmaRegisterRow[] = [];
  const emit = (iid: string, uid: string, matched_by: FinmaMatchedBy) => {
    for (const licence of licencesByUid.get(uid) ?? []) {
      rows.push({ ...licence, iid, matched_by, as_of: asOf });
    }
  };

  for (const { iid, name, bic, headquarters_iid: hq } of lines) {
    const uid = direct.get(iid);
    if (uid) {
      emit(iid, uid, 'lei_to_uid');
      continue;
    }
    // Une succursale dont le BIC n'a aucun LEI hérite du siège, sous le même nom seulement.
    if (!bic || !hq || hq === iid) continue;
    const key = bic11(bic);
    if ((namesByBic.get(key)?.size ?? 0) > 1 || bicLei.get(key)?.size) continue;
    const seat = byIid.get(hq);
    const seatUid = direct.get(hq);
    if (seat && seatUid && nameKey(seat.name) === nameKey(name)) {
      emit(iid, seatUid, 'head_office_lei_to_uid');
    }
  }
  return rows;
}

/**
 * Le flux d'OpenSwissData, relu champ par champ : `{ collected_on, rows: [{ uid,
 * entity_type, licence_type, licence_type_de, licence_type_fr, licence_type_it }] }`.
 * Lève sur tout ce qui ne ressemble pas à une copie récente et complète.
 */
export function parseLicenceFeed(payload: unknown, now: Date = new Date()): FinmaFeed {
  if (typeof payload !== 'object' || payload === null) throw new Error('flux FINMA illisible');
  const { collected_on: collectedOn, rows } = payload as { collected_on?: unknown; rows?: unknown };
  if (typeof collectedOn !== 'string' || !DATE_FORMAT.test(collectedOn)) {
    throw new Error('flux FINMA sans date de collecte lisible');
  }
  const ageDays = (now.getTime() - Date.parse(`${collectedOn}T00:00:00Z`)) / DAY_MS;
  if (!Number.isFinite(ageDays) || ageDays < -1 || ageDays > FEED_MAX_AGE_DAYS) {
    throw new Error(`flux FINMA hors de la fenêtre de fraîcheur : ${collectedOn}`);
  }
  if (!Array.isArray(rows)) throw new Error('flux FINMA sans lignes');

  const seen = new Set<string>();
  const licences: FinmaLicence[] = [];
  for (const raw of rows as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.entity_type !== 'string' || !KEPT_ENTITY_TYPES.has(row.entity_type)) continue;
    const licenceType = optionalText(row.licence_type);
    if (typeof row.uid !== 'string' || !UID_FORMAT.test(row.uid) || !licenceType) continue;
    const key = `${row.uid}|${licenceType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    licences.push({
      uid: row.uid,
      licence_type: licenceType,
      licence_type_de: optionalText(row.licence_type_de),
      licence_type_fr: optionalText(row.licence_type_fr),
      licence_type_it: optionalText(row.licence_type_it),
    });
  }
  if (licences.length < FEED_MIN_ROWS) {
    throw new Error(`flux FINMA tronqué : ${licences.length} lignes retenues`);
  }
  return { asOf: collectedOn, licences };
}

/** Lit le flux. Le jeton, s'il existe, ne passe que par cet en-tête et n'est jamais journalisé. */
export async function fetchFinmaLicences(options: {
  url: string;
  token?: string;
  fetchImpl?: FetchImpl;
}): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = new Headers({ accept: 'application/json' });
  if (options.token) headers.set('authorization', `Bearer ${options.token}`);
  const response = await fetchImpl(options.url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`flux FINMA : HTTP ${response.status}`);
  return (await response.json()) as unknown;
}

/** LEI -> IDE chez GLEIF (données sous CC0), seulement pour un IDE suisse bien formé. */
export async function fetchLeiUids(
  leis: readonly string[],
  options: { fetchImpl?: FetchImpl; pauseMs?: number } = {},
): Promise<Map<string, string>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pauseMs = options.pauseMs ?? 1_200;
  const uids = new Map<string, string>();
  for (let start = 0; start < leis.length; start += LEI_BATCH_SIZE) {
    if (start > 0 && pauseMs > 0) await new Promise((done) => setTimeout(done, pauseMs));
    const query = new URLSearchParams({
      'filter[lei]': leis.slice(start, start + LEI_BATCH_SIZE).join(','),
      'page[size]': String(LEI_BATCH_SIZE),
    });
    const response = await fetchImpl(`${GLEIF_RECORDS_URL}?${query}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`GLEIF : HTTP ${response.status}`);
    const body = (await response.json()) as {
      data?: Array<{
        id?: string;
        attributes?: {
          entity?: { registeredAs?: string | null };
          registration?: { status?: string };
        };
      }>;
    };
    for (const record of body.data ?? []) {
      const registeredAs = record.attributes?.entity?.registeredAs ?? '';
      const status = record.attributes?.registration?.status ?? '';
      if (!record.id || !registeredAs.startsWith('CHE') || !VALID_LEI_STATUSES.has(status)) {
        continue;
      }
      const digits = registeredAs.replace(/\D/g, '');
      if (digits.length !== 9) continue;
      uids.set(record.id, `CHE-${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`);
    }
  }
  return uids;
}

function createTable(db: Database.Database): void {
  for (const statement of restrictedTable('compliance', 'finma_register').ddl) db.exec(statement);
}

const COLUMNS =
  'iid, uid, licence_type, licence_type_de, licence_type_fr, licence_type_it, matched_by, as_of';

function writeRows(db: Database.Database, rows: readonly FinmaRegisterRow[]): void {
  db.transaction(() => {
    // Après la table : une instruction préparée exige que sa table existe déjà.
    createTable(db);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO finma_register (${COLUMNS})
       VALUES (@iid, @uid, @licence_type, @licence_type_de, @licence_type_fr, @licence_type_it,
               @matched_by, @as_of)`,
    );
    for (const row of rows) insert.run(row);
  })();
}

/** Les lignes de la base précédente, ou rien si elle ne les porte pas ou ne se lit pas. */
function previousRows(path: string): FinmaRegisterRow[] {
  if (!existsSync(path)) return [];
  let previous: Database.Database | null = null;
  try {
    previous = new Database(path, { readonly: true, fileMustExist: true });
    return previous.prepare(`SELECT ${COLUMNS} FROM finma_register`).all() as FinmaRegisterRow[];
  } catch {
    return [];
  } finally {
    previous?.close();
  }
}

function readDirectory(path: string): {
  lines: ClearingLine[];
  bicLei: Map<string, Set<string>>;
} {
  const bic = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const lines = bic
      .prepare('SELECT iid, name, bic, headquarters_iid FROM ch_clearing')
      .all() as ClearingLine[];
    const bicLei = new Map<string, Set<string>>();
    const rows = bic
      .prepare(
        `SELECT bic11, lei FROM bic_entries
          WHERE lei IS NOT NULL AND lei <> ''
            AND bic11 IN (SELECT CASE WHEN length(bic) = 11 THEN bic ELSE bic || 'XXX' END
                            FROM ch_clearing WHERE bic IS NOT NULL)`,
      )
      .all() as Array<{ bic11: string; lei: string }>;
    for (const { bic11: code, lei } of rows) {
      const leis = bicLei.get(code) ?? new Set<string>();
      leis.add(lei);
      bicLei.set(code, leis);
    }
    return { lines, bicLei };
  } finally {
    bic.close();
  }
}

/**
 * Remplit `finma_register` dans la base de travail. Ne lève jamais : voir l'en-tête.
 * `loadFeed` et `loadLeiUids` se remplacent dans les tests, qui ne touchent pas au réseau.
 */
export async function refreshFinmaRegister(
  target: Database.Database,
  options: {
    bicDbPath: string;
    previousDbPath: string;
    minRows?: number;
    loadFeed?: () => Promise<FinmaFeed>;
    loadLeiUids?: (leis: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  },
): Promise<FinmaRegisterOutcome> {
  const minRows = options.minRows ?? RESTRICTED_FLOORS.finma_register;
  const loadFeed =
    options.loadFeed ??
    (async () =>
      parseLicenceFeed(
        await fetchFinmaLicences({
          url: process.env.FINMA_REGISTER_URL ?? FINMA_REGISTER_DEFAULT_URL,
          token: process.env.FINMA_REGISTER_TOKEN,
        }),
      ));
  const loadLeiUids = options.loadLeiUids ?? ((leis) => fetchLeiUids(leis));

  try {
    const { lines, bicLei } = readDirectory(options.bicDbPath);
    const feed = await loadFeed();
    const leis = [...new Set([...bicLei.values()].flatMap((set) => [...set]))].sort();
    const leiUid = await loadLeiUids(leis);
    const rows = buildFinmaRegisterRows({
      lines,
      bicLei,
      leiUid,
      licences: feed.licences,
      asOf: feed.asOf,
    });
    if (rows.length < minRows) {
      throw new Error(`rapprochement sous son plancher : ${rows.length} lignes`);
    }
    writeRows(target, rows);
    console.log(`  FINMA register: ${rows.length} rows, copy of ${feed.asOf}`);
    return { state: 'fresh', rows: rows.length, as_of: feed.asOf };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'erreur inconnue';
    const carried = previousRows(options.previousDbPath);
    if (carried.length === 0) {
      console.warn(`::warning::registre FINMA non rafraîchi, rien à reprendre (${reason})`);
      return { state: 'absent', rows: 0, as_of: null };
    }
    writeRows(target, carried);
    const asOf = carried.reduce((latest, r) => (r.as_of > latest ? r.as_of : latest), '');
    console.warn(
      `::warning::registre FINMA repris de la copie du ${asOf}, ${carried.length} lignes (${reason})`,
    );
    return { state: 'carried_over', rows: carried.length, as_of: asOf };
  }
}

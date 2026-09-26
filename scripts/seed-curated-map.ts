/**
 * Les clés PL, FI et LU de la carte composite, et la liste finlandaise des codes
 * d'établissement, pour la surcouche privée (membres `map_pl`, `map_fi`, `map_lu`
 * et `register_fi` de src/lib/restricted-family.ts).
 *
 * ## Pourquoi ce fichier existe
 *
 * Jusqu'au 25/09/2026, ces clés vivaient dans src/db/bic_data.json, importées le
 * 08/04/2026 de la compilation mdomke/schwifty (MIT) des sources nationales : le
 * fichier EWIB de la NBP pour la Pologne, Finance Finland pour la Finlande, et,
 * pour le Luxembourg, le registre de l'ABBL par la compilation sigalor/iban-to-bic
 * complétée de quelques clés schwifty. Leurs conditions ne permettent pas la
 * redistribution : elles ont quitté le dépôt public (étape du retrait), et la
 * session principale a décidé le même jour de les servir depuis le dépôt privé
 * plutôt que de perdre le service. Ce seeder refait donc, à chaque passage
 * mensuel de la chaîne privée, ce que l'import avait fait une fois : il télécharge
 * la dernière publication de schwifty sur PyPI et en lit les registres.
 *
 * ## La source, datée et vérifiée
 *
 * L'index JSON de PyPI donne la version publiée, l'adresse de sa roue, son
 * empreinte SHA-256 et sa date de publication. La roue est refusée si son
 * empreinte diffère ; les registres sont lus dans l'archive (lecteur ZIP de
 * scripts/seed-eba-psd.ts). `as_of` de chaque ligne est la date de publication
 * de la roue : la compilation lue, pas le jour du passage.
 *
 * ## La liste finlandaise : aucune source à télécharger
 *
 * Finance Finland publie sa liste en PDF (plages écrites en prose, un groupe
 * réparti sur plusieurs lignes) ; la version servie jusqu'ici était une
 * transcription à la main, qu'aucun robot ne rafraîchissait. La compilation
 * schwifty n'en est pas un substitut : elle date d'une publication ancienne et
 * garde des banques sorties du marché finlandais. Le membre `register_fi` est
 * donc une liste STATIQUE (`staticList`) : ce seeder ne l'écrit que si
 * FI_LIST_PATH désigne un fichier JSON (chargement initial ou nouvelle
 * transcription, un geste manuel) ; sinon il la déclare `static_list`, et la
 * commande `seed` la recopie telle quelle de la surcouche précédente
 * (scripts/restricted-carry-over.ts). Forme du fichier :
 *
 *   { "as_of": "AAAA-MM-JJ", "source": "…", "codes": [{ "code": "…", "bic": "…", "institution": "…" }] }
 *
 * ## Ce qui n'est jamais écrit ailleurs
 *
 * La chaîne privée seulement (SEED_FAMILY=restricted, posée par `npm run
 * overlay:seed`) : sans la variable, refus avant tout téléchargement. Le journal
 * ne porte que des comptes, une version et des dates, jamais une ligne.
 */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import {
  RESTRICTED_FAMILY,
  memberPredicate,
  restrictedTable,
  seedFamilyFromEnv,
  type RestrictedMember,
} from '../src/lib/restricted-family.js';
import { STATIC_LIST_REPORT } from './restricted-carry-over.js';
import { readZipEntries } from './seed-eba-psd.js';
import { failureCause, reportSeedMember } from './seed-report.js';

/** L'index JSON du projet sur PyPI : version, roue, empreinte et date. */
export const SCHWIFTY_INDEX_URL = 'https://pypi.org/pypi/schwifty/json';
/** Une roue de schwifty pèse quelques centaines de Ko ; au-delà, ce n'est pas elle. */
export const MAX_WHEEL_BYTES = 32 * 1024 * 1024;

/**
 * Les registres de la roue, par pays, dans l'ordre de préférence. Depuis sa
 * version 2026.03.0, schwifty publie les registres polonais et finlandais au
 * format v2, sous un autre nom (`generated_pl.v2.json`, voir `registryEntries`) ;
 * sans ce nom, le passage du 26/09/2026 n'a trouvé aucun registre PL ni FI dans la
 * roue. Le nom v2 passe en premier, l'ancien reste lu pour une roue plus ancienne,
 * et le nom v2 du registre luxembourgeois est lu d'avance.
 */
export const REGISTRY_FILES: Readonly<Record<'PL' | 'FI' | 'LU', readonly string[]>> = {
  PL: ['schwifty/bank_registry/generated_pl.v2.json', 'schwifty/bank_registry/generated_pl.json'],
  FI: ['schwifty/bank_registry/generated_fi.v2.json', 'schwifty/bank_registry/generated_fi.json'],
  LU: [
    'schwifty/bank_registry/generated_lu.v2.json',
    'schwifty/bank_registry/generated_lu.json',
    'schwifty/bank_registry/manual_lu.json',
  ],
};

/** La forme d'un code bancaire de l'IBAN, par pays. */
const CODE_SHAPE: Readonly<Record<'PL' | 'FI' | 'LU', RegExp>> = {
  PL: /^\d{8}$/,
  FI: /^\d{3}$/,
  LU: /^\d{3}$/,
};
const BIC_SHAPE = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface SchwiftyRelease {
  version: string;
  url: string;
  sha256: string;
  /** Date de publication de la roue (AAAA-MM-JJ). */
  published: string;
}

export interface CuratedRow {
  code: string;
  bic: string;
}

export interface FiListRow {
  code: string;
  bic: string;
  institution: string;
}

export interface FiList {
  as_of: string;
  source: string;
  codes: FiListRow[];
}

export type CuratedFetch = (url: string) => Promise<{
  ok: boolean;
  status: number;
  /** La taille annoncée (`Content-Length`), lue avant le corps. */
  headers?: { get(name: string): string | null };
  /** Le corps en flux : lu par morceaux, abandonné au-delà du plafond. */
  body?: ReadableStream<Uint8Array> | null;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

const MEMBER_BY_COUNTRY: Readonly<Record<'PL' | 'FI' | 'LU', string>> = {
  PL: 'map_pl',
  FI: 'map_fi',
  LU: 'map_lu',
};

function member(id: string): RestrictedMember {
  const found = RESTRICTED_FAMILY.find((m) => m.id === id);
  if (!found) throw new Error(`Membre inconnu : ${id}`);
  return found;
}

/**
 * La roue universelle de la dernière version, lue dans l'index de PyPI. Toute
 * forme inattendue est une Error ordinaire (format changé), jamais une devinette.
 */
export function pickWheel(index: unknown): SchwiftyRelease {
  const root = index as { info?: { version?: unknown }; urls?: unknown };
  const version = root?.info?.version;
  if (typeof version !== 'string' || !/^[0-9][0-9A-Za-z.+-]{0,40}$/.test(version))
    throw new Error('schwifty : version illisible dans l’index PyPI');
  if (!Array.isArray(root.urls))
    throw new Error('schwifty : liste des fichiers absente de l’index');
  const wheel = root.urls.find((u: unknown) => {
    const f = u as { packagetype?: unknown; filename?: unknown };
    return (
      f?.packagetype === 'bdist_wheel' &&
      typeof f.filename === 'string' &&
      f.filename.endsWith('-py3-none-any.whl')
    );
  }) as
    { url?: unknown; digests?: { sha256?: unknown }; upload_time_iso_8601?: unknown } | undefined;
  if (!wheel) throw new Error('schwifty : aucune roue universelle pour la dernière version');
  const url = wheel.url;
  const sha256 = wheel.digests?.sha256;
  const uploaded = wheel.upload_time_iso_8601;
  if (typeof url !== 'string' || !url.startsWith('https://'))
    throw new Error('schwifty : adresse de la roue illisible');
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256))
    throw new Error('schwifty : empreinte de la roue illisible');
  const published = typeof uploaded === 'string' ? uploaded.slice(0, 10) : '';
  if (!ISO_DAY.test(published) || Number.isNaN(Date.parse(`${published}T00:00:00Z`)))
    throw new Error('schwifty : date de publication illisible');
  return { version, url, sha256, published };
}

/** Les fichiers de la roue, par nom, inflatés. */
export function readWheel(wheel: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readZipEntries(wheel)) {
    if (!entry.name.startsWith('schwifty/bank_registry/') || !entry.name.endsWith('.json'))
      continue;
    let raw: Buffer;
    if (entry.method === 8) raw = inflateRawSync(entry.compressed);
    else if (entry.method === 0) raw = Buffer.from(entry.compressed);
    else throw new Error(`schwifty : méthode ZIP ${entry.method} inattendue`);
    files.set(entry.name, raw.toString('utf8'));
  }
  return files;
}

/**
 * Les lignes d'un registre, une par code. Deux formats : une liste (v1, une ligne
 * par code), ou un objet v2, une entrée par banque dont le champ `expand_from`
 * porte la liste de ses codes, dépliée en une ligne par code sous le nom
 * `expand_into`, comme schwifty le fait lui-même (`parse_v2` de son registry.py).
 * La forme décide, pas le nom du fichier. Une entrée sans liste de codes reste une
 * ligne sans code : écartée et comptée plus loin. Toute autre forme est une Error.
 */
function registryEntries(cc: 'PL' | 'FI' | 'LU', text: string): unknown[] {
  const parsed: unknown = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  const v2 = parsed as { entries?: unknown; expand_from?: unknown; expand_into?: unknown } | null;
  const from = v2?.expand_from;
  const into = v2?.expand_into;
  if (!v2 || !Array.isArray(v2.entries) || typeof from !== 'string' || typeof into !== 'string')
    throw new Error(`schwifty ${cc} : un registre n’est ni une liste ni au format v2`);
  const rows: unknown[] = [];
  for (const raw of v2.entries) {
    const entry = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const values = entry[from];
    const rest = Object.fromEntries(Object.entries(entry).filter(([key]) => key !== from));
    if (!Array.isArray(values)) rows.push(rest);
    else for (const value of values) rows.push({ ...rest, [into]: value });
  }
  return rows;
}

/**
 * Les clés d'un pays, lues dans ses registres : une par code, la première
 * entrée « primaire » l'emporte, puis la première tout court. Un code ou un BIC
 * qui n'a pas la forme attendue est écarté (et compté), jamais corrigé.
 */
export function parseRegistry(
  cc: 'PL' | 'FI' | 'LU',
  texts: readonly string[],
): { rows: Array<CuratedRow & { name: string | null }>; skipped: number } {
  const byCode = new Map<string, CuratedRow & { name: string | null; primary: boolean }>();
  let skipped = 0;
  for (const text of texts) {
    for (const raw of registryEntries(cc, text)) {
      const entry = raw as {
        country_code?: unknown;
        bank_code?: unknown;
        bic?: unknown;
        name?: unknown;
        primary?: unknown;
      };
      if (entry?.country_code !== cc) {
        skipped++;
        continue;
      }
      const code = typeof entry.bank_code === 'string' ? entry.bank_code.trim() : '';
      const read = typeof entry.bic === 'string' ? entry.bic.trim().toUpperCase() : '';
      if (!CODE_SHAPE[cc].test(code) || !BIC_SHAPE.test(read)) {
        skipped++;
        continue;
      }
      // La carte servait les BIC finlandais sous leur forme à onze caractères
      // (import du 08/04/2026) ; les BIC polonais et luxembourgeois tels que la
      // compilation les donne. Même forme, même réponse qu'avant le retrait.
      const bic = cc === 'FI' && read.length === 8 ? `${read}XXX` : read;
      const primary = entry.primary === true;
      const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : null;
      const before = byCode.get(code);
      if (!before || (primary && !before.primary)) byCode.set(code, { code, bic, name, primary });
    }
  }
  const rows = [...byCode.values()]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(({ code, bic, name }) => ({ code, bic, name }));
  return { rows, skipped };
}

/** Relit un fichier de liste finlandaise (voir l'en-tête). Error à la moindre forme inattendue. */
export function parseFiList(text: string): FiList {
  const raw = JSON.parse(text) as { as_of?: unknown; source?: unknown; codes?: unknown };
  const asOf = raw?.as_of;
  if (typeof asOf !== 'string' || !ISO_DAY.test(asOf))
    throw new Error('liste FI : as_of illisible');
  const source = raw.source;
  if (typeof source !== 'string' || source.trim() === '')
    throw new Error('liste FI : source absente');
  if (!Array.isArray(raw.codes)) throw new Error('liste FI : codes absents');
  const seen = new Set<string>();
  const codes = raw.codes.map((c: unknown) => {
    const row = c as { code?: unknown; bic?: unknown; institution?: unknown };
    const code = typeof row?.code === 'string' ? row.code : '';
    const bic = typeof row?.bic === 'string' ? row.bic.toUpperCase() : '';
    const institution = typeof row?.institution === 'string' ? row.institution.trim() : '';
    if (!/^\d{1,4}$/.test(code) || !BIC_SHAPE.test(bic) || !institution || seen.has(code))
      throw new Error(
        'liste FI : une ligne n’a pas la forme attendue (code, BIC, établissement, unique)',
      );
    seen.add(code);
    return { code, bic, institution };
  });
  return { as_of: asOf, source: source.trim(), codes };
}

function tableExists(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

/** Crée la table d'un membre depuis la constante, une instruction à la fois. */
function ensureTable(db: Database.Database, m: RestrictedMember): void {
  if (tableExists(db, m.table)) return;
  for (const statement of restrictedTable(m.kind, m.table).ddl) db.prepare(statement).run();
}

/** Remplace les lignes d'un pays de la carte composite (membre `map_<pays>`). */
export function writeCuratedRows(
  db: Database.Database,
  cc: 'PL' | 'FI' | 'LU',
  rows: readonly CuratedRow[],
  source: string,
  asOf: string | null,
): void {
  const m = member(MEMBER_BY_COUNTRY[cc]);
  ensureTable(db, m);
  const p = memberPredicate(m);
  db.transaction(() => {
    db.prepare(`DELETE FROM curated_bank_codes WHERE ${p.sql}`).run(...p.params);
    const insert = db.prepare(
      'INSERT INTO curated_bank_codes (country, code, bic, source, as_of) VALUES (?, ?, ?, ?, ?)',
    );
    for (const row of rows) insert.run(cc, row.code, row.bic, source, asOf);
  })();
}

/** Remplace la liste finlandaise (membre `register_fi`). */
export function writeFiList(db: Database.Database, list: FiList): void {
  const m = member('register_fi');
  ensureTable(db, m);
  db.transaction(() => {
    db.prepare('DELETE FROM fi_monetary_codes').run();
    const insert = db.prepare(
      'INSERT INTO fi_monetary_codes (code, bic, institution, source, as_of) VALUES (?, ?, ?, ?, ?)',
    );
    for (const row of list.codes)
      insert.run(row.code, row.bic, row.institution, list.source, list.as_of);
  })();
}

/**
 * Les clés PL, FI et LU d'une carte composite au format de src/db/bic_data.json
 * (`{ "PL:12345678": { "bic": "…" } }`), pour l'extraction sans téléchargement
 * (`npm run overlay -- extract --curated-map`) : la preuve d'équivalence lit
 * la carte d'une révision qui les portait encore. Rend les lignes par pays.
 */
export function curatedRowsFromMap(text: string): Record<'PL' | 'FI' | 'LU', CuratedRow[]> {
  const map = JSON.parse(text) as Record<string, { bic?: unknown }>;
  if (typeof map !== 'object' || map === null || Array.isArray(map))
    throw new Error('carte composite : un objet était attendu');
  const out: Record<'PL' | 'FI' | 'LU', CuratedRow[]> = { PL: [], FI: [], LU: [] };
  for (const [key, value] of Object.entries(map)) {
    const [cc, code] = key.split(':');
    if (cc !== 'PL' && cc !== 'FI' && cc !== 'LU') continue;
    const bic = typeof value?.bic === 'string' ? value.bic.toUpperCase() : '';
    if (!code || !CODE_SHAPE[cc].test(code) || !BIC_SHAPE.test(bic))
      throw new Error(`carte composite : une clé ${cc} n’a pas la forme attendue`);
    out[cc].push({ code, bic });
  }
  for (const cc of ['PL', 'FI', 'LU'] as const)
    out[cc].sort((a, b) => a.code.localeCompare(b.code));
  return out;
}

/** Le crédit d'une ligne : la compilation, sa version et la source nationale qu'elle compile. */
export function schwiftySource(cc: 'PL' | 'FI' | 'LU', version: string): string {
  const national = {
    PL: 'Narodowy Bank Polski, EWIB',
    FI: 'Finance Finland',
    LU: 'ABBL, Luxembourg register of IBAN/BIC codes',
  }[cc];
  return `mdomke/schwifty ${version} (MIT), compiled from ${national}`;
}

/**
 * Le corps d'une réponse, sans jamais lire plus de `max` octets (relecture de la
 * PR 267, point 6) : la taille annoncée refuse avant la première lecture, et le
 * flux est abandonné dès qu'il dépasse le plafond, annonce absente ou fausse.
 */
async function readCapped(res: Awaited<ReturnType<CuratedFetch>>, max: number): Promise<Buffer> {
  const tooLarge = (): Error => new Error('schwifty : taille de la roue hors bornes');
  const declared = res.headers?.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > max) throw tooLarge();
  if (res.body) {
    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  }
  // Sans flux (une doublure de test) : un seul bloc, borné aussitôt.
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > max) throw tooLarge();
  return body;
}

async function download(fetchImpl: CuratedFetch, release: SchwiftyRelease): Promise<Buffer> {
  const res = await fetchImpl(release.url);
  if (!res.ok) throw new Error(`schwifty wheel: HTTP ${res.status}`);
  const body = await readCapped(res, MAX_WHEEL_BYTES);
  if (body.length === 0) throw new Error('schwifty : taille de la roue hors bornes');
  if (createHash('sha256').update(body).digest('hex') !== release.sha256)
    throw new Error('schwifty : empreinte de la roue différente de celle de l’index');
  return body;
}

export interface CuratedSeedResult {
  release: SchwiftyRelease | null;
  /** Lignes écrites par membre ; un membre en panne n'y est pas. */
  written: Record<string, number>;
  /** Membres en panne, avec leur code de cause. */
  failed: Record<string, string>;
}

/**
 * Le passage : index, roue, registres, puis une écriture par membre, chacune
 * contrôlée contre son plancher. Un membre en panne n'écrit rien et le dit ; les
 * autres sont écrits. Ne lève jamais pour une panne de source.
 *
 * Une seule exception : un chargement EXPLICITE de la liste finlandaise
 * (`fiListPath`, FI_LIST_PATH) qui échoue, fichier illisible ou sous le
 * plancher, lève et arrête le passage. Rendu comme une panne ordinaire, il
 * faisait reprendre l'ancienne liste de la surcouche précédente, datée du
 * début d'un passage au lieu de la date de la liste, alors qu'on en chargeait
 * une nouvelle (relecture de la PR 267, point 5).
 */
export async function seedCuratedMap(options: {
  db: Database.Database;
  fetchImpl: CuratedFetch;
  /** FI_LIST_PATH : la liste finlandaise à charger (sinon, liste statique reprise). */
  fiListPath?: string;
  log?: (line: string) => void;
}): Promise<CuratedSeedResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const result: CuratedSeedResult = { release: null, written: {}, failed: {} };
  const fail = (id: string, cause: string): void => {
    result.failed[id] = cause;
    reportSeedMember({ member: id, state: 'failed', cause });
  };

  let files: Map<string, string> | null = null;
  try {
    const index = await options.fetchImpl(SCHWIFTY_INDEX_URL);
    if (!index.ok) throw new Error(`schwifty index: HTTP ${index.status}`);
    result.release = pickWheel(await index.json());
    files = readWheel(await download(options.fetchImpl, result.release));
    log(`[carte] schwifty ${result.release.version}, publiée le ${result.release.published}`);
  } catch (err) {
    const cause = failureCause(err) === 'error' ? 'download_failed' : failureCause(err);
    log(`[carte] schwifty illisible (${cause}) : aucune clé écrite`);
    for (const cc of ['PL', 'FI', 'LU'] as const) fail(MEMBER_BY_COUNTRY[cc], cause);
  }

  if (files && result.release) {
    for (const cc of ['PL', 'FI', 'LU'] as const) {
      const id = MEMBER_BY_COUNTRY[cc];
      const texts = REGISTRY_FILES[cc]
        .map((name) => files!.get(name))
        .filter((t): t is string => !!t);
      if (texts.length === 0) {
        log(`[carte] ${cc} : aucun registre dans la roue`);
        fail(id, 'missing_file');
        continue;
      }
      let parsed: ReturnType<typeof parseRegistry>;
      try {
        parsed = parseRegistry(cc, texts);
      } catch {
        log(`[carte] ${cc} : registre illisible`);
        fail(id, 'unreadable');
        continue;
      }
      if (parsed.rows.length < member(id).minRows) {
        log(`[carte] ${cc} : ${parsed.rows.length} clés, plancher ${member(id).minRows}`);
        fail(id, 'below_floor');
        continue;
      }
      writeCuratedRows(
        options.db,
        cc,
        parsed.rows,
        schwiftySource(cc, result.release.version),
        result.release.published,
      );
      result.written[id] = parsed.rows.length;
      log(`[carte] ${cc} : ${parsed.rows.length} clés écrites (${parsed.skipped} écartées)`);
      reportSeedMember({ member: id, state: 'loaded', processed: parsed.rows.length });
    }
  }

  // La liste finlandaise : chargée d'un fichier désigné, sinon statique (reprise).
  if (options.fiListPath) {
    let list: FiList;
    try {
      list = parseFiList(readFileSync(options.fiListPath, 'utf8'));
    } catch {
      log('[carte] liste FI désignée par FI_LIST_PATH illisible : le passage s’arrête');
      throw new Error('FI_LIST_PATH : liste finlandaise illisible, rien n’est publié');
    }
    if (list.codes.length < member('register_fi').minRows) {
      log(
        `[carte] liste FI : ${list.codes.length} codes, plancher ${member('register_fi').minRows} : le passage s’arrête`,
      );
      throw new Error('FI_LIST_PATH : liste finlandaise sous son plancher, rien n’est publié');
    }
    writeFiList(options.db, list);
    result.written.register_fi = list.codes.length;
    log(`[carte] liste FI : ${list.codes.length} codes écrits, liste du ${list.as_of}`);
    reportSeedMember({ member: 'register_fi', state: 'loaded', processed: list.codes.length });
  } else {
    log('[carte] liste FI statique : reprise telle quelle de la surcouche précédente');
    result.failed.register_fi = STATIC_LIST_REPORT;
    reportSeedMember({ member: 'register_fi', state: 'failed', cause: STATIC_LIST_REPORT });
  }
  return result;
}

async function main(): Promise<void> {
  // Famille sous conditions (voir l'en-tête) : la chaîne privée seulement.
  if (seedFamilyFromEnv() !== 'restricted') {
    console.error(
      '[carte] refusé : les clés PL, FI et LU et la liste finlandaise sont reconstruites ' +
        'seulement par la chaîne privée (SEED_FAMILY=restricted, npm run overlay:seed).',
    );
    process.exitCode = 1;
    return;
  }
  const path = process.env.BIC_DB_PATH;
  if (!path) {
    console.error('[carte] BIC_DB_PATH manquant : la base de travail de la chaîne privée.');
    process.exitCode = 1;
    return;
  }
  const db = new Database(path);
  try {
    await seedCuratedMap({
      db,
      fetchImpl: (url) => fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) }),
      fiListPath: process.env.FI_LIST_PATH || undefined,
    });
  } finally {
    db.close();
  }
}

const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error('[carte] échec :', failureCause(err));
    process.exitCode = 1;
  });
}

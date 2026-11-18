/**
 * Écrit data/ch-localities.json depuis le répertoire officiel des localités
 * avec NPA et périmètre de swisstopo (décision de Claude-Alain du 29.10.2026,
 * 15 h 06, « localites = Oui »).
 *
 *   npx tsx scripts/seed-ch-localities.ts            # écrit le fichier
 *   npx tsx scripts/seed-ch-localities.ts --dry-run  # lit, contrôle, n'écrit rien
 *
 * ## Ce qu'il lit
 *
 * L'élément STAC `ortschaftenverzeichnis_plz` de la collection
 * `ch.swisstopo-vd.ortschaftenverzeichnis_plz` (data.geo.admin.ch), sa date
 * (`properties.datetime`, la version du jeu) et son fichier CSV en WGS 84
 * zippé. Colonnes du fichier : Ortschaftsname, PLZ4, Zusatzziffer, ZIP_ID,
 * Gemeindename, BFS-Nr, Kantonskürzel, Adressenanteil, E, N, Sprache, Validity.
 *
 * ## Ce qu'il garde
 *
 * Six colonnes seulement : NPA (PLZ4), chiffre additionnel (Zusatzziffer),
 * localité (Ortschaftsname), commune (Gemeindename), canton (Kantonskürzel,
 * vide au Liechtenstein) et langue (Sprache). Ni coordonnées, ni part
 * d'adresses, ni numéro de commune. Le fichier porte la version du jeu, le jour
 * de lecture, l'etag et l'empreinte du zip, et la phrase des conditions.
 *
 * ## Conditions (cas 1 de la règle du 28.10.2026)
 *
 * Lues le 29.10.2026 (TERMS ci-dessous) : réutilisation et usage commercial
 * permis, mention de la source obligatoire (« ©swisstopo »).
 *
 * ## En cas d'échec
 *
 * Un format qui change (colonnes, NPA mal formé, canton inconnu, ligne sans
 * canton hors des communes du Liechtenstein, table sous le plancher) arrête le
 * script sans rien écrire. Le fichier est écrit à côté puis renommé : un lecteur
 * ne voit jamais une moitié de table.
 *
 * ## Dans le robot mensuel (refresh-bic.yml, depuis le 18/11/2026)
 *
 * Même discipline que le registre tchèque et la liste bulgare du même robot : une
 * source qui ne répond pas ne doit pas coûter au mois ses autres sources. L'élément
 * STAC ou l'archive ne répond pas (refus HTTP, réseau, délai de 60 secondes), sert
 * autre chose que du JSON ou une archive zip (une page de refus servie en 200), ou
 * la version est plus ancienne que celle déjà servie : `ChLocalitiesNotLoaded`. Le
 * fichier en place n'est pas touché, le script sort en 0, écrit une annotation
 * `::warning::` et `ch_localities=not_loaded` dans $GITHUB_OUTPUT ; l'étape « Swiss
 * localities not loaded » du robot en fait un passage rouge et une alerte, APRÈS le
 * commit des autres sources. Un format qui change lève toujours, pour un humain.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { readZipEntries } from './seed-eba-psd.js';
import { failureCause } from './seed-report.js';
import {
  CH_CANTONS,
  CH_LOCALITIES_ATTRIBUTION,
  CH_LOCALITIES_COLLECTION,
  CH_LOCALITY_COLUMNS,
  isChLocalitiesTable,
  type ChLocalitiesTable,
  type ChLocalityRow,
} from '../src/lib/ch-localities.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.CH_LOCALITIES_PATH ?? resolve(__dirname, '../data/ch-localities.json');

export const ITEM_URL =
  'https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo-vd.ortschaftenverzeichnis_plz/items/ortschaftenverzeichnis_plz';
const ASSET = 'ortschaftenverzeichnis_plz_4326.csv.zip';

export const SOURCE =
  'Federal Office of Topography swisstopo, official directory of localities with postcode and perimeter ' +
  '(Amtliches Ortschaftenverzeichnis mit Postleitzahl und Perimeter; ordinance on geographical names, art. 24)';

export const TERMS =
  'The free geodata and geoservices of swisstopo may be used, distributed and made accessible. Furthermore, ' +
  'they may be enriched and processed and also used commercially. A reference to the source is mandatory.';
export const TERMS_URL =
  'https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices';
export const TERMS_READ_ON = '2026-10-29';

export const HEADER = [
  'Ortschaftsname',
  'PLZ4',
  'Zusatzziffer',
  'ZIP_ID',
  'Gemeindename',
  'BFS-Nr',
  'Kantonskürzel',
  'Adressenanteil',
  'E',
  'N',
  'Sprache',
  'Validity',
] as const;

/** Les numéros OFS des onze communes du Liechtenstein, les seules lignes sans canton. */
const LI_MUNICIPALITIES = /^70(0[1-9]|1[01])$/;

export interface ParsedLocalities {
  rows: ChLocalityRow[];
  /** Signes d'un format qui a changé : le script s'arrête. */
  problems: string[];
  /** Lignes identiques une fois les colonnes écartées. */
  duplicates: number;
}

/** Lit le CSV (point-virgule, UTF-8 avec BOM, fins de ligne CRLF) et garde six colonnes. */
export function parseLocalitiesCsv(text: string): ParsedLocalities {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  const problems: string[] = [];
  const header = (lines[0] ?? '').split(';');
  if (header.join(';') !== HEADER.join(';')) {
    problems.push(`unexpected header: ${header.join(';')}`);
    return { rows: [], problems, duplicates: 0 };
  }
  const seen = new Set<string>();
  const rows: ChLocalityRow[] = [];
  let duplicates = 0;
  for (const [i, line] of lines.slice(1).entries()) {
    const f = line.split(';');
    const at = `line ${i + 2}`;
    if (f.length !== HEADER.length) {
      problems.push(`${at}: ${f.length} fields`);
      continue;
    }
    const [locality, postcode, extra, , municipality, bfs, canton, , , , language] = f.map((v) =>
      v.trim(),
    ) as string[];
    if (!/^\d{4}$/.test(postcode!)) problems.push(`${at}: postcode ${JSON.stringify(postcode)}`);
    if (!/^\d{2}$/.test(extra!)) problems.push(`${at}: additional digit ${JSON.stringify(extra)}`);
    if (!locality || !municipality) problems.push(`${at}: empty locality or municipality`);
    if (canton && !CH_CANTONS.has(canton)) problems.push(`${at}: canton ${JSON.stringify(canton)}`);
    if (!canton && !LI_MUNICIPALITIES.test(bfs!)) {
      problems.push(`${at}: no canton outside the municipalities of Liechtenstein (BFS ${bfs})`);
    }
    if (!['de', 'fr', 'it', 'rm', 'multiple'].includes(language!)) {
      problems.push(`${at}: language ${JSON.stringify(language)}`);
    }
    const row: ChLocalityRow = [postcode!, extra!, locality!, municipality!, canton!, language!];
    const id = row.join('|');
    if (seen.has(id)) {
      duplicates += 1;
      continue;
    }
    seen.add(id);
    rows.push(row);
  }
  // Ordre par point de code, pas par la langue : le même fichier sur toute
  // version de Node, donc aucune différence fantôme d'un mois à l'autre.
  rows.sort((a, b) => {
    const x = a.join('\u0000');
    const y = b.join('\u0000');
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return { rows, problems, duplicates };
}

/** Le fichier, une ligne de la table par ligne de texte, pour des différences lisibles. */
export function serializeTable(table: ChLocalitiesTable): string {
  const { rows, ...meta } = table;
  const head = JSON.stringify(meta, null, 2).replace(/\n}$/, '');
  const body = rows.map((r) => `    ${JSON.stringify(r)}`).join(',\n');
  return `${head},\n  "rows": [\n${body}\n  ]\n}\n`;
}

/**
 * Le répertoire n'a pas répondu, ou pas avec une version à servir : le fichier en place
 * reste (voir « Dans le robot mensuel », en tête de ce fichier).
 */
export class ChLocalitiesNotLoaded extends Error {}

/** Une lecture qui n'aboutit pas (réseau, délai, refus HTTP) : la source n'a pas répondu. */
async function read<T>(
  what: string,
  url: string,
  fetchImpl: typeof fetch,
  body: (res: Response) => Promise<T>,
): Promise<T> {
  let res: Response;
  try {
    // Le délai manquait : un serveur qui accepte sans répondre tenait le robot mensuel
    // jusqu'à son délai de job, qui annule le passage entier.
    res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    throw new ChLocalitiesNotLoaded(`${what}: ${failureCause(e)}`, { cause: e });
  }
  if (!res.ok) throw new ChLocalitiesNotLoaded(`${what}: HTTP ${res.status}`);
  try {
    return await body(res);
  } catch (e) {
    if (e instanceof ChLocalitiesNotLoaded) throw e;
    throw new ChLocalitiesNotLoaded(`${what}: not read to the end (${failureCause(e)})`, {
      cause: e,
    });
  }
}

/** La version déjà servie, ou null s'il n'y a pas de fichier lisible. */
function servedVersion(out: string): string | null {
  try {
    const version = (JSON.parse(readFileSync(out, 'utf8')) as { version?: unknown }).version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

/**
 * Lit l'élément STAC et son fichier, contrôle la table et la rend, sans rien écrire.
 * Lève `ChLocalitiesNotLoaded` quand la source n'a pas répondu ; toute autre erreur
 * est un changement de forme.
 */
export async function readChLocalities(
  fetchImpl: typeof fetch = fetch,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<{ table: ChLocalitiesTable; duplicates: number }> {
  const item = await read('STAC item', ITEM_URL, fetchImpl, async (r) => {
    try {
      return JSON.parse(await r.text()) as {
        properties?: { datetime?: string; updated?: string };
        assets?: Record<string, { href?: string }>;
      };
    } catch (e) {
      // Une page de refus servie en 200 n'est pas du JSON : la source n'a pas répondu.
      throw new ChLocalitiesNotLoaded('STAC item: the answer is not JSON', { cause: e });
    }
  });
  const version = (item.properties?.datetime ?? '').slice(0, 10);
  const updated = item.properties?.updated ?? '';
  const fileUrl = item.assets?.[ASSET]?.href;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(version) || !fileUrl) {
    throw new Error(`STAC item without a date or without ${ASSET}`);
  }

  const zipRes = await read(fileUrl, fileUrl, fetchImpl, async (r) => ({
    zip: Buffer.from(await r.arrayBuffer()),
    etag: r.headers.get('etag'),
  }));
  const { zip } = zipRes;
  const sha256 = createHash('sha256').update(zip).digest('hex');
  let entries: ReturnType<typeof readZipEntries>;
  try {
    entries = readZipEntries(zip);
  } catch (e) {
    // Une page de refus servie à la place de l'archive : la source n'a pas répondu.
    throw new ChLocalitiesNotLoaded(`${fileUrl}: not a zip archive`, { cause: e });
  }
  const csv = entries.filter((e) => /\.csv$/i.test(e.name));
  if (csv.length !== 1) throw new Error(`expected one CSV in the zip, found ${csv.length}`);
  const entry = csv[0]!;
  const raw = entry.method === 8 ? inflateRawSync(entry.compressed) : entry.compressed;
  const parsed = parseLocalitiesCsv(raw.toString('utf8'));
  if (parsed.problems.length > 0) {
    throw new Error(`format changed:\n  ${parsed.problems.slice(0, 20).join('\n  ')}`);
  }

  const table: ChLocalitiesTable = {
    source: SOURCE,
    attribution: CH_LOCALITIES_ATTRIBUTION,
    collection: CH_LOCALITIES_COLLECTION,
    item_url: ITEM_URL,
    file_url: fileUrl,
    version,
    updated,
    etag: zipRes.etag,
    sha256,
    fetched_on: today,
    terms: TERMS,
    terms_url: TERMS_URL,
    terms_read_on: TERMS_READ_ON,
    columns: [...CH_LOCALITY_COLUMNS],
    rows: parsed.rows,
  };
  if (!isChLocalitiesTable(table)) throw new Error('the table does not pass isChLocalitiesTable');
  return { table, duplicates: parsed.duplicates };
}

/**
 * Lit, puis réécrit le fichier (voisin puis renommage). Une version plus ancienne que
 * celle déjà servie n'est pas écrite (`ChLocalitiesNotLoaded`).
 */
export async function refreshChLocalities(
  out: string = OUT,
  fetchImpl: typeof fetch = fetch,
  today?: string,
): Promise<{ table: ChLocalitiesTable; duplicates: number }> {
  const result = await readChLocalities(fetchImpl, today);
  const served = servedVersion(out);
  if (served && result.table.version < served)
    throw new ChLocalitiesNotLoaded(
      `version ${result.table.version} is older than the one served (${served})`,
    );
  const tmp = `${out}.tmp`;
  writeFileSync(tmp, serializeTable(result.table));
  renameSync(tmp, out);
  return result;
}

/** Une commande de workflow tient sur une ligne : %, CR et LF échappés. */
function workflowData(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/**
 * Dit au workflow ce qu'est devenu le répertoire. `not_loaded` écrit une annotation
 * et, sous Actions, `ch_localities=not_loaded` dans $GITHUB_OUTPUT, que refresh-bic.yml
 * lit pour lever l'alarme après le commit des autres sources. La sortie reste 0.
 */
export function reportChLocalitiesStatus(
  status: 'loaded' | 'not_loaded',
  message = '',
  env: NodeJS.ProcessEnv = process.env,
  log: (line: string) => void = console.log,
): void {
  if (status === 'not_loaded') {
    log(
      `::warning title=Swiss localities not loaded::${workflowData(`${message}; data/ch-localities.json stays as it was`)}`,
    );
  }
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `ch_localities=${status}\n`);
}

function describeTable(table: ChLocalitiesTable, duplicates: number): string {
  const postcodes = new Set(table.rows.map((r) => r[0])).size;
  return `version ${table.version}, ${table.rows.length} rows (${duplicates} duplicates dropped), ${postcodes} postcodes, zip sha256 ${table.sha256}`;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  try {
    if (dryRun) {
      const { table, duplicates } = await readChLocalities();
      console.log(describeTable(table, duplicates));
      return;
    }
    const { table, duplicates } = await refreshChLocalities();
    console.log(describeTable(table, duplicates));
    console.log(`written: ${OUT}`);
    reportChLocalitiesStatus('loaded');
  } catch (e) {
    if (!(e instanceof ChLocalitiesNotLoaded)) throw e;
    console.log(`[ch-localities] not re-read: ${e.message}. The file in place is still served.`);
    if (!dryRun) reportChLocalitiesStatus('not_loaded', e.message);
  }
}

const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error('[ch-localities] seed failed:', err);
    process.exitCode = 1;
  });
}

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
 */
import { createHash } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { readZipEntries } from './seed-eba-psd.js';
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

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const itemRes = await fetch(ITEM_URL);
  if (!itemRes.ok) throw new Error(`STAC item: HTTP ${itemRes.status}`);
  const item = (await itemRes.json()) as {
    properties?: { datetime?: string; updated?: string };
    assets?: Record<string, { href?: string }>;
  };
  const version = (item.properties?.datetime ?? '').slice(0, 10);
  const updated = item.properties?.updated ?? '';
  const fileUrl = item.assets?.[ASSET]?.href;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(version) || !fileUrl) {
    throw new Error(`STAC item without a date or without ${ASSET}`);
  }

  const zipRes = await fetch(fileUrl);
  if (!zipRes.ok) throw new Error(`${fileUrl}: HTTP ${zipRes.status}`);
  const zip = Buffer.from(await zipRes.arrayBuffer());
  const sha256 = createHash('sha256').update(zip).digest('hex');
  const csv = readZipEntries(zip).filter((e) => /\.csv$/i.test(e.name));
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
    etag: zipRes.headers.get('etag'),
    sha256,
    fetched_on: new Date().toISOString().slice(0, 10),
    terms: TERMS,
    terms_url: TERMS_URL,
    terms_read_on: TERMS_READ_ON,
    columns: [...CH_LOCALITY_COLUMNS],
    rows: parsed.rows,
  };
  if (!isChLocalitiesTable(table)) throw new Error('the table does not pass isChLocalitiesTable');

  const postcodes = new Set(table.rows.map((r) => r[0])).size;
  console.log(
    `version ${version}, ${table.rows.length} rows (${parsed.duplicates} duplicates dropped), ${postcodes} postcodes, zip sha256 ${sha256}`,
  );
  if (dryRun) return;
  const tmp = `${OUT}.tmp`;
  writeFileSync(tmp, serializeTable(table));
  renameSync(tmp, OUT);
  console.log(`written: ${OUT}`);
}

const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error('[ch-localities] seed failed:', err);
    process.exitCode = 1;
  });
}

/**
 * Actualise la liste partielle des émetteurs néerlandais depuis sa page officielle.
 * Le lien XLSX change à chaque republication : il est découvert et doit être unique.
 * Le titre du fichier fournit la date, jamais remplacée par la date du téléchargement.
 * Une présence confirme l'émetteur ; une absence ne prouve jamais son inexistence.
 * L'import du module ne télécharge rien et n'écrit aucun fichier.
 *
 *   npm run db:refresh-nl-psp     # écrit src/db/nl-psp.json (NL_PSP_PATH pour un autre chemin)
 *
 * ## Dans le robot mensuel (refresh-bic.yml, depuis le 18/11/2026)
 *
 * Même discipline que le registre tchèque et la liste bulgare du même robot : une
 * source qui ne répond pas ne doit pas coûter au mois ses autres sources.
 * - `DutchListNotLoaded` quand la source ne sert pas une liste à servir : la page ou
 *   le fichier ne répond pas (refus HTTP, réseau, délai), dépasse son plafond, la
 *   page répond sans le lien attendu (une page de refus servie en 200, comme le
 *   pare-feu de bnb.bg en sert), le lien sert autre chose qu'un classeur, le
 *   classeur dépasse ses bornes, l'édition est plus ancienne que celle déjà servie,
 *   ou la liste est tronquée (sous le plancher, ou privée de plus d'un dixième des
 *   prestataires déjà servis). Le fichier en place n'est pas touché, le script sort
 *   en 0, écrit une annotation `::warning::` et `nl_psp=not_loaded` dans
 *   $GITHUB_OUTPUT ; l'étape « Dutch PSP list not loaded » du robot en fait un passage
 *   rouge et une alerte, APRÈS le commit des autres sources (relecture de la PR 640 :
 *   une page sans son lien faisait perdre tout le passage mensuel).
 * - Le classeur a changé de forme (date absente ou impossible, identifiant
 *   contradictoire, prestataire sans nom) : le script lève et sort en 1, parce que
 *   c'est ce qu'un humain doit lire. Rien n'est écrit.
 *
 * Une perte de plus d'un dixième peut être réelle (des prestataires qui quittent la
 * liste) : après lecture de l'édition, `NL_PSP_ACCEPT_LOSS=1 npm run db:refresh-nl-psp`
 * l'écrit quand même, à la main, jamais dans le robot.
 */
import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';
import { measureXlsxArchive, readCappedBody } from './bounded-read.js';
import { failureCause } from './seed-report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.NL_PSP_PATH ?? resolve(__dirname, '../src/db/nl-psp.json');

export const PUBLICATION_PAGE = 'https://www.betaalvereniging.nl/kennisbank/iban-en-bic/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

/** 94 providers on 29/07/2026. A parse that loses most of them is a bad parse. */
const MIN_EXPECTED = 70;

/**
 * La part des prestataires déjà servis qu'une édition peut perdre d'un coup : au-delà,
 * c'est une liste tronquée plutôt que des départs (la même borne que la porte de la
 * surcouche privée, « aucun membre en baisse de plus de 10 % »). Ces prestataires
 * complètent aussi la carte composite (addListedDutchProviders, bic-lookup.ts) : une
 * perte retirerait des codes résolus.
 */
export const MAX_LOSS_SHARE = 0.1;

/**
 * Les plafonds : la page de publication, le classeur, ce qu'il pèse décompressé et ses
 * parties, la hauteur de sa feuille. Une édition de la liste en est une petite fraction.
 */
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const MAX_XLSX_BYTES = 5 * 1024 * 1024;
export const MAX_XLSX_UNZIPPED_BYTES = 40 * 1024 * 1024;
const MAX_XLSX_PARTS = 200;
export const MAX_SHEET_ROWS = 20_000;

/** La source n'a pas répondu, ou pas avec une édition à servir : le fichier en place reste. */
export class DutchListNotLoaded extends Error {}

/**
 * Le document change d'adresse ; seule la page de publication reste le point d'entrée.
 * Un `href` que `new URL` refuse n'est pas le lien cherché : il est sauté.
 */
export function findDutchPspWorkbook(html: string): string {
  const links = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    let url: URL;
    try {
      url = new URL(match[1].replace(/&amp;/g, '&'), PUBLICATION_PAGE);
    } catch {
      continue;
    }
    if (
      url.protocol === 'https:' &&
      url.hostname === 'www.betaalvereniging.nl' &&
      !url.username &&
      !url.password &&
      /\/BIC-lijst-NL[^/]*\.xlsx$/i.test(url.pathname)
    )
      links.add(url.href);
  }
  if (links.size !== 1)
    throw new DutchListNotLoaded(
      `Page de publication néerlandaise : ${links.size} lien(s) vers la liste au lieu d'un`,
    );
  return [...links][0];
}

/**
 * Le classeur, lu dans ses bornes : l'archive mesurée avant que SheetJS ne la
 * décompresse (scripts/bounded-read.ts), puis la feuille lue sans construire les lignes
 * au-delà de MAX_SHEET_ROWS. Une borne franchie : `DutchListNotLoaded` (ce n'est pas
 * la liste). Le plancher n'est pas contrôlé ici : voir `refreshDutchPsp`.
 */
export function parseDutchPspWorkbook(buffer: Buffer) {
  try {
    measureXlsxArchive(
      buffer,
      { maxUnzippedBytes: MAX_XLSX_UNZIPPED_BYTES, maxParts: MAX_XLSX_PARTS },
      'Document néerlandais',
    );
  } catch (e) {
    throw new DutchListNotLoaded((e as Error).message, { cause: e });
  }
  // Une ligne de plus que la borne : une feuille plus haute se voit dans `!fullref`,
  // que SheetJS pose quand il s'arrête avant la fin.
  const wb = XLSX.read(buffer, {
    type: 'buffer',
    cellFormula: false,
    cellHTML: false,
    sheetRows: MAX_SHEET_ROWS + 1,
  });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const ref = sheet?.['!fullref'] ?? sheet?.['!ref'];
  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    const height = range.e.r - range.s.r + 1;
    if (!Number.isFinite(height) || height > MAX_SHEET_ROWS)
      throw new DutchListNotLoaded(
        'Document néerlandais : la feuille dépasse toute édition de la liste',
      );
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });

  // The first row is a title carrying the publication date; keep it, it is the
  // only way a reader knows how stale the answer may be.
  const title = String(rows[0]?.[0] ?? '');
  const asOf = title.match(/(\d{2})-(\d{2})-(\d{4})/);
  const as_of = asOf ? `${asOf[3]}-${asOf[2]}-${asOf[1]}` : null;
  if (
    !as_of ||
    !Number.isFinite(Date.parse(as_of)) ||
    new Date(as_of).toISOString().slice(0, 10) !== as_of
  )
    throw new Error('Date de publication néerlandaise absente ou invalide');

  const providers: Record<string, { bic: string; name: string }> = {};
  for (const r of rows) {
    const bic = String(r[0] ?? '')
      .replace(/\s/g, '')
      .toUpperCase();
    const id = String(r[1] ?? '')
      .trim()
      .toUpperCase();
    const name = String(r[2] ?? '').trim();
    // The identifier is exactly four letters, which is what a Dutch IBAN carries.
    if (!/^[A-Z]{4}$/.test(id) || !/^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(bic)) continue;
    if (!name) throw new Error('Nom de prestataire néerlandais absent');
    const value = { bic: bic.slice(0, 8), name };
    if (providers[id] && JSON.stringify(providers[id]) !== JSON.stringify(value))
      throw new Error('Identifiant néerlandais contradictoire');
    providers[id] = value;
  }

  return { as_of, providers };
}

/** Une lecture qui n'aboutit pas (réseau, délai, refus HTTP, plafond) : la source n'a pas répondu. */
async function read(
  what: string,
  url: string,
  maxBytes: number,
  fetchImpl: typeof fetch,
): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new DutchListNotLoaded(`${what} : ${failureCause(e)}`, { cause: e });
  }
  if (!res.ok) throw new DutchListNotLoaded(`${what} : HTTP ${res.status}`);
  try {
    return await readCappedBody(res, maxBytes, what);
  } catch (e) {
    throw new DutchListNotLoaded(`${what} : lecture interrompue (${(e as Error).message})`, {
      cause: e,
    });
  }
}

/** Le fichier déjà servi (édition et identifiants), ou null s'il n'y en a pas de lisible. */
function servedList(out: string): { as_of: string | null; ids: string[] } | null {
  try {
    const file = JSON.parse(readFileSync(out, 'utf8')) as { as_of?: unknown; providers?: unknown };
    const ids =
      file.providers && typeof file.providers === 'object' ? Object.keys(file.providers) : [];
    return { as_of: typeof file.as_of === 'string' ? file.as_of : null, ids };
  } catch {
    return null;
  }
}

export interface DutchRefresh {
  source: string;
  as_of: string;
  count: number;
  /** Les identifiants déjà servis que cette édition ne porte plus. */
  lost: string[];
}

export interface DutchRefreshOptions {
  /** Écrire une édition qui perd plus de MAX_LOSS_SHARE des prestataires servis (à la main). */
  acceptLoss?: boolean;
}

/**
 * Lit la page, son lien, le classeur, et réécrit le fichier (voisin puis renommage).
 * Lève `DutchListNotLoaded` quand la source ne sert pas une liste à servir ; toute
 * autre erreur est un changement de forme.
 */
export async function refreshDutchPsp(
  out: string = OUT,
  fetchImpl: typeof fetch = fetch,
  options: DutchRefreshOptions = {},
): Promise<DutchRefresh> {
  const page = await read(
    'Page de publication néerlandaise',
    PUBLICATION_PAGE,
    MAX_PAGE_BYTES,
    fetchImpl,
  );
  const source = findDutchPspWorkbook(page.toString('utf8'));
  const buffer = await read('Document néerlandais', source, MAX_XLSX_BYTES, fetchImpl);
  // Un classeur XLSX est une archive zip ; une page de refus servie en 200 n'en est pas une.
  if (buffer.subarray(0, 4).toString('latin1') !== 'PK\u0003\u0004')
    throw new DutchListNotLoaded('Document néerlandais : le lien ne sert pas un classeur XLSX');
  const result = parseDutchPspWorkbook(buffer);
  const count = Object.keys(result.providers).length;
  if (count < MIN_EXPECTED)
    throw new DutchListNotLoaded(
      `Document néerlandais : ${count} prestataires lus, sous le plancher de ${MIN_EXPECTED}`,
    );
  const served = servedList(out);
  if (served?.as_of && result.as_of < served.as_of)
    throw new DutchListNotLoaded(
      `Document néerlandais : édition du ${result.as_of}, plus ancienne que celle servie (${served.as_of})`,
    );
  // Les identifiants perdus, pas le compte net : une liste qui en remplace d'autres
  // garde son compte et retire quand même des codes.
  const lost = (served?.ids ?? []).filter((id) => !(id in result.providers)).sort();
  if (served && lost.length > served.ids.length * MAX_LOSS_SHARE && !options.acceptLoss)
    throw new DutchListNotLoaded(
      `Document néerlandais : l'édition du ${result.as_of} perd ${lost.length} des ${served.ids.length} prestataires servis (${lost.join(', ')}), plus d'un dixième ; relire l'édition, puis NL_PSP_ACCEPT_LOSS=1 à la main`,
    );
  const tmp = `${out}.tmp`;
  writeFileSync(tmp, JSON.stringify({ source, ...result }, null, 2) + '\n', 'utf8');
  renameSync(tmp, out);
  return { source, as_of: result.as_of, count, lost };
}

/** Une commande de workflow tient sur une ligne : %, CR et LF échappés. */
function workflowData(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/**
 * Dit au workflow ce qu'est devenue la liste. `not_loaded` écrit une annotation et,
 * sous Actions, `nl_psp=not_loaded` dans $GITHUB_OUTPUT, que refresh-bic.yml lit pour
 * lever l'alarme après le commit des autres sources. La sortie reste 0.
 */
export function reportDutchStatus(
  status: 'loaded' | 'not_loaded',
  message = '',
  env: NodeJS.ProcessEnv = process.env,
  log: (line: string) => void = console.log,
): void {
  if (status === 'not_loaded') {
    log(
      `::warning title=Dutch PSP list not loaded::${workflowData(`${message}; src/db/nl-psp.json stays as it was`)}`,
    );
  }
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `nl_psp=${status}\n`);
}

async function main(): Promise<void> {
  try {
    const result = await refreshDutchPsp(OUT, fetch, {
      acceptLoss: process.env.NL_PSP_ACCEPT_LOSS === '1',
    });
    console.log(`${result.count} prestataires néerlandais écrits, publication ${result.as_of}`);
    if (result.lost.length > 0)
      console.log(`Prestataires qui ont quitté la liste : ${result.lost.join(', ')}`);
    reportDutchStatus('loaded');
  } catch (e) {
    if (!(e instanceof DutchListNotLoaded)) throw e;
    console.log(`Liste néerlandaise non relue : ${e.message}. Le fichier en place reste servi.`);
    reportDutchStatus('not_loaded', e.message);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

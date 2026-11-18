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
 * - La page ou le fichier ne répond pas (refus HTTP, réseau, délai), le lien sert
 *   autre chose qu'un classeur (une page de refus servie en 200), ou l'édition est
 *   plus ancienne que celle déjà servie : `DutchListNotLoaded`. Le fichier en place
 *   n'est pas touché, le script sort en 0, écrit une annotation `::warning::` et
 *   `nl_psp=not_loaded` dans $GITHUB_OUTPUT ; l'étape « Dutch PSP list not loaded »
 *   du robot en fait un passage rouge et une alerte, APRÈS le commit des autres
 *   sources.
 * - La page répond sans le lien attendu, ou le classeur a changé de forme (date,
 *   identifiants contradictoires, plancher) : le script lève et sort en 1, parce que
 *   c'est ce qu'un humain doit lire. Rien n'est écrit.
 */
import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';
import { failureCause } from './seed-report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.NL_PSP_PATH ?? resolve(__dirname, '../src/db/nl-psp.json');

export const PUBLICATION_PAGE = 'https://www.betaalvereniging.nl/kennisbank/iban-en-bic/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

/** 94 providers on 29/07/2026. A parse that loses most of them is a bad parse. */
const MIN_EXPECTED = 70;

/** La source n'a pas répondu, ou pas avec une édition à servir : le fichier en place reste. */
export class DutchListNotLoaded extends Error {}

/** Le document change d'adresse ; seule la page de publication reste le point d'entrée. */
export function findDutchPspWorkbook(html: string): string {
  const links = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const url = new URL(match[1].replace(/&amp;/g, '&'), PUBLICATION_PAGE);
    if (
      url.protocol === 'https:' &&
      url.hostname === 'www.betaalvereniging.nl' &&
      !url.username &&
      !url.password &&
      /\/BIC-lijst-NL[^/]*\.xlsx$/i.test(url.pathname)
    )
      links.add(url.href);
  }
  if (links.size !== 1) throw new Error('Lien du document néerlandais absent ou ambigu');
  return [...links][0];
}

export function parseDutchPspWorkbook(buffer: Buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    blankrows: false,
  });

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

  const count = Object.keys(providers).length;
  if (count < MIN_EXPECTED) {
    throw new Error(`Only ${count} providers parsed, expected at least ${MIN_EXPECTED}.`);
  }

  return { as_of, providers };
}

/** Une lecture qui n'aboutit pas (réseau, délai, refus HTTP) : la source n'a pas répondu. */
async function read<T>(
  what: string,
  url: string,
  fetchImpl: typeof fetch,
  body: (res: Response) => Promise<T>,
): Promise<T> {
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
    return await body(res);
  } catch (e) {
    throw new DutchListNotLoaded(`${what} : lecture interrompue (${failureCause(e)})`, {
      cause: e,
    });
  }
}

/** L'édition déjà servie, ou null s'il n'y a pas de fichier lisible. */
function servedEdition(out: string): string | null {
  try {
    const as_of = (JSON.parse(readFileSync(out, 'utf8')) as { as_of?: unknown }).as_of;
    return typeof as_of === 'string' ? as_of : null;
  } catch {
    return null;
  }
}

export interface DutchRefresh {
  source: string;
  as_of: string;
  count: number;
}

/**
 * Lit la page, son lien, le classeur, et réécrit le fichier (voisin puis renommage).
 * Lève `DutchListNotLoaded` quand la source n'a pas répondu ; toute autre erreur est
 * un changement de forme.
 */
export async function refreshDutchPsp(
  out: string = OUT,
  fetchImpl: typeof fetch = fetch,
): Promise<DutchRefresh> {
  const html = await read('Page de publication néerlandaise', PUBLICATION_PAGE, fetchImpl, (r) =>
    r.text(),
  );
  const source = findDutchPspWorkbook(html);
  const buffer = await read('Document néerlandais', source, fetchImpl, async (r) =>
    Buffer.from(await r.arrayBuffer()),
  );
  // Un classeur XLSX est une archive zip ; une page de refus servie en 200 n'en est pas une.
  if (buffer.subarray(0, 4).toString('latin1') !== 'PK\u0003\u0004')
    throw new DutchListNotLoaded('Document néerlandais : le lien ne sert pas un classeur XLSX');
  const result = parseDutchPspWorkbook(buffer);
  const served = servedEdition(out);
  if (served && result.as_of < served)
    throw new DutchListNotLoaded(
      `Document néerlandais : édition du ${result.as_of}, plus ancienne que celle servie (${served})`,
    );
  const tmp = `${out}.tmp`;
  writeFileSync(tmp, JSON.stringify({ source, ...result }, null, 2) + '\n', 'utf8');
  renameSync(tmp, out);
  return { source, as_of: result.as_of, count: Object.keys(result.providers).length };
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
    const result = await refreshDutchPsp();
    console.log(`${result.count} prestataires néerlandais écrits, publication ${result.as_of}`);
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

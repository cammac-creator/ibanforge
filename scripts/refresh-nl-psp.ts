/**
 * Actualise la liste partielle des émetteurs néerlandais depuis sa page officielle.
 * Le lien XLSX change à chaque republication : il est découvert et doit être unique.
 * Le titre du fichier fournit la date, jamais remplacée par la date du téléchargement.
 * Une présence confirme l'émetteur ; une absence ne prouve jamais son inexistence.
 * L'import du module ne télécharge rien et n'écrit aucun fichier.
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../src/db/nl-psp.json');

export const PUBLICATION_PAGE = 'https://www.betaalvereniging.nl/kennisbank/iban-en-bic/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

/** 94 providers on 29/07/2026. A parse that loses most of them is a bad parse. */
const MIN_EXPECTED = 70;

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

async function main(): Promise<void> {
  const options = {
    redirect: 'follow' as const,
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(30_000),
  };
  const page = await fetch(PUBLICATION_PAGE, options);
  if (!page.ok) throw new Error(`Page de publication néerlandaise : HTTP ${page.status}`);
  const source = findDutchPspWorkbook(await page.text());
  const response = await fetch(source, { ...options, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Document néerlandais : HTTP ${response.status}`);
  const result = parseDutchPspWorkbook(Buffer.from(await response.arrayBuffer()));
  writeFileSync(OUT, JSON.stringify({ source, ...result }, null, 2) + '\n', 'utf8');
  console.log(
    `${Object.keys(result.providers).length} prestataires néerlandais écrits, publication ${result.as_of}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

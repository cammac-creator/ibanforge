/**
 * Fetch the UK modulus checking reference data published by Vocalink (Mastercard)
 * for Pay.UK, and write it to a local store the API reads at runtime.
 *
 *   npx tsx scripts/seed-uk-modulus.ts
 *
 * WHY THIS IS A SEEDER AND NOT A COMMITTED FILE
 *
 * Vocalink publishes the weight table for implementers but grants no written
 * redistribution right, so the table must not enter this repository (public) nor
 * the published `ibanforge-mcp` package. It lives only on the server, fetched at
 * build or boot, and only a computed boolean ever leaves the process. Writing to
 * data/uk-modulus.json, which .gitignore excludes, is what enforces that.
 *
 * WHY IT SCRAPES INSTEAD OF STORING THE URL
 *
 * The download links are content-hashed and rotate with every revision of the
 * specification: the two URLs recorded in July 2026 both answered 404 by August.
 * A stored URL therefore rots into a silently missing feature. The tools page
 * itself is stable, so we read the current links from it every time.
 *
 * FAILURE POSTURE
 *
 * Exits non-zero on failure but is invoked non-blocking from the Dockerfile: a
 * rotted link must degrade to "no modulus check available", never to a broken
 * deploy. The runtime treats an absent file the same way de-blz.ts treats a
 * missing table.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ModulusTable, WeightRow } from '../src/lib/uk-modulus.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.UK_MODULUS_PATH ?? resolve(__dirname, '../data/uk-modulus.json');
const TOOLS_PAGE = 'https://www.vocalink.com/tools/modulus-checking/';
const UA = 'Mozilla/5.0 (compatible; IBANforge/1.0; +https://ibanforge.com)';

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

/**
 * Find the current download links on the tools page.
 *
 * Matched on the filename stem rather than the hash directory, since the stem
 * ("valacdos", "scsubtab") is what has stayed constant across revisions while
 * the hash has not. The revision published in August 2026 named the file
 * `valacdos-1.txt`, hence the tolerated suffix.
 */
function findLinks(html: string): { valacdos: string; scsubtab: string } {
  const abs = (href: string) => (href.startsWith('http') ? href : `https://www.vocalink.com${href}`);
  const pick = (stem: string): string => {
    const m = html.match(new RegExp(`href="([^"]*${stem}[^"]*\\.txt)"`, 'i'));
    if (!m) throw new Error(`no ${stem}.txt link on ${TOOLS_PAGE} — the page layout changed`);
    return abs(m[1]);
  };
  return { valacdos: pick('valacdos'), scsubtab: pick('scsubtab') };
}

/**
 * Parse valacdos.txt: whitespace-separated fixed fields, 17 columns without an
 * exception and 18 with one.
 *
 * Weights can be negative (-1 appears in the exception 12/13 rows), so the
 * parser must not assume unsigned digits.
 */
export function parseWeights(text: string): WeightRow[] {
  const rows: WeightRow[] = [];
  for (const line of text.split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p.length < 17) continue;
    const algorithm = p[2].toUpperCase();
    if (algorithm !== 'MOD10' && algorithm !== 'MOD11' && algorithm !== 'DBLAL') continue;
    rows.push({
      start: p[0],
      end: p[1],
      algorithm,
      weights: p.slice(3, 17).map(Number),
      exception: p.length >= 18 ? Number(p[17]) : null,
    });
  }
  return rows;
}

/** Parse scsubtab.txt: two space-separated six-digit sorting codes per line. */
export function parseSubstitutions(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(\d{6})\s+(\d{6})$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main(): Promise<void> {
  const links = findLinks(await get(TOOLS_PAGE));
  const [valacdos, scsubtab] = await Promise.all([get(links.valacdos), get(links.scsubtab)]);

  const rows = parseWeights(valacdos);
  const substitutions = parseSubstitutions(scsubtab);

  // A layout change that silently yields a near-empty table would read as
  // "sorting code not covered" for every UK account, which is indistinguishable
  // from a correct answer. Refuse to write a table that small.
  if (rows.length < 500) throw new Error(`only ${rows.length} weight rows parsed — refusing to write`);
  if (Object.keys(substitutions).length < 10) {
    throw new Error(`only ${Object.keys(substitutions).length} substitutions parsed — refusing to write`);
  }

  const table: ModulusTable = {
    harvested: new Date().toISOString().slice(0, 10),
    source: links.valacdos,
    rows,
    substitutions,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(table));
  console.log(`wrote ${rows.length} weight rows + ${Object.keys(substitutions).length} substitutions to ${OUT}`);
}

main().catch((err) => {
  console.error(`uk-modulus seed failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

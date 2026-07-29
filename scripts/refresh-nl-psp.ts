/**
 * Regenerate the Dutch payment-service-provider list from Betaalvereniging.
 *
 *   npx tsx scripts/refresh-nl-psp.ts
 *
 * WHY THIS IS A CHECKED-IN FILE AND NOT A RUNTIME FETCH
 *
 * The published URL carries the month it was posted, so it moves on every
 * republication: the file that answers today 404s the day they replace it.
 * A monthly job pointed at a dead URL would silently stop refreshing, and the
 * list is 94 rows, far too small for a row-count floor to catch anything. So
 * the parsed result is committed and this script is run deliberately when
 * Betaalvereniging republishes, with the publication date carried in the data.
 *
 * WHAT THIS LIST IS, AND WHAT IT IS NOT
 *
 * It names the providers that issue Dutch IBANs, keyed by the four-letter
 * identifier a Dutch IBAN carries. It is NOT exhaustive and says so:
 * "het is voor betaaldienstverleners niet verplicht om op deze lijst te staan
 * en daarom is het overzicht niet compleet". So it can confirm that an
 * identifier belongs to a real issuer; it can never prove that one does not.
 * That asymmetry is the whole design of how it is used.
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../src/db/nl-psp.json');

const SOURCE = 'https://www.betaalvereniging.nl/wp-content/uploads/2026/03/BIC-lijst-NL-2.xlsx';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

/** 94 providers on 29/07/2026. A parse that loses most of them is a bad parse. */
const MIN_EXPECTED = 70;

async function main(): Promise<void> {
  const res = await fetch(SOURCE, { redirect: 'follow', headers: { 'User-Agent': UA } });
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status}. The URL carries a publication month and moves when they ` +
        `republish; find the current one at betaalvereniging.nl and update SOURCE.`,
    );
  }
  const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    blankrows: false,
  });

  // The first row is a title carrying the publication date; keep it, it is the
  // only way a reader knows how stale the answer may be.
  const title = String(rows[0]?.[0] ?? '');
  const asOf = title.match(/(\d{2})-(\d{2})-(\d{4})/);
  const as_of = asOf ? `${asOf[3]}-${asOf[2]}-${asOf[1]}` : null;
  if (!as_of) throw new Error(`No publication date in the title row: ${title}`);

  const providers: Record<string, { bic: string; name: string }> = {};
  for (const r of rows) {
    const bic = String(r[0] ?? '').replace(/\s/g, '').toUpperCase();
    const id = String(r[1] ?? '').trim().toUpperCase();
    const name = String(r[2] ?? '').trim();
    // The identifier is exactly four letters, which is what a Dutch IBAN carries.
    if (!/^[A-Z]{4}$/.test(id) || !/^[A-Z]{6}[A-Z0-9]{2}/.test(bic)) continue;
    if (!providers[id]) providers[id] = { bic: bic.slice(0, 8), name };
  }

  const count = Object.keys(providers).length;
  if (count < MIN_EXPECTED) {
    throw new Error(`Only ${count} providers parsed, expected at least ${MIN_EXPECTED}.`);
  }

  writeFileSync(
    OUT,
    JSON.stringify({ source: SOURCE, as_of, providers }, null, 2) + '\n',
    'utf8',
  );
  console.log(`${count} Dutch providers written, published ${as_of}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

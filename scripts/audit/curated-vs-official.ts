/**
 * Confront curated bank names with official identities (ECB MFI + GLEIF), by LEI.
 *
 * Run: NODE_OPTIONS= npx tsx scripts/audit/curated-vs-official.ts
 *
 * What the 26/08/2026 run established, so nobody re-derives it:
 * - Only 1,183 of the 24,069 curated keys carry a bank_name at all (the other
 *   22,886 are bic-only and inherit their name from bic_entries at serve time,
 *   so their freshness is GLEIF's freshness, not this file's).
 * - Register countries (CH/LI/DE/AT/BE/FI/GB/GI) are excluded: their names are
 *   already confronted with the national register itself.
 * - Shared BIC8s (e.g. the Swiss RBAB network) are skipped unless every row
 *   under the BIC8 is one identity: comparing a local member bank to whichever
 *   group member holds the LEI row produced 90+ false conflicts in the first
 *   naive pass.
 * - Findings: GB:BUKB (Bank of Scotland -> Barclays, fixed 26/08 via the PRA
 *   join) and IT:05034 (Banca Popolare di Milano -> Banco BPM, a 2017 merger
 *   still uncorrected — fixed 26/08 from this run, confirmed by GLEIF AND the
 *   ECB MFI list).
 */
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';

const curated = JSON.parse(readFileSync('src/db/bic_data.json', 'utf8')) as Record<string, { bic: string; bank_name: string; city?: string }>;
const db = new Database('data/bic.sqlite', { readonly: true });

const REGISTER_COUNTRIES = new Set(['CH', 'LI', 'DE', 'AT', 'BE', 'FI', 'GB', 'GI']);
const byBic11 = db.prepare('SELECT lei, institution FROM bic_entries WHERE bic11 = ? AND lei IS NOT NULL LIMIT 1');
const allByBic8 = db.prepare('SELECT lei, institution FROM bic_entries WHERE bic8 = ? AND lei IS NOT NULL');
const ecbOf = db.prepare('SELECT name FROM ecb_mfi WHERE lei = ? LIMIT 1');

const STOP = new Set(['bank', 'banque', 'banca', 'banco', 'bankas', 'banka', 'the', 'and', 'des', 'der', 'die', 'ag', 'sa', 'plc', 'ltd', 'limited', 'nv', 'group', 'groupe', 'holding', 'international', 'europe', 'european', 'co', 'company', 'de', 'du', 'of', 'für', 'national', 'branch']);
const tokens = (s: string) => new Set(
  s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/)
    .filter(w => w.length >= 3 && !STOP.has(w.toLowerCase())),
);
const overlap = (a: string, b: string) => {
  const ta = tokens(a), tb = tokens(b);
  for (const w of ta) if (tb.has(w)) return true;
  // préfixes (BARC vs BARCLAYS)
  for (const w of ta) for (const v of tb) if (w.length >= 5 && v.length >= 5 && (w.startsWith(v.slice(0, 5)) || v.startsWith(w.slice(0, 5)))) return true;
  return false;
};

let checked = 0; const conflicts: string[] = []; let outOfRegister = 0, bic11Hit = 0, bic8Rows = 0, bic8Unique = 0;
for (const [key, e] of Object.entries(curated)) {
  if (!e?.bic || !e.bank_name) continue;
  if (REGISTER_COUNTRIES.has(key.slice(0, 2))) continue; // already confronted with their own register
  outOfRegister++;
  const bic11 = e.bic.length === 11 ? e.bic : e.bic.slice(0, 8) + 'XXX';
  let row = byBic11.get(bic11) as { lei: string; institution: string | null } | undefined;
  if (row) bic11Hit++;
  if (!row) {
    const rows = allByBic8.all(e.bic.slice(0, 8)) as Array<{ lei: string; institution: string | null }>;
    if (!rows.length) continue;
    bic8Rows++;
    // A shared BIC8 names no single institution — but name VARIANTS of one
    // institution are not sharing. Deduplicate by token identity first.
    const identities = new Map<string, { lei: string; institution: string | null }>();
    for (const r of rows) {
      const sig = [...tokens(r.institution ?? '')].sort().slice(0, 3).join('|') || r.lei;
      if (!identities.has(sig)) identities.set(sig, r);
    }
    if (identities.size !== 1) continue;
    bic8Unique++;
    row = [...identities.values()][0];
  }
  const official = (ecbOf.get(row.lei) as { name: string } | undefined)?.name ?? null;
  const refs = [official, row.institution].filter(Boolean) as string[];
  if (!refs.length) continue;
  checked++;
  if (!refs.some(r => overlap(e.bank_name, r))) {
    conflicts.push(`${key} | curated: "${e.bank_name}" | GLEIF: "${row.institution ?? ''}" | ECB: "${official ?? ''}" | ${e.bic}`);
  }
}
console.log(`tunnel: hors-registres=${outOfRegister} bic11=${bic11Hit} bic8avecLignes=${bic8Rows} bic8identitéUnique=${bic8Unique}`);
console.log(`clés confrontées (BIC→LEI trouvé): ${checked} / ${Object.keys(curated).length}`);
console.log(`contradictions franches (zéro mot commun): ${conflicts.length}`);
for (const c of conflicts.slice(0, 40)) console.log(' ', c);

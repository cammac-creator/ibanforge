/**
 * Build src/lib/issuers-generated.ts.
 *
 * Cross-matches the EBA PIR + FCA UK EMI/PI register snapshot against the BIC
 * base (bic_entries) by exact normalized-name match, and emits a
 * BIC8 -> IssuerType map. This extends classifyIssuer's stage-1 coverage well
 * beyond the hand-curated KNOWN_ISSUERS list.
 *
 * Run: npm run issuers:build   (or: node scripts/build-issuer-index.mjs)
 *
 * To REFRESH the snapshot (rare — endpoint is undocumented):
 *   EBA PIR: POST https://euclid.eba.europa.eu/register/api/search/entities
 *            body {"$and":[{"_payload.EntityType":"PSD_EMI"}]} (and PSD_EEMI,
 *            PSD_PI, PSD_AISP); fields ENT_NAM / ENT_COU_RES.
 *   FCA UK : CSV exports "E-Money Firms" + "Firms with PSD Permissions".
 *   Then rewrite scripts/data/eu-emi-register-YYYY-MM-DD.json as
 *   [{ name, country, type }] with type in {emi,digital_bank,payment_institution}.
 */
import Database from 'better-sqlite3';
import { readFileSync, writeFileSync } from 'node:fs';

const SNAPSHOT = 'scripts/data/eu-emi-register-2026-05-22.json';
// The generated file now lives in the open-source library. The generator stays
// here: it cross-matches the public EBA/FCA registers against the BIC base,
// which is private and does not leave this repo.
const OUT = process.env.ISSUERS_OUT ?? '../iban-core/src/issuers-generated.ts';

// Corporate/legal-form tokens stripped before matching, so that e.g.
// "Stripe Payments UK Limited" and "STRIPE PAYMENTS UK LTD" align.
const SUFFIXES = new Set([
  'ltd', 'limited', 'plc', 'llp', 'llc', 'inc', 'corp', 'co',
  'sa', 'sas', 'sasu', 'sarl', 'nv', 'bv', 'cv', 'ag', 'gmbh', 'kg', 'se', 'ug',
  'uab', 'ab', 'oy', 'oyj', 'as', 'aps', 'hf', 'ehf', 'spa', 'srl', 'doo', 'dd',
  'zrt', 'kft', 'rt', 'sl', 'lda', 'ltda', 'dac', 'scrl', 'scpa', 'publ',
  'n', 'v', 's', 'a', 'o', 'p', 'r', 'l', 'd', 'e', 'i', 'sp', 'z',
]);

function norm(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t && !SUFFIXES.has(t))
    .join(' ');
}

const list = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const db = new Database('data/bic.sqlite', { readonly: true });
const rows = db.prepare('SELECT bic8, institution FROM bic_entries').all();

// Index bic_entries by normalized institution name.
const idx = new Map();
for (const r of rows) {
  if (!r.institution) continue;
  const k = norm(r.institution);
  if (!k) continue;
  if (!idx.has(k)) idx.set(k, []);
  idx.get(k).push(r.bic8);
}

// Cross-match. On a BIC8 type conflict, keep the most informative type.
const RANK = { digital_bank: 3, emi: 2, payment_institution: 1 };
const generated = new Map();
let matchedEntities = 0;
for (const e of list) {
  const bics = idx.get(norm(e.name));
  if (!bics) continue;
  matchedEntities++;
  for (const b of bics) {
    const cur = generated.get(b);
    if (!cur || RANK[e.type] > RANK[cur]) generated.set(b, e.type);
  }
}

const entries = [...generated.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const body = entries.map(([b, t]) => `  ${b}: '${t}',`).join('\n');
// The header below ships inside the open-source library, where this script,
// its snapshot and the BIC database do not exist. It must therefore stand on
// its own: no command to run, no path to follow, nothing a reader could look
// for and fail to find. Audit 2026-07-25.
const content = `// GENERATED FILE — do not edit by hand.
// A BIC8 -> issuer-type index, built by cross-matching the public EBA Payment
// Institutions Register and the FCA UK e-money register against a bank
// identifier directory, on exact normalised-name match. ${entries.length} BIC8 codes.
// Refreshed periodically. Open an issue to report a misclassification.
import type { IssuerType } from './issuers.js';

export const GENERATED_ISSUERS: Record<string, IssuerType> = {
${body}
};
`;
writeFileSync(OUT, content);

console.log(`Snapshot entities      : ${list.length}`);
console.log(`Matched entities       : ${matchedEntities}`);
console.log(`Generated BIC8 entries : ${entries.length}  -> ${OUT}`);
console.log('--- sanity check ---');
for (const name of [
  'Adyen N.V.', 'Stripe Payments UK Limited', 'CHECKOUT', 'SWAN',
  'Modulr FS Limited', 'Wise Payments Limited', 'Qonto', 'N26 Bank',
  'Mollie B.V.', 'Revolut Bank UAB', 'NEXI PAYMENTS S.P.A.', 'Payhawk Financial Services UAB',
]) {
  const bics = idx.get(norm(name));
  console.log(`  ${name} -> ${bics ? bics.join(',') : '(no match)'}`);
}

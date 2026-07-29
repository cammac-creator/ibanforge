// Petteri ran the textbook example IBANs. We SHIP a list of those (EXAMPLE_IBANS,
// served on /v1/demo, the landing page, OpenAPI and the MCP resources), so his
// experiment is reproducible on a set we can enumerate, and the answer matters
// twice over: it tells us whether our own published examples pass our own
// bank-code check.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const lib = await import('./node_modules/iban-core/dist/index.js');
const { validateIBAN } = await import('./dist/lib/iban.js');
const { enrichResult } = await import('./dist/lib/enrich.js');

const ex = lib.EXAMPLE_IBANS ?? {};
console.log('example IBANs shipped:', Object.keys(ex).length);
const rows = [];
for (const [cc, iban] of Object.entries(ex)) {
  const r = validateIBAN(iban);
  if (!r.valid) { rows.push({ cc, iban, status: 'INVALID:' + r.error }); continue; }
  enrichResult(r);
  const b = r.bank_code_check;
  rows.push({ cc, iban, bank: r.bban?.bank_code, status: b?.status, auth: b?.authoritative, bic: r.bic?.code ?? null, cls: r.issuer?.classification ?? null });
}
const bad = rows.filter((r) => r.status !== 'verified');
console.log(`\n${bad.length} of ${rows.length} shipped example IBANs do NOT come back verified:\n`);
for (const r of bad) console.log(`  ${r.cc}  ${(r.iban||'').padEnd(34)} bank=${String(r.bank).padEnd(9)} ${r.status}${r.auth ? ' (AUTHORITATIVE)' : ''}`);
const ok = rows.filter((r) => r.status === 'verified');
console.log(`\n${ok.length} verified. classification breakdown:`,
  JSON.stringify(ok.reduce((a, r) => { a[r.cls ?? 'none'] = (a[r.cls ?? 'none'] ?? 0) + 1; return a; }, {})));

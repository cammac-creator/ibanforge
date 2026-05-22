/**
 * Verify src/lib/countries.ts against the official SWIFT IBAN Registry
 * snapshot (scripts/data/iban-registry-2026-05-22.json). Reports IBAN-length
 * and bank-code drift, and lists BBAN_STRUCTURE coverage gaps. Never auto-fixes.
 *
 * Run: npm run iban-registry:check  — exits non-zero on HARD drift only
 * (coverage gaps are informational).
 *
 * Refresh: SWIFT updates the registry a few times a year. swift.com blocks
 * fetchers; python-stdnum's iban.dat mirrors the official registry text file.
 * Re-extract, write a new dated JSON snapshot, repoint this script, reconcile.
 */
import { readFileSync } from 'node:fs';
import { IBAN_LENGTHS, BBAN_STRUCTURE } from '../src/lib/countries.js';

interface RegistryEntry {
  ibanLength: number;
  bankCode: [number, number];
  branchCode: [number, number] | null;
  accountNumber: [number, number];
}

/**
 * countries.ts splits the "bank identifier" into bank + branch more granularly
 * than the SWIFT registry's single field for these countries. Verified correct
 * against the bic_data.json lookup keys — intentional, not drift.
 */
const KNOWN_CONVENTION_DIFFERENCES = new Set(['IT', 'SM', 'XK']);

const SNAPSHOT = 'scripts/data/iban-registry-2026-05-22.json';
const registry = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Record<string, RegistryEntry>;

let issues = 0;
const gaps: string[] = [];

for (const [cc, ref] of Object.entries(registry)) {
  // IBAN length — firm.
  const len = IBAN_LENGTHS[cc];
  if (len === undefined) {
    console.log(`[drift] ${cc}: missing from IBAN_LENGTHS (registry length ${ref.ibanLength})`);
    issues += 1;
  } else if (len !== ref.ibanLength) {
    console.log(`[drift] ${cc}: IBAN_LENGTHS=${len} but registry=${ref.ibanLength}`);
    issues += 1;
  }

  // Bank-code position — firm, minus documented convention differences.
  if (KNOWN_CONVENTION_DIFFERENCES.has(cc)) continue;
  const bban = BBAN_STRUCTURE[cc];
  if (!bban) {
    gaps.push(cc);
  } else if (bban.bankCode[0] !== ref.bankCode[0] || bban.bankCode[1] !== ref.bankCode[1]) {
    console.log(
      `[drift] ${cc}: bankCode ${JSON.stringify(bban.bankCode)} but registry ${JSON.stringify(ref.bankCode)}`,
    );
    issues += 1;
  }
}

if (gaps.length > 0) {
  console.log(
    `[gap]   ${gaps.length} registry countries have no BBAN_STRUCTURE ` +
      `(bank-code extraction unavailable): ${gaps.sort().join(', ')}`,
  );
}

console.log(`\n${issues} hard drift issue(s), ${gaps.length} coverage gap(s) against ${SNAPSHOT}.`);
process.exit(issues > 0 ? 1 : 0);

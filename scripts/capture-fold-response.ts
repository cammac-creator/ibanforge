/**
 * Rewrites the landing page's captured answer.
 *
 * The fold of ibanforge.com shows a real response of /v1/iban/validate for
 * CH10 0023 0000 0000 1234 5 while the live call runs, and keeps it when the
 * call cannot be made (no JavaScript, reduced motion, relay quota). Until
 * 2026-09-05 that answer was typed into playground/examples.ts on 7 July and
 * aged there (audit n° 21). This script runs in the monthly BIC refresh, on
 * the freshly seeded database, and dates the file; the page reads the date.
 *
 *   npx tsx scripts/capture-fold-response.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateIBAN } from '../src/lib/iban.js';
import { enrichResult } from '../src/lib/enrich.js';

const IBAN = 'CH1000230000000012345';
const OUT = resolve(process.cwd(), 'frontend/app/[locale]/playground/captured-iban.json');

// The first call opens the database and fills the caches (66 ms measured on
// 2026-09-05); the API answers warm. Five warm-up runs, then the median of
// nine timed ones: what a warm server measures for this IBAN, neither the
// cold outlier nor the luckiest run.
for (let i = 0; i < 5; i++) enrichResult(validateIBAN(IBAN));
const timings: number[] = [];
let result = validateIBAN(IBAN);
for (let i = 0; i < 9; i++) {
  const start = performance.now();
  result = validateIBAN(IBAN);
  enrichResult(result);
  timings.push(performance.now() - start);
}
timings.sort((a, b) => a - b);
result.processing_ms = Math.round(timings[4] * 100) / 100;
result.cost_usdc = 0;

if (!result.valid || !result.bic || typeof result.bic !== 'object') {
  console.error('capture-fold-response: the answer is not the one the page expects, file left untouched');
  process.exit(1);
}

const captured = { captured_at: new Date().toISOString().slice(0, 10), response: result };
writeFileSync(OUT, `${JSON.stringify(captured, null, 2)}\n`);
console.log(`capture-fold-response: ${OUT} rewritten, ${captured.captured_at}, ${result.processing_ms} ms`);

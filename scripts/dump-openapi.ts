/**
 * Write the generated OpenAPI document to disk so the contract linter can read it.
 *
 *   npx tsx scripts/dump-openapi.ts [outfile]
 *
 * The document is built from code, not stored as a file, which is what keeps it
 * from drifting from the deployed server. The cost is that no linter can see it
 * without running the code first — so CI regenerates it and lints the fresh copy
 * on every push. A ruleset that is published but never enforced is a claim, not
 * governance.
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSpec } from '../src/routes/openapi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? resolve(__dirname, '../openapi.generated.json');

writeFileSync(out, JSON.stringify(buildSpec(), null, 2));
console.log(`wrote ${out}`);

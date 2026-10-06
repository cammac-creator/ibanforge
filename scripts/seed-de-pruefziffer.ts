/**
 * Write the check-digit method of every German bank code (BLZ) to
 * data/de-pruefziffer.json, from field 9 of the Bundesbank's Bankleitzahlendatei.
 *
 *   npx tsx scripts/seed-de-pruefziffer.ts
 *
 * ## Why a JSON file and not a column of data/bic.sqlite
 *
 * A robot recommits data/bic.sqlite every day (refresh-cz-register.yml). A schema
 * change there would turn every branch that touches it into a daily binary
 * conflict. This table is small (one two-character code per BLZ), lives in its
 * own tracked file and is refreshed by the same monthly workflow as the register
 * (refresh-bic.yml), right after it.
 *
 * ## What it reads
 *
 * The public CSV (scripts/bundesbank-blz-csv.ts). Field 9 is "Kennzeichen für
 * Prüfzifferberechnungsmethode"; the Merkblatt Bankleitzahlendatei says the
 * Merkmal 2 rows of a BLZ carry the same code as its Merkmal 1 row, so the
 * Merkmal 1 row is read and the others are only checked against it. Rows marked
 * for deletion are kept: an IBAN issued under a BLZ that is being retired still
 * carries an account number built for that BLZ's method.
 *
 * ## Failure posture
 *
 * This step runs inside the monthly refresh, before its commit: failing it
 * would hold back every register refreshed that month. So a download failure
 * exits 0 with a warning and leaves the previous table standing (the register
 * step just above read the same file, so this is rare). Only what a human has
 * to read fails the step: a code of the wrong shape, a BLZ with no Merkmal 1
 * row, or fewer BLZ than the sanity floor of seed-blz.ts, all signs that the
 * format changed. A BLZ whose secondary rows carry another code than its
 * Merkmal 1 row is reported as a warning and takes the Merkmal 1 code, as the
 * Merkblatt says it should. The file is written to a neighbour and renamed, so
 * a reader never sees half of it.
 */
import { renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BLZ_CSV_FIELD,
  downloadBundesbankBlzCsv,
  splitBundesbankCsvLine,
} from './bundesbank-blz-csv.js';
import {
  DE_METHOD_CODE,
  DE_TABLE_ATTRIBUTION,
  DE_TABLE_MIN_ENTRIES,
  DE_TABLE_SOURCE,
  isDeMethodTable,
  type DeMethodTable,
} from '../src/lib/national-check/de/table.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.DE_PRUEFZIFFER_PATH ?? resolve(__dirname, '../data/de-pruefziffer.json');

export interface ParsedMethods {
  /** BLZ → method code, from the Merkmal 1 row of each BLZ. */
  methods: Record<string, string>;
  /** Signs of a format change: a code of the wrong shape, a BLZ with no Merkmal 1 row. */
  problems: string[];
  /** BLZ whose secondary rows carry another code than the Merkmal 1 row. */
  warnings: string[];
}

export function parseCheckMethods(text: string): ParsedMethods {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const primary = new Map<string, string>();
  const seen = new Map<string, Set<string>>();
  const problems: string[] = [];
  const warnings: string[] = [];
  for (const line of lines.slice(1)) {
    const f = splitBundesbankCsvLine(line);
    const blz = f[BLZ_CSV_FIELD.blz];
    if (!/^\d{8}$/.test(blz)) continue;
    const code = (f[BLZ_CSV_FIELD.checkMethod] ?? '').trim().toUpperCase();
    if (!DE_METHOD_CODE.test(code)) {
      problems.push(`${blz}: method code ${JSON.stringify(code)} has the wrong shape`);
      continue;
    }
    if (!seen.has(blz)) seen.set(blz, new Set());
    seen.get(blz)!.add(code);
    if (f[BLZ_CSV_FIELD.merkmal] === '1' && !primary.has(blz)) primary.set(blz, code);
  }
  for (const [blz, codes] of seen) {
    if (codes.size > 1) warnings.push(`${blz}: rows carry ${[...codes].join(', ')}`);
    if (!primary.has(blz)) problems.push(`${blz}: no Merkmal 1 row`);
  }
  // Sorted keys: the monthly commit then shows only what really changed.
  const methods = Object.fromEntries([...primary.entries()].sort(([a], [b]) => a.localeCompare(b)));
  return { methods, problems, warnings };
}

export function buildTable(methods: Record<string, string>, today: string): DeMethodTable {
  return {
    source: DE_TABLE_SOURCE,
    attribution: DE_TABLE_ATTRIBUTION,
    fetched_on: today,
    methods,
  };
}

async function main(): Promise<void> {
  let text: string;
  try {
    text = await downloadBundesbankBlzCsv();
  } catch (err) {
    console.log(
      `::warning title=German check-digit methods not refreshed::${String(err).slice(0, 200)}; the previous data/de-pruefziffer.json stays in place`,
    );
    return;
  }
  const { methods, problems, warnings } = parseCheckMethods(text);
  for (const w of warnings.slice(0, 20)) console.log(`::warning title=BLZ rows disagree::${w}`);
  const count = Object.keys(methods).length;
  console.log(`Parsed the check-digit method of ${count} BLZ`);
  if (problems.length > 0) {
    throw new Error(
      `${problems.length} BLZ rejected, refusing to replace the table:\n  ${problems.slice(0, 20).join('\n  ')}`,
    );
  }
  if (count < DE_TABLE_MIN_ENTRIES) {
    throw new Error(
      `Only ${count} BLZ parsed, expected at least ${DE_TABLE_MIN_ENTRIES}. Refusing to replace the table.`,
    );
  }
  const table = buildTable(methods, new Date().toISOString().slice(0, 10));
  if (!isDeMethodTable(table)) throw new Error('The table built does not pass its own check.');

  const byMethod = new Map<string, number>();
  for (const code of Object.values(methods)) byMethod.set(code, (byMethod.get(code) ?? 0) + 1);
  console.log(
    `  ${byMethod.size} distinct methods, ${byMethod.get('09') ?? 0} BLZ on 09 (no check)`,
  );

  const tmp = `${OUT}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(table, null, 1) + '\n');
  renameSync(tmp, OUT);
  console.log(`Wrote ${OUT}`);
}

const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

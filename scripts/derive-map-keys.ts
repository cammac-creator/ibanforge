/**
 * Rebuild keys of the composite bank-code map (src/db/bic_data.json) from open
 * sources only, and withdraw the ones no open source rebuilds.
 *
 *   tsx scripts/derive-map-keys.ts <keys.json>            # dry run: what would change
 *   tsx scripts/derive-map-keys.ts <keys.json> --write    # rewrite the map in place
 *
 * <keys.json> is a JSON array of map keys ("CC:code") to take out of the file.
 * Each one is removed, then put back only if its country has a derivation below
 * and that derivation, read from data/bic.sqlite, names exactly one BIC. The old
 * value is never consulted to choose: a key whose derivation is ambiguous or
 * empty stays out, even when one of the candidates is the BIC it held. Absence
 * is the answer the API already gives for a code it cannot pair, and it is
 * better than a pairing nobody granted us.
 *
 * Why (29/09/2026, decision of Claude-Alain on the licence inventory of the
 * map): part of the map had been imported from a third-party compilation whose
 * national files turned out to come, for eleven countries, from commercial
 * sites or from publishers that reserve commercial use. Those keys leave the
 * repository and the service. Italy and Romania are rebuilt from open data, and
 * the Irish, Latvian, Bulgarian and British keys of the same import (sources
 * not named) are re-derived the way the rest of those countries already are.
 *
 * The derivations:
 *  - IT, `it-lei`: the ABI code's LEI as the Banca d'Italia publishes it
 *    (national_bank_codes, CC BY 4.0), then the BIC GLEIF pairs with that LEI in
 *    Italy (bic_entries, source 'gleif', from the SWIFT BIC-to-LEI Mapping
 *    Table, whose notice NOTICE reproduces). Several BICs for one LEI: the one
 *    head-office BIC (ending XXX) if there is exactly one, else nothing.
 *  - RO, IE, LV, GB, `bic-prefix`: in these countries the IBAN bank code is the
 *    first four letters of the BIC. The one BIC8 of bic_entries that begins with
 *    the code, as BIC8 + XXX, the rule the map already applies to its other
 *    Irish and British keys. Several BIC8: nothing here, and the lookup's own
 *    prefix search answers with the number of candidates.
 *  - BG, `bg-bae`: the BIC the Bulgarian National Bank's BAE register gives the
 *    code (bg_bae, served with the BNB's written permission), when it gives one;
 *    otherwise the `bic-prefix` rule.
 *  - Every other country: no derivation, the key is withdrawn.
 *
 * The file is rewritten with the same serialisation (compact JSON, no final
 * newline) and every key it keeps stays in place.
 */
import Database from 'better-sqlite3';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Db = InstanceType<typeof Database>;

export type Derivation = 'it-lei' | 'bic-prefix' | 'bg-bae';

/** The derivation each country's keys are rebuilt with; absent means withdrawn. */
export const DERIVATION: Readonly<Record<string, Derivation>> = {
  IT: 'it-lei',
  RO: 'bic-prefix',
  IE: 'bic-prefix',
  LV: 'bic-prefix',
  GB: 'bic-prefix',
  BG: 'bg-bae',
};

export type Outcome =
  | { bic: string; reason?: undefined }
  | {
      bic: null;
      reason:
        | 'no_derivation'
        | 'not_in_register'
        | 'no_lei'
        | 'lei_without_bic'
        | 'ambiguous'
        | 'not_a_bic_prefix'
        | 'absent';
    };

const toBic11 = (bic: string): string => (bic.length === 8 ? `${bic}XXX` : bic);

/** One BIC, or the single head-office one among several, or nothing. */
function single(candidates: string[]): Outcome {
  const unique = [...new Set(candidates.map(toBic11))].sort();
  if (unique.length === 1) return { bic: unique[0]! };
  if (unique.length === 0) return { bic: null, reason: 'lei_without_bic' };
  const head = unique.filter((b) => b.endsWith('XXX'));
  return head.length === 1 ? { bic: head[0]! } : { bic: null, reason: 'ambiguous' };
}

export function deriveItalian(db: Db, code: string): Outcome {
  const row = db
    .prepare("SELECT lei FROM national_bank_codes WHERE country = 'IT' AND code = ?")
    .get(code) as { lei: string | null } | undefined;
  if (!row) return { bic: null, reason: 'not_in_register' };
  if (!row.lei) return { bic: null, reason: 'no_lei' };
  const bics = db
    .prepare(
      "SELECT bic11 FROM bic_entries WHERE source = 'gleif' AND country_code = 'IT' AND lei = ?",
    )
    .all(row.lei) as Array<{ bic11: string }>;
  return single(bics.map((b) => b.bic11));
}

export function derivePrefix(db: Db, cc: string, code: string): Outcome {
  if (!/^[A-Z]{4}$/.test(code)) return { bic: null, reason: 'not_a_bic_prefix' };
  const rows = db
    .prepare(
      'SELECT DISTINCT bic8 FROM bic_entries WHERE country_code = ? AND substr(bic8, 1, 4) = ?',
    )
    .all(cc, code) as Array<{ bic8: string }>;
  if (rows.length === 0) return { bic: null, reason: 'absent' };
  if (rows.length > 1) return { bic: null, reason: 'ambiguous' };
  return { bic: toBic11(rows[0]!.bic8) };
}

export function deriveBulgarian(db: Db, code: string): Outcome {
  const rows = db
    .prepare('SELECT DISTINCT bic FROM bg_bae WHERE bank_code = ? AND bic IS NOT NULL')
    .all(code) as Array<{ bic: string }>;
  const bics = [...new Set(rows.map((r) => toBic11(r.bic)))];
  if (bics.length === 1) return { bic: bics[0]! };
  if (bics.length > 1) return { bic: null, reason: 'ambiguous' };
  return derivePrefix(db, 'BG', code);
}

export function deriveKey(db: Db, key: string): Outcome {
  const cc = key.slice(0, key.indexOf(':'));
  const code = key.slice(cc.length + 1);
  switch (DERIVATION[cc]) {
    case 'it-lei':
      return deriveItalian(db, code);
    case 'bic-prefix':
      return derivePrefix(db, cc, code);
    case 'bg-bae':
      return deriveBulgarian(db, code);
    default:
      return { bic: null, reason: 'no_derivation' };
  }
}

type MapEntry = { bic: string; bank_name?: string; city?: string };

/**
 * The map with `keys` taken out and the derivable ones put back in place.
 * `report` counts, per country, the keys rebuilt with the same BIC, rebuilt
 * with another, and withdrawn with their reason.
 */
export function rebuild(
  db: Db,
  map: Record<string, MapEntry>,
  keys: Iterable<string>,
): { map: Record<string, MapEntry>; report: Record<string, Record<string, number>> } {
  const targets = new Set(keys);
  const report: Record<string, Record<string, number>> = {};
  const out: Record<string, MapEntry> = {};
  for (const [key, entry] of Object.entries(map)) {
    if (!targets.has(key)) {
      out[key] = entry;
      continue;
    }
    const cc = key.slice(0, key.indexOf(':'));
    const row = (report[cc] ??= {});
    const outcome = deriveKey(db, key);
    const column = outcome.bic
      ? outcome.bic === toBic11(entry.bic)
        ? 'same_bic'
        : 'other_bic'
      : `withdrawn_${outcome.reason}`;
    row[column] = (row[column] ?? 0) + 1;
    if (outcome.bic) out[key] = { bic: outcome.bic };
  }
  return { map: out, report };
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const mapPath = resolve(here, '../src/db/bic_data.json');
  const dbPath = process.env.BIC_DB_PATH ?? resolve(here, '../data/bic.sqlite');
  const [keysPath, flag] = process.argv.slice(2);
  if (!keysPath) {
    console.error('usage: derive-map-keys.ts <keys.json> [--write]');
    process.exit(2);
  }
  const keys = JSON.parse(readFileSync(keysPath, 'utf8')) as string[];
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as Record<string, MapEntry>;
  const missing = keys.filter((k) => !(k in map));
  if (missing.length > 0) {
    console.error(`${missing.length} of the keys are not in the map (already rebuilt?)`);
    process.exit(1);
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const { map: next, report } = rebuild(db, map, keys);
  db.close();
  for (const cc of Object.keys(report).sort()) console.log(cc, JSON.stringify(report[cc]));
  console.log(`keys: ${Object.keys(map).length} -> ${Object.keys(next).length}`);
  if (flag === '--write') {
    writeFileSync(mapPath, JSON.stringify(next));
    console.log(`written: ${mapPath}`);
  }
}

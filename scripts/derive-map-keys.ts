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
 * Adding keys the map does not hold (07/10/2026, the Italian codes the
 * rebuild of 29/09/2026 left without a BIC):
 *
 *   tsx scripts/derive-map-keys.ts <keys.json> --add [--ecb <mfi_csv_YYMMDD.csv>]
 *       [--trace <out.json>] [--write]
 *
 * With --add, a key absent from the map is derived the same way and added when
 * one BIC comes out; without it, an absent key stops the run (the guard against
 * rebuilding twice). --ecb names a daily MFI list of the European Central Bank
 * as downloaded (https://www.ecb.europa.eu/stats/money/mfi/general/html/dla/
 * mfi_MID/mfi_csv_YYMMDD.csv, dated by its name); --trace writes, per key, the
 * BIC and the chain of sources behind it, or why nothing came out.
 *
 * Why (29/09/2026, decision of Claude-Alain on the licence inventory of the
 * map): part of the map had been imported from a third-party compilation whose
 * national files turned out to come, for eleven countries, from commercial
 * sites or from publishers that reserve commercial use. Those keys leave the
 * repository and the service. The Italian and Romanian ones are rebuilt from
 * open data where it names one BIC.
 *
 * The derivations read GLEIF (bic_entries, source 'gleif': the BIC directory
 * rows whose BIC the SWIFT BIC-to-LEI Mapping Table pairs with an LEI, whose
 * notice NOTICE reproduces), never the SwiftCodes copy, whose rights are not
 * established:
 *  - IT, `it-lei`, in this order, the first that names one BIC winning:
 *    1. `gleif-lei`: the ABI code's LEI as the Banca d'Italia publishes it
 *       (national_bank_codes, CC BY 4.0), then the BIC GLEIF pairs with that
 *       LEI in Italy. Several BICs for one LEI: the one head-office BIC
 *       (ending XXX) if there is exactly one, else nothing.
 *    2. `ecb-head-office` (07/10/2026): the code's holder is the Italian branch
 *       of a foreign bank. The ECB's MFI list names that branch with the LEI of
 *       its head office (HEAD_LEI); the Italian BIC GLEIF pairs with that LEI,
 *       same rule. The branch row is found by the LEI the Banca d'Italia
 *       publishes, or, when it publishes none, by the exact name AND town,
 *       unique on both sides. A branch has no legal personality of its own:
 *       its Italian BIC belongs to the head office's LEI, which is why step 1
 *       finds nothing for it.
 *    3. `bank-site` (07/10/2026): the BIC the bank itself publishes on its own
 *       website (scripts/data/it-bank-site-bics.json, URL, date and quoted
 *       sentence for each). It may break a tie only between the head-office
 *       BICs GLEIF already names; a website naming another one is a conflict
 *       and nothing comes out. For a code the registers do not list (Poste
 *       Italiane, 07601), the quoted sentence must carry the code itself.
 *  - RO, `gleif-prefix`: in Romania the IBAN bank code is the first four
 *    letters of the BIC. The one Romanian BIC8 of GLEIF that begins with the
 *    code, as BIC8 + XXX. Several, or none: nothing here (the lookup's own
 *    prefix search still answers, naming its source and its candidates).
 *  - Every other country: no derivation, the key is withdrawn.
 *
 * The file is rewritten with the same serialisation (compact JSON, no final
 * newline) and every key it keeps stays in place; an added key goes right
 * after the last key of its country.
 */
import Database from 'better-sqlite3';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ECB_MFI_COLUMNS, decodeEcbCsv, normaliseLei } from './seed-ecb-mfi.js';

type Db = InstanceType<typeof Database>;

export type Derivation = 'it-lei' | 'gleif-prefix';

/** The derivation each country's keys are rebuilt with; absent means withdrawn. */
export const DERIVATION: Readonly<Record<string, Derivation>> = {
  IT: 'it-lei',
  RO: 'gleif-prefix',
};

/** Which source named the BIC, for the trace. */
export type Via = 'gleif-lei' | 'ecb-head-office' | 'bank-site' | 'gleif-prefix';

export type Reason =
  | 'no_derivation'
  | 'not_in_register'
  | 'no_lei'
  | 'lei_without_bic'
  | 'ambiguous'
  | 'bank_site_conflict'
  | 'not_a_bic_prefix'
  | 'absent';

export type Outcome =
  | { bic: string; via: Via; evidence?: Record<string, string>; reason?: undefined }
  | { bic: null; reason: Reason; via?: undefined };

/** A row of the ECB's daily MFI list registered in Italy, head-office columns included. */
export interface EcbItalianRow {
  riad_code: string;
  name: string;
  city: string;
  lei: string | null;
  head_lei: string | null;
}

/** What a website says, kept with the words that say it. */
export interface BankSiteBic {
  bic: string;
  holder: string;
  url: string;
  consulted: string;
  /** The bank's words, which must spell the BIC (spaces aside). */
  quote: string;
  /** Where the bank ties the code to itself, when the registers do not. */
  abi_url?: string;
  abi_quote?: string;
}

/** The sources beyond data/bic.sqlite that the Italian derivation may read. */
export interface ItalianSources {
  ecb?: { list_date: string; rows: EcbItalianRow[] };
  bankSites?: Readonly<Record<string, BankSiteBic>>;
}

const toBic11 = (bic: string): string => (bic.length === 8 ? `${bic}XXX` : bic);

/** Exact comparison, blind only to case and runs of spaces. */
const norm = (s: string | null | undefined): string =>
  (s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

type Single = { bic: string } | { bic: null; reason: 'lei_without_bic' | 'ambiguous' };

/** One BIC, or the single head-office one among several, or nothing. */
function single(candidates: string[]): Single {
  const unique = [...new Set(candidates.map(toBic11))].sort();
  if (unique.length === 1) return { bic: unique[0]! };
  if (unique.length === 0) return { bic: null, reason: 'lei_without_bic' };
  const head = unique.filter((b) => b.endsWith('XXX'));
  return head.length === 1 ? { bic: head[0]! } : { bic: null, reason: 'ambiguous' };
}

/** The Italian BICs GLEIF pairs with an LEI. */
function italianGleifBics(db: Db, lei: string): string[] {
  const rows = db
    .prepare(
      "SELECT bic11 FROM bic_entries WHERE source = 'gleif' AND country_code = 'IT' AND lei = ?",
    )
    .all(lei) as Array<{ bic11: string }>;
  return rows.map((r) => r.bic11);
}

/** The head-office BICs among several candidates: what a website may choose between. */
function headOffices(candidates: string[]): string[] {
  return [...new Set(candidates.map(toBic11))].filter((b) => b.endsWith('XXX'));
}

/**
 * Read the ECB's daily MFI list and keep the rows registered in Italy, with
 * the head-office columns the seeder of the ecb_mfi table leaves out. The
 * header is checked against the same pinned columns as the seeder.
 */
export function parseEcbItalianRows(text: string): EcbItalianRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = (lines[0] ?? '').split('\t').map((h) => h.trim());
  if (header.length !== ECB_MFI_COLUMNS.length || header.some((h, i) => h !== ECB_MFI_COLUMNS[i])) {
    throw new Error(`ECB MFI columns moved: [${header.join(', ')}]`);
  }
  const col = (name: (typeof ECB_MFI_COLUMNS)[number]) => ECB_MFI_COLUMNS.indexOf(name);
  const rows: EcbItalianRow[] = [];
  for (const line of lines.slice(1)) {
    const f = line.split('\t');
    if (f.length !== ECB_MFI_COLUMNS.length) {
      throw new Error(`ECB MFI row has ${f.length} fields, expected ${ECB_MFI_COLUMNS.length}`);
    }
    if (f[col('COUNTRY_OF_REGISTRATION')]!.trim() !== 'IT') continue;
    rows.push({
      riad_code: f[col('RIAD_CODE')]!.trim(),
      name: f[col('NAME')]!.trim(),
      city: f[col('CITY')]!.trim(),
      lei: normaliseLei(f[col('LEI')]),
      head_lei: normaliseLei(f[col('HEAD_LEI')]),
    });
  }
  return rows;
}

/**
 * The ECB row of the code's holder: by the LEI the Banca d'Italia publishes,
 * or, without one, by the exact name and town, the name unique among the
 * codes in force and the row unique in the list. Anything less is no row.
 */
function ecbRowFor(
  db: Db,
  rows: EcbItalianRow[],
  reg: { name: string; lei: string | null; town: string | null },
): EcbItalianRow | null {
  if (reg.lei) {
    const byLei = rows.filter((r) => r.lei === reg.lei);
    return byLei.length === 1 ? byLei[0]! : null;
  }
  const sameName = db
    .prepare("SELECT name FROM national_bank_codes WHERE country = 'IT'")
    .all() as Array<{ name: string }>;
  if (sameName.filter((r) => norm(r.name) === norm(reg.name)).length !== 1) return null;
  const byName = rows.filter(
    (r) => norm(r.name) === norm(reg.name) && norm(r.city) === norm(reg.town),
  );
  return byName.length === 1 ? byName[0]! : null;
}

export function deriveItalian(db: Db, code: string, sources: ItalianSources = {}): Outcome {
  const site = sources.bankSites?.[code];
  const row = db
    .prepare("SELECT name, lei, town FROM national_bank_codes WHERE country = 'IT' AND code = ?")
    .get(code) as { name: string; lei: string | null; town: string | null } | undefined;

  if (site && !site.quote.replace(/\s/g, '').includes(site.bic.slice(0, 8))) {
    throw new Error(`IT ${code}: the quoted words do not spell ${site.bic}`);
  }
  if (!row) {
    // Outside the registers, only the bank's own words can tie the code to it.
    if (site && (site.abi_quote ?? site.quote).includes(code)) {
      return { bic: toBic11(site.bic), via: 'bank-site', evidence: siteEvidence(site) };
    }
    return { bic: null, reason: 'not_in_register' };
  }

  // 1. The LEI the Banca d'Italia publishes.
  let failure: Reason = 'no_lei';
  let candidates: string[] = [];
  if (row.lei) {
    candidates = italianGleifBics(db, row.lei);
    const one = single(candidates);
    if (one.bic !== null) return { bic: one.bic, via: 'gleif-lei', evidence: { lei: row.lei } };
    failure = one.reason;
  }

  // 2. The head office the ECB names for an Italian branch.
  const ecb = sources.ecb;
  const branch = ecb ? ecbRowFor(db, ecb.rows, row) : null;
  if (ecb && branch?.head_lei) {
    const headCandidates = italianGleifBics(db, branch.head_lei);
    const one = single(headCandidates);
    if (one.bic !== null) {
      return {
        bic: one.bic,
        via: 'ecb-head-office',
        evidence: {
          ecb_riad_code: branch.riad_code,
          ecb_list_date: ecb.list_date,
          head_lei: branch.head_lei,
        },
      };
    }
    if (headCandidates.length > 0) {
      candidates = headCandidates;
      failure = one.reason;
    } else if (failure === 'no_lei') {
      // The ECB names the head office, and GLEIF pairs no Italian BIC with it.
      failure = 'lei_without_bic';
    }
  }

  // 3. The bank's own website, which may only choose among GLEIF's head offices.
  if (site) {
    const bic = toBic11(site.bic);
    const heads = headOffices(candidates);
    if (heads.length > 0 && !heads.includes(bic))
      return { bic: null, reason: 'bank_site_conflict' };
    if (candidates.length > 0 && heads.length === 0)
      return { bic: null, reason: 'bank_site_conflict' };
    return { bic, via: 'bank-site', evidence: siteEvidence(site) };
  }
  return { bic: null, reason: failure };
}

function siteEvidence(site: BankSiteBic): Record<string, string> {
  return {
    url: site.url,
    consulted: site.consulted,
    quote: site.quote,
    ...(site.abi_url ? { abi_url: site.abi_url } : {}),
    ...(site.abi_quote ? { abi_quote: site.abi_quote } : {}),
  };
}

export function derivePrefix(db: Db, cc: string, code: string): Outcome {
  if (!/^[A-Z]{4}$/.test(code)) return { bic: null, reason: 'not_a_bic_prefix' };
  const rows = db
    .prepare(
      "SELECT DISTINCT bic8 FROM bic_entries WHERE country_code = ? AND source = 'gleif' AND substr(bic8, 1, 4) = ?",
    )
    .all(cc, code) as Array<{ bic8: string }>;
  if (rows.length === 0) return { bic: null, reason: 'absent' };
  if (rows.length > 1) return { bic: null, reason: 'ambiguous' };
  return { bic: toBic11(rows[0]!.bic8), via: 'gleif-prefix' };
}

export function deriveKey(db: Db, key: string, sources: ItalianSources = {}): Outcome {
  const cc = key.slice(0, key.indexOf(':'));
  const code = key.slice(cc.length + 1);
  switch (DERIVATION[cc]) {
    case 'it-lei':
      return deriveItalian(db, code, sources);
    case 'gleif-prefix':
      return derivePrefix(db, cc, code);
    default:
      return { bic: null, reason: 'no_derivation' };
  }
}

type MapEntry = { bic: string; bank_name?: string; city?: string };

/**
 * The map with `keys` taken out and the derivable ones put back in place;
 * with `add`, the keys it does not hold are derived too and inserted after the
 * last key of their country. `report` counts, per country, the keys rebuilt
 * with the same BIC, rebuilt with another, withdrawn with their reason, added,
 * or left out with their reason; `trace` keeps each target key's outcome.
 */
export function rebuild(
  db: Db,
  map: Record<string, MapEntry>,
  keys: Iterable<string>,
  options: { add?: boolean; sources?: ItalianSources } = {},
): {
  map: Record<string, MapEntry>;
  report: Record<string, Record<string, number>>;
  trace: Record<string, Outcome>;
} {
  const targets = new Set(keys);
  const report: Record<string, Record<string, number>> = {};
  const trace: Record<string, Outcome> = {};
  const count = (cc: string, column: string) => {
    const row = (report[cc] ??= {});
    row[column] = (row[column] ?? 0) + 1;
  };
  const countryOf = (key: string) => key.slice(0, key.indexOf(':'));

  const added = new Map<string, Array<[string, MapEntry]>>();
  if (options.add) {
    for (const key of targets) {
      if (key in map) continue;
      const cc = countryOf(key);
      const outcome = deriveKey(db, key, options.sources);
      trace[key] = outcome;
      count(cc, outcome.bic ? 'added' : `not_added_${outcome.reason}`);
      if (outcome.bic) {
        const list = added.get(cc) ?? [];
        list.push([key, { bic: outcome.bic }]);
        added.set(cc, list);
      }
    }
  }
  const lastOf = new Map<string, string>();
  for (const key of Object.keys(map)) lastOf.set(countryOf(key), key);

  const out: Record<string, MapEntry> = {};
  for (const [key, entry] of Object.entries(map)) {
    if (!targets.has(key)) {
      out[key] = entry;
    } else {
      const cc = countryOf(key);
      const outcome = deriveKey(db, key, options.sources);
      trace[key] = outcome;
      const column = outcome.bic
        ? outcome.bic === toBic11(entry.bic)
          ? 'same_bic'
          : 'other_bic'
        : `withdrawn_${outcome.reason}`;
      count(cc, column);
      if (outcome.bic) out[key] = { bic: outcome.bic };
    }
    const cc = countryOf(key);
    if (lastOf.get(cc) === key) {
      for (const [k, e] of (added.get(cc) ?? []).sort(([a], [b]) => a.localeCompare(b))) {
        out[k] = e;
      }
      added.delete(cc);
    }
  }
  // Countries the map did not hold at all: at the end.
  for (const list of added.values()) {
    for (const [k, e] of list.sort(([a], [b]) => a.localeCompare(b))) out[k] = e;
  }
  return { map: out, report, trace };
}

/** The ECB list named on the command line, dated by its published file name. */
export function readEcbList(path: string): { list_date: string; rows: EcbItalianRow[] } {
  const m = /^mfi_csv_(\d{2})(\d{2})(\d{2})\.csv$/.exec(basename(path));
  if (!m) throw new Error(`--ecb expects the file as published, mfi_csv_YYMMDD.csv: ${path}`);
  const list_date = `20${m[1]}-${m[2]}-${m[3]}`;
  const rows = parseEcbItalianRows(decodeEcbCsv(readFileSync(path)));
  return { list_date, rows };
}

/** What each `via` of a trace rests on, with the credit its publisher asks for. */
export const TRACE_SOURCES: Readonly<Record<Via, string>> = {
  'gleif-lei':
    "Banca d'Italia, Albi ed elenchi di vigilanza (open data, CC BY 4.0): the LEI of the ABI code; GLEIF (CC0) and the BIC-to-LEI Mapping Table developed by SWIFT (notice in NOTICE): the BIC of that LEI in Italy.",
  'ecb-head-office':
    'Source: European Central Bank, list of monetary financial institutions (https://www.ecb.europa.eu/stats/money/mfi/general/html/index.en.html), whose information may be obtained free of charge on that website: the Italian branch and the LEI of its head office; GLEIF (CC0) and the BIC-to-LEI Mapping Table developed by SWIFT: the BIC of that LEI in Italy.',
  'bank-site': "The bank's own website, at the address and on the date given, in the words quoted.",
  'gleif-prefix': 'GLEIF (CC0) and the BIC-to-LEI Mapping Table developed by SWIFT.',
};

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const mapPath = resolve(here, '../src/db/bic_data.json');
  const sitesPath = resolve(here, 'data/it-bank-site-bics.json');
  const dbPath = process.env.BIC_DB_PATH ?? resolve(here, '../data/bic.sqlite');
  const args = process.argv.slice(2);
  const option = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const keysPath = args[0];
  if (!keysPath || keysPath.startsWith('--')) {
    console.error(
      'usage: derive-map-keys.ts <keys.json> [--add] [--ecb <mfi_csv_YYMMDD.csv>] [--trace <out.json>] [--write]',
    );
    process.exit(2);
  }
  const add = args.includes('--add');
  const keys = JSON.parse(readFileSync(keysPath, 'utf8')) as string[];
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as Record<string, MapEntry>;
  const missing = keys.filter((k) => !(k in map));
  if (!add && missing.length > 0) {
    console.error(
      `${missing.length} of the keys are not in the map (already rebuilt? --add adds them)`,
    );
    process.exit(1);
  }
  const ecbPath = option('--ecb');
  const sources: ItalianSources = {
    ...(ecbPath ? { ecb: readEcbList(ecbPath) } : {}),
    ...(existsSync(sitesPath)
      ? {
          bankSites: (
            JSON.parse(readFileSync(sitesPath, 'utf8')) as {
              codes: Record<string, BankSiteBic>;
            }
          ).codes,
        }
      : {}),
  };
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const { map: next, report, trace } = rebuild(db, map, keys, { add, sources });
  db.close();
  for (const cc of Object.keys(report).sort()) console.log(cc, JSON.stringify(report[cc]));
  console.log(`keys: ${Object.keys(map).length} -> ${Object.keys(next).length}`);
  const tracePath = option('--trace');
  if (tracePath) {
    const sorted = Object.fromEntries(Object.entries(trace).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(
      tracePath,
      `${JSON.stringify({ sources: TRACE_SOURCES, keys: sorted }, null, 2)}\n`,
    );
    console.log(`trace: ${tracePath}`);
  }
  if (args.includes('--write')) {
    writeFileSync(mapPath, JSON.stringify(next));
    console.log(`written: ${mapPath}`);
  }
}

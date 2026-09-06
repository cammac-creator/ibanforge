/**
 * Export the data behind the public country pages (/iban/{cc}, one page per
 * IBAN country) into frontend/data/countries.json.
 *
 * Same mechanics as export-register-pages.ts, and for the same reason: each
 * page prints "what the API answers for this country's example IBAN", and the
 * honest way to get that block is to ask the very same Hono app production
 * runs, in-process, on a scratch stats database. No network, no credits, no
 * production stats touched.
 *
 * What a page gets, per country: the ISO 13616 length, the BBAN layout field
 * by field with its SWIFT-notation charset (from the library's compiled
 * registry), the registry's example IBAN, the SEPA and VoP facts the API
 * serves, and the validate route's own answer to that example — including,
 * when we hold the national register, the bank behind the example's code.
 *
 * Run after the monthly register refresh (`npm run pages:export-countries`);
 * the JSON is committed so the frontend build needs nothing but the repository.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, '../frontend/data');

process.env.STATS_DB_PATH ??= resolve(here, '../data/.export-country-pages.stats.sqlite');
process.env.NODE_ENV = 'development';
process.env.IP_HASH_SECRET ??= 'export-country-pages-scratch';
process.env.RATE_LIMIT_PER_MIN = '1000000';

const { buildApp } = await import('../src/app.js');
const { generateOemKey } = await import('../src/lib/api-keys.js');
const {
  IBAN_LENGTHS,
  BBAN_STRUCTURE,
  EXAMPLE_IBANS,
  COUNTRY_NAMES,
  getBBANFieldSpec,
  getSepaInfo,
} = await import('../src/lib/countries.js');

type Json = Record<string, unknown>;

function pick(obj: Json | undefined, keys: string[]): Json | null {
  if (!obj) return null;
  const out: Json = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** The same trimmed block the register pages print: the route's answer, the fields a reader can act on. */
function apiBlock(answer: Json): Json {
  return {
    valid: answer.valid,
    country: answer.country ?? null,
    bic: pick(answer.bic as Json, [
      'code',
      'bank_name',
      'city',
      'source',
      'as_of',
      'basis',
      'authoritative',
      'lei',
    ]),
    bank_code_check: answer.bank_code_check ?? null,
    sepa: pick(answer.sepa as Json, [
      'member',
      'schemes',
      'vop_required',
      'vop_participant',
      'basis',
    ]),
    issuer: pick(answer.issuer as Json, ['type', 'name', 'classification']),
    risk_indicators: pick(answer.risk_indicators as Json, [
      'country_risk',
      'sepa_reachable',
      'vop_coverage',
      'test_bic',
    ]),
  };
}

const app = buildApp();
const key = generateOemKey(
  'export-country-pages@ibanforge.local',
  10_000_000,
  `cs_export_countries_${Date.now()}`,
  null,
);
if (!key.api_key) throw new Error('could not mint the export key');
const headers = { Authorization: `Bearer ${key.api_key}`, 'content-type': 'application/json' };

async function call(path: string, init?: RequestInit): Promise<Json> {
  const res = await app.request(path, {
    ...init,
    headers: { ...headers, ...(init?.headers as Json | undefined) },
  });
  const body = (await res.json()) as Json;
  if (res.status !== 200)
    throw new Error(`${path} -> ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

interface Field {
  /** bank_code | branch_code | account_number */
  name: string;
  /** 1-based position of the first character inside the IBAN (country code = 1, 2). */
  from: number;
  to: number;
  /** SWIFT notation of the field's charset, e.g. "8!n". */
  spec: string | null;
}

const countries: Json = {};
const codes = Object.keys(IBAN_LENGTHS).sort();
for (const cc of codes) {
  const structure = BBAN_STRUCTURE[cc];
  const example = EXAMPLE_IBANS[cc];
  if (!structure || !example) throw new Error(`${cc}: no structure or example in the library`);
  const fields: Field[] = [];
  const add = (name: string, range: [number, number] | undefined) => {
    if (!range) return;
    const [start, length] = range;
    fields.push({
      name,
      from: 5 + start,
      to: 4 + start + length,
      spec: getBBANFieldSpec(cc, start, length),
    });
  };
  add('bank_code', structure.bankCode);
  add('branch_code', structure.branchCode);
  add('account_number', structure.accountNumber);
  fields.sort((a, b) => a.from - b.from);
  const answer = await call('/v1/iban/validate', {
    method: 'POST',
    body: JSON.stringify({ iban: example }),
  });
  if (answer.valid !== true)
    throw new Error(`${cc}: the registry example ${example} is not valid for the API`);
  const check = answer.bank_code_check as Json | undefined;
  countries[cc] = {
    code: cc,
    name_en: COUNTRY_NAMES[cc] ?? cc,
    length: IBAN_LENGTHS[cc],
    fields,
    example,
    sepa: getSepaInfo(cc),
    /** The national register the API verified the example's bank code against, when it holds one. */
    register:
      check?.status === 'verified' && typeof check.register === 'string' ? check.register : null,
    api: apiBlock(answer),
  };
}

mkdirSync(OUT_DIR, { recursive: true });
const file = resolve(OUT_DIR, 'countries.json');
writeFileSync(
  file,
  JSON.stringify(
    {
      generated_at: new Date().toISOString().slice(0, 10),
      source: 'ISO 13616 registry (lengths, layouts, examples) + the IBANforge validate route',
      count: codes.length,
      countries,
    },
    null,
    1,
  ),
);
const withRegister = codes.filter((cc) => (countries[cc] as Json).register).length;
console.log(
  `${codes.length} countries written to ${file}; ${withRegister} verified against a national register`,
);

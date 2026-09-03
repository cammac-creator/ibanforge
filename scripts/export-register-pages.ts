/**
 * Export the data behind the public register pages (/blz/{blz} for Germany,
 * /iid/{iid} for Switzerland, /at/{code} for Austria, /be/{code} for Belgium)
 * into frontend/data/registers/*.json.
 *
 * ## Why the pages read a JSON and not the API at request time
 *
 * Each page shows "what the API answers for this code". The honest way to get
 * that is to ask the API itself, and the cheapest honest way is to ask it
 * IN-PROCESS: this script builds the very same Hono app production runs, mints
 * a throwaway key on a scratch stats database, and calls
 * `POST /v1/iban/validate` (one synthetic IBAN per BLZ) and
 * `GET /v1/ch/clearing/{iid}` (one call per IID) against the committed
 * registers in data/. No network, no credits, no production stats touched, and
 * the block printed on every page is byte-for-byte the route's own answer.
 *
 * Run after the monthly register refresh (`npm run pages:export`); the JSON is
 * committed so the frontend build needs nothing but the repository.
 *
 * ## The first batch
 *
 * Google's "scaled content" rule is the reason the pages ship in batches. The
 * first batch, the one the sitemap lists and the build pre-renders, is the
 * set a reader is most likely to look up: every German head-office BLZ (the
 * BIC ends in XXX) that is not retired, and every Swiss headquarters IID.
 * Every other code still has a page, rendered on demand, and joins the sitemap
 * once the first batch shows it earns its place.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, '../frontend/data/registers');

// A scratch stats DB so the in-process calls record nothing anyone reads.
process.env.STATS_DB_PATH ??= resolve(here, '../data/.export-register-pages.stats.sqlite');
// Not production: src/lib/stats.ts rightly refuses to pseudonymise IPs with a
// default salt in production, and this run has no client IPs at all.
process.env.NODE_ENV = 'development';
process.env.IP_HASH_SECRET ??= 'export-register-pages-scratch';
// The in-process calls all come from the same non-address; the per-minute
// limiter would stop the export after its first window.
process.env.RATE_LIMIT_PER_MIN = '1000000';

const { buildApp } = await import('../src/app.js');
const { generateOemKey } = await import('../src/lib/api-keys.js');
const { getBicDB } = await import('../src/lib/db.js');

/** ISO 13616 check digits for country + bban (mod 97, chunked to stay in Number). */
function checkDigits(country: string, bban: string): string {
  const rearranged = `${bban}${country}00`;
  let expanded = '';
  for (const ch of rearranged) {
    expanded += /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
  }
  let rem = 0;
  for (let i = 0; i < expanded.length; i += 7) {
    rem = Number(`${rem}${expanded.slice(i, i + 7)}`) % 97;
  }
  return String(98 - rem).padStart(2, '0');
}

interface BlzRow {
  blz: string;
  name: string;
  short_name: string | null;
  bic: string | null;
  post_code: string | null;
  town: string | null;
  retired: number;
  successor_blz: string | null;
  updated_at: string;
}

interface IidRow {
  iid: string;
  valid_on: string;
  concatenation: number | null;
  redirect_iid: string | null;
  sic_iid: string | null;
  headquarters_iid: string | null;
  iid_type: number | null;
  qr_iid: string | null;
  name: string;
  street: string | null;
  building_number: string | null;
  post_code: string | null;
  town: string | null;
  country: string | null;
  bic: string | null;
  sic_participation: number | null;
  rtgs_chf: number | null;
  ip_chf: number | null;
  eurosic_participation: number | null;
  lsv_bdd_chf: number | null;
  lsv_bdd_eur: number | null;
  updated_at: string;
}

type Json = Record<string, unknown>;

function pick(obj: Json | undefined, keys: string[]): Json | null {
  if (!obj) return null;
  const out: Json = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** The api block every register page prints: the route's own answer, trimmed to the fields a reader can act on. */
function apiBlock(answer: Json): Json {
  return {
    valid: answer.valid,
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
  'export-register-pages@ibanforge.local',
  10_000_000,
  `cs_export_${Date.now()}`,
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

// ---------------------------------------------------------------------------
// Germany: one synthetic IBAN per BLZ, the validate route's own answer
// ---------------------------------------------------------------------------
const bic = getBicDB();
const blzRows = bic
  .prepare(
    'SELECT blz, name, short_name, bic, post_code, town, retired, successor_blz, updated_at FROM de_blz ORDER BY blz',
  )
  .all() as BlzRow[];
const byBic8 = new Map<string, string[]>();
for (const r of blzRows) {
  if (!r.bic || r.retired) continue;
  const k = r.bic.slice(0, 8);
  byBic8.set(k, [...(byBic8.get(k) ?? []), r.blz]);
}
const de: Json = {};
const deBatch1: string[] = [];
for (const r of blzRows) {
  const bban = `${r.blz}1000000000`;
  const iban = `DE${checkDigits('DE', bban)}${bban}`;
  const answer = await call('/v1/iban/validate', {
    method: 'POST',
    body: JSON.stringify({ iban }),
  });
  const related = (r.bic ? (byBic8.get(r.bic.slice(0, 8)) ?? []) : [])
    .filter((b) => b !== r.blz)
    .slice(0, 12);
  de[r.blz] = {
    register: {
      blz: r.blz,
      name: r.name,
      short_name: r.short_name,
      bic: r.bic,
      post_code: r.post_code,
      town: r.town,
      retired: r.retired === 1,
      successor_blz: r.successor_blz,
      as_of: r.updated_at.slice(0, 7),
    },
    example_iban: iban,
    api: apiBlock(answer),
    related,
  };
  if (!r.retired && r.bic && r.bic.endsWith('XXX')) deBatch1.push(r.blz);
}

// ---------------------------------------------------------------------------
// Switzerland: the clearing route's own answer per IID
// ---------------------------------------------------------------------------
const iidRows = bic
  .prepare(
    'SELECT iid, valid_on, concatenation, redirect_iid, sic_iid, headquarters_iid, iid_type, qr_iid, name, street, building_number, post_code, town, country, bic, sic_participation, rtgs_chf, ip_chf, eurosic_participation, lsv_bdd_chf, lsv_bdd_eur, updated_at FROM ch_clearing ORDER BY iid',
  )
  .all() as IidRow[];
const byHq = new Map<string, string[]>();
for (const r of iidRows) {
  if (!r.headquarters_iid) continue;
  byHq.set(r.headquarters_iid, [...(byHq.get(r.headquarters_iid) ?? []), r.iid]);
}
const ch: Json = {};
const chBatch1: string[] = [];
let chSkipped = 0;
for (const r of iidRows) {
  const answer = await call(`/v1/ch/clearing/${r.iid}`);
  if (answer.found !== true) {
    chSkipped++;
    continue; // redirected or empty rows answer through their target; no page of their own
  }
  const api: Json = { ...answer };
  delete api.cost_usdc;
  delete api.processing_ms;
  const bban = `${r.iid}${'1'.padStart(12, '0')}`;
  const iban = `CH${checkDigits('CH', bban)}${bban}`;
  const related = (r.headquarters_iid ? (byHq.get(r.headquarters_iid) ?? []) : [])
    .filter((i) => i !== r.iid)
    .slice(0, 12);
  ch[r.iid] = {
    register: {
      iid: r.iid,
      name: r.name,
      town: r.town,
      post_code: r.post_code,
      iid_type: r.iid_type,
      headquarters_iid: r.headquarters_iid,
      redirect_iid: r.redirect_iid,
      qr_iid: r.qr_iid,
      bic: r.bic,
      valid_on: r.valid_on,
    },
    example_iban: iban,
    api,
    related,
  };
  if (r.iid_type === 1) chBatch1.push(r.iid);
}

// ---------------------------------------------------------------------------
// Austria and Belgium: one synthetic IBAN per national bank code, the
// validate route's own answer. Both registers live in national_bank_codes
// (OeNB directory, NBB list); the edition date is the one the route stamps.
// ---------------------------------------------------------------------------
interface NationalRow {
  country: string;
  code: string;
  name: string;
  bic: string | null;
  street: string | null;
  post_code: string | null;
  town: string | null;
  lei: string | null;
}
const nationalRows = bic
  .prepare(
    "SELECT country, code, name, bic, street, post_code, town, lei FROM national_bank_codes WHERE country IN ('AT', 'BE') ORDER BY country, code",
  )
  .all() as NationalRow[];
const stamp = new Date().toISOString().slice(0, 7);
const asOf = (answer: Json): string =>
  ((answer.bank_code_check as Json | undefined)?.as_of as string | undefined) ?? stamp;
const registerName = (answer: Json, fallback: string): string =>
  ((answer.bank_code_check as Json | undefined)?.register as string | undefined) ?? fallback;

// Austria: five-digit Bankleitzahl, positions 5 to 9 of the IBAN, then an
// eleven-digit account. Related codes are the other codes of the same BIC8.
const atRows = nationalRows.filter((r) => r.country === 'AT');
const atByBic8 = new Map<string, string[]>();
for (const r of atRows) {
  if (!r.bic) continue;
  const k = r.bic.slice(0, 8);
  atByBic8.set(k, [...(atByBic8.get(k) ?? []), r.code]);
}
const at: Json = {};
let atSource = 'Oesterreichische Nationalbank SEPA-Zahlungsverkehrs-Verzeichnis';
for (const r of atRows) {
  const bban = `${r.code}00000000001`;
  const iban = `AT${checkDigits('AT', bban)}${bban}`;
  const answer = await call('/v1/iban/validate', {
    method: 'POST',
    body: JSON.stringify({ iban }),
  });
  if (answer.valid !== true) throw new Error(`AT ${r.code}: synthetic IBAN ${iban} is not valid`);
  atSource = registerName(answer, atSource);
  const related = (r.bic ? (atByBic8.get(r.bic.slice(0, 8)) ?? []) : [])
    .filter((c) => c !== r.code)
    .slice(0, 12);
  at[r.code] = {
    register: {
      code: r.code,
      name: r.name,
      bic: r.bic,
      street: r.street,
      post_code: r.post_code,
      town: r.town,
      lei: r.lei,
      as_of: asOf(answer),
    },
    example_iban: iban,
    api: apiBlock(answer),
    related,
  };
}
// First batch: every institution once (first code per BIC8) before any
// institution twice, capped so the batch stays a list a reader would look up.
const AT_BATCH_CAP = 400;
const seenBic8 = new Set<string>();
const atFirst: string[] = [];
const atRest: string[] = [];
for (const r of atRows) {
  if (!r.bic) continue;
  const k = r.bic.slice(0, 8);
  if (seenBic8.has(k)) atRest.push(r.code);
  else {
    seenBic8.add(k);
    atFirst.push(r.code);
  }
}
const atBatch1 = [...atFirst, ...atRest].slice(0, AT_BATCH_CAP);

// Belgium: three-digit bank identifier, seven-digit account, two national
// check digits (the first ten digits modulo 97, 97 when the remainder is 0).
// The NBB allocates blocks of identifiers to one institution, so one page per
// code would be the same page a hundred times over: every code keeps its
// address, but the first code of a block is the bank's canonical page and the
// others point to it.
const beRows = nationalRows.filter((r) => r.country === 'BE');
const groupKey = (r: NationalRow): string => `${r.name}|${r.bic ?? ''}`;
const beGroups = new Map<string, string[]>();
for (const r of beRows) beGroups.set(groupKey(r), [...(beGroups.get(groupKey(r)) ?? []), r.code]);
const be: Json = {};
let beSource = 'Banque nationale de Belgique, identification des banques';
for (const r of beRows) {
  const account = '0000001';
  const nationalCheck = String(Number(`${r.code}${account}`) % 97 || 97).padStart(2, '0');
  const bban = `${r.code}${account}${nationalCheck}`;
  const iban = `BE${checkDigits('BE', bban)}${bban}`;
  const answer = await call('/v1/iban/validate', {
    method: 'POST',
    body: JSON.stringify({ iban }),
  });
  if (answer.valid !== true) throw new Error(`BE ${r.code}: synthetic IBAN ${iban} is not valid`);
  beSource = registerName(answer, beSource);
  const group = beGroups.get(groupKey(r)) ?? [r.code];
  be[r.code] = {
    register: {
      code: r.code,
      name: r.name,
      bic: r.bic,
      canonical: group[0],
      group_codes: group,
      as_of: asOf(answer),
    },
    example_iban: iban,
    api: apiBlock(answer),
    related: group.filter((c) => c !== r.code).slice(0, 12),
  };
}
const beBatch1 = [...beGroups.values()].map((codes) => codes[0]);

mkdirSync(OUT_DIR, { recursive: true });
const generated_at = new Date().toISOString().slice(0, 10);
writeFileSync(
  resolve(OUT_DIR, 'de-blz.json'),
  JSON.stringify({
    generated_at,
    source: 'Deutsche Bundesbank Bankleitzahlendatei',
    count: Object.keys(de).length,
    batch1: deBatch1,
    entries: de,
  }),
);
writeFileSync(
  resolve(OUT_DIR, 'ch-iid.json'),
  JSON.stringify({
    generated_at,
    source: 'SIX BankMaster',
    count: Object.keys(ch).length,
    batch1: chBatch1,
    entries: ch,
  }),
);
writeFileSync(
  resolve(OUT_DIR, 'at-blz.json'),
  JSON.stringify({
    generated_at,
    source: atSource,
    count: Object.keys(at).length,
    batch1: atBatch1,
    entries: at,
  }),
);
writeFileSync(
  resolve(OUT_DIR, 'be-bank.json'),
  JSON.stringify({
    generated_at,
    source: beSource,
    count: Object.keys(be).length,
    batch1: beBatch1,
    entries: be,
  }),
);
console.log(`de-blz.json: ${Object.keys(de).length} BLZ, batch1 ${deBatch1.length}`);
console.log(`at-blz.json: ${Object.keys(at).length} codes, batch1 ${atBatch1.length}`);
console.log(
  `be-bank.json: ${Object.keys(be).length} codes in ${beGroups.size} institutions, batch1 ${beBatch1.length}`,
);
console.log(
  `ch-iid.json: ${Object.keys(ch).length} IID (${chSkipped} rows without a page of their own), batch1 ${chBatch1.length}`,
);

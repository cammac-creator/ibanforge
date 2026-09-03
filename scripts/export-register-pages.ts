/**
 * Export the data behind the public register pages (/blz/{blz} for Germany,
 * /iid/{iid} for Switzerland) into frontend/data/registers/*.json.
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
    api: {
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
    },
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
console.log(`de-blz.json: ${Object.keys(de).length} BLZ, batch1 ${deBatch1.length}`);
console.log(
  `ch-iid.json: ${Object.keys(ch).length} IID (${chSkipped} rows without a page of their own), batch1 ${chBatch1.length}`,
);

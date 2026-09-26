/**
 * Export the data behind the public register pages (/blz/{blz} for Germany,
 * /iid/{iid} for Switzerland, /sk/{code} for Slovakia, /it/{code} for Italy)
 * into frontend/data/registers/*.json.
 *
 * ## Austria, Belgium and San Marino are not exported any more
 *
 * Since the withdrawal step (25/09/2026), their registers belong to the
 * restricted family (src/lib/restricted-family.ts): the API serves them from a
 * private overlay, and nothing in this public repository may carry their rows.
 * Their pages (/at, /be, /sm) are rendered on demand by the site, one code per
 * request, from the API's own answer (frontend/lib/register-live.ts). This
 * script writes no file for them, and the monthly refresh deletes nothing it
 * did not write.
 *
 * ## No EPC-derived field in the exported answers
 *
 * The block printed on each page used to carry `sepa.schemes`,
 * `sepa.vop_participant` and `sepa.basis`, read from the EPC scheme and VoP
 * registers: a copy of those registers, one bank per page, in a public file.
 * They are restricted too. The block keeps the country-level SEPA facts
 * (`member`, `vop_required`), which come from the ISO registry and the IPR, not
 * from the EPC.
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
 *
 * Slovakia (38 codes) has no batch at all: at that size the batch IS the
 * register, and the rule this section exists for does not bite.
 *
 * L'Italie (/it/{code}, 25/09/2026) : le premier lot est l'ensemble des codes en
 * vigueur ; les codes que la Banca d'Italia a radiés ont aussi leur page, rendue
 * à la demande et hors du plan du site, parce que c'est là qu'un lecteur qui
 * tape un ancien code apprend sa radiation et son successeur légal.
 *
 * ## Un seul pays, quand on le nomme
 *
 *   npm run pages:export          # tous les registres, comme avant
 *   npm run pages:export -- IT    # n'écrit que it-bank.json
 *
 * La relecture hebdomadaire du registre italien (refresh-it-register.yml)
 * réexporte ses pages sans réécrire les fichiers des autres registres, qui ne
 * sont rafraîchis que par le cycle mensuel. Toutes les réponses sont quand même
 * calculées (quelques secondes) : le filtre ne porte que sur l'écriture, ce qui
 * laisse chaque section de ce fichier telle qu'elle était.
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
const { computeItalianCin } = await import('../src/lib/national-check/it-cin.js');

/** `npm run pages:export -- IT` : le pays dont on écrit le fichier ; tous sans argument. */
const ONLY = process.argv[2]?.toUpperCase() ?? null;
const wants = (cc: string): boolean => !ONLY || ONLY === cc;

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
      // Same reason as the country pages: `code` is 8 or 11 characters, and
      // `bic8` is the field a reader compares a supplied BIC against.
      'bic8',
      'redirected_from',
      'bank_name',
      'city',
      'source',
      'as_of',
      'basis',
      'authoritative',
      'lei',
    ]),
    bank_code_check: answer.bank_code_check ?? null,
    // Country-level facts only: the bank-level fields come from the EPC
    // registers, which this public file must not copy (see the header).
    sepa: pick(answer.sepa as Json, ['member', 'vop_required']),
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
// Slovakia: one synthetic IBAN per national bank code, the validate route's own
// answer. The register lives in national_bank_codes (NBS prevodník) and carries
// its own edition date. Austria, Belgium and San Marino share the table but not
// the licence: they are restricted, and exported nowhere (see the header).
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
  /** The credit its licence requires, and the edition date. */
  source: string | null;
  as_of: string | null;
}
const nationalRows = bic
  .prepare(
    "SELECT country, code, name, bic, street, post_code, town, lei, source, as_of FROM national_bank_codes WHERE country = 'SK' ORDER BY country, code",
  )
  .all() as NationalRow[];
const registerName = (answer: Json, fallback: string): string =>
  ((answer.bank_code_check as Json | undefined)?.register as string | undefined) ?? fallback;

// Slovakia: four-digit payment code in IBAN positions 5-8, then a six-digit
// account prefix and a ten-digit account number. No national check digits —
// the mod-97 of the IBAN is the only checksum a Slovak BBAN carries.
//
// The whole register is 38 codes, so there is no first batch to choose: every
// code is a payment service provider a reader may genuinely look up, and the
// "scaled content" concern the German batch exists for does not
// arise at this size. batch1 is the register.
//
// `related` groups by BIC8, and comes out EMPTY for every
// Slovak code (measured 06/09/2026): no two codes share a BIC8 — 3100 and 5600
// are one bank under two different BICs, and the Fio and J&T pairs are separate
// Czech and Slovak entities. An empty list is the truthful answer, and with 38
// codes the index page already IS the neighbour list.
const skRows = nationalRows.filter((r) => r.country === 'SK');
const skByBic8 = new Map<string, string[]>();
for (const r of skRows) {
  if (!r.bic) continue;
  const k = r.bic.slice(0, 8);
  skByBic8.set(k, [...(skByBic8.get(k) ?? []), r.code]);
}
const sk: Json = {};
let skSource =
  'Národná banka Slovenska, prevodník of identification codes for the domestic payment system';
for (const r of skRows) {
  const bban = `${r.code}0000000000000001`;
  const iban = `SK${checkDigits('SK', bban)}${bban}`;
  const answer = await call('/v1/iban/validate', {
    method: 'POST',
    body: JSON.stringify({ iban }),
  });
  if (answer.valid !== true) throw new Error(`SK ${r.code}: synthetic IBAN ${iban} is not valid`);
  skSource = registerName(answer, skSource);
  const related = (r.bic ? (skByBic8.get(r.bic.slice(0, 8)) ?? []) : [])
    .filter((c) => c !== r.code)
    .slice(0, 12);
  sk[r.code] = {
    register: {
      code: r.code,
      name: r.name,
      bic: r.bic,
      // The FULL effective date and the credit string, both straight from the
      // row: the NBS terms make naming the source a condition of reuse, and the
      // page has to be able to print the citation without rebuilding it. The
      // year-month the API stamps is in the `api` block beside it and answers a
      // different question.
      as_of: r.as_of,
      source: r.source,
    },
    example_iban: iban,
    api: apiBlock(answer),
    related,
  };
}
const skBatch1 = skRows.map((r) => r.code);

// ---------------------------------------------------------------------------
// Italie : un IBAN synthétique par code ABI, la réponse de la route elle-même
// (25/09/2026). Un CIN (lettre de contrôle sur l'ABI, le CAB et le compte) puis
// cinq chiffres d'ABI, cinq de CAB, douze de compte ; guichet et compte inventés,
// ceux des IBAN de l'étude du 24/09/2026, avec leur CIN calculé : l'API contrôle
// aussi cette lettre, et un exemple faux répondrait `fail` sur nos propres pages.
//
// Deux sortes de codes, deux tables : ceux que la Banca d'Italia tient en vigueur
// (`national_bank_codes`, le premier lot) et ceux qu'elle a radiés
// (`national_bank_codes_retired`), dont la page dit la date et le successeur
// légal. Un registre partiel : les pages le disent.
// ---------------------------------------------------------------------------
interface ItalianRow {
  code: string;
  name: string;
  street: string | null;
  post_code: string | null;
  town: string | null;
  lei: string | null;
  source: string | null;
  as_of: string | null;
}
interface ItalianRetiredRow {
  code: string;
  name: string;
  retired_on: string;
  successor_code: string | null;
  successor_name: string | null;
  source: string | null;
  as_of: string | null;
}
const itInForce = bic
  .prepare(
    "SELECT code, name, street, post_code, town, lei, source, as_of FROM national_bank_codes WHERE country = 'IT' ORDER BY code",
  )
  .all() as ItalianRow[];
const itRetired = bic
  .prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'national_bank_codes_retired'",
  )
  .get()
  ? (bic
      .prepare(
        "SELECT code, name, retired_on, successor_code, successor_name, source, as_of FROM national_bank_codes_retired WHERE country = 'IT' ORDER BY code",
      )
      .all() as ItalianRetiredRow[])
  : [];

/**
 * Un IBAN italien valide pour un code ABI, CIN compris (calculé par le module
 * que l'API applique, comme pour Saint-Marin plus haut), sur le guichet et le
 * compte de l'étude.
 */
function italianIban(code: string): string {
  const cin = computeItalianCin(code, '01600', '000000123456');
  if (!cin) throw new Error(`IT ${code}: the ABI code is not five digits`);
  const bban = `${cin}${code}01600000000123456`;
  return `IT${checkDigits('IT', bban)}${bban}`;
}

const itEntries: Json = {};
let itSource = "Banca d'Italia, registers of banks, payment institutions and e-money institutions";
for (const r of itInForce) {
  const iban = italianIban(r.code);
  const answer = await call('/v1/iban/validate', {
    method: 'POST',
    body: JSON.stringify({ iban }),
  });
  if (answer.valid !== true) throw new Error(`IT ${r.code}: synthetic IBAN ${iban} is not valid`);
  itSource = registerName(answer, itSource);
  itEntries[r.code] = {
    register: {
      code: r.code,
      status: 'in_force',
      name: r.name,
      street: r.street,
      post_code: r.post_code,
      town: r.town,
      lei: r.lei,
      // L'édition entière et le crédit, lus dans la ligne : la licence CC BY 4.0
      // demande de citer la source, et la page imprime la citation sans la
      // reconstruire.
      as_of: r.as_of,
      source: r.source,
    },
    example_iban: iban,
    api: apiBlock(answer),
    related: [],
  };
}
for (const r of itRetired) {
  const iban = italianIban(r.code);
  const answer = await call('/v1/iban/validate', {
    method: 'POST',
    body: JSON.stringify({ iban }),
  });
  if (answer.valid !== true) throw new Error(`IT ${r.code}: synthetic IBAN ${iban} is not valid`);
  itEntries[r.code] = {
    register: {
      code: r.code,
      status: 'retired',
      name: r.name,
      retired_on: r.retired_on,
      successor_code: r.successor_code,
      successor_name: r.successor_name,
      as_of: r.as_of,
      source: r.source,
    },
    example_iban: iban,
    api: apiBlock(answer),
    related: [],
  };
}
// Le premier lot, pré-rendu et listé : les codes en vigueur. Les codes radiés
// restent rendus à la demande, pour qui tape un ancien code.
const itBatch1 = itInForce.map((r) => r.code);

mkdirSync(OUT_DIR, { recursive: true });
const generated_at = new Date().toISOString().slice(0, 10);
if (wants('DE'))
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
if (wants('CH'))
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
if (wants('SK'))
  writeFileSync(
    resolve(OUT_DIR, 'sk-bank.json'),
    JSON.stringify({
      generated_at,
      source: skSource,
      count: Object.keys(sk).length,
      batch1: skBatch1,
      entries: sk,
    }),
  );
// Pas de fichier vide : une base sans registre italien laisse it-bank.json tel
// qu'il était, plutôt que d'effacer les pages.
if (wants('IT')) {
  if (itInForce.length === 0) {
    console.warn('it-bank.json: no Italian register in this database, file left as it was');
  } else {
    writeFileSync(
      resolve(OUT_DIR, 'it-bank.json'),
      JSON.stringify({
        generated_at,
        source: itSource,
        count: Object.keys(itEntries).length,
        batch1: itBatch1,
        entries: itEntries,
      }),
    );
    console.log(
      `it-bank.json: ${itInForce.length} codes in force (batch1), ${itRetired.length} struck off`,
    );
  }
}
if (!ONLY) {
  console.log(`de-blz.json: ${Object.keys(de).length} BLZ, batch1 ${deBatch1.length}`);
  console.log(
    `sk-bank.json: ${Object.keys(sk).length} codes, batch1 ${skBatch1.length}, ` +
      `${skRows.filter((r) => r.bic).length} carrying a BIC`,
  );
  console.log(
    `ch-iid.json: ${Object.keys(ch).length} IID (${chSkipped} rows without a page of their own), batch1 ${chBatch1.length}`,
  );
}

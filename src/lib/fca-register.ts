import { createRequire } from 'node:module';
import { getStatsDB } from './db.js';

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../../package.json') as { version: string };

/**
 * FCA Financial Services Register — one firm per request, by Firm Reference
 * Number, under the permission the FCA's Register Team gave in writing on
 * 07/09/2026 (docs/data-sources.md, "la FCA accepte l'usage décrit").
 *
 * ## The four conditions, and where each one is kept in this file
 *
 * 1. **The Register API Terms of Use and the published rate limits, without
 *    circumvention.** One request in flight at a time and a floor between two
 *    calls (`MIN_INTERVAL_MS`), a 429 or 503 honoured with a single wait and
 *    then a fall-back on what we already hold — never a retry storm. See
 *    `pace()` and `fetchFirm()`. The limit itself is NOT written here as a
 *    fact: the portal publishes it, and this file only knows what third-party
 *    clients report (ten requests per ten seconds). The constant is to be
 *    aligned on the portal's own figure the day the key lands.
 * 2. **No marketing use.** This module writes nowhere but its own cache
 *    table, and `fca-register.marketing-guard.test.ts` fails the suite if a
 *    CRM or prospecting module ever imports it. The data answers a caller's
 *    question about one firm; it is never used to find, rank, or write to the
 *    firms in the dataset.
 * 3. **We are the controller (GDPR) of what we receive.** Only the firm-level
 *    resource is ever called — `/Firm/{frn}`, nothing under `/Individuals`,
 *    `/CF` or a search by individual — so no personal data enters the
 *    process. What is stored is one firm row per FRN, for a day.
 * 4. **The FCA accepts no liability.** Every answer carries the FCA's own
 *    exclusion and names the register as the record that prevails
 *    (`FCA_DISCLAIMER`); nothing here claims an endorsement.
 *
 * The usage described to the FCA and accepted by it: one request = one firm;
 * name, FRN, status, the credit "Source: FCA Financial Services Register" and
 * the retrieval date on every answer; no comparison table, no list, no bulk
 * copy; a cache of one day at most; no claim of endorsement.
 *
 * ## The API, as confirmed from public sources on 07/09/2026
 *
 * The developer portal (https://register.fca.org.uk/Developer/s/) is a
 * Salesforce application that renders nothing without a browser, so the
 * request and response shapes below were confirmed from open-source clients
 * that record real exchanges:
 *   - https://github.com/CyborgFinance/FCARegisterLaravel — base URL, the
 *     `x-auth-email` / `x-auth-key` headers, the `Firm/{FRN}` example with
 *     its object definition, and the ten-per-ten-seconds figure.
 *   - https://github.com/release-art/fca-api — the status-code table
 *     (`FSR-API-02-01-00` found, `-11` not found, `-21` bad request;
 *     `FSR-API-01-01-11` unauthorised, `-21` credential unknown) and
 *     exchanges recorded on 27/02/2026 for a found and a not-found firm.
 *   - https://github.com/craigpotter/fca-php-sdk — a not-found exchange
 *     recorded on 14/06/2023: HTTP 200, `Data: null`.
 *
 * What they agree on: HTTP 200 for a hit AND for a miss, the verdict living in
 * `Status`; dates as `dd/mm/yyyy` (older recordings show `Wed Sep 01 00:00:00
 * GMT 2004`, handled too); the firm's name under `Organisation Name`, while
 * `Name` is the URL of the trading-names sub-resource. Every key of the 2026
 * recording is mapped in `mapFirm`; a key that disappears reads as null, and
 * an unknown `Status` is a failure, never a guess.
 */

export const FCA_REGISTER_BASE = 'https://register.fca.org.uk/services/V0.1';
export const FCA_SOURCE = 'FCA Financial Services Register';
export const FCA_REGISTER_URL = 'https://register.fca.org.uk/';

/** Condition "cache ≤ 24 h", as described to the FCA. */
export const FCA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long past its expiry a row may still answer, marked `stale`, when the
 * register itself is down. Six hours: long enough to ride out an outage,
 * short enough that nothing older than thirty hours is ever served. Set to 0
 * to hold the letter of the "24 h" described to the FCA and answer 502
 * instead; the choice is documented in docs/data-sources.md.
 */
export const FCA_STALE_GRACE_MS = 6 * 60 * 60 * 1000;

/**
 * Floor between two calls to the register, one call in flight at a time.
 *
 * ⚠️ To align on the limit published in the FS Developer portal the day the
 * key lands. Third-party clients report ten requests per ten seconds; 1 100 ms
 * keeps a single instance under nine, with the daily cache absorbing repeats.
 */
export const MIN_INTERVAL_MS = 1100;

/** The one wait honoured after a 429 or 503, capped whatever Retry-After says. */
export const MAX_RETRY_WAIT_MS = 2000;
const DEFAULT_RETRY_WAIT_MS = 1500;

/** Condition 4, served verbatim on every answer. */
export const FCA_DISCLAIMER =
  'Data from the Financial Services Register, made available by the Financial Conduct Authority ' +
  'without warranty and with no liability accepted by the FCA. The register at register.fca.org.uk ' +
  'is the record that prevails: this answer is a dated copy of one firm entry and implies no ' +
  'endorsement by the FCA of IBANforge or of the firm.';

/** Firm Reference Numbers are six digits, seven for the newest registrations. */
export const FRN_PATTERN = /^\d{6,7}$/;

const USER_AGENT = `IBANforge/${PKG_VERSION} (+https://ibanforge.com; FCA Register API, per-firm lookups under the Terms of Use)`;

/** The public register page for a firm: the search by FRN, which needs no internal id. */
export function firmRegisterUrl(frn: string): string {
  return `https://register.fca.org.uk/s/search?q=${encodeURIComponent(frn)}&type=Companies`;
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export interface FcaCredentials {
  /** The account e-mail: the portal makes it the API identifier. */
  email: string;
  key: string;
}

/**
 * Both variables, or nothing. Read on every call rather than at import: the
 * variables exist in production only, and the API must boot on a laptop and
 * in CI without them.
 */
export function fcaCredentials(): FcaCredentials | null {
  const key = process.env.FCA_REGISTER_API_KEY?.trim();
  const email = process.env.FCA_REGISTER_API_EMAIL?.trim();
  if (!key || !email) return null;
  return { email, key };
}

export function isFcaRegisterConfigured(): boolean {
  return fcaCredentials() !== null;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface FcaFirmNotice {
  /** "Exceptional Info Title" as the register words it, e.g. "CAUTION". */
  title: string;
  body: string;
}

/**
 * One firm, every field the register publishes on `/Firm/{frn}`, in our own
 * vocabulary. Values are the register's strings verbatim (`status:
 * 'Authorised'`, `'No longer authorised'`, `'Appointed representative'`…):
 * folding them into an enum would silently drop the day the FCA adds one.
 */
export interface FcaFirm {
  frn: string;
  name: string | null;
  status: string | null;
  /** YYYY-MM-DD when the register's dd/mm/yyyy could be read; verbatim otherwise. */
  status_effective_date: string | null;
  business_type: string | null;
  companies_house_number: string | null;
  client_money_permission: string | null;
  sub_status: string | null;
  sub_status_effective_from: string | null;
  mlrs_status: string | null;
  mlrs_status_effective_date: string | null;
  psd_emd_status: string | null;
  psd_emd_effective_date: string | null;
  psd_agent_status: string | null;
  e_money_agent_status: string | null;
  mutual_society_number: string | null;
  notices: FcaFirmNotice[];
  /**
   * The register's "System Timestamp": when the FCA last touched the entry, in
   * the register's own local time (no zone is published, none is invented).
   */
  register_timestamp: string | null;
}

export type FcaLookup = { found: true; firm: FcaFirm } | { found: false };

/**
 * An upstream refusal or failure. `status` is an HTTP status a route can map
 * from; `reason` is the token the route branches on and the log line carries.
 */
export class FcaRegisterError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(reason);
    this.name = 'FcaRegisterError';
  }
}

// ---------------------------------------------------------------------------
// Parsing — pure, and the only place the register's vocabulary is read
// ---------------------------------------------------------------------------

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * The register's dates, folded to ISO where they can be read.
 *
 * Three forms have been observed: `dd/mm/yyyy` (the current API), `dd/mm/yyyy
 * hh:mm` for the system timestamp, and `Wed Sep 01 00:00:00 GMT 2004` in a
 * 2018 example. Anything else is returned verbatim rather than dropped — a
 * date we cannot read is still the register's date, and a null would say the
 * register published none.
 *
 * A time is kept as a local-time ISO string without a zone designator: the
 * register publishes no zone, and stamping `Z` on a London time would be
 * wrong for half the year.
 */
export function parseRegisterDate(raw: unknown): string | null {
  const t = text(raw);
  if (!t) return null;

  const uk = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (uk) {
    const [, dd, mm, yyyy, hh, mi, ss] = uk;
    const iso = `${yyyy}-${mm}-${dd}`;
    // A calendar check: 31/02/2026 must not become an ISO string that looks fine.
    const probe = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== iso) return t;
    return hh ? `${iso}T${hh}:${mi}${ss ? `:${ss}` : ''}` : iso;
  }

  const isoLike = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?$/.exec(t);
  if (isoLike) return isoLike[2] ? `${isoLike[1]}T${isoLike[2]}` : isoLike[1];

  // "Wed Sep 01 00:00:00 GMT 2004" — an instant, with its zone: safe to fold to a UTC day.
  const instant = Date.parse(t);
  if (!Number.isNaN(instant) && /GMT|UTC|[+-]\d{4}$/.test(t)) {
    const d = new Date(instant);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  return t;
}

/** `"PSD / EMD Status"`, `"Sub-Status"` and `"Sub Status"` all reach the same key. */
const normKey = (k: string): string => k.toLowerCase().replace(/[^a-z0-9]/g, '');

function readNotices(row: Map<string, unknown>): FcaFirmNotice[] {
  const out: FcaFirmNotice[] = [];
  // Current shape: an array of { "Exceptional Info Title", "Exceptional Info Body" }.
  const details = row.get('exceptionalinfodetails');
  if (Array.isArray(details)) {
    for (const item of details) {
      if (!item || typeof item !== 'object') continue;
      const m = new Map(
        Object.entries(item as Record<string, unknown>).map(([k, v]) => [normKey(k), v]),
      );
      const title = text(m.get('exceptionalinfotitle'));
      const body = text(m.get('exceptionalinfobody'));
      if (title || body) out.push({ title: title ?? '', body: body ?? '' });
    }
  }
  // Older shape: the same two fields flat on the firm, empty strings when none.
  const flatTitle = text(row.get('exceptionalinfotitle'));
  const flatBody = text(row.get('exceptionalinfobody'));
  if ((flatTitle || flatBody) && !out.some((n) => n.title === flatTitle && n.body === flatBody)) {
    out.push({ title: flatTitle ?? '', body: flatBody ?? '' });
  }
  return out;
}

/** One `Data` row → one firm. Exported for the tests; the route never calls it. */
export function mapFirm(raw: Record<string, unknown>, requestedFrn: string): FcaFirm {
  const row = new Map(Object.entries(raw).map(([k, v]) => [normKey(k), v]));
  const get = (key: string): string | null => text(row.get(key));
  return {
    frn: get('frn') ?? requestedFrn,
    name: get('organisationname'),
    status: get('status'),
    status_effective_date: parseRegisterDate(row.get('statuseffectivedate')),
    business_type: get('businesstype'),
    companies_house_number: get('companieshousenumber'),
    client_money_permission: get('clientmoneypermission'),
    sub_status: get('substatus'),
    sub_status_effective_from: parseRegisterDate(row.get('substatuseffectivefrom')),
    mlrs_status: get('mlrsstatus'),
    mlrs_status_effective_date: parseRegisterDate(row.get('mlrsstatuseffectivedate')),
    psd_emd_status: get('psdemdstatus'),
    psd_emd_effective_date: parseRegisterDate(row.get('psdemdeffectivedate')),
    psd_agent_status: get('psdagentstatus'),
    e_money_agent_status: get('emoneyagentstatus'),
    mutual_society_number: get('mutualsocietynumber') ?? get('mutualsocietyregistrationnumber'),
    notices: readNotices(row),
    register_timestamp: parseRegisterDate(row.get('systemtimestamp')),
  };
}

interface Envelope {
  Status?: unknown;
  Message?: unknown;
  Data?: unknown;
}

/** Firm found. */
export const STATUS_FOUND = 'FSR-API-02-01-00';
/** "Firm not found - When SOQL returns no record". Not an error: the register's verdict. */
export const STATUS_NOT_FOUND = 'FSR-API-02-01-11';
/** "Bad request. Invalid Input - If we cannot confirm if the FRN is correct". */
export const STATUS_BAD_REQUEST = 'FSR-API-02-01-21';

/**
 * The envelope, turned into a verdict — and only ever a verdict the register
 * actually gave. A "found" status with no row, or a status this file has never
 * seen, is a failure to be told about, not an absence to be served.
 */
export function parseFirmEnvelope(body: unknown, requestedFrn: string): FcaLookup {
  if (!body || typeof body !== 'object') throw new FcaRegisterError(502, 'unexpected_payload');
  const env = body as Envelope;
  const status = text(env.Status) ?? '';

  if (status === STATUS_NOT_FOUND) return { found: false };
  if (status === STATUS_BAD_REQUEST) throw new FcaRegisterError(400, 'bad_request');
  // FSR-API-01-xx-xx is the login family: unauthorised, or a credential the
  // portal does not know. Our problem, never the caller's.
  if (status.startsWith('FSR-API-01-')) throw new FcaRegisterError(401, 'refused');
  if (status !== STATUS_FOUND) {
    throw new FcaRegisterError(502, `unexpected_status:${status || 'none'}`);
  }

  const rows = Array.isArray(env.Data) ? env.Data : [];
  const row = rows.find((r) => r && typeof r === 'object') as Record<string, unknown> | undefined;
  if (!row) throw new FcaRegisterError(502, 'unexpected_payload');
  return { found: true, firm: mapFirm(row, requestedFrn) };
}

// ---------------------------------------------------------------------------
// Pacing — condition 1
// ---------------------------------------------------------------------------

export interface FcaDeps {
  /** Injected by the tests; production uses the global. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let chain: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

/**
 * One call at a time, `MIN_INTERVAL_MS` apart, whatever the number of
 * concurrent requests. A queue rather than a rejection: a caller who has paid
 * for a lookup waits a second, they are not turned away.
 */
function pace<T>(fn: () => Promise<T>, deps: FcaDeps): Promise<T> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? realSleep;
  const run = chain.then(async () => {
    const wait = lastCallAt + MIN_INTERVAL_MS - now();
    if (wait > 0) await sleep(wait);
    lastCallAt = now();
    return fn();
  });
  // The chain must survive a failed call, or one outage would queue forever.
  chain = run.catch(() => undefined);
  return run;
}

/** Seconds from Retry-After, capped; the default when the header is absent or unreadable. */
export function retryWaitMs(retryAfter: string | null): number {
  const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN;
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_RETRY_WAIT_MS;
  return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
}

/**
 * One firm from the register: one request, one honoured wait on a 429/503,
 * then the verdict or a failure. Never called without credentials.
 */
export async function fetchFirm(frn: string, deps: FcaDeps = {}): Promise<FcaLookup> {
  const creds = fcaCredentials();
  if (!creds) throw new FcaRegisterError(503, 'not_configured');
  if (!FRN_PATTERN.test(frn)) throw new FcaRegisterError(400, 'invalid_frn');
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;

  return pace(async () => {
    const attempt = (): Promise<Response | null> =>
      fetchImpl(`${FCA_REGISTER_BASE}/Firm/${frn}`, {
        method: 'GET',
        headers: {
          'x-auth-email': creds.email,
          'x-auth-key': creds.key,
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
      }).catch(() => null);

    let res = await attempt();
    if (res && (res.status === 429 || res.status === 503)) {
      // The single wait the conditions allow. Counted as a call of its own so
      // the next request in the queue keeps its distance from it.
      await sleep(retryWaitMs(res.headers.get('retry-after')));
      lastCallAt = now();
      res = await attempt();
    }
    if (!res) throw new FcaRegisterError(502, 'unreachable');
    if (res.status === 429 || res.status === 503)
      throw new FcaRegisterError(res.status, 'rate_limited');
    if (res.status === 401 || res.status === 403) throw new FcaRegisterError(res.status, 'refused');
    if (!res.ok) throw new FcaRegisterError(res.status, `http_${res.status}`);
    const body = await res.json().catch(() => null);
    return parseFirmEnvelope(body, frn);
  }, deps);
}

// ---------------------------------------------------------------------------
// Cache — one row per FRN, a day, in stats.sqlite
// ---------------------------------------------------------------------------

let ready = false;
function ensureTable(): void {
  if (ready) return;
  getStatsDB().exec(`
    CREATE TABLE IF NOT EXISTS fca_firm_cache (
      frn TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      retrieved_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
  ready = true;
}

/** Tests swap the stats database and the clock; they must be able to say so. */
export function resetFcaRegisterState(): void {
  ready = false;
  lastCallAt = 0;
  chain = Promise.resolve();
}

export interface CachedFirm {
  lookup: FcaLookup;
  /** ISO instants, UTC. */
  retrieved_at: string;
  expires_at: string;
}

export function cachedFirm(frn: string): CachedFirm | null {
  ensureTable();
  const row = getStatsDB()
    .prepare('SELECT payload, retrieved_at, expires_at FROM fca_firm_cache WHERE frn = ?')
    .get(frn) as { payload: string; retrieved_at: string; expires_at: string } | undefined;
  if (!row) return null;
  try {
    const lookup = JSON.parse(row.payload) as FcaLookup;
    if (typeof lookup !== 'object' || lookup === null || typeof lookup.found !== 'boolean')
      return null;
    return { lookup, retrieved_at: row.retrieved_at, expires_at: row.expires_at };
  } catch {
    // Unreadable is the same as absent; the next reading replaces it.
    return null;
  }
}

function storeFirm(frn: string, lookup: FcaLookup, now: Date): CachedFirm {
  ensureTable();
  const retrieved_at = now.toISOString();
  const expires_at = new Date(now.getTime() + FCA_CACHE_TTL_MS).toISOString();
  const db = getStatsDB();
  db.prepare(
    `INSERT INTO fca_firm_cache (frn, payload, retrieved_at, expires_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(frn) DO UPDATE SET payload = excluded.payload,
       retrieved_at = excluded.retrieved_at, expires_at = excluded.expires_at`,
  ).run(frn, JSON.stringify(lookup), retrieved_at, expires_at);
  // Condition 3: nothing outlives the day plus the outage grace. Pruned on
  // every write so the table never holds what the answer could not serve.
  db.prepare('DELETE FROM fca_firm_cache WHERE expires_at < ?').run(
    new Date(now.getTime() - FCA_STALE_GRACE_MS).toISOString(),
  );
  return { lookup, retrieved_at, expires_at };
}

export function isFresh(cached: CachedFirm, now: Date): boolean {
  const exp = Date.parse(cached.expires_at);
  return !Number.isNaN(exp) && exp > now.getTime();
}

export function withinGrace(cached: CachedFirm, now: Date): boolean {
  const exp = Date.parse(cached.expires_at);
  return !Number.isNaN(exp) && exp + FCA_STALE_GRACE_MS > now.getTime();
}

// ---------------------------------------------------------------------------
// The assembled reading
// ---------------------------------------------------------------------------

export interface FirmReading extends CachedFirm {
  cache: {
    /** Served from the cache without asking the register. */
    hit: boolean;
    /** Served from an expired row because the register did not answer. */
    stale: boolean;
  };
}

/**
 * What the route serves: the cached row while it is fresh, a new reading
 * otherwise, and — only when the register fails — the expired row, marked as
 * such. A miss is cached like a hit: a scanner retrying the same absent FRN
 * costs the register nothing for a day.
 */
export async function lookupFirm(frn: string, deps: FcaDeps = {}): Promise<FirmReading> {
  const now = new Date((deps.now ?? Date.now)());
  const cached = cachedFirm(frn);
  if (cached && isFresh(cached, now)) return { ...cached, cache: { hit: true, stale: false } };
  try {
    const lookup = await fetchFirm(frn, deps);
    return { ...storeFirm(frn, lookup, now), cache: { hit: false, stale: false } };
  } catch (err) {
    // A refused FRN or a refused credential is not an outage: the stale row
    // must not paper over either.
    const outage =
      err instanceof FcaRegisterError && err.reason !== 'bad_request' && err.reason !== 'refused';
    if (outage && cached && withinGrace(cached, now)) {
      return { ...cached, cache: { hit: true, stale: true } };
    }
    throw err;
  }
}

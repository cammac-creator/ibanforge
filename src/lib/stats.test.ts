import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { recordOperation, recordBatch, recordRequest, recordRejection, getRejectionStats, getStats, getQuickStats, getStatsHistory, getStatusByPath, getBusinessFunnel, getClientProfiles, getBotProfiles, classifyClient, extractClientIp, normalizeRequestPath } from './stats.js';
import { generateApiKey } from './api-keys.js';
import { closeAll, getStatsDB } from './db.js';
import type { RejectReason } from './input-normalize.js';

afterAll(() => {
  closeAll();
});

describe('extractClientIp (spoof-resistant, trusted-proxy last hop)', () => {
  it('prefers x-real-ip (set by the proxy, not the client)', () => {
    expect(extractClientIp({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })).toBe('9.9.9.9');
  });
  it('uses the LAST X-Forwarded-For hop (the trusted proxy appends it)', () => {
    // A client-forged first entry must NOT win — the real peer is the last hop.
    expect(extractClientIp({ 'x-forwarded-for': '6.6.6.6, 10.0.0.1' })).toBe('10.0.0.1');
  });
  it('handles a single XFF value', () => {
    expect(extractClientIp({ 'x-forwarded-for': '203.0.113.7' })).toBe('203.0.113.7');
  });
  it('returns null when no proxy headers are present', () => {
    expect(extractClientIp({})).toBeNull();
  });
});

describe('recordOperation', () => {
  it('does not throw when recording a successful IBAN validation', () => {
    expect(() => recordOperation('iban_validate', 'CH', true, 0.005)).not.toThrow();
  });

  it('does not throw when recording a failed BIC lookup', () => {
    expect(() => recordOperation('bic_lookup', null, false, 0.003)).not.toThrow();
  });

  it('does not throw when country_code is null', () => {
    expect(() => recordOperation('iban_batch', null, true, 0.020)).not.toThrow();
  });
});

describe('recordBatch', () => {
  it('does not throw when recording a batch', () => {
    expect(() => recordBatch(5, 4, 0.020)).not.toThrow();
  });
});

describe('getStats', () => {
  it('returns an object with total_operations', () => {
    const stats = getStats();
    expect(stats).toHaveProperty('total_operations');
    expect(typeof stats.total_operations).toBe('number');
  });

  it('total_operations is >= 0', () => {
    const stats = getStats();
    expect(stats.total_operations).toBeGreaterThanOrEqual(0);
  });

  it('has by_type with iban_validate, iban_batch and bic_lookup keys', () => {
    const stats = getStats();
    expect(stats.by_type).toHaveProperty('iban_validate');
    expect(stats.by_type).toHaveProperty('iban_batch');
    expect(stats.by_type).toHaveProperty('bic_lookup');
  });

  it('iban_validate stats have total, valid_count and success_rate', () => {
    const stats = getStats();
    const iv = stats.by_type.iban_validate;
    expect(typeof iv.total).toBe('number');
    expect(typeof iv.valid_count).toBe('number');
    expect(typeof iv.success_rate).toBe('number');
  });

  it('bic_lookup stats have total, found_count and hit_rate', () => {
    const stats = getStats();
    const bl = stats.by_type.bic_lookup;
    expect(typeof bl.total).toBe('number');
    expect(typeof bl.found_count).toBe('number');
    expect(typeof bl.hit_rate).toBe('number');
  });

  it('total_revenue_usdc is a number >= 0', () => {
    const stats = getStats();
    expect(typeof stats.total_revenue_usdc).toBe('number');
    expect(stats.total_revenue_usdc).toBeGreaterThanOrEqual(0);
  });

  it('top_countries is an array', () => {
    const stats = getStats();
    expect(Array.isArray(stats.top_countries)).toBe(true);
  });

  it('last_7_days is an array', () => {
    const stats = getStats();
    expect(Array.isArray(stats.last_7_days)).toBe(true);
  });

  it('reflects recorded operations (total_operations increases after recordOperation)', () => {
    const before = getStats().total_operations;
    recordOperation('iban_validate', 'DE', true, 0.005);
    const after = getStats().total_operations;
    expect(after).toBe(before + 1);
  });
});

describe('getQuickStats', () => {
  it('returns total_operations, iban_validations, bic_lookups and success_rate', () => {
    const qs = getQuickStats();
    expect(qs).toHaveProperty('total_operations');
    expect(qs).toHaveProperty('iban_validations');
    expect(qs).toHaveProperty('bic_lookups');
    expect(qs).toHaveProperty('success_rate');
  });

  it('all fields are numbers', () => {
    const qs = getQuickStats();
    expect(typeof qs.total_operations).toBe('number');
    expect(typeof qs.iban_validations).toBe('number');
    expect(typeof qs.bic_lookups).toBe('number');
    expect(typeof qs.success_rate).toBe('number');
  });

  it('total_operations >= 0', () => {
    const qs = getQuickStats();
    expect(qs.total_operations).toBeGreaterThanOrEqual(0);
  });

  it('success_rate is between 0 and 100', () => {
    const qs = getQuickStats();
    expect(qs.success_rate).toBeGreaterThanOrEqual(0);
    expect(qs.success_rate).toBeLessThanOrEqual(100);
  });
});

describe('getStatsHistory', () => {
  it('returns an array', () => {
    const history = getStatsHistory();
    expect(Array.isArray(history)).toBe(true);
  });

  it('returns an array with default 7-day window', () => {
    const history = getStatsHistory();
    expect(history.length).toBeLessThanOrEqual(7);
  });

  it('accepts a custom number of days', () => {
    const history = getStatsHistory(30);
    expect(history.length).toBeLessThanOrEqual(30);
  });

  it('each entry has date, iban_validate, iban_batch, bic_lookup and revenue_usdc fields', () => {
    // Record at least one op to guarantee at least one row today
    recordOperation('iban_validate', 'FR', true, 0.005);
    const history = getStatsHistory(1);
    if (history.length > 0) {
      const entry = history[0];
      expect(entry).toHaveProperty('date');
      expect(entry).toHaveProperty('iban_validate');
      expect(entry).toHaveProperty('iban_batch');
      expect(entry).toHaveProperty('bic_lookup');
      expect(entry).toHaveProperty('revenue_usdc');
    }
  });
});

describe('getStatusByPath', () => {
  it('returns an array', () => {
    expect(Array.isArray(getStatusByPath())).toBe(true);
  });

  it('accepts a custom number of days and clamps output', () => {
    expect(Array.isArray(getStatusByPath(7))).toBe(true);
    expect(getStatusByPath(1).length).toBeLessThanOrEqual(30);
  });

  it('each row has path + per-class counters summing to total', () => {
    const rows = getStatusByPath(30);
    for (const r of rows) {
      expect(typeof r.path).toBe('string');
      expect(r.s2xx + r.s3xx + r.s4xx + r.s5xx).toBe(r.total);
      expect(typeof r.avg_ms === 'number' || r.avg_ms === null).toBe(true);
    }
  });

  it('by_status entries sum back to total', () => {
    const rows = getStatusByPath(30);
    for (const r of rows) {
      const sum = Object.values(r.by_status).reduce((s, n) => s + n, 0);
      expect(sum).toBe(r.total);
    }
  });

  it('by_status keys are stringified HTTP status codes', () => {
    const rows = getStatusByPath(30);
    for (const r of rows) {
      for (const code of Object.keys(r.by_status)) {
        const n = parseInt(code, 10);
        expect(n).toBeGreaterThanOrEqual(100);
        expect(n).toBeLessThan(600);
      }
    }
  });

  it('by_method sums back to total and keys are HTTP verbs', () => {
    const rows = getStatusByPath(30);
    for (const r of rows) {
      const sum = Object.values(r.by_method).reduce((s, n) => s + n, 0);
      expect(sum).toBe(r.total);
      for (const m of Object.keys(r.by_method)) {
        expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).toContain(m);
      }
    }
  });

  it('rows are ordered by total desc', () => {
    const rows = getStatusByPath(30);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].total).toBeGreaterThanOrEqual(rows[i].total);
    }
  });
});

describe('getBusinessFunnel', () => {
  it('returns an array (possibly empty)', () => {
    expect(Array.isArray(getBusinessFunnel())).toBe(true);
  });

  it('each row has date + 5 numeric buckets, all non-negative', () => {
    const rows = getBusinessFunnel(30);
    for (const r of rows) {
      expect(typeof r.date).toBe('string');
      for (const k of ['success', 'paywall', 'auth_or_quota', 'bad_input', 'server_error'] as const) {
        expect(typeof r[k]).toBe('number');
        expect(r[k]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('honours the period clamp without throwing', () => {
    expect(() => getBusinessFunnel(1)).not.toThrow();
    expect(() => getBusinessFunnel(90)).not.toThrow();
  });

  it('rows are chronologically ascending', () => {
    const rows = getBusinessFunnel(30);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].date >= rows[i - 1].date).toBe(true);
    }
  });

  it('excludes internal-key traffic (founder/Claude audits) but keeps clients and anonymous', () => {
    const runId = Date.now();
    const internal = generateApiKey(`perf-audit-${runId}@ibanforge.com`);
    const external = generateApiKey(`funnel-real-${runId}@acme-corp.com`);
    expect(internal).not.toBeNull();
    expect(external).not.toBeNull();

    const today = new Date().toISOString().slice(0, 10);
    const successToday = () => getBusinessFunnel(1).find((r) => r.date === today)?.success ?? 0;

    const before = successToday();
    recordRequest('POST', '/v1/iban/validate', 200, 10, 'api', null, null, internal!.key_prefix);
    recordRequest('POST', '/v1/iban/validate', 200, 10, 'api', null, null, external!.key_prefix);
    recordRequest('POST', '/v1/iban/validate', 200, 10, 'api', null, null, null); // anonymous (x402)
    const after = successToday();

    // external + anonymous count; the internal audit key must not.
    expect(after - before).toBe(2);
  });
});

describe('recordRejection', () => {
  it('enregistre la catégorie et jamais la valeur soumise', () => {
    recordRejection('bic_lookup', 'normalizable');
    recordRejection('bic_lookup', 'normalizable');
    recordRejection('bic_lookup', 'placeholder_literal');
    const rows = getRejectionStats(30);
    const bic = rows.filter((r) => r.operation_type === 'bic_lookup');
    expect(bic.find((r) => r.reject_reason === 'normalizable')?.count).toBeGreaterThanOrEqual(2);
    expect(bic.find((r) => r.reject_reason === 'placeholder_literal')?.count).toBeGreaterThanOrEqual(1);
  });

  // DPA: the column must only ever hold a category from the RejectReason union.
  // Asserted over EVERY rejection row, not just the ones this test wrote, so a
  // future caller that leaks an IBAN/BIC/IID into the column fails here.
  it('persists a category only — no submitted value, no country attribution', () => {
    // `satisfies Record<RejectReason, true>` : ajouter une raison à l'union sans
    // l'ajouter ici ne compile plus. Une simple liste de chaînes avait déjà
    // dérivé une fois (le jour où `invalid_bic_shape` est apparu), et le test
    // échouait alors sur des lignes parfaitement légitimes.
    const categories = Object.keys({
      placeholder_literal: true,
      normalizable: true,
      too_short: true,
      too_long: true,
      invalid_length: true,
      invalid_charset: true,
      not_numeric: true,
      not_an_identifier: true,
      invalid_bic_shape: true,
    } satisfies Record<RejectReason, true>);
    recordRejection('ch_clearing_lookup', 'not_numeric');
    const rows = getStatsDB()
      .prepare('SELECT country_code, success, error_detail, reject_reason FROM operations WHERE reject_reason IS NOT NULL')
      .all() as Array<{ country_code: string | null; success: number; error_detail: string | null; reject_reason: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) {
      expect(categories).toContain(r.reject_reason);
      expect(r.country_code).toBeNull();
      expect(r.error_detail).toBeNull();
      expect(r.success).toBe(0);
    }
  });

  // The defect this guards: rejections live in the same table as operations, so
  // without `reject_reason IS NULL` on every operation-facing read, one rejection
  // would count as one failed bic_lookup — and at the observed rejection volume
  // the hit rate would crater to single digits, reading as an outage rather than
  // as a measurement change. Asserting the column exists would not catch that.
  it('keeps rejections out of the operation aggregations (separate lane)', () => {
    const rejectionCount = () =>
      getRejectionStats(30).find((r) => r.operation_type === 'bic_lookup' && r.reject_reason === 'too_short')?.count ?? 0;

    const beforeType = getStats().by_type.bic_lookup;
    const beforeQuick = getQuickStats().bic_lookups;
    const beforeRejected = rejectionCount();

    recordOperation('bic_lookup', 'CH', true, 0);
    recordRejection('bic_lookup', 'too_short');

    const afterType = getStats().by_type.bic_lookup;

    // Two rows written, but the operation lane must see exactly the one real
    // lookup: total +1 (not +2) and found_count +1, so the hit rate contribution
    // is 1/1 and not 1/2.
    expect(afterType.total - beforeType.total).toBe(1);
    expect(afterType.found_count - beforeType.found_count).toBe(1);
    expect(getQuickStats().bic_lookups - beforeQuick).toBe(1);

    // The rejection is not lost — it is readable through its own lane.
    expect(rejectionCount() - beforeRejected).toBe(1);
  });
});

describe('classifyClient', () => {
  it('classifies /mcp paths as mcp_http regardless of UA', () => {
    expect(classifyClient('/mcp', 'curl/8.0')).toBe('mcp_http');
    expect(classifyClient('/mcp/initialize', undefined)).toBe('mcp_http');
    expect(classifyClient('/mcp', 'Mozilla/5.0 Chrome/120')).toBe('mcp_http');
  });

  it('classifies missing UA as api', () => {
    expect(classifyClient('/v1/iban/validate', undefined)).toBe('api');
    expect(classifyClient('/', undefined)).toBe('api');
  });

  it('classifies the npm stdio package as mcp_stdio', () => {
    expect(classifyClient('/v1/iban/validate', 'ibanforge-mcp/1.2.2')).toBe('mcp_stdio');
    expect(classifyClient('/v1/iban/validate', 'ibanforge-mcp/0.0.1')).toBe('mcp_stdio');
    expect(classifyClient('/v1/bic/UBSWCHZH80A', 'mcp-proxy/0.5.0')).toBe('mcp_stdio');
  });

  it('classifies known AI agent UAs as mcp_stdio (agent traffic bucket)', () => {
    expect(classifyClient('/v1/iban/validate', 'ChatGPT-User/1.0')).toBe('mcp_stdio');
    expect(classifyClient('/v1/iban/validate', 'GPTBot/1.2 (+https://openai.com/gptbot)')).toBe('mcp_stdio');
    expect(classifyClient('/v1/iban/validate', 'Claude-User/1.0 (Anthropic)')).toBe('mcp_stdio');
    expect(classifyClient('/v1/iban/validate', 'ClaudeBot/1.0 (+https://www.anthropic.com)')).toBe('mcp_stdio');
    expect(classifyClient('/v1/iban/validate', 'Cursor/0.42.0')).toBe('mcp_stdio');
    expect(classifyClient('/v1/iban/validate', 'Cline/3.1.0')).toBe('mcp_stdio');
    expect(classifyClient('/v1/iban/validate', 'PerplexityBot/1.0 (+https://www.perplexity.ai)')).toBe('mcp_stdio');
  });

  it('classifies indexer / catalog crawlers as bot', () => {
    expect(classifyClient('/v1/iban/validate', 'decixa-probe/1.0')).toBe('bot');
    expect(classifyClient('/.well-known/x402', 'x402scan/2.0')).toBe('bot');
    expect(classifyClient('/openapi.json', 'Googlebot/2.1 (+http://www.google.com/bot.html)')).toBe('bot');
    expect(classifyClient('/', 'Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toBe('bot');
    expect(classifyClient('/v1/iban/validate', 'Mozilla/5.0 (compatible; bazaar-indexer)')).toBe('bot');
  });

  it('classifies real browsers as web', () => {
    expect(classifyClient('/', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')).toBe('web');
    expect(classifyClient('/', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0')).toBe('web');
    expect(classifyClient('/', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('web');
  });

  it('falls back to api for unknown UAs', () => {
    expect(classifyClient('/v1/iban/validate', 'curl/8.4.0')).toBe('api');
    expect(classifyClient('/v1/iban/validate', 'python-requests/2.31.0')).toBe('api');
    expect(classifyClient('/v1/iban/validate', 'PostmanRuntime/7.32.3')).toBe('api');
    expect(classifyClient('/v1/iban/validate', 'node-fetch/2.6.7')).toBe('api');
  });

  it('agent UA on /mcp path still classifies as mcp_http (path wins)', () => {
    expect(classifyClient('/mcp', 'Cursor/0.42.0')).toBe('mcp_http');
    expect(classifyClient('/mcp', 'ibanforge-mcp/1.2.2')).toBe('mcp_http');
  });

  it('is case-insensitive on the UA', () => {
    expect(classifyClient('/v1/iban/validate', 'IBANFORGE-MCP/1.2.2'.toLowerCase())).toBe('mcp_stdio');
    expect(classifyClient('/v1/iban/validate', 'CHATGPT-USER/1.0')).toBe('mcp_stdio');
    expect(classifyClient('/v1/iban/validate', 'GOOGLEBOT/2.1')).toBe('bot');
  });
});

describe('normalizeRequestPath', () => {
  // Each case below was observed to leak before the fix. `request_log` keeps
  // rows for twelve months, so a survivng identifier is a DPA breach, not a
  // cosmetic dashboard defect.
  it('consumes the whole BIC segment, not just its alphanumeric head', () => {
    // Was '/v1/bic/:code%20CHZH' — the tail of the submitted BIC survived.
    expect(normalizeRequestPath('/v1/bic/UBSW%20CHZH')).toBe('/v1/bic/:code');
    expect(normalizeRequestPath('/v1/bic/UBSW+CHZH')).toBe('/v1/bic/:code');
  });

  it('consumes a non-numeric clearing segment', () => {
    // Was stored raw and whole: the old pattern required leading digits.
    expect(normalizeRequestPath('/v1/ch/clearing/CH230')).toBe('/v1/ch/clearing/:iid');
    expect(normalizeRequestPath('/v1/ch/clearing/762a')).toBe('/v1/ch/clearing/:iid');
  });

  it('redacts an IBAN-shaped segment on a path no route matches (the 404 case)', () => {
    // Was stored complete: no rule covered unmatched paths.
    expect(normalizeRequestPath('/CH9300762011623852957')).toBe('/:redacted');
    expect(normalizeRequestPath('/lookup/DE89370400440532013000/details')).toBe('/lookup/:redacted/details');
  });

  it('keeps the existing buckets for well-formed identifiers (no dashboard fragmentation)', () => {
    expect(normalizeRequestPath('/v1/bic/UBSWCHZH')).toBe('/v1/bic/:code');
    expect(normalizeRequestPath('/v1/ch/clearing/230')).toBe('/v1/ch/clearing/:iid');
  });

  // getBusinessFunnel() excludes spec-template paths by matching `{`/`%7B` in
  // the stored path — folding them into `:code` would start counting them as
  // bad_input, the very regression that exclusion exists to prevent. There is
  // no submitted identifier in a template literal, so verbatim is also correct
  // on the DPA side.
  it('leaves OpenAPI template literals verbatim, so the funnel keeps excluding them', () => {
    expect(normalizeRequestPath('/v1/bic/%7Bcode%7D')).toBe('/v1/bic/%7Bcode%7D');
    expect(normalizeRequestPath('/v1/ch/clearing/%7Biid%7D')).toBe('/v1/ch/clearing/%7Biid%7D');
    expect(normalizeRequestPath('/v1/bic/{code}')).toBe('/v1/bic/{code}');
    expect(normalizeRequestPath('/v1/ch/clearing/{iid}')).toBe('/v1/ch/clearing/{iid}');
  });

  // The trap in the rule above: an agent that substitutes the OpenAPI
  // placeholder but keeps the braces sends `/v1/bic/{CH93…}`, which WHATWG
  // percent-encodes to `%7BCH93…%7D` before the middleware ever sees it. That
  // segment is not IBAN-shaped (it starts with `%`), so redaction missed it,
  // and it contains `%7B`, so the template rule excused it — a COMPLETE IBAN
  // stored for twelve months, worse than the BIC tail that blocked the merge.
  //
  // Both properties must hold at once: the wrapper survives so the funnel
  // exclusion keeps firing, the identifier does not.
  it('redacts an identifier wrapped in braces, keeping the wrapper', () => {
    expect(normalizeRequestPath('/v1/bic/%7BCH9300762011623852957%7D')).toBe('/v1/bic/%7B:redacted%7D');
    expect(normalizeRequestPath('/v1/ch/clearing/%7BCH9300762011623852957%7D')).toBe('/v1/ch/clearing/%7B:redacted%7D');
    expect(normalizeRequestPath('/%7BCH9300762011623852957%7D')).toBe('/%7B:redacted%7D');
    // Raw braces (a client that does not encode) and lowercase hex.
    expect(normalizeRequestPath('/v1/bic/{CH9300762011623852957}')).toBe('/v1/bic/{:redacted}');
    expect(normalizeRequestPath('/%7bCH9300762011623852957%7d')).toBe('/%7b:redacted%7d');
    // Half a wrapper is still a wrapper: `%7B` alone excused the segment too.
    expect(normalizeRequestPath('/%7BCH9300762011623852957')).toBe('/%7B:redacted');
    expect(normalizeRequestPath('/CH9300762011623852957%7D')).toBe('/:redacted%7D');
  });

  it('leaves ordinary endpoints untouched', () => {
    for (const p of ['/', '/v1/iban/validate', '/health', '/openapi.json', '/mcp', '/v1/credits/buy/25k', '/v1/iban/structure/CH']) {
      expect(normalizeRequestPath(p)).toBe(p);
    }
  });
});

// Mirrors the `operations` DPA test above, over the other table this branch
// writes to. Same reason it is valuable: it sweeps EVERY row rather than only
// the ones it wrote, so a future caller — or a future narrowing of the
// normalisation — that lets a submitted value into twelve-month storage fails
// here rather than in production during the measurement window.
describe('request_log persists no submitted identifier (DPA)', () => {
  it('holds no identifier in any stored path, across the whole table', () => {
    // Write the shapes that leaked, so the sweep is never vacuous — on CI the
    // table starts empty and a bare sweep would pass green checking nothing.
    recordRequest('GET', '/v1/bic/UBSW%20CHZH', 400, 1);
    recordRequest('GET', '/v1/ch/clearing/CH230', 400, 1);
    recordRequest('POST', '/CH9300762011623852957', 404, 1);
    // Brace-wrapped: excused by the template rule AND invisible to a
    // whole-segment shape test. This is the row that made an earlier version of
    // this very sweep pass green over a table holding complete IBANs.
    recordRequest('GET', '/v1/bic/%7BCH9300762011623852957%7D', 400, 1);
    recordRequest('POST', '/%7BCH9300762011623852957%7D', 404, 1);

    // Invariants restated independently of stats.ts: if the production regexes
    // were wrong, importing them here would make the test wrong the same way.
    const ibanShape = /^[A-Za-z]{2}\d{2}[A-Za-z0-9]{1,30}$/;
    const specTemplate = /\{|%7[Bb]/;
    // Percent-escapes and braces delimit an identifier just as `/` does —
    // splitting on `/` alone hid `%7BCH93…%7D` from invariant A, because the
    // `B` of `%7B` glues onto the `CH` and the whole segment stops matching.
    const BOUNDARY = /\/|%[0-9A-Fa-f]{2}|[{}]/;

    const rows = getStatsDB().prepare('SELECT path FROM request_log').all() as Array<{ path: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(5);

    for (const { path } of rows) {
      // A. No token anywhere is identifier-shaped — covers unmatched routes and
      // identifiers wrapped in an OpenAPI placeholder.
      expect(path.split(BOUNDARY).filter((token) => ibanShape.test(token))).toEqual([]);

      // B. The two identifier-bearing route families only ever store their
      // label. Invariant A alone would not catch a regression to the narrow
      // BIC pattern, because '/v1/bic/:code%20CHZH' is not IBAN-shaped.
      const bic = /^\/v1\/bic\/([^/]+)/.exec(path);
      if (bic && !specTemplate.test(bic[1])) expect(bic[1]).toBe(':code');

      const iid = /^\/v1\/ch\/clearing\/([^/]+)/.exec(path);
      if (iid && !specTemplate.test(iid[1])) expect(iid[1]).toBe(':iid');
    }
  });
});

// The suite runs against the repository's real stats DB, which persists between
// runs, so any test that counts its own rows has to start from a known state or
// it passes once and drifts upward for ever after.
const SYNTHETIC = ['ifk_attrib01', 'ifk_batch01', 'ifk_profile1'];
function clearSynthetic() {
  const db = getStatsDB();
  for (const k of SYNTHETIC) {
    db.prepare('DELETE FROM operations WHERE key_prefix = ?').run(k);
    db.prepare('DELETE FROM request_log WHERE key_prefix = ?').run(k);
  }
}

describe('per-client attribution (operations carry the key that asked)', () => {
  beforeEach(clearSynthetic);
  afterAll(clearSynthetic);

  it('stores the key prefix alongside the operation', () => {
    recordOperation('iban_validate', 'PT', true, 0, undefined, 'ifk_attrib01');
    const row = getStatsDB()
      .prepare(`SELECT country_code, key_prefix FROM operations WHERE key_prefix = 'ifk_attrib01'`)
      .get() as { country_code: string; key_prefix: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.country_code).toBe('PT');
  });

  it('leaves the key prefix null for an unauthenticated (x402 or anonymous) call', () => {
    recordOperation('bic_lookup', 'GR', true, 0.003);
    const row = getStatsDB()
      .prepare(`SELECT key_prefix FROM operations WHERE country_code = 'GR' ORDER BY id DESC`)
      .get() as { key_prefix: string | null };
    expect(row.key_prefix).toBeNull();
  });

  it('records one row per IBAN in a batch, each with its own country and the caller', () => {
    // The batch used to write country_code NULL for every row, so a customer
    // who validates only through /v1/iban/batch showed no countries at all.
    recordBatch(3, 2, 0, 'ifk_batch01', [
      { valid: true, country: 'MT' },
      { valid: true, country: 'CY' },
      { valid: false, country: 'MT' },
    ]);
    const rows = getStatsDB()
      .prepare(`SELECT country_code, success FROM operations WHERE key_prefix = 'ifk_batch01' ORDER BY id`)
      .all() as Array<{ country_code: string | null; success: number }>;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.country_code).sort()).toEqual(['CY', 'MT', 'MT']);
    expect(rows.filter((r) => r.success === 1)).toHaveLength(2);
  });

  it('still records a batch when the caller passes no countries', () => {
    expect(() => recordBatch(2, 2, 0)).not.toThrow();
  });
});

describe('getClientProfiles', () => {
  beforeEach(clearSynthetic);
  afterAll(clearSynthetic);

  it('reports what one customer did: volume, endpoints, countries and freshness', () => {
    recordRequest('POST', '/v1/iban/validate', 200, 12, 'api', 'iphash1', 'guzzle/7', 'ifk_profile1');
    recordRequest('POST', '/v1/iban/validate', 402, 8, 'api', 'iphash1', 'guzzle/7', 'ifk_profile1');
    recordOperation('iban_validate', 'ES', true, 0, undefined, 'ifk_profile1');
    recordOperation('iban_validate', 'ES', true, 0, undefined, 'ifk_profile1');
    recordOperation('iban_validate', 'IT', false, 0, undefined, 'ifk_profile1');

    const p = getClientProfiles()['ifk_profile1'];
    expect(p).toBeDefined();
    expect(p.total).toBe(2);
    expect(p.paywall).toBe(1);
    expect(p.ok).toBe(1);
    expect(p.endpoints[0]).toEqual({ path: '/v1/iban/validate', count: 2 });
    // Countries are ranked by volume, so the panel leads with what they check most.
    expect(p.countries[0]).toEqual({ code: 'ES', count: 2 });
    expect(p.countries.map((c) => c.code)).toContain('IT');
    expect(p.distinct_ips).toBe(1);
    expect(p.user_agents[0].ua).toBe('guzzle/7');
    expect(p.last_seen).not.toBeNull();
  });

  it('omits a key that never called anything', () => {
    expect(getClientProfiles()['ifk_never_called_xyz']).toBeUndefined();
  });
});

describe('the last thing that happened to a customer', () => {
  beforeEach(clearSynthetic);
  afterAll(clearSynthetic);

  it('separates the last refusal from the last success, so a wall can be told from a pause', () => {
    // The case this exists for: a customer ends on a 402 and goes quiet. Their
    // quota gets raised afterwards, so "quota exhausted" is false today and the
    // fact that they walked away at a wall would be invisible without these
    // two instants.
    recordRequest('POST', '/v1/iban/validate', 200, 5, 'api', 'ip', 'ua', 'ifk_profile1');
    recordRequest('POST', '/v1/iban/validate', 402, 5, 'api', 'ip', 'ua', 'ifk_profile1');
    const p = getClientProfiles()['ifk_profile1'];
    expect(p.last_success_at).not.toBeNull();
    expect(p.last_refusal_at).not.toBeNull();
    expect(p.last_refusal_at! >= p.last_success_at!).toBe(true);
  });

  it('leaves the refusal instant null for a customer who was never turned away', () => {
    recordRequest('POST', '/v1/iban/validate', 200, 5, 'api', 'ip', 'ua', 'ifk_profile1');
    const p = getClientProfiles()['ifk_profile1'];
    expect(p.last_refusal_at).toBeNull();
    expect(p.last_success_at).not.toBeNull();
  });
});

describe('getBotProfiles', () => {
  const clearBots = () => {
    const db = getStatsDB();
    db.prepare("DELETE FROM request_log WHERE user_agent LIKE 'synthbot%'").run();
  };
  beforeEach(clearBots);
  afterAll(clearBots);

  it('groups anonymous callers by user agent, which is what survives a salt rotation', () => {
    recordRequest('GET', '/.well-known/x402', 200, 4, 'bot', 'ipA', 'synthbot-crawler/1.0', null);
    recordRequest('GET', '/openapi.json', 200, 3, 'bot', 'ipB', 'synthbot-crawler/1.0', null);
    const p = getBotProfiles(90, 1)['synthbot-crawler/1.0'];
    expect(p.total).toBe(2);
    expect(p.ok).toBe(2);
    expect(p.distinct_ips).toBe(2);
    expect(p.client_kind).toBe('bot');
  });

  it('never mixes in a caller that authenticated: those belong to the Clients tab', () => {
    recordRequest('GET', '/.well-known/x402', 200, 4, 'api', 'ipC', 'synthbot-keyed/1.0', 'ifk_somekey01');
    expect(getBotProfiles(90, 1)['synthbot-keyed/1.0']).toBeUndefined();
  });

  it('reports the paths a caller keeps failing to find, which is what it came for', () => {
    for (const path of ['/.well-known/agent.json', '/.well-known/agent.json', '/manifest.json']) {
      recordRequest('GET', path, 404, 2, 'bot', 'ipD', 'synthbot-lost/1.0', null);
    }
    const p = getBotProfiles(90, 1)['synthbot-lost/1.0'];
    expect(p.not_found).toBe(3);
    expect(p.not_found_paths[0]).toEqual({ path: '/.well-known/agent.json', count: 2 });
  });

  it('counts the paid calls it got through without a key, which is an x402 payment', () => {
    recordRequest('POST', '/v1/iban/validate', 200, 9, 'api', 'ipE', 'synthbot-payer/1.0', null);
    recordRequest('GET', '/health', 200, 1, 'api', 'ipE', 'synthbot-payer/1.0', null);
    const p = getBotProfiles(90, 1)['synthbot-payer/1.0'];
    expect(p.billable_ok).toBe(1);
    expect(p.total).toBe(2);
  });

  it('ignores the long tail below the noise floor', () => {
    recordRequest('GET', '/', 200, 1, 'web', 'ipF', 'synthbot-onehit/1.0', null);
    expect(getBotProfiles(90, 5)['synthbot-onehit/1.0']).toBeUndefined();
    expect(getBotProfiles(90, 1)['synthbot-onehit/1.0']).toBeDefined();
  });
});

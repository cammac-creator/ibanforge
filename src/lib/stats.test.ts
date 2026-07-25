import { describe, it, expect, afterAll } from 'vitest';
import { recordOperation, recordBatch, recordRequest, recordRejection, getRejectionStats, getStats, getQuickStats, getStatsHistory, getStatusByPath, getBusinessFunnel, classifyClient, extractClientIp } from './stats.js';
import { generateApiKey } from './api-keys.js';
import { closeAll, getStatsDB } from './db.js';

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
    const categories = [
      'placeholder_literal',
      'normalizable',
      'too_short',
      'too_long',
      'invalid_length',
      'invalid_charset',
      'not_numeric',
      'not_an_identifier',
    ];
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

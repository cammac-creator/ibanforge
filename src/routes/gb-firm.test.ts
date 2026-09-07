import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { gbFirm, fcaConfiguredGuard, GB_FIRM_COST_USDC } from './gb-firm.js';
import { frnGuardMiddleware } from '../middleware/identifier-guard.js';
import { apiKeyMiddleware } from '../middleware/api-key.js';
import { FCA_SOURCE, resetFcaRegisterState } from '../lib/fca-register.js';
import { generateApiKey, validateApiKey, getUsage } from '../lib/api-keys.js';
import { getRejectionStats } from '../lib/stats.js';
import { getStatsDB } from '../lib/db.js';
import type { HonoEnv } from '../types.js';

/**
 * The route as src/app.ts mounts it: the configured guard first, the API-key
 * middleware, the format guard, then the route. The x402 middleware is absent,
 * as in every route test here; its half of the contract (402 on the template
 * probe once the credential exists, 503 before) is in src/app.test.ts.
 */
function makeApp(withKeys = false) {
  const app = new Hono<HonoEnv>();
  app.get('/v1/gb/firm/:frn', fcaConfiguredGuard());
  if (withKeys) app.use('/v1/*', apiKeyMiddleware());
  app.get('/v1/gb/firm/:frn', frnGuardMiddleware());
  app.route('/', gbFirm);
  return app;
}

const FOUND = {
  Status: 'FSR-API-02-01-00',
  ResultInfo: { page: '1', per_page: '1', total_count: '1' },
  Message: 'Ok. Firm Found',
  Data: [
    {
      Name: 'https://register.fca.org.uk/services/V0.1/Firm/123456/Names',
      'Organisation Name': 'Alpha Bank Example Ltd',
      FRN: '123456',
      Status: 'Authorised',
      'Business Type': 'Regulated',
      'Status Effective Date': '01/09/2004',
      'Companies House Number': '01234567',
      'Client Money Permission': '',
      'PSD / EMD Status': '',
      'Exceptional Info Details': [],
      'System Timestamp': '07/09/2026 12:00',
    },
  ],
};
const NOT_FOUND = {
  Status: 'FSR-API-02-01-11',
  ResultInfo: null,
  Message: 'Firm not found',
  Data: null,
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function registerAnswers(...responses: Response[]) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('fetch stub exhausted');
    return next;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function totalRejections(): number {
  return getRejectionStats(1).reduce((n, r) => n + r.count, 0);
}

const RUN_ID = Date.now();

beforeEach(() => {
  process.env.FCA_REGISTER_API_KEY = 'test-register-key';
  process.env.FCA_REGISTER_API_EMAIL = 'acme@example.com';
  getStatsDB().exec('DROP TABLE IF EXISTS fca_firm_cache');
  resetFcaRegisterState();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.FCA_REGISTER_API_KEY;
  delete process.env.FCA_REGISTER_API_EMAIL;
});

describe('GET /v1/gb/firm/:frn', () => {
  it('answers 503 not_configured without calling anything when the credential is missing', async () => {
    const fetchMock = registerAnswers(json(FOUND));
    delete process.env.FCA_REGISTER_API_KEY;
    const res = await makeApp().request('/v1/gb/firm/123456');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 400 to a malformed FRN and to the placeholder, without calling the register', async () => {
    const fetchMock = registerAnswers(json(FOUND));
    const before = totalRejections();

    const short = await makeApp().request('/v1/gb/firm/12');
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({
      error: 'invalid_frn_format',
      message: 'A Firm Reference Number is 6 or 7 digits.',
    });

    const placeholder = await makeApp().request('/v1/gb/firm/%7Bfrn%7D');
    expect(placeholder.status).toBe(400);
    expect(await placeholder.json()).toMatchObject({
      error: 'placeholder_literal',
      example: 'GET /v1/gb/firm/123456',
    });

    // An Individual Reference Number must never reach the register as a firm.
    const irn = await makeApp().request('/v1/gb/firm/ABC01234');
    expect(irn.status).toBe(400);

    expect(fetchMock).not.toHaveBeenCalled();
    // Guard and route never both count: exactly one rejection per request.
    expect(totalRejections()).toBe(before + 3);
  });

  it('serves the firm with the credit, the date, the disclaimer and the cache state', async () => {
    const fetchMock = registerAnswers(json(FOUND));
    const res = await makeApp().request('/v1/gb/firm/123456');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      frn: '123456',
      found: true,
      name: 'Alpha Bank Example Ltd',
      status: 'Authorised',
      status_effective_date: '2004-09-01',
      business_type: 'Regulated',
      companies_house_number: '01234567',
      client_money_permission: null,
      notices: [],
      source: FCA_SOURCE,
      source_url: 'https://register.fca.org.uk/s/search?q=123456&type=Companies',
      cache: { hit: false, stale: false },
      cost_usdc: GB_FIRM_COST_USDC,
    });
    expect(typeof body.retrieved_at).toBe('string');
    expect(typeof (body.cache as { expires_at: string }).expires_at).toBe('string');
    expect(String(body.disclaimer)).toContain('no liability accepted by the FCA');
    expect(String(body.disclaimer)).toContain('register.fca.org.uk');
    expect(body).not.toHaveProperty('attribution');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('answers a miss as 200 found:false, credited and dated like a hit', async () => {
    registerAnswers(json(NOT_FOUND));
    const res = await makeApp().request('/v1/gb/firm/999999');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ frn: '999999', found: false, source: FCA_SOURCE });
    expect(String(body.note)).toContain('not a finding about anyone');
    expect(body).not.toHaveProperty('name');
  });

  it('asks the register once for two identical requests', async () => {
    const fetchMock = registerAnswers(json(FOUND));
    const app = makeApp();
    const first = (await (await app.request('/v1/gb/firm/123456')).json()) as {
      cache: { hit: boolean };
    };
    const second = (await (await app.request('/v1/gb/firm/123456')).json()) as {
      cache: { hit: boolean };
      name: string;
    };
    expect(first.cache.hit).toBe(false);
    expect(second.cache.hit).toBe(true);
    expect(second.name).toBe('Alpha Bank Example Ltd');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves the expired copy marked stale when the register is down, and 502 when there is none', async () => {
    const fetchMock = registerAnswers(json(FOUND), json({}, 500), json({}, 500));
    const app = makeApp();
    await app.request('/v1/gb/firm/123456');
    // Age the row past its day (still inside the grace) without touching the clock.
    getStatsDB()
      .prepare('UPDATE fca_firm_cache SET expires_at = ? WHERE frn = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), '123456');

    resetFcaRegisterState();
    const stale = await app.request('/v1/gb/firm/123456');
    expect(stale.status).toBe(200);
    expect(await stale.json()).toMatchObject({
      found: true,
      name: 'Alpha Bank Example Ltd',
      cache: { hit: true, stale: true },
    });

    resetFcaRegisterState();
    const none = await app.request('/v1/gb/firm/234567');
    expect(none.status).toBe(502);
    expect(await none.json()).toMatchObject({
      error: 'upstream',
      upstream_status: 500,
      reason: 'http_500',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('relays a number the register itself refuses as a 400, and a refused credential as a 502', async () => {
    registerAnswers(
      json({ Status: 'FSR-API-02-01-21', Message: 'Bad request', Data: null }),
      json({ Status: 'FSR-API-01-01-11', Message: 'Unauthorised', Data: null }),
    );
    const bad = await makeApp().request('/v1/gb/firm/100000');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'invalid_frn' });

    resetFcaRegisterState();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const refused = await makeApp().request('/v1/gb/firm/100001');
    expect(refused.status).toBe(502);
    expect(await refused.json()).toMatchObject({ error: 'upstream', reason: 'credential_refused' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('GET /v1/gb/firm/:frn — what a key pays', () => {
  it('charges nothing for 503 not_configured (answered before the key is read) nor for a 400', async () => {
    const key = generateApiKey(`gb-firm-${RUN_ID}-1@example.com`)!.api_key;
    const { keyHash } = validateApiKey(key);
    const auth = { headers: { Authorization: `Bearer ${key}` } };
    const before = getUsage(keyHash).used;

    delete process.env.FCA_REGISTER_API_KEY;
    const unconfigured = await makeApp(true).request('/v1/gb/firm/123456', auth);
    expect(unconfigured.status).toBe(503);
    expect(getUsage(keyHash).used).toBe(before);

    process.env.FCA_REGISTER_API_KEY = 'test-register-key';
    registerAnswers(json(FOUND));
    const malformed = await makeApp(true).request('/v1/gb/firm/12', auth);
    expect(malformed.status).toBe(400);
    expect(getUsage(keyHash).used).toBe(before);
  });

  it('charges one request for a hit, free of USDC, with the free-tier credit', async () => {
    const key = generateApiKey(`gb-firm-${RUN_ID}-2@example.com`)!.api_key;
    const { keyHash } = validateApiKey(key);
    const before = getUsage(keyHash).used;
    registerAnswers(json(FOUND));

    const res = await makeApp(true).request('/v1/gb/firm/123456', {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cost_usdc: number; attribution?: { required: boolean } };
    expect(body.cost_usdc).toBe(0);
    expect(body.attribution?.required).toBe(true);
    expect(getUsage(keyHash).used).toBe(before + 1);
  });
});

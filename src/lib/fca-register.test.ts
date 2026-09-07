import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  FCA_CACHE_TTL_MS,
  FCA_STALE_GRACE_MS,
  FcaRegisterError,
  MAX_RETRY_WAIT_MS,
  MIN_INTERVAL_MS,
  cachedFirm,
  fcaCredentials,
  fetchFirm,
  firmRegisterUrl,
  isFcaRegisterConfigured,
  lookupFirm,
  mapFirm,
  parseFirmEnvelope,
  parseRegisterDate,
  resetFcaRegisterState,
  retryWaitMs,
} from './fca-register.js';
import { getStatsDB } from './db.js';

/**
 * Written blind, on 07/09/2026, against the shapes three open-source clients
 * recorded from the real register (see the module header). The fixtures name
 * no firm: `Alpha Bank Example Ltd`, FRN 123456.
 */

/** The 27/02/2026 recording's key set, values replaced by fixtures. */
const FOUND_2026 = {
  Status: 'FSR-API-02-01-00',
  ResultInfo: { page: '1', per_page: '1', total_count: '1' },
  Message: 'Ok. Firm Found',
  Data: [
    {
      Name: 'https://register.fca.org.uk/services/V0.1/Firm/123456/Names',
      Individuals: 'https://register.fca.org.uk/services/V0.1/Firm/123456/Individuals',
      Permission: 'https://register.fca.org.uk/services/V0.1/Firm/123456/Permissions',
      Address: 'https://register.fca.org.uk/services/V0.1/Firm/123456/Address',
      'Organisation Name': 'Alpha Bank Example Ltd',
      FRN: '123456',
      Status: 'Authorised',
      'Business Type': 'Regulated',
      'Status Effective Date': '01/09/2004',
      'Companies House Number': '01234567',
      'Client Money Permission': 'Control but not hold client money',
      'Sub-Status': '',
      'Sub Status Effective from': '',
      'Mutual Society Number': '',
      'MLRs Status': '',
      'MLRs Status Effective Date': '',
      'PSD / EMD Status': 'Authorised Payment Institution',
      'PSD / EMD Effective Date': '13/10/2009',
      'PSD Agent Status': '',
      'PSD Agent Effective date': '',
      'E-Money Agent Status': '',
      'E-Money Agent Effective Date': '',
      'Exceptional Info Details': [],
      'System Timestamp': '27/02/2026 11:25',
    },
  ],
};

/** The 2018 example of the portal: flat notice fields and a Java-style date. */
const FOUND_2018 = {
  Status: 'FSR-API-02-01-00',
  ResultInfo: { page: '1', per_page: '1', total_count: '1' },
  Message: 'Success : Found Firm',
  Data: [
    {
      Name: 'https://register.fca.org.uk/services/V0.1/Firm/1234567/Names',
      'Organisation Name': 'Alpha Bank Example Ltd',
      Status: 'No longer authorised',
      'Business Type': 'Regulated',
      'Status Effective Date': 'Wed Sep 01 00:00:00 GMT 2004',
      'System Timestamp': '2018-10-24 09:49:29',
      'Exceptional Info Details': [
        { 'Exceptional Info Title': 'CAUTION', 'Exceptional Info Body': 'A notice.' },
        { 'Exceptional Info Title': '', 'Exceptional Info Body': '' },
      ],
    },
  ],
};

const NOT_FOUND = {
  Status: 'FSR-API-02-01-11',
  ResultInfo: null,
  Message: 'Firm not found',
  Data: null,
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** A fetch stub that answers from a script, one response per call, and remembers the calls. */
function scripted(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error('fetch stub exhausted');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const T0 = Date.parse('2026-09-07T12:00:00Z');

beforeEach(() => {
  process.env.FCA_REGISTER_API_KEY = 'test-register-key';
  process.env.FCA_REGISTER_API_EMAIL = 'acme@example.com';
  getStatsDB().exec('DROP TABLE IF EXISTS fca_firm_cache');
  resetFcaRegisterState();
});

afterEach(() => {
  delete process.env.FCA_REGISTER_API_KEY;
  delete process.env.FCA_REGISTER_API_EMAIL;
  resetFcaRegisterState();
});

describe('credentials', () => {
  it('needs both variables, and reads them at call time', () => {
    expect(isFcaRegisterConfigured()).toBe(true);
    delete process.env.FCA_REGISTER_API_EMAIL;
    expect(fcaCredentials()).toBeNull();
    process.env.FCA_REGISTER_API_EMAIL = '   ';
    expect(isFcaRegisterConfigured()).toBe(false);
    process.env.FCA_REGISTER_API_EMAIL = 'acme@example.com';
    expect(fcaCredentials()).toEqual({ email: 'acme@example.com', key: 'test-register-key' });
  });

  it('points at the public register by FRN', () => {
    expect(firmRegisterUrl('123456')).toBe(
      'https://register.fca.org.uk/s/search?q=123456&type=Companies',
    );
  });
});

describe('parseRegisterDate', () => {
  it('folds the register forms to ISO and keeps what it cannot read', () => {
    expect(parseRegisterDate('01/12/2001')).toBe('2001-12-01');
    expect(parseRegisterDate('27/02/2026 11:25')).toBe('2026-02-27T11:25');
    expect(parseRegisterDate('Wed Sep 01 00:00:00 GMT 2004')).toBe('2004-09-01');
    expect(parseRegisterDate('2018-10-24 09:49:29')).toBe('2018-10-24T09:49:29');
    expect(parseRegisterDate('')).toBeNull();
    expect(parseRegisterDate(undefined)).toBeNull();
    // A date that is not a date stays the register's string, never a null.
    expect(parseRegisterDate('31/02/2026')).toBe('31/02/2026');
    expect(parseRegisterDate('on request')).toBe('on request');
  });
});

describe('parseFirmEnvelope', () => {
  it('maps every key of the 2026 recording', () => {
    const lookup = parseFirmEnvelope(FOUND_2026, '123456');
    expect(lookup.found).toBe(true);
    if (!lookup.found) throw new Error('unreachable');
    expect(lookup.firm).toEqual({
      frn: '123456',
      name: 'Alpha Bank Example Ltd',
      status: 'Authorised',
      status_effective_date: '2004-09-01',
      business_type: 'Regulated',
      companies_house_number: '01234567',
      client_money_permission: 'Control but not hold client money',
      sub_status: null,
      sub_status_effective_from: null,
      mlrs_status: null,
      mlrs_status_effective_date: null,
      psd_emd_status: 'Authorised Payment Institution',
      psd_emd_effective_date: '2009-10-13',
      psd_agent_status: null,
      e_money_agent_status: null,
      mutual_society_number: null,
      notices: [],
      register_timestamp: '2026-02-27T11:25',
    });
  });

  it('reads the 2018 shape too: notices as an array, a Java-style date, and drops the empty notice', () => {
    const lookup = parseFirmEnvelope(FOUND_2018, '1234567');
    if (!lookup.found) throw new Error('expected a firm');
    expect(lookup.firm.frn).toBe('1234567');
    expect(lookup.firm.status).toBe('No longer authorised');
    expect(lookup.firm.status_effective_date).toBe('2004-09-01');
    expect(lookup.firm.register_timestamp).toBe('2018-10-24T09:49:29');
    expect(lookup.firm.notices).toEqual([{ title: 'CAUTION', body: 'A notice.' }]);
  });

  it('reaches the same key whatever the register does with spaces and hyphens', () => {
    const firm = mapFirm(
      {
        'Sub Status': 'In liquidation',
        'Exceptional Info Title': 'ATTENTION',
        'Exceptional Info Body': 'Flat form of the notice.',
        'Mutual Society Registration Number': 'IP00001',
      },
      '123456',
    );
    expect(firm.sub_status).toBe('In liquidation');
    expect(firm.mutual_society_number).toBe('IP00001');
    expect(firm.notices).toEqual([{ title: 'ATTENTION', body: 'Flat form of the notice.' }]);
    expect(firm.name).toBeNull();
  });

  it("returns the register's own miss, and only that", () => {
    expect(parseFirmEnvelope(NOT_FOUND, '999999')).toEqual({ found: false });
  });

  it('turns the register error statuses into typed failures, never into guesses', () => {
    const bad = { Status: 'FSR-API-02-01-21', Message: 'Bad request', Data: null };
    expect(() => parseFirmEnvelope(bad, '123456')).toThrow(FcaRegisterError);
    try {
      parseFirmEnvelope(bad, '123456');
    } catch (err) {
      expect((err as FcaRegisterError).reason).toBe('bad_request');
      expect((err as FcaRegisterError).status).toBe(400);
    }

    const refused = { Status: 'FSR-API-01-01-11', Message: 'Unauthorised', Data: null };
    expect(() => parseFirmEnvelope(refused, '123456')).toThrow(/refused/);

    const unknown = { Status: 'FSR-API-99-00-00', Message: '?', Data: [] };
    expect(() => parseFirmEnvelope(unknown, '123456')).toThrow(
      /unexpected_status:FSR-API-99-00-00/,
    );

    // "Found" with nothing to show is a contradiction, not an absence.
    const hollow = { Status: 'FSR-API-02-01-00', Message: 'Ok. Firm Found', Data: null };
    expect(() => parseFirmEnvelope(hollow, '123456')).toThrow(/unexpected_payload/);
    expect(() => parseFirmEnvelope('not json', '123456')).toThrow(/unexpected_payload/);
  });
});

describe('retryWaitMs', () => {
  it('honours Retry-After up to the cap and defaults when unreadable', () => {
    expect(retryWaitMs(null)).toBe(1500);
    expect(retryWaitMs('1')).toBe(1000);
    expect(retryWaitMs('30')).toBe(MAX_RETRY_WAIT_MS);
    expect(retryWaitMs('soon')).toBe(1500);
  });
});

describe('fetchFirm', () => {
  it('sends the two credential headers and our user agent, to the firm resource only', async () => {
    const { impl, calls } = scripted([json(FOUND_2026)]);
    const lookup = await fetchFirm('123456', {
      fetchImpl: impl,
      now: () => T0,
      sleep: async () => {},
    });
    expect(lookup.found).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://register.fca.org.uk/services/V0.1/Firm/123456');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['x-auth-email']).toBe('acme@example.com');
    expect(headers['x-auth-key']).toBe('test-register-key');
    expect(headers['user-agent']).toMatch(/^IBANforge\/\d/);
    expect(headers['user-agent']).toContain('https://ibanforge.com');
  });

  it('refuses to call without credentials, and refuses a malformed FRN before any call', async () => {
    const { impl, calls } = scripted([json(FOUND_2026)]);
    delete process.env.FCA_REGISTER_API_KEY;
    await expect(fetchFirm('123456', { fetchImpl: impl })).rejects.toMatchObject({
      reason: 'not_configured',
      status: 503,
    });
    process.env.FCA_REGISTER_API_KEY = 'test-register-key';
    await expect(fetchFirm('ABC01234', { fetchImpl: impl })).rejects.toMatchObject({
      reason: 'invalid_frn',
    });
    expect(calls).toHaveLength(0);
  });

  it('waits once on a 429, then takes the answer', async () => {
    const waits: number[] = [];
    const { impl, calls } = scripted([json({}, 429, { 'retry-after': '1' }), json(NOT_FOUND)]);
    const lookup = await fetchFirm('999999', {
      fetchImpl: impl,
      now: () => T0,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(lookup).toEqual({ found: false });
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([1000]);
  });

  it('gives up after the one wait the conditions allow', async () => {
    const { impl, calls } = scripted([json({}, 429), json({}, 429)]);
    await expect(
      fetchFirm('123456', { fetchImpl: impl, now: () => T0, sleep: async () => {} }),
    ).rejects.toMatchObject({ reason: 'rate_limited', status: 429 });
    expect(calls).toHaveLength(2);
  });

  it('names a refused credential and an unreachable register', async () => {
    const refused = scripted([json({}, 401)]);
    await expect(
      fetchFirm('123456', { fetchImpl: refused.impl, now: () => T0, sleep: async () => {} }),
    ).rejects.toMatchObject({ reason: 'refused', status: 401 });

    resetFcaRegisterState();
    const down = scripted([new Error('ECONNRESET')]);
    await expect(
      fetchFirm('123456', { fetchImpl: down.impl, now: () => T0, sleep: async () => {} }),
    ).rejects.toMatchObject({ reason: 'unreachable', status: 502 });
  });

  it('keeps two calls MIN_INTERVAL_MS apart, one in flight at a time', async () => {
    const waits: number[] = [];
    const { impl, calls } = scripted([json(FOUND_2026), json(NOT_FOUND)]);
    const deps = {
      fetchImpl: impl,
      now: () => T0,
      sleep: async (ms: number) => {
        waits.push(ms);
      },
    };
    const [a, b] = await Promise.all([fetchFirm('123456', deps), fetchFirm('999999', deps)]);
    expect(a.found).toBe(true);
    expect(b.found).toBe(false);
    expect(calls.map((c) => c.url)).toEqual([
      'https://register.fca.org.uk/services/V0.1/Firm/123456',
      'https://register.fca.org.uk/services/V0.1/Firm/999999',
    ]);
    // The clock is held still, so the second call has the whole floor to wait.
    expect(waits).toEqual([MIN_INTERVAL_MS]);
  });
});

describe('lookupFirm — the one-day cache', () => {
  const quiet = { sleep: async () => {} };

  it('asks the register once, then serves the row for a day — a miss included', async () => {
    const { impl, calls } = scripted([json(FOUND_2026), json(NOT_FOUND)]);
    const first = await lookupFirm('123456', { ...quiet, fetchImpl: impl, now: () => T0 });
    expect(first.cache).toEqual({ hit: false, stale: false });
    expect(first.retrieved_at).toBe('2026-09-07T12:00:00.000Z');
    expect(Date.parse(first.expires_at) - Date.parse(first.retrieved_at)).toBe(FCA_CACHE_TTL_MS);

    const again = await lookupFirm('123456', { ...quiet, fetchImpl: impl, now: () => T0 + 60_000 });
    expect(again.cache).toEqual({ hit: true, stale: false });
    expect(again.lookup).toEqual(first.lookup);
    expect(calls).toHaveLength(1);

    resetFcaRegisterState();
    const miss = await lookupFirm('999999', { ...quiet, fetchImpl: impl, now: () => T0 });
    expect(miss.lookup).toEqual({ found: false });
    const missAgain = await lookupFirm('999999', { ...quiet, fetchImpl: impl, now: () => T0 + 1 });
    expect(missAgain.cache.hit).toBe(true);
    expect(calls).toHaveLength(2);
    expect(cachedFirm('999999')?.lookup).toEqual({ found: false });
  });

  it('refetches past the day, and answers an outage with an error rather than a copy older than a day', async () => {
    // The usage described to the FCA says "cache ≤ 24 h" (FCA_STALE_GRACE_MS
    // is 0): once the row is a day old, the register's outage is the answer.
    const later = T0 + FCA_CACHE_TTL_MS + 60_000;
    const { impl, calls } = scripted([json(FOUND_2026), json({}, 500), json(FOUND_2026)]);
    await lookupFirm('123456', { ...quiet, fetchImpl: impl, now: () => T0 });

    resetFcaRegisterState();
    await expect(
      lookupFirm('123456', { ...quiet, fetchImpl: impl, now: () => later }),
    ).rejects.toMatchObject({ reason: 'http_500' });
    expect(calls).toHaveLength(2);

    resetFcaRegisterState();
    const fresh = await lookupFirm('123456', { ...quiet, fetchImpl: impl, now: () => later });
    expect(fresh.cache).toEqual({ hit: false, stale: false });
    expect(fresh.retrieved_at).toBe(new Date(later).toISOString());
    expect(calls).toHaveLength(3);
  });

  it('never serves a row older than the grace, and never papers over a refusal', async () => {
    const { impl } = scripted([json(FOUND_2026), json({}, 500), json({}, 401)]);
    await lookupFirm('123456', { ...quiet, fetchImpl: impl, now: () => T0 });

    resetFcaRegisterState();
    const tooLate = T0 + FCA_CACHE_TTL_MS + FCA_STALE_GRACE_MS + 1;
    await expect(
      lookupFirm('123456', { ...quiet, fetchImpl: impl, now: () => tooLate }),
    ).rejects.toMatchObject({ reason: 'http_500' });

    resetFcaRegisterState();
    const withinGrace = T0 + FCA_CACHE_TTL_MS + 60_000;
    await expect(
      lookupFirm('123456', { ...quiet, fetchImpl: impl, now: () => withinGrace }),
    ).rejects.toMatchObject({ reason: 'refused' });
  });

  it('prunes rows past the grace when it writes', async () => {
    const { impl } = scripted([json(FOUND_2026), json(NOT_FOUND)]);
    await lookupFirm('123456', { ...quiet, fetchImpl: impl, now: () => T0 });
    resetFcaRegisterState();
    await lookupFirm('999999', {
      ...quiet,
      fetchImpl: impl,
      now: () => T0 + FCA_CACHE_TTL_MS + FCA_STALE_GRACE_MS + 1,
    });
    expect(cachedFirm('123456')).toBeNull();
    expect(cachedFirm('999999')).not.toBeNull();
  });
});

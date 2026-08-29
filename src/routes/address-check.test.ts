import { describe, it, expect, afterAll } from 'vitest';
import { Hono } from 'hono';
import { addressCheck } from './address-check.js';
import { closeAll, getStatsDB } from '../lib/db.js';

afterAll(() => {
  closeAll();
});

function app() {
  const a = new Hono();
  a.route('/', addressCheck);
  return a;
}

async function post(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await app().request('/v1/address/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
}

describe('POST /v1/address/check (free, no payment)', () => {
  it('answers 200 with a verdict and no cost field', async () => {
    const { status, json } = await post({
      scheme: 'sps',
      address: { strt_nm: 'Bahnhofstrasse', bldg_nb: '45', pst_cd: '8001', twn_nm: 'Zurich', ctry: 'CH' },
    });

    expect(status).toBe(200);
    expect(json.conforms).toBe(true);
    expect(json.scheme).toBe('sps');
    expect(json.cost_usdc).toBeUndefined();
    expect(Array.isArray(json.findings)).toBe(true);
  });

  it('refuses cbpr+ with the reason, not a shrug', async () => {
    for (const scheme of ['cbpr+', 'CBPR+', 'cbpr', 'CBPR Plus']) {
      const { status, json } = await post({ scheme, address: { twn_nm: 'Zurich', ctry: 'CH' } });
      expect(status, scheme).toBe(400);
      expect(json.error, scheme).toBe('scheme_not_available');
      expect(String(json.note), scheme).toContain('swift.com');
      expect(json.schemes).toEqual(['sps', 'hvps_plus', 'fedwire']);
    }
  });

  it('accepts the spellings the market actually writes for HVPS+', async () => {
    for (const scheme of ['hvps+', 'HVPS+', 'hvps_plus', 'hvps plus', 'HVPS-Plus', 'hvps']) {
      const { status, json } = await post({ scheme, address: { twn_nm: 'Bern', ctry: 'CH' } });
      expect(status, scheme).toBe(200);
      expect(json.scheme, scheme).toBe('hvps_plus');
    }
  });

  it('rejects an unknown scheme and lists the ones that exist', async () => {
    const { status, json } = await post({ scheme: 'sepa', address: {} });
    expect(status).toBe(400);
    expect(json.error).toBe('unknown_scheme');
    expect(String(json.message)).toContain('sps');
  });

  it('rejects a malformed body with an example rather than a bare error', async () => {
    const { status, json } = await post({ address: { twn_nm: 'Zurich' } });
    expect(status).toBe(400);
    expect(json.error).toBe('invalid_request');
    expect(json.example).toBeDefined();
  });

  it('rejects an unknown address element instead of silently ignoring it', async () => {
    // A caller who writes `town` instead of `twn_nm` must be told, not handed a
    // green verdict on an address we never looked at.
    const { status, json } = await post({ scheme: 'sps', address: { town: 'Zurich', ctry: 'CH' } });
    expect(status).toBe(400);
    expect(json.error).toBe('invalid_request');
  });

  it('rejects invalid JSON', async () => {
    const r = await app().request('/v1/address/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe('invalid_json');
  });

  it('answers 200 with findings — not 400 — when the caller sends seven AdrLine', async () => {
    // The whole point of the endpoint: the useful answer to too many lines is
    // the rule that says so, with its source, not a rejected request.
    const { status, json } = await post({
      scheme: 'sps',
      address: { twn_nm: 'Zurich', ctry: 'CH', adr_line: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
    });
    expect(status).toBe(200);
    expect(json.conforms).toBe(false);
    const findings = json.findings as Array<{ rule: string; verdict: string }>;
    expect(findings.find((f) => f.rule === 'adr_line_max_2')?.verdict).toBe('fail');
  });
});

/**
 * The endpoint is named on every buying surface and used to record nothing at
 * all, so its demand existed only as anonymous 200s in request_log — no way to
 * tell it apart from any other path, and no answer to "is anyone asking for
 * this?". Free it stays; measured it now is.
 */
describe('POST /v1/address/check — the demand for a free endpoint is measurable', () => {
  const rows = (): Array<{ country_code: string | null; success: number; error_detail: string | null }> =>
    getStatsDB()
      .prepare('SELECT country_code, success, error_detail FROM operations WHERE operation_type = ?')
      .all('address_check') as Array<{ country_code: string | null; success: number; error_detail: string | null }>;

  it('books one operation per served answer, carrying the scheme and the verdict', async () => {
    const before = rows().length;
    await post({
      scheme: 'sps',
      address: { strt_nm: 'Bahnhofstrasse', bldg_nb: '45', pst_cd: '8001', twn_nm: 'Zurich', ctry: 'CH' },
    });
    // 'CHE' is not ISO 3166 alpha-2: the answer is served, and it does not
    // conform. Also the shape of country the caller most often sends.
    await post({ scheme: 'HVPS+', address: { twn_nm: 'Zurich', ctry: 'CHE' } });

    const after = rows();
    expect(after.length - before).toBe(2);
    const written = after.slice(-2);
    expect(written.map((r) => r.error_detail)).toEqual(['sps', 'hvps_plus']);
    // A non-conforming address is a served answer, and the axis worth watching.
    expect(written.map((r) => r.success)).toEqual([1, 0]);
  });

  it('never lets a submitted country reach the public country ranking', async () => {
    // topCountries on /stats is public and keeps anonymous rows. This door has
    // no paywall and no key, so a country written here would be a free way into
    // an all-time public ranking that has been distorted once already.
    await post({ scheme: 'fedwire', address: { twn_nm: 'Zurich', ctry: 'CH' } });
    for (const r of rows()) expect(r.country_code).toBeNull();
  });

  it('records nothing when the request was refused', async () => {
    const before = rows().length;
    await post({ scheme: 'cbpr+', address: { twn_nm: 'Zurich', ctry: 'CH' } });
    await post({ scheme: 'invented', address: { twn_nm: 'Zurich' } });
    await post({ scheme: 'sps' });
    expect(rows().length).toBe(before);
  });
});

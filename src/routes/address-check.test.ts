import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { addressCheck } from './address-check.js';

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

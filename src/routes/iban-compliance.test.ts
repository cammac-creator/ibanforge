import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { ibanCompliance } from './iban-compliance.js';

const app = new Hono();
app.route('/', ibanCompliance);

async function check(iban: string) {
  const res = await app.request('/v1/iban/compliance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dev-Skip': 'true' },
    body: JSON.stringify({ iban }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('POST /v1/iban/compliance', () => {
  it('returns the nested compliance block (not a flat risk_score)', async () => {
    const { status, body } = await check('DE89370400440532013000');
    expect(status).toBe(200);
    expect(body.valid).toBe(true);
    const c = body.compliance as Record<string, unknown>;
    expect(c).toBeDefined();
    expect(c).toHaveProperty('sanctions');
    expect(c).toHaveProperty('reachability');
    expect(c).toHaveProperty('vop');
    expect(typeof c.risk_score).toBe('number');
    expect(c).toHaveProperty('risk_level');
    expect(Array.isArray(c.flags)).toBe(true);
  });

  it('always carries a meta block disclosing scope + freshness + disclaimer', async () => {
    const { body } = await check('DE89370400440532013000');
    const meta = body.meta as Record<string, unknown>;
    expect(meta).toBeDefined();
    // The scope MUST say bank-BIC-only so an agent never mistakes this for
    // beneficiary-name screening (regulatory-sensitive claim).
    expect(meta.scope).toBe('bank_bic_only');
    expect(typeof meta.disclaimer).toBe('string');
    expect((meta.disclaimer as string).toLowerCase()).toContain('beneficiary');
    // Freshness fields come from the compliance DB metadata table.
    expect(meta).toHaveProperty('sanctions_as_of');
    expect(meta).toHaveProperty('fatf_as_of');
    expect(meta).toHaveProperty('sources');
  });

  it('does NOT inflate a standard FATF non-member SEPA country (PL stays low)', async () => {
    const { body } = await check('PL61109010140000071219812874');
    expect(body.valid).toBe(true);
    const c = body.compliance as { risk_level: string; flags: string[] };
    expect(c.risk_level).toBe('low');
    expect(c.flags).not.toContain('fatf_non_member');
  });

  it('rejects a missing iban with 400', async () => {
    const res = await app.request('/v1/iban/compliance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dev-Skip': 'true' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

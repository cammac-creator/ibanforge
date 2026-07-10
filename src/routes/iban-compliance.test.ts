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

  it('RU scores ≥80/critical with country flag + FATF suspended (2026-07-10 audit)', async () => {
    // Production used to answer 60/high WITHOUT the country flag because
    // country risk was read from risk_indicators (absent when the country had
    // no BBAN_STRUCTURE) — and fatf_status said 'member' (RU is suspended).
    const { body } = await check('RU0204452560040702810412345678901');
    expect(body.valid).toBe(true);
    const c = body.compliance as {
      risk_score: number; risk_level: string; flags: string[];
      sanctions: { country_sanctioned: boolean; fatf_status: string };
    };
    expect(c.risk_score).toBeGreaterThanOrEqual(80);
    expect(c.risk_level).toBe('critical');
    expect(c.flags).toContain('high_risk_country');
    expect(c.flags).toContain('sanctioned_country');
    expect(c.flags).toContain('fatf_suspended');
    expect(c.sanctions.country_sanctioned).toBe(true);
    expect(c.sanctions.fatf_status).toBe('suspended');
  });

  it('country risk never depends on BBAN parsing (BY high even if enrichment is partial)', async () => {
    // BY sits on the HIGH_RISK editorial axis; the flag must come from the
    // country code itself.
    const { body } = await check('BY13NBRB3600900000002Z00AB00');
    expect(body.valid).toBe(true);
    const c = body.compliance as { flags: string[] };
    expect(c.flags).toContain('high_risk_country');
  });

  it('Revolut LT IBAN reaches SEPA (SCT + instant + VoP) via the documented BIC alias', async () => {
    // Revolut Bank UAB participates in EPC schemes under RVUALT2V while its
    // customer IBANs resolve to BIC REVOLT21 — the reflex test any fintech
    // prospect runs. sct:false here is factually wrong (their IBANs receive
    // SCTs daily).
    const { body } = await check('LT353250012345678901');
    expect(body.valid).toBe(true);
    expect((body.bic as { code: string }).code).toBe('REVOLT21');
    const c = body.compliance as {
      reachability: { sct: boolean; sepa_instant: boolean; sdd: boolean };
      vop: { participant: boolean };
      flags: string[];
    };
    expect(c.reachability.sct).toBe(true);
    expect(c.reachability.sepa_instant).toBe(true);
    expect(c.reachability.sdd).toBe(true);
    expect(c.vop.participant).toBe(true);
    expect(c.flags).not.toContain('no_vop');
  });

  it('a previously structure-less SEPA country (RO) now yields full risk_indicators', async () => {
    const { body } = await check('RO49AAAA1B31007593840000');
    expect(body.valid).toBe(true);
    expect(body.risk_indicators).toBeDefined();
    const bban = body.bban as { bank_code: string };
    expect(bban.bank_code).toBe('AAAA');
  });
});

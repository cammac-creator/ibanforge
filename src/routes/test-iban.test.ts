import { describe, it, expect, afterAll } from 'vitest';
import { Hono } from 'hono';
import { testIban } from './test-iban.js';
import { validateIBAN } from '../lib/iban.js';
import { closeAll } from '../lib/db.js';

afterAll(() => {
  closeAll();
});

function makeApp() {
  const app = new Hono();
  app.route('/', testIban);
  return app;
}

interface Item {
  iban: string;
  country: string;
  proof: { bank_code_check: { status: string; authoritative: boolean } };
  note: string;
}

describe('GET /v1/test-iban', () => {
  it.each(['CH', 'DE', 'AT', 'BE'])(
    '%s: generates a valid IBAN whose own proof says verified',
    async (cc) => {
      const res = await makeApp().request(`/v1/test-iban?country=${cc}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { test_ibans: Item[]; disclaimer: string };
      expect(body.test_ibans.length).toBe(1);
      const item = body.test_ibans[0];
      expect(item.country).toBe(cc);
      // The IBAN must pass our own validator — same engine, no shortcuts.
      expect(validateIBAN(item.iban).valid).toBe(true);
      // The whole point: the bank code is register-verified, and the proof is
      // the engine's answer, not a hand-written claim.
      expect(item.proof.bank_code_check.status).toBe('verified');
      expect(item.proof.bank_code_check.authoritative).toBe(true);
      // Honesty ships on every item.
      expect(item.note).toMatch(/NOT a real account/);
      expect(body.disclaimer).toMatch(/Do not send money/);
    },
  );

  it('caps count at 10 and honours it', async () => {
    const res = await makeApp().request('/v1/test-iban?country=DE&count=3');
    const body = (await res.json()) as { test_ibans: Item[] };
    expect(body.test_ibans.length).toBe(3);
    const over = await makeApp().request('/v1/test-iban?count=99');
    const overBody = (await over.json()) as { test_ibans: Item[] };
    expect(overBody.test_ibans.length).toBe(1);
  });

  it('rejects an unsupported country with the honest reason', async () => {
    const res = await makeApp().request('/v1/test-iban?country=FR');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('unsupported_country');
    expect(body.message).toMatch(/national register/);
  });

  it('BE: the national check digits are correct, not just the IBAN ones', async () => {
    const res = await makeApp().request('/v1/test-iban?country=BE');
    const body = (await res.json()) as { test_ibans: Item[] };
    const bban = body.test_ibans[0].iban.slice(4);
    const national = Number(BigInt(bban.slice(0, 10)) % 97n) || 97;
    expect(bban.slice(10, 12)).toBe(String(national).padStart(2, '0'));
  });
});

describe('GET /v1/test-iban?country=SK', () => {
  it('SK: the payment code is in the register and the mod-11 checks hold on prefix and account', async () => {
    const res = await makeApp().request('/v1/test-iban?country=SK&count=5');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { test_ibans: Item[] };
    expect(body.test_ibans.length).toBeGreaterThan(0);
    const weighted = (digits: string, weights: number[]): number =>
      [...digits].reduce((sum, d, i) => sum + Number(d) * weights[i], 0);
    for (const item of body.test_ibans) {
      expect(item.iban).toMatch(/^SK\d{22}$/);
      const prefix = item.iban.slice(8, 14);
      const account = item.iban.slice(14, 24);
      expect(weighted(prefix, [10, 5, 8, 4, 2, 1]) % 11).toBe(0);
      expect(weighted(account, [6, 3, 7, 9, 10, 5, 8, 4, 2, 1]) % 11).toBe(0);
      expect(item.proof.bank_code_check.status).toBe('verified');
      expect(item.proof.bank_code_check.authoritative).toBe(true);
    }
  });
});

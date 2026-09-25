/**
 * Constat C1 du lot B1 (chantier « clé unique », 25.09.2026) : le SDK x402
 * exécute la route de vente AVANT de régler. Avant ce lot, un pack USDC
 * frappait donc une clé active, chargée, récupérable par sa référence, même
 * quand le règlement était ensuite refusé. La clé naît désormais inactive et
 * seule la confirmation du règlement l'active (Q8 de la spec, acceptée).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { buildApp } from '../app.js';
import { resetX402Paywall } from '../middleware/x402.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import {
  paymentHeaderFor,
  startFakeFacilitator,
  type FakeFacilitator,
} from '../test-support/fake-facilitator.js';

let facilitator: FakeFacilitator;
const originalEnv = { ...process.env };
let ip = 0;

beforeAll(async () => {
  facilitator = await startFakeFacilitator();
});

afterAll(async () => {
  await facilitator.close();
  process.env = originalEnv;
  closeAll();
});

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.X402_ENABLED = 'true';
  process.env.WALLET_ADDRESS = '0x00000000000000000000000000000000000000A1';
  process.env.FACILITATOR_URL = facilitator.url;
  delete process.env.CDP_API_KEY_ID;
  delete process.env.CDP_API_KEY_SECRET;
  delete process.env.IBANFORGE_FREE_MODE;
  resetX402Paywall();
  facilitator.settleMode = 'success';
});

async function request(method: string, path: string, headers: Record<string, string> = {}) {
  ip += 1;
  return buildApp().request(`https://api.ibanforge.com${path}`, {
    method,
    headers: {
      'x-real-ip': `198.18.1.${(ip % 250) + 1}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: method === 'POST' ? '{}' : undefined,
  });
}

describe('une clé frappée avant un règlement refusé', () => {
  it('n’est pas récupérable, reste inactive et perd sa clé en clair', async () => {
    const quote = await request('POST', '/v1/credits/buy/1k');
    expect(quote.status).toBe(402);
    const accepts = ((await quote.json()) as { accepts: Array<Record<string, unknown>> }).accepts;
    const header = paymentHeaderFor(accepts[0]);
    const ref = createHash('sha256').update(header).digest('hex').slice(0, 32);
    facilitator.settleMode = 'refuse';
    const res = await request('POST', '/v1/credits/buy/1k', { 'payment-signature': header });
    expect(res.status).toBe(402);
    const row = getStatsDB()
      .prepare(
        'SELECT active, raw_key_one_time_view, deactivated_at FROM api_keys WHERE x402_payment_ref = ?',
      )
      .get(ref) as {
      active: number;
      raw_key_one_time_view: string | null;
      deactivated_at: string | null;
    };
    expect(row.active).toBe(0);
    expect(row.raw_key_one_time_view).toBeNull();
    expect(row.deactivated_at).not.toBeNull();
    expect((await request('GET', `/v1/credits/recover/${ref}`)).status).toBe(404);
  });
});

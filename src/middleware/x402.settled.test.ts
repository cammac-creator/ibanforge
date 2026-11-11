/**
 * Constat C2 du lot B1 (chantier « clé unique », 25.09.2026) : « vérifié »
 * n'est pas « réglé ».
 *
 * Le SDK x402 rend `undefined` sur toute la branche du paiement VÉRIFIÉ,
 * règlement refusé compris, et remplace alors la réponse par un 402. Le
 * journal de règlement lisait `outcome === undefined` seul : un règlement
 * refusé pouvait donc s'y inscrire et déclencher la promotion « 200 une fois ».
 * Prouvé ici avec un facilitateur qui vérifie PUIS refuse.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Une panne imprévue dans une route payante (11.11.2026) : la validation d'IBAN
 * de la route lève une exception quand le test le demande, et rend sinon le
 * vrai résultat. Rien d'autre ne change.
 */
const boom = vi.hoisted(() => ({ on: false }));
vi.mock('../lib/iban.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/iban.js')>();
  return {
    ...actual,
    validateIBAN: (...args: Parameters<typeof actual.validateIBAN>) => {
      if (boom.on) throw new Error('panne imprévue (essai)');
      return actual.validateIBAN(...args);
    },
  };
});

import { buildApp } from '../app.js';
import { resetX402Paywall } from './x402.js';
import { generateApiKey } from '../lib/api-keys.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import {
  paymentHeaderFor,
  startFakeFacilitator,
  type FakeFacilitator,
} from '../test-support/fake-facilitator.js';

const VALID_IBAN = 'CH9300762011623852957';
const MONTH = () => new Date().toISOString().slice(0, 7);
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

async function validate(key: string, payment?: string): Promise<Response> {
  ip += 1;
  return buildApp().request('https://api.ibanforge.com/v1/iban/validate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'x-real-ip': `198.18.0.${(ip % 250) + 1}`,
      ...(payment ? { 'payment-signature': payment } : {}),
    },
    body: JSON.stringify({ iban: VALID_IBAN }),
  });
}

/** Une clé anonyme dont l'allocation est épuisée : le paywall la cote. */
function exhaustedAnonymousKey() {
  const k = generateApiKey(null)!;
  getStatsDB()
    .prepare('INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, 25)')
    .run(k.key_hash, MONTH());
  return k;
}

function settlementsOf(keyHash: string): number {
  return (
    getStatsDB()
      .prepare('SELECT COUNT(*) AS n FROM key_settlements WHERE key_hash = ?')
      .get(keyHash) as { n: number }
  ).n;
}

async function requirementsFor(key: string): Promise<Record<string, unknown>> {
  const res = await validate(key);
  expect(res.status).toBe(402);
  const body = (await res.json()) as { accepts: Array<Record<string, unknown>> };
  return body.accepts[0];
}

describe('un paiement à l’appel, vérifié puis réglé ou refusé', () => {
  it('un règlement refusé n’écrit pas key_settlements', async () => {
    const k = exhaustedAnonymousKey();
    const header = paymentHeaderFor(await requirementsFor(k.api_key));
    facilitator.settleMode = 'refuse';
    const res = await validate(k.api_key, header);
    expect(res.status).toBe(402);
    expect(facilitator.calls.settle).toBeGreaterThan(0);
    expect(settlementsOf(k.key_hash)).toBe(0);
  });

  it('une exception levée par la route payée rend un 500 et ne règle rien', async () => {
    const k = exhaustedAnonymousKey();
    const header = paymentHeaderFor(await requirementsFor(k.api_key));
    const before = { verify: facilitator.calls.verify, settle: facilitator.calls.settle };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    boom.on = true;
    let res: Response;
    try {
      res = await validate(k.api_key, header);
    } finally {
      boom.on = false;
      errors.mockRestore();
    }
    // Le paiement a bien été vérifié par le vrai middleware…
    expect(facilitator.calls.verify).toBeGreaterThan(before.verify);
    // …et rien n'a été réglé, ni inscrit.
    expect(facilitator.calls.settle).toBe(before.settle);
    expect(settlementsOf(k.key_hash)).toBe(0);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe('internal_error');
  });

  it('un règlement confirmé s’y inscrit, comme avant', async () => {
    const k = exhaustedAnonymousKey();
    const header = paymentHeaderFor(await requirementsFor(k.api_key));
    const res = await validate(k.api_key, header);
    expect(res.status).toBe(200);
    expect(settlementsOf(k.key_hash)).toBe(1);
  });
});

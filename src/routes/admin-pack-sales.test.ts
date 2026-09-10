import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { adminPackSales } from './admin-pack-sales.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import { generateCreditKey, generateStripeKey, rotateApiKey } from '../lib/api-keys.js';
import type { PackSalesSummary } from '../lib/pack-sales.js';

vi.hoisted(() => {
  process.env.RADAR_INTERNAL_EMAILS = '';
  process.env.CRM_INTERNAL_EMAILS = '';
});

afterAll(() => closeAll());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const app = new Hono();
app.route('/', adminPackSales);
const headers = { 'X-Admin-Secret': 'secret-admin-fictif' };

beforeEach(() => {
  vi.stubEnv('ADMIN_SECRET', 'secret-admin-fictif');
  vi.stubEnv('WALLET_ADDRESS', '');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Aucun accès réseau autorisé dans ce test');
    }),
  );
  getStatsDB().exec('DELETE FROM api_keys');
});

function purchase(session: string, minor: number | null = 500) {
  const created = generateStripeKey('buyer@alpha.example.net', 1000, session);
  getStatsDB()
    .prepare(
      'UPDATE api_keys SET amount_paid_minor = ?, amount_paid_currency = ? WHERE stripe_session_id = ?',
    )
    .run(minor, minor === null ? null : 'usd', session);
  return created;
}

async function summary() {
  const response = await app.request('/v1/admin/pack-sales', { headers });
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  return (await response.json()) as PackSalesSummary;
}

describe('GET /v1/admin/pack-sales', () => {
  it('refuse l’absence de secret, un secret incorrect et une autorisation Bearer seule', async () => {
    const refusedHeaders: HeadersInit[] = [
      {},
      { 'X-Admin-Secret': 'incorrect' },
      { Authorization: 'Bearer secret-admin-fictif' },
    ];
    for (const wrongHeaders of refusedHeaders) {
      const response = await app.request('/v1/admin/pack-sales', { headers: wrongHeaders });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthorized' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuse un secret non configuré côté serveur', async () => {
    vi.stubEnv('ADMIN_SECRET', '');
    const response = await app.request('/v1/admin/pack-sales', { headers });
    expect(response.status).toBe(401);
  });

  it('répond sans portefeuille ni appel RPC avec un contrat versionné', async () => {
    purchase('cs_fictif_sans_wallet', 275);
    const out = await summary();
    expect(out).toMatchObject({
      version: 1,
      source: 'retained_api_keys_payment_metadata',
      scope: 'all_retained_credit_keys',
      stripe: { groups: 1, usd_amount_minor: 275 },
    });
    expect(Number.isFinite(Date.parse(out.generated_at))).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('conserve un seul paiement après deux rotations successives et le rejeu de sa création', async () => {
    const created = purchase('cs_fictif_rotation');
    const before = await summary();
    const rotated = rotateApiKey(created.api_key!);
    expect(rotated).not.toBeNull();
    expect(rotateApiKey(rotated!.api_key)).not.toBeNull();
    expect(
      generateStripeKey('buyer@alpha.example.net', 1000, 'cs_fictif_rotation').idempotent,
    ).toBe(true);
    const after = await summary();
    expect(after.stripe).toEqual(before.stripe);
    expect(after.unattributed_credit_keys).toBe(2);
    expect(after.stripe).toMatchObject({ groups: 1, usd_known_groups: 1, usd_amount_minor: 500 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('conserve deux achats à la même adresse et sépare l’inconnu du zéro', async () => {
    purchase('cs_fictif_zero', 0);
    purchase('cs_fictif_ancien', null);
    const out = await summary();
    expect(out.stripe).toMatchObject({
      groups: 2,
      usd_known_groups: 1,
      usd_zero_groups: 1,
      amount_missing_groups: 1,
      usd_amount_minor: 0,
    });
  });

  it('n’expose aucune adresse, clé ou référence de paiement et ne prétend pas régler x402', async () => {
    purchase('cs_fictif_prive');
    generateCreditKey(null, 1000, 'ref_fictive_privee');
    const out = await summary();
    expect(out.x402).toEqual({
      distinct_references: 1,
      settlement_status: 'not_reconciled',
      confirmed_amount_usdc: null,
    });
    const body = JSON.stringify(out);
    for (const sensitive of [
      'buyer@',
      'cs_fictif_prive',
      'ref_fictive_privee',
      'ibf_',
      'key_hash',
      'key_prefix',
    ]) {
      expect(body).not.toContain(sensitive);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

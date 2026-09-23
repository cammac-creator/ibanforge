import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { adminRevenue } from './admin-revenue.js';
import { closeAll, getStatsDB } from '../lib/db.js';

/**
 * /admin/revenue expose les abonnements dans ses deux branches, à côté des
 * packs. Le portefeuille USDC passe par des appels RPC : un faux fetch leur
 * répond, rien ne sort de la machine. Montants et adresses inventés.
 */
vi.hoisted(() => {
  process.env.RADAR_INTERNAL_EMAILS = '';
  process.env.CRM_INTERNAL_EMAILS = '';
});

const app = new Hono();
app.route('/', adminRevenue);
const auth = { Authorization: 'Bearer jeton-stats-fictif' };

/** Un nœud Base factice : bloc courant, horodatage, aucun transfert, solde nul. */
function fakeRpc() {
  return vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    const { method } = JSON.parse(String(init?.body ?? '{}')) as { method?: string };
    const result =
      method === 'eth_blockNumber'
        ? '0x64'
        : method === 'eth_getBlockByNumber'
          ? { timestamp: '0x70dbd880' }
          : method === 'eth_getLogs'
            ? []
            : '0x0';
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
  });
}

beforeEach(() => {
  vi.stubEnv('STATS_TOKEN', 'jeton-stats-fictif');
  vi.stubEnv('WALLET_ADDRESS', `0x${'ab'.repeat(20)}`);
  vi.stubGlobal('fetch', fakeRpc());
  const db = getStatsDB();
  db.exec('DELETE FROM api_keys; DELETE FROM subscription_payments;');
  db.prepare(
    `INSERT INTO api_keys (key_hash, key_prefix, email, monthly_limit, amount_paid_minor,
       amount_paid_currency, stripe_session_id, stripe_subscription_id, created_at)
     VALUES ('h_rev_sub', 'ifk_rev00001', 'abonne@alpha.example.net', 10000, 1700, 'usd',
       'cs_rev_sub', 'sub_rev', '2030-01-01 00:00:00')`,
  ).run();
  db.prepare(
    `INSERT INTO subscription_payments (stripe_event_id, invoice_id, subscription_id, key_hash,
       amount_paid_minor, amount_paid_currency, billing_reason, paid_at)
     VALUES ('evt_rev', 'in_rev', 'sub_rev', 'h_rev_sub', 1700, 'usd', 'subscription_cycle',
       '2030-02-01 00:00:00')`,
  ).run();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(() => closeAll());

describe('GET /admin/revenue — les abonnements à côté des packs', () => {
  it('refuse sans le jeton des statistiques', async () => {
    expect((await app.request('/admin/revenue?balance_only=true')).status).toBe(403);
  });

  it.each([
    ['la lecture rapide du solde', '/admin/revenue?balance_only=true'],
    ['le parcours complet des transferts', '/admin/revenue?blocks=10'],
  ])('dans %s', async (_, path) => {
    const res = await app.request(path, { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      packs_sold: unknown;
      subscriptions_sold: Record<string, unknown>;
      subscriptions_note: string;
    };
    expect(body.packs_sold).toBeDefined();
    expect(body.subscriptions_sold).toMatchObject({
      first_payments: 1,
      renewals: 1,
      usd_minor: 3400,
      usd: 34,
      active_subscriptions: 1,
    });
    expect(body.subscriptions_note).toContain('subscription_create');
    expect(JSON.stringify(body)).not.toContain('abonne@');
  });
});

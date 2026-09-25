/**
 * Le rail USDC du lot B1 (chantier « clé unique », 25.09.2026), à travers le
 * VRAI paywall : l'application assemblée par `buildApp()`, en mode payant,
 * devant un facilitateur local qui vérifie puis règle, refuse ou se tait.
 *
 * Pourquoi par le vrai paywall : le SDK x402 exécute la route AVANT de régler.
 * Une route testée seule, sans enrobage, ne voit jamais un règlement refusé,
 * et c'est précisément le cas où une clé chargée restait active et
 * récupérable (constat C1) et où un règlement refusé s'inscrivait au journal
 * (constat C2).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('../lib/ops-alert.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/ops-alert.js')>();
  return { ...actual, opsFail: vi.fn(async () => undefined) };
});

import { buildApp } from '../app.js';
import { resetX402Paywall } from '../middleware/x402.js';
import { generateApiKey, validateApiKey } from '../lib/api-keys.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import { opsFail } from '../lib/ops-alert.js';
import { CREDITS_PURCHASE_TYPE, getStats } from '../lib/stats.js';
import {
  paymentHeaderFor,
  startFakeFacilitator,
  type FakeFacilitator,
} from '../test-support/fake-facilitator.js';

const WALLET = '0x00000000000000000000000000000000000000A1';
const VALID_IBAN = 'CH9300762011623852957';

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
  process.env.WALLET_ADDRESS = WALLET;
  process.env.FACILITATOR_URL = facilitator.url;
  delete process.env.CDP_API_KEY_ID;
  delete process.env.CDP_API_KEY_SECRET;
  delete process.env.IBANFORGE_FREE_MODE;
  delete process.env.X402_SETTLE_TIMEOUT_MS;
  resetX402Paywall();
  facilitator.settleMode = 'success';
  vi.mocked(opsFail).mockClear();
});

afterEach(() => {
  resetX402Paywall();
});

async function send(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<Response> {
  ip += 1;
  return buildApp().request(`https://api.ibanforge.com${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'x-real-ip': `203.0.113.${(ip % 250) + 1}`,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Ce que le paywall annonce pour ce pack : les exigences que le paiement accepte. */
async function requirementsFor(bundle: string): Promise<Record<string, unknown>> {
  const res = await send('POST', `/v1/credits/buy/${bundle}`, {}, {});
  expect(res.status).toBe(402);
  const body = (await res.json()) as { accepts?: Array<Record<string, unknown>> };
  expect(body.accepts?.length, 'le 402 annonce ses exigences').toBeGreaterThan(0);
  return body.accepts![0];
}

async function paidHeader(bundle: string): Promise<string> {
  return paymentHeaderFor(await requirementsFor(bundle));
}

function refOf(header: string): string {
  return createHash('sha256').update(header).digest('hex').slice(0, 32);
}

function purchase(paymentRef: string) {
  return getStatsDB()
    .prepare('SELECT * FROM key_purchases WHERE payment_ref = ?')
    .get(paymentRef) as Record<string, unknown> | undefined;
}

function freeKey(tag: string): { api_key: string; key_prefix: string; key_hash: string } {
  const k = generateApiKey(`${tag}-${Date.now()}-${ip}@alpha.example.net`);
  if (!k) throw new Error('frappe impossible');
  return k;
}

function anonymousKey(): { api_key: string; key_prefix: string; key_hash: string } {
  const k = generateApiKey(null);
  if (!k) throw new Error('frappe impossible');
  return k;
}

function row(keyHash: string) {
  return getStatsDB().prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(keyHash) as Record<
    string,
    unknown
  >;
}

function revenueToday(): { total: number; revenue: number } {
  const r = getStatsDB()
    .prepare(
      "SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(revenue_usdc), 0) AS revenue FROM daily_stats WHERE date = date('now') AND operation_type = ?",
    )
    .get(CREDITS_PURCHASE_TYPE) as { total: number; revenue: number };
  return r;
}

describe('le banc : un achat payé passe de bout en bout', () => {
  it('un pack sans clé présentée rend une clé active, créditée, une fois réglé', async () => {
    const header = await paidHeader('1k');
    const res = await send('POST', '/v1/credits/buy/1k', { 'payment-signature': header }, {});
    expect(res.status).toBe(201);
    const body = (await res.json()) as { api_key: string; key_prefix: string };
    expect(facilitator.calls.verify).toBeGreaterThan(0);
    expect(facilitator.calls.settle).toBeGreaterThan(0);
    const v = validateApiKey(body.api_key);
    expect(v.valid).toBe(true);
    expect(v.creditsRemaining).toBe(1000);
    expect(purchase(`x402:${refOf(header)}`)?.outcome).toBe('minted');
  });
});

describe('recharge en USDC de la clé présentée', () => {
  it('règlement confirmé : crédité une fois, et api_key renvoie la clé présentée', async () => {
    const key = freeKey('topup');
    const header = await paidHeader('1k');
    const res = await send(
      'POST',
      '/v1/credits/buy/1k',
      { Authorization: `Bearer ${key.api_key}`, 'payment-signature': header },
      {},
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    // Un client qui suit la doc d'avant et « bascule sur la clé rendue »
    // continue donc sur la même.
    expect(body.api_key).toBe(key.api_key);
    expect(body.same_key).toBe(true);
    expect(body.recharged).toBe(true);
    expect(body.credits_added).toBe(1000);
    const v = validateApiKey(key.api_key);
    expect(v.creditsRemaining).toBe(1000);
    expect(v.creditsTotal).toBe(1000);
    // Une clé gratuite rechargée garde son gratuit (règle A) : 200 par mois.
    expect(v.monthlyLimit).toBe(200);
    expect(v.tier).toBe('email');
    const p = purchase(`x402:${refOf(header)}`)!;
    expect(p.outcome).toBe('credited');
    expect(p.key_hash).toBe(key.key_hash);
    expect(p.balance_after).toBe(1000);
    // La photo de l'allocation propre, prise à ce premier achat.
    expect(p.prev_monthly_limit).toBe(200);

    // Le même paiement rejoué : rien de plus.
    const replay = await send(
      'POST',
      '/v1/credits/buy/1k',
      { Authorization: `Bearer ${key.api_key}`, 'payment-signature': header },
      {},
    );
    expect(replay.status).toBe(200);
    const again = (await replay.json()) as Record<string, unknown>;
    expect(again.idempotent).toBe(true);
    expect(again.recharged).toBe(true);
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(1000);
    expect(
      (
        getStatsDB()
          .prepare('SELECT COUNT(*) AS n FROM key_purchases WHERE key_hash = ?')
          .get(key.key_hash) as { n: number }
      ).n,
    ).toBe(1);
  });

  it('une deuxième recharge s’additionne et le cumul monte', async () => {
    const key = freeKey('twice');
    for (const bundle of ['1k', '5k']) {
      const res = await send(
        'POST',
        `/v1/credits/buy/${bundle}`,
        { Authorization: `Bearer ${key.api_key}`, 'payment-signature': await paidHeader(bundle) },
        {},
      );
      expect(res.status).toBe(201);
    }
    const v = validateApiKey(key.api_key);
    expect(v.creditsRemaining).toBe(6000);
    expect(v.creditsTotal).toBe(6000);
    // L'assiette de l'alerte des 10 % : le solde juste après la dernière recharge.
    expect(v.creditsNoticeBase).toBe(6000);
  });

  it('règlement refusé : aucun crédit, la ligne passe en échec', async () => {
    const key = freeKey('refused');
    const header = await paidHeader('1k');
    facilitator.settleMode = 'refuse';
    const res = await send(
      'POST',
      '/v1/credits/buy/1k',
      { Authorization: `Bearer ${key.api_key}`, 'payment-signature': header },
      {},
    );
    expect(res.status).toBe(402);
    const v = validateApiKey(key.api_key);
    expect(v.creditsRemaining).toBeUndefined();
    expect(v.tier).toBe('email');
    expect(purchase(`x402:${refOf(header)}`)?.outcome).toBe('failed');
  });

  it('délai dépassé : la ligne reste en attente, rien n’est crédité, et une alerte part', async () => {
    process.env.X402_SETTLE_TIMEOUT_MS = '150';
    const key = freeKey('timeout');
    const header = await paidHeader('1k');
    facilitator.settleMode = 'hang';
    const res = await send(
      'POST',
      '/v1/credits/buy/1k',
      { Authorization: `Bearer ${key.api_key}`, 'payment-signature': header },
      {},
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('settlement_unconfirmed');
    // Une recharge n'a rien à récupérer : la note dit que les crédits arrivent
    // une fois le règlement confirmé, et de ne pas payer deux fois.
    expect(body.recovery_url).toBeUndefined();
    expect(String(body.recovery_note)).toMatch(/do not pay again/i);
    expect(validateApiKey(key.api_key).creditsRemaining).toBeUndefined();
    const p = purchase(`x402:${refOf(header)}`)!;
    expect(p.outcome).toBe('pending');
    expect(
      vi
        .mocked(opsFail)
        .mock.calls.some(([k]) => String(k) === `x402:purchase-unconfirmed:${p.id}`),
    ).toBe(true);
  });

  it('la clé présentée ne paie pas d’unité, même épuisée', async () => {
    const key = freeKey('units');
    getStatsDB()
      .prepare('INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, 200)')
      .run(key.key_hash, new Date().toISOString().slice(0, 7));
    const res = await send(
      'POST',
      '/v1/credits/buy/1k',
      { Authorization: `Bearer ${key.api_key}`, 'payment-signature': await paidHeader('1k') },
      {},
    );
    expect(res.status).toBe(201);
    const used = getStatsDB()
      .prepare('SELECT count FROM api_usage WHERE key_hash = ? AND month = ?')
      .get(key.key_hash, new Date().toISOString().slice(0, 7)) as { count: number };
    expect(used.count).toBe(200);
    // Et sans paiement, présenter sa clé épuisée ne fait pas tomber un refus
    // de quota : la vente demande un paiement, rien d'autre.
    const unpaid = await send(
      'POST',
      '/v1/credits/buy/1k',
      { Authorization: `Bearer ${key.api_key}` },
      {},
    );
    expect(unpaid.status).toBe(402);
    const body = (await unpaid.json()) as { cause?: unknown };
    expect(body.cause).toBeUndefined();
  });

  it('aucune promotion « 200 une fois » : une clé anonyme qui achète passe au palier payant à 0', async () => {
    const key = anonymousKey();
    const res = await send(
      'POST',
      '/v1/credits/buy/1k',
      { Authorization: `Bearer ${key.api_key}`, 'payment-signature': await paidHeader('1k') },
      {},
    );
    expect(res.status).toBe(201);
    const r = row(key.key_hash);
    expect(r.tier).toBe('paid');
    // ZG1 : pas de 25 par mois après le pack, pas de « 200 une fois » non plus.
    expect(r.monthly_limit).toBe(0);
    expect(r.no_recredit).toBe(0);
    expect(r.claim_method).toBe('credits');
    expect(r.claimed_at).not.toBeNull();
    expect(r.credits_remaining).toBe(1000);
    // Aucun règlement au journal des paiements à l'appel.
    expect(
      (
        getStatsDB()
          .prepare('SELECT COUNT(*) AS n FROM key_settlements WHERE key_hash = ?')
          .get(key.key_hash) as { n: number }
      ).n,
    ).toBe(0);
    // Journalisée comme une promotion.
    expect(
      (
        getStatsDB()
          .prepare("SELECT COUNT(*) AS n FROM key_claims WHERE key_hash = ? AND method = 'credits'")
          .get(key.key_hash) as { n: number }
      ).n,
    ).toBe(1);
  });

  it('clé présentée invalide : une clé neuve, et la réponse le dit', async () => {
    const res = await send(
      'POST',
      '/v1/credits/buy/1k',
      {
        Authorization: `Bearer ifk_${'0'.repeat(64)}`,
        'payment-signature': await paidHeader('1k'),
      },
      {},
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.api_key).toMatch(/^ifk_[0-9a-f]{64}$/);
    expect(body.api_key).not.toBe(`ifk_${'0'.repeat(64)}`);
    expect(String(body.note)).toMatch(/invalid or revoked: this pack is on a NEW key/);
    expect(validateApiKey(body.api_key as string).creditsRemaining).toBe(1000);
  });
});

describe('clé neuve en USDC : rien d’actif avant un règlement confirmé', () => {
  it('rend la clé une seule fois à qui a payé, par sa référence', async () => {
    const header = await paidHeader('5k');
    const bought = (await (
      await send('POST', '/v1/credits/buy/5k', { 'payment-signature': header }, {})
    ).json()) as { api_key: string; recovery_url: string };
    const ref = refOf(header);
    expect(bought.recovery_url).toContain(`/v1/credits/recover/${ref}`);
    const first = await send('GET', `/v1/credits/recover/${ref}`);
    expect(first.status).toBe(200);
    const recovered = (await first.json()) as { api_key: string; credits_total: number };
    expect(recovered.api_key).toBe(bought.api_key);
    expect(recovered.credits_total).toBe(5000);
    expect((await send('GET', `/v1/credits/recover/${ref}`)).status).toBe(404);
  });

  it('ne frappe jamais deux fois pour un même règlement', async () => {
    const header = await paidHeader('25k');
    const first = (await (
      await send('POST', '/v1/credits/buy/25k', { 'payment-signature': header }, {})
    ).json()) as { api_key: string; key_prefix: string };
    const replay = await send('POST', '/v1/credits/buy/25k', { 'payment-signature': header }, {});
    const second = (await replay.json()) as {
      api_key?: string;
      key_prefix: string;
      idempotent: boolean;
    };
    expect(second.idempotent).toBe(true);
    expect(second.api_key).toBeUndefined();
    expect(second.key_prefix).toBe(first.key_prefix);
    expect(
      (
        getStatsDB()
          .prepare('SELECT COUNT(*) AS n FROM api_keys WHERE x402_payment_ref = ?')
          .get(refOf(header)) as { n: number }
      ).n,
    ).toBe(1);
  });

  it('inscrit la vente au revenu du jour à la confirmation, et rien sur un refus', async () => {
    const before = revenueToday();
    const ok = await send(
      'POST',
      '/v1/credits/buy/25k',
      { 'payment-signature': await paidHeader('25k') },
      {},
    );
    expect(ok.status).toBe(201);
    const afterPaid = revenueToday();
    expect(afterPaid.total - before.total).toBe(1);
    expect(afterPaid.revenue - before.revenue).toBeCloseTo(80, 6);

    facilitator.settleMode = 'refuse';
    const refused = await send(
      'POST',
      '/v1/credits/buy/1k',
      { 'payment-signature': await paidHeader('1k') },
      {},
    );
    expect(refused.status).toBe(402);
    expect(revenueToday()).toEqual(afterPaid);
  });

  it('une vente ne gonfle aucun compteur d’usage', async () => {
    const opsBefore = getStats().total_operations;
    const res = await send(
      'POST',
      '/v1/credits/buy/5k',
      { 'payment-signature': await paidHeader('5k') },
      {},
    );
    expect(res.status).toBe(201);
    expect(getStats().total_operations).toBe(opsBefore);
  });

  it('en mode payant, un appel servi avec la clé achetée débite ses crédits', async () => {
    const bought = (await (
      await send('POST', '/v1/credits/buy/1k', { 'payment-signature': await paidHeader('1k') }, {})
    ).json()) as { api_key: string };
    const res = await send(
      'POST',
      '/v1/iban/validate',
      { Authorization: `Bearer ${bought.api_key}` },
      { iban: VALID_IBAN },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-credits-remaining')).toBe('999');
    expect(res.headers.get('x-charged-from')).toBe('credits');
  });
});

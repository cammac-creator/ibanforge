/**
 * Les issues d'un règlement USDC que la relecture de sécurité de la PR 259 a
 * prises en défaut (D1, D2, D7, D9, D10), à travers le VRAI paywall devant un
 * facilitateur local.
 *
 * D1 : seul un REFUS TERMINAL du facilitateur fait échouer un achat
 *      (`success: false`, motif explicite, rien de diffusé, statut < 500).
 *      Tout le reste (page d'une passerelle, 5xx, connexion coupée,
 *      `settlement_pending`, transaction diffusée puis annulée) est une issue
 *      INCONNUE : l'achat reste en attente, la clé brute est gardée, une alerte
 *      part, la réponse est un 502 qui dit de ne pas payer deux fois, et la
 *      route d'administration peut encore confirmer.
 * D2 : un paiement déjà vu dont l'achat n'est ni crédité ni frappé répond 409 :
 *      le SDK ne règle jamais une réponse d'erreur, donc rien ne part.
 * D7 : une recharge repliée sur une clé neuve à la confirmation le dit au client.
 * D9 : une route qui échoue après avoir ouvert l'achat, sans règlement tenté,
 *      ne laisse pas une ligne en attente.
 * D10 : la ligne garde le payeur, le nonce et le hash de transaction, jamais la
 *      signature.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('../lib/ops-alert.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/ops-alert.js')>();
  return { ...actual, opsFail: vi.fn(async () => undefined) };
});

// La route de vente appelle `buildFirstCallCurl` APRÈS avoir ouvert l'achat :
// c'est le point où la faire échouer pour D9. Enrobé, jamais remplacé, sauf
// dans le test qui le demande.
vi.mock('../lib/first-call.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/first-call.js')>();
  return { ...actual, buildFirstCallCurl: vi.fn(actual.buildFirstCallCurl) };
});

import { buildApp } from '../app.js';
import { resetX402Paywall } from '../middleware/x402.js';
import { generateApiKey, revokeApiKey, validateApiKey } from '../lib/api-keys.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import { opsFail } from '../lib/ops-alert.js';
import { buildFirstCallCurl } from '../lib/first-call.js';
import {
  encodePayment,
  FAKE_PAYER,
  paymentFor,
  startFakeFacilitator,
  type FakeFacilitator,
  type SettleMode,
} from '../test-support/fake-facilitator.js';

const WALLET = '0x00000000000000000000000000000000000000A1';
const ADMIN = 'admin-secret-for-settlement-tests-0123';
/** La signature fictive que `paymentFor` écrit : elle ne doit jamais arriver en base. */
const SIGNATURE_BODY = 'ab'.repeat(65);

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
  process.env.ADMIN_SECRET = ADMIN;
  delete process.env.CDP_API_KEY_ID;
  delete process.env.CDP_API_KEY_SECRET;
  delete process.env.IBANFORGE_FREE_MODE;
  delete process.env.X402_SETTLE_TIMEOUT_MS;
  resetX402Paywall();
  facilitator.settleMode = 'success';
  facilitator.onSettle = null;
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

/** Ce que le paywall annonce pour cette route : les exigences que le paiement accepte. */
async function requirementsFor(method: string, path: string): Promise<Record<string, unknown>> {
  const res = await send(method, path, {}, method === 'GET' ? undefined : {});
  expect(res.status).toBe(402);
  const body = (await res.json()) as { accepts?: Array<Record<string, unknown>> };
  return body.accepts![0];
}

async function paid(bundle: string): Promise<{ header: string; nonce: string }> {
  const payment = paymentFor(await requirementsFor('POST', `/v1/credits/buy/${bundle}`));
  const nonce = (payment.payload as { authorization: { nonce: string } }).authorization.nonce;
  return { header: encodePayment(payment), nonce };
}

function refOf(header: string): string {
  return createHash('sha256').update(header).digest('hex').slice(0, 32);
}

function purchase(header: string): Record<string, unknown> {
  const row = getStatsDB()
    .prepare('SELECT * FROM key_purchases WHERE payment_ref = ?')
    .get(`x402:${refOf(header)}`) as Record<string, unknown> | undefined;
  if (!row) throw new Error('aucune ligne au registre pour ce paiement');
  return row;
}

function keyRow(keyHash: unknown): {
  active: number;
  raw_key_one_time_view: string | null;
  deactivated_at: string | null;
} {
  return getStatsDB()
    .prepare(
      'SELECT active, raw_key_one_time_view, deactivated_at FROM api_keys WHERE key_hash = ?',
    )
    .get(keyHash as string) as {
    active: number;
    raw_key_one_time_view: string | null;
    deactivated_at: string | null;
  };
}

function freeKey(tag: string): { api_key: string; key_prefix: string; key_hash: string } {
  const k = generateApiKey(`${tag}-${Date.now()}-${ip}@alpha.example.net`);
  if (!k) throw new Error('frappe impossible');
  return k;
}

function alerted(key: string): boolean {
  return vi.mocked(opsFail).mock.calls.some(([k]) => String(k) === key);
}

function purchaseAlerts(): number {
  return vi.mocked(opsFail).mock.calls.filter(([k]) => String(k).startsWith('x402:purchase-'))
    .length;
}

async function admin(path: string): Promise<Record<string, unknown>> {
  const res = await send('POST', path, { 'X-Admin-Secret': ADMIN });
  return (await res.json()) as Record<string, unknown>;
}

const UNKNOWN_MODES: SettleMode[] = [
  'html502',
  'json500',
  'json500success',
  'reset',
  'pending',
  'reverted',
];

describe('D1 : une issue de règlement inconnue n’est jamais un refus', () => {
  for (const mode of UNKNOWN_MODES) {
    it(`clé neuve, facilitateur en « ${mode} » : 502, achat en attente, clé gardée, alerte, rapprochement possible`, async () => {
      const { header } = await paid('1k');
      facilitator.settleMode = mode;
      const settledBefore = facilitator.calls.settle;
      const res = await send('POST', '/v1/credits/buy/1k', { 'payment-signature': header }, {});
      // La demande de règlement a bien atteint le facilitateur : l'argent a
      // pu partir.
      expect(facilitator.calls.settle).toBeGreaterThan(settledBefore);
      expect(res.status).toBe(502);
      const body = (await res.json()) as {
        error: string;
        settlement: { paid: unknown };
        recovery_url?: string;
      };
      expect(body.error).toBe('settlement_unconfirmed');
      expect(body.settlement.paid).toBeNull();
      expect(body.recovery_url).toContain(refOf(header));

      const p = purchase(header);
      expect(p.outcome).toBe('pending');
      const k = keyRow(p.key_hash);
      expect(k.active).toBe(0);
      // La clé brute est GARDÉE : c'est elle que l'acheteur récupérera si le
      // règlement a eu lieu.
      expect(k.raw_key_one_time_view).not.toBeNull();
      expect(k.deactivated_at).toBeNull();
      expect(alerted(`x402:purchase-unconfirmed:${p.id}`)).toBe(true);

      // Le rapprochement à la main fonctionne : la clé s'active, puis se
      // récupère une fois.
      expect((await admin(`/v1/admin/purchases/${String(p.id)}/confirm`)).status).toBe('minted');
      const recovered = await send('GET', `/v1/credits/recover/${refOf(header)}`);
      expect(recovered.status).toBe(200);
      const key = (await recovered.json()) as { api_key: string };
      expect(validateApiKey(key.api_key).creditsRemaining).toBe(1000);
    });
  }

  it('recharge, connexion coupée : 502, en attente, alerte, puis créditée par la confirmation', async () => {
    const key = freeKey('d1-topup');
    const { header } = await paid('1k');
    facilitator.settleMode = 'reset';
    const res = await send(
      'POST',
      '/v1/credits/buy/1k',
      { Authorization: `Bearer ${key.api_key}`, 'payment-signature': header },
      {},
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { recovery_note?: string };
    expect(String(body.recovery_note)).toMatch(/do not pay again/i);
    const p = purchase(header);
    expect(p.outcome).toBe('pending');
    expect(validateApiKey(key.api_key).creditsRemaining).toBeUndefined();
    expect(alerted(`x402:purchase-unconfirmed:${p.id}`)).toBe(true);
    expect((await admin(`/v1/admin/purchases/${String(p.id)}/confirm`)).status).toBe('credited');
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(1000);
  });

  it('en attente au premier appel, réglé à la relance du SDK : 201, clé active, aucune alerte', async () => {
    const { header } = await paid('1k');
    facilitator.settleMode = 'pending_then_success';
    const settledBefore = facilitator.calls.settle;
    const res = await send('POST', '/v1/credits/buy/1k', { 'payment-signature': header }, {});
    expect(facilitator.calls.settle - settledBefore).toBe(2);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { api_key: string };
    expect(validateApiKey(body.api_key).creditsRemaining).toBe(1000);
    expect(purchase(header).outcome).toBe('minted');
    expect(purchaseAlerts()).toBe(0);
  });

  it('un refus propre reste un refus : 402, achat en échec, aucune alerte', async () => {
    const { header } = await paid('1k');
    facilitator.settleMode = 'refuse';
    const res = await send('POST', '/v1/credits/buy/1k', { 'payment-signature': header }, {});
    expect(res.status).toBe(402);
    const p = purchase(header);
    expect(p.outcome).toBe('failed');
    expect(keyRow(p.key_hash).raw_key_one_time_view).toBeNull();
    expect(purchaseAlerts()).toBe(0);
  });

  it('une route payée à l’appel : une erreur réseau pendant le règlement rend 502, plus 402', async () => {
    const accepts = await requirementsFor('GET', '/v1/bic/DEUTDEFFXXX');
    facilitator.settleMode = 'reset';
    const res = await send('GET', '/v1/bic/DEUTDEFFXXX', {
      'payment-signature': encodePayment(paymentFor(accepts)),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; recovery_url?: string };
    expect(body.error).toBe('settlement_unconfirmed');
    // Rien n'a été frappé sur une route payée à l'appel : aucun lien.
    expect(body.recovery_url).toBeUndefined();
  });
});

describe('D2 : un paiement déjà vu, ni crédité ni frappé, n’est jamais réglé à nouveau', () => {
  it('recharge refusée puis rejouée : 409, rien de réglé, rien de crédité', async () => {
    const key = freeKey('d2-topup');
    const { header } = await paid('1k');
    const auth = { Authorization: `Bearer ${key.api_key}`, 'payment-signature': header };
    facilitator.settleMode = 'refuse';
    expect((await send('POST', '/v1/credits/buy/1k', auth, {})).status).toBe(402);
    expect(purchase(header).outcome).toBe('failed');

    facilitator.settleMode = 'success';
    const settledBefore = facilitator.calls.settle;
    const replay = await send('POST', '/v1/credits/buy/1k', auth, {});
    expect(replay.status).toBe(409);
    const body = (await replay.json()) as { error: string; purchase_status: string };
    expect(body.error).toBe('payment_refused');
    expect(body.purchase_status).toBe('failed');
    // Le SDK ne règle jamais une réponse d'erreur : aucun appel de plus.
    expect(facilitator.calls.settle).toBe(settledBefore);
    expect(purchase(header).outcome).toBe('failed');
    expect(validateApiKey(key.api_key).creditsRemaining).toBeUndefined();
  });

  it('clé neuve refusée puis rejouée : 409, sans lien de récupération', async () => {
    const { header } = await paid('5k');
    facilitator.settleMode = 'refuse';
    expect(
      (await send('POST', '/v1/credits/buy/5k', { 'payment-signature': header }, {})).status,
    ).toBe(402);
    facilitator.settleMode = 'success';
    const settledBefore = facilitator.calls.settle;
    const replay = await send('POST', '/v1/credits/buy/5k', { 'payment-signature': header }, {});
    expect(replay.status).toBe(409);
    const body = (await replay.json()) as Record<string, unknown>;
    expect(body.recovery_url).toBeUndefined();
    expect(facilitator.calls.settle).toBe(settledBefore);
    expect((await send('GET', `/v1/credits/recover/${refOf(header)}`)).status).toBe(404);
  });

  it('achat en attente rejoué : 409, « ne payez pas deux fois », rien de réglé', async () => {
    const { header } = await paid('1k');
    facilitator.settleMode = 'pending';
    expect(
      (await send('POST', '/v1/credits/buy/1k', { 'payment-signature': header }, {})).status,
    ).toBe(502);
    facilitator.settleMode = 'success';
    const settledBefore = facilitator.calls.settle;
    const replay = await send('POST', '/v1/credits/buy/1k', { 'payment-signature': header }, {});
    expect(replay.status).toBe(409);
    const body = (await replay.json()) as { error: string; message: string };
    expect(body.error).toBe('payment_pending');
    expect(body.message).toMatch(/do not pay again/i);
    expect(facilitator.calls.settle).toBe(settledBefore);
    expect(purchase(header).outcome).toBe('pending');
  });
});

describe('D7 : une recharge repliée sur une clé neuve le dit au client', () => {
  it('la clé présentée est révoquée pendant le règlement : 201 réécrit, avec la clé neuve', async () => {
    const key = freeKey('d7');
    const { header } = await paid('1k');
    facilitator.onSettle = () => {
      revokeApiKey(key.api_key);
    };
    const res = await send(
      'POST',
      '/v1/credits/buy/1k',
      { Authorization: `Bearer ${key.api_key}`, 'payment-signature': header },
      {},
    );
    expect(res.status).toBe(201);
    // Les en-têtes de règlement du SDK survivent à la réécriture.
    expect(res.headers.get('payment-response')).toBeTruthy();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.same_key).toBe(false);
    expect(body.recharged).toBe(false);
    expect(body.api_key).not.toBe(key.api_key);
    expect(String(body.recovery_url)).toContain(refOf(header));
    expect(validateApiKey(body.api_key as string).creditsRemaining).toBe(1000);
    const p = purchase(header);
    expect(p.outcome).toBe('minted_fallback');
    expect(alerted(`x402:topup-fallback:${p.id}`)).toBe(true);
  });
});

describe('D9 : une route qui échoue après avoir ouvert l’achat', () => {
  it('sans règlement tenté, l’achat passe en échec et la clé neuve reste morte', async () => {
    const { header } = await paid('1k');
    vi.mocked(buildFirstCallCurl).mockImplementationOnce(() => {
      throw new Error('route failure after the purchase was opened');
    });
    const settledBefore = facilitator.calls.settle;
    const res = await send('POST', '/v1/credits/buy/1k', { 'payment-signature': header }, {});
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(facilitator.calls.settle).toBe(settledBefore);
    const p = purchase(header);
    expect(p.outcome).toBe('failed');
    expect(keyRow(p.key_hash).active).toBe(0);
    expect(keyRow(p.key_hash).raw_key_one_time_view).toBeNull();
  });
});

describe('D10 : le registre garde de quoi rapprocher, jamais la signature', () => {
  it('un achat en attente porte le payeur, le nonce et le hash de transaction', async () => {
    const { header, nonce } = await paid('1k');
    facilitator.settleMode = 'pending';
    expect(
      (await send('POST', '/v1/credits/buy/1k', { 'payment-signature': header }, {})).status,
    ).toBe(502);
    const p = purchase(header);
    expect(String(p.payer_address).toLowerCase()).toBe(FAKE_PAYER.toLowerCase());
    expect(p.auth_nonce).toBe(nonce);
    expect(p.tx_hash).toBe(facilitator.lastTransaction);
    expect(JSON.stringify(p)).not.toContain(SIGNATURE_BODY);

    // La liste d'administration les montre : le rapprochement n'est plus à
    // l'aveugle.
    const list = await send('GET', '/v1/admin/purchases?outcome=pending', {
      'X-Admin-Secret': ADMIN,
    });
    const rows = ((await list.json()) as { purchases: Array<Record<string, unknown>> }).purchases;
    const listed = rows.find((r) => r.id === p.id);
    expect(listed).toMatchObject({ auth_nonce: nonce, tx_hash: facilitator.lastTransaction });
    expect(JSON.stringify(rows)).not.toContain(SIGNATURE_BODY);
  });

  it('un achat réglé garde aussi son hash de transaction', async () => {
    const { header } = await paid('1k');
    expect(
      (await send('POST', '/v1/credits/buy/1k', { 'payment-signature': header }, {})).status,
    ).toBe(201);
    expect(purchase(header).tx_hash).toBe(facilitator.lastTransaction);
  });
});

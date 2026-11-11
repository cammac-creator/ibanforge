/**
 * La vue unique d'une clé achetée en USDC s'efface à la PREMIÈRE requête faite
 * avec la clé (SEC-05#3, audit du 10.11.2026), et seulement alors.
 *
 * Une clé qui sert prouve que son acheteur l'a reçue ; rien d'autre côté
 * serveur ne le prouve (la réponse d'achat peut se perdre après le mandataire).
 * Donc :
 *  - après un achat réussi et AVANT tout usage, `recover` rend la clé, une fois ;
 *  - après une requête reconnue avec la clé, `recover` répond 404 ;
 *  - une clé inconnue n'efface rien ;
 *  - après un 502 d'issue inconnue, la clé reste récupérable ;
 *  - une clé achetée par carte n'est pas touchée.
 *
 * À travers le VRAI paywall devant le facilitateur local, comme
 * credits-buy.settlement.test.ts.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import type Stripe from 'stripe';

vi.mock('../lib/ops-alert.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/ops-alert.js')>();
  return { ...actual, opsFail: vi.fn(async () => undefined) };
});

import { buildApp } from '../app.js';
import { resetX402Paywall } from '../middleware/x402.js';
import { processStripeEvent } from './stripe-webhook.js';
import { generateApiKey, revokeApiKey, validateApiKey } from '../lib/api-keys.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import {
  encodePayment,
  paymentFor,
  startFakeFacilitator,
  type FakeFacilitator,
} from '../test-support/fake-facilitator.js';

const WALLET = '0x00000000000000000000000000000000000000A1';
const ADMIN = 'admin-secret-for-view-erasure-tests-01';
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
  process.env.ADMIN_SECRET = ADMIN;
  delete process.env.CDP_API_KEY_ID;
  delete process.env.CDP_API_KEY_SECRET;
  delete process.env.IBANFORGE_FREE_MODE;
  delete process.env.X402_SETTLE_TIMEOUT_MS;
  resetX402Paywall();
  facilitator.settleMode = 'success';
  facilitator.onSettle = null;
});

afterEach(() => resetX402Paywall());

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
      'x-real-ip': `198.51.100.${(ip % 250) + 1}`,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function paid(bundle: string): Promise<string> {
  const res = await send('POST', `/v1/credits/buy/${bundle}`, {}, {});
  expect(res.status).toBe(402);
  const accepts = ((await res.json()) as { accepts: Array<Record<string, unknown>> }).accepts;
  return encodePayment(paymentFor(accepts[0]));
}

const refOf = (header: string): string =>
  createHash('sha256').update(header).digest('hex').slice(0, 32);

function purchase(header: string): { id: number; outcome: string; key_hash: string } {
  const row = getStatsDB()
    .prepare('SELECT id, outcome, key_hash FROM key_purchases WHERE payment_ref = ?')
    .get(`x402:${refOf(header)}`) as { id: number; outcome: string; key_hash: string } | undefined;
  if (!row) throw new Error('aucune ligne au registre pour ce paiement');
  return row;
}

function viewOf(keyHash: string): string | null {
  return (
    getStatsDB()
      .prepare('SELECT raw_key_one_time_view FROM api_keys WHERE key_hash = ?')
      .get(keyHash) as { raw_key_one_time_view: string | null }
  ).raw_key_one_time_view;
}

/** Un achat réussi d'une clé neuve : la clé et sa référence. */
async function buyNewKey(): Promise<{
  apiKey: string;
  ref: string;
  header: string;
  note: string;
}> {
  const header = await paid('1k');
  const res = await send('POST', '/v1/credits/buy/1k', { 'payment-signature': header }, {});
  expect(res.status).toBe(201);
  const body = (await res.json()) as { api_key: string; recovery_note: string };
  return { apiKey: body.api_key, ref: refOf(header), header, note: body.recovery_note };
}

async function validateWith(key: string): Promise<Response> {
  return send(
    'POST',
    '/v1/iban/validate',
    { Authorization: `Bearer ${key}` },
    { iban: VALID_IBAN },
  );
}

describe('SEC-05#3 : la vue d’une clé USDC tient jusqu’à son premier usage', () => {
  it('avant tout usage, recover rend la clé, une fois, comme avant', async () => {
    const { apiKey, ref } = await buyNewKey();
    const recovered = await send('GET', `/v1/credits/recover/${ref}`);
    expect(recovered.status).toBe(200);
    expect(((await recovered.json()) as { api_key: string }).api_key).toBe(apiKey);
    expect((await send('GET', `/v1/credits/recover/${ref}`)).status).toBe(404);
  });

  it('la note de récupération du 201 dit que la récupération tient jusqu’au premier usage', async () => {
    const { note } = await buyNewKey();
    expect(note).toMatch(/only until the key is first used/);
    // Ce qui ferme la récupération, dit comme le code le fait : les routes de
    // gestion des clés et du solde passent avant le middleware des clés.
    expect(note).toMatch(/key and balance endpoints do not count/);
  });

  it('après une première requête avec la clé, recover répond 404 et le dit', async () => {
    const { apiKey, ref, header } = await buyNewKey();
    expect(viewOf(purchase(header).key_hash)).not.toBeNull();

    const used = await validateWith(apiKey);
    expect(used.status).toBe(200);
    expect(viewOf(purchase(header).key_hash)).toBeNull();

    const recovered = await send('GET', `/v1/credits/recover/${ref}`);
    expect(recovered.status).toBe(404);
    expect(((await recovered.json()) as { message: string }).message).toMatch(
      /has been used, so it reached you/,
    );
    // La clé sert toujours : rien d'autre n'a bougé que la vue.
    expect(validateApiKey(apiKey).creditsRemaining).toBe(999);
  });

  it('l’acheteur qui rejoue sa requête d’achat après usage apprend qu’il détient la clé', async () => {
    const { apiKey, header } = await buyNewKey();
    expect((await validateWith(apiKey)).status).toBe(200);
    const replay = await send('POST', '/v1/credits/buy/1k', { 'payment-signature': header }, {});
    expect(replay.status).toBe(200);
    const body = (await replay.json()) as { message: string; recovery_url?: string };
    expect(body.recovery_url).toBeUndefined();
    expect(body.message).toMatch(/has been used, so you hold it/);
    expect(body.message).toMatch(/support@ibanforge\.com/);
  });

  it('consulter le solde avec la clé ne ferme pas la récupération (la note le dit)', async () => {
    const { apiKey, ref, header } = await buyNewKey();
    const balance = await send('GET', '/v1/credits/balance', { Authorization: `Bearer ${apiKey}` });
    expect(balance.status).toBe(200);
    expect(viewOf(purchase(header).key_hash)).not.toBeNull();
    expect((await send('GET', `/v1/credits/recover/${ref}`)).status).toBe(200);
  });

  it('une clé inconnue présentée n’efface rien', async () => {
    const { ref, header } = await buyNewKey();
    const unknown = `ifk_${randomBytes(32).toString('hex')}`;
    await validateWith(unknown);
    expect(viewOf(purchase(header).key_hash)).not.toBeNull();
    expect((await send('GET', `/v1/credits/recover/${ref}`)).status).toBe(200);
  });

  it('après un 502 d’issue inconnue, la clé reste récupérable après rapprochement', async () => {
    const header = await paid('1k');
    facilitator.settleMode = 'html502';
    const res = await send('POST', '/v1/credits/buy/1k', { 'payment-signature': header }, {});
    expect(res.status).toBe(502);
    const p = purchase(header);
    expect(p.outcome).toBe('pending');
    expect(viewOf(p.key_hash)).not.toBeNull();

    const confirmed = await send('POST', `/v1/admin/purchases/${p.id}/confirm`, {
      'X-Admin-Secret': ADMIN,
    });
    expect(((await confirmed.json()) as { status: string }).status).toBe('minted');
    const recovered = await send('GET', `/v1/credits/recover/${refOf(header)}`);
    expect(recovered.status).toBe(200);
  });
});

/** Une requête MCP sur `/mcp`, la clé en en-tête, dans une session ou pour l'ouvrir. */
async function mcp(key: string, body: unknown, sessionId?: string): Promise<Response> {
  return send(
    'POST',
    '/mcp',
    {
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${key}`,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body,
  );
}

describe('SEC-05#3 : ce qui efface la vue, au-delà d’un appel REST (11.11.2026)', () => {
  it('un appel d’outil MCP avec la clé efface la vue ; ouvrir la session, non', async () => {
    const { apiKey, ref, header } = await buyNewKey();
    const opened = await mcp(apiKey, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'vitest-vue', version: '1.0.0' },
      },
    });
    expect(opened.status).toBe(200);
    await opened.arrayBuffer();
    const sessionId = opened.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();
    expect(viewOf(purchase(header).key_hash)).not.toBeNull();

    const called = await mcp(
      apiKey,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'validate_iban', arguments: { iban: VALID_IBAN } },
      },
      sessionId!,
    );
    expect(called.status).toBe(200);
    expect(await called.text()).toContain(VALID_IBAN);
    expect(viewOf(purchase(header).key_hash)).toBeNull();
    expect((await send('GET', `/v1/credits/recover/${ref}`)).status).toBe(404);
  });

  it('une requête refusée faute de crédits efface aussi la vue (choix assumé : la clé a servi à appeler)', async () => {
    const { apiKey, ref, header } = await buyNewKey();
    const keyHash = purchase(header).key_hash;
    getStatsDB()
      .prepare('UPDATE api_keys SET credits_remaining = 0 WHERE key_hash = ?')
      .run(keyHash);
    const refused = await validateWith(apiKey);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(viewOf(keyHash)).toBeNull();
    expect((await send('GET', `/v1/credits/recover/${ref}`)).status).toBe(404);
  });

  it('une clé neuve de repli voit sa vue effacée à son premier usage', async () => {
    const presented = generateApiKey('repli-vue@alpha.example.net');
    expect(presented).not.toBeNull();
    const header = await paid('1k');
    facilitator.onSettle = () => {
      revokeApiKey(presented!.api_key);
    };
    const res = await send(
      'POST',
      '/v1/credits/buy/1k',
      { Authorization: `Bearer ${presented!.api_key}`, 'payment-signature': header },
      {},
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { api_key: string; recharged: boolean };
    expect(body.recharged).toBe(false);
    const fallback = purchase(header);
    expect(fallback.outcome).toBe('minted_fallback');
    expect(viewOf(fallback.key_hash)).not.toBeNull();

    expect((await validateWith(body.api_key)).status).toBe(200);
    expect(viewOf(fallback.key_hash)).toBeNull();
    expect((await send('GET', `/v1/credits/recover/${refOf(header)}`)).status).toBe(404);
  });
});

describe('SEC-05#3 : les achats par carte ne changent pas', () => {
  it('une clé de pack payée par carte garde sa vue après usage', async () => {
    const sessionId = `cs_test_vue_${randomBytes(6).toString('hex')}`;
    const event = {
      id: `evt_vue_${randomBytes(6).toString('hex')}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          metadata: { bundle: '1k' },
          customer_email: null,
          customer_details: null,
          payment_status: 'paid',
          amount_total: 400,
          currency: 'usd',
        },
      },
    } as unknown as Stripe.Event;
    const minted = processStripeEvent(event);
    const rawKey = minted.notify?.rawKey;
    expect(rawKey).toBeTruthy();

    expect((await validateWith(rawKey!)).status).toBe(200);
    const row = getStatsDB()
      .prepare('SELECT raw_key_one_time_view FROM api_keys WHERE stripe_session_id = ?')
      .get(sessionId) as { raw_key_one_time_view: string | null };
    expect(row.raw_key_one_time_view).toBe(rawKey);
  });
});

import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { enrich402Middleware } from './enrich-402.js';
import { apiKeyMiddleware } from './api-key.js';
import {
  checkAndIncrementQuota,
  generateApiKey,
  generateCreditKey,
  validateApiKey,
} from '../lib/api-keys.js';
import type { HonoEnv } from '../types.js';

/**
 * Le champ `account_page` du 402 (lot C3, 25.09.2026).
 *
 * Le porteur d'une clé valide qui tombe sur le mur vient d'épuiser son
 * allocation ou ses crédits ; le 402 lui dit désormais où lire le solde et la
 * consommation de cette clé. Présent SEULEMENT quand une clé valide a été
 * présentée : ni sans clé, ni avec une clé fausse ou révoquée.
 *
 * Monté sur la vraie pile, `enrich402Middleware` puis `apiKeyMiddleware`, comme
 * `src/middleware/api-key.test.ts` : c'est le middleware de clé qui décide ce
 * qu'est une clé valide, et un test qui poserait le contexte à la main ne
 * verrait pas un prédicat mal choisi (la simple présence d'un en-tête, par
 * exemple, qui laisserait passer la clé fausse).
 *
 * 🚨 La valeur attendue est écrite en littéral, jamais relue dans la constante.
 */
const EXPECTED =
  'Balance and usage of this key: https://ibanforge.com/account (sign in with its e-mail address, or paste the key).';

/** Une annonce x402 v2 minimale, telle que le SDK la pose en en-tête. */
const ANNOUNCEMENT = Buffer.from(
  JSON.stringify({
    x402Version: 2,
    error: 'Payment required',
    resource: { url: 'https://api.ibanforge.com/v1/gated', mimeType: 'application/json' },
    accepts: [{ scheme: 'exact', network: 'eip155:8453', amount: '5000', payTo: '0x0' }],
  }),
  'utf8',
).toString('base64');

function paywalledApp() {
  const app = new Hono<HonoEnv>();
  app.use('/v1/*', enrich402Middleware());
  app.use('/v1/*', apiKeyMiddleware());
  app.get('/v1/paid', (c) => {
    if (c.get('apiKeyAuthenticated')) return c.json({ ok: true });
    return c.body('', 402);
  });
  app.get('/v1/gated', (c) => {
    if (c.get('apiKeyAuthenticated')) return c.json({ ok: true });
    return new Response('{}', { status: 402, headers: { 'payment-required': ANNOUNCEMENT } });
  });
  return app;
}

type Wall = { error?: string; account_page?: unknown; cause?: { reason?: string } };

async function wall(path: string, key?: string): Promise<{ res: Response; body: Wall }> {
  const res = await paywalledApp().request(path, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  expect(res.status).toBe(402);
  return { res, body: (await res.json()) as Wall };
}

/** Une clé anonyme valide, allocation du mois épuisée. */
function exhaustedMonthlyKey(): string {
  const key = generateApiKey(null)!.api_key;
  const { keyHash, monthlyLimit, noRecredit } = validateApiKey(key);
  let quota = checkAndIncrementQuota(keyHash, monthlyLimit, 1, noRecredit);
  while (quota.allowed) quota = checkAndIncrementQuota(keyHash, monthlyLimit, 1, noRecredit);
  return key;
}

describe('account_page: only when a valid key is presented', () => {
  it('without a key: absent', async () => {
    const { body } = await wall('/v1/paid');
    expect(body.error).toBe('payment_required');
    expect(body).not.toHaveProperty('account_page');
  });

  it('with a key that does not validate: absent', async () => {
    const { body } = await wall('/v1/paid', 'ifk_' + '0'.repeat(64));
    expect(body.cause?.reason).toBe('invalid_api_key');
    expect(body).not.toHaveProperty('account_page');
  });

  it('with a valid key whose month is used up: present, with the address of the page', async () => {
    const { body } = await wall('/v1/paid', exhaustedMonthlyKey());
    expect(body.cause?.reason).toBe('monthly_quota_exhausted');
    expect(body.account_page).toBe(EXPECTED);
  });

  it('with a valid prepaid key whose credits ran out: present', async () => {
    const key = generateCreditKey(null, 1).api_key;
    const served = await paywalledApp().request('/v1/paid', {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(served.status).toBe(200);
    const { body } = await wall('/v1/paid', key);
    expect(body.cause?.reason).toBe('credits_exhausted');
    expect(body.account_page).toBe(EXPECTED);
  });

  it('lives in the body, never in the PAYMENT-REQUIRED header', async () => {
    const { res, body } = await wall('/v1/gated', exhaustedMonthlyKey());
    expect(body.account_page).toBe(EXPECTED);
    const header = res.headers.get('payment-required');
    expect(header).not.toBeNull();
    const decoded = JSON.parse(Buffer.from(header!, 'base64').toString('utf8')) as object;
    expect(decoded).not.toHaveProperty('account_page');
  });
});

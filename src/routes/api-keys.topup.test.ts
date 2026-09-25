/**
 * Les surfaces de lecture d'une clé rechargeable (chantier « clé unique »,
 * lot B1, 25.09.2026) et les routes d'administration du registre.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { apiKeys } from './api-keys.js';
import { adminPurchases } from './admin-purchases.js';
import {
  creditKeyInTx,
  generateApiKey,
  generateCreditKey,
  recordQuotaNotice,
  validateApiKey,
} from '../lib/api-keys.js';
import { openUsdcMint, openUsdcTopup } from '../lib/key-purchases.js';
import { closeAll, getStatsDB } from '../lib/db.js';

const ADMIN = 'admin-secret-for-topup-tests';
const originalSecret = process.env.ADMIN_SECRET;

beforeAll(() => {
  process.env.ADMIN_SECRET = ADMIN;
});

afterAll(() => {
  process.env.ADMIN_SECRET = originalSecret;
  closeAll();
});

let seq = 0;
function mixedKey(credits: number) {
  seq += 1;
  const k = generateApiKey(`surface-${Date.now()}-${seq}@alpha.example.net`)!;
  const db = getStatsDB();
  db.transaction(() => creditKeyInTx(db, k.key_hash, credits))();
  return k;
}

function app() {
  const a = new Hono();
  a.route('/', apiKeys);
  a.route('/', adminPurchases);
  return a;
}

describe('/v1/credits/balance', () => {
  it('accepte les trois dialectes et sert allocation, ordre et recharge', async () => {
    const k = mixedKey(500);
    const dialects: Array<Record<string, string>> = [
      { Authorization: `Bearer ${k.api_key}` },
      { 'X-API-Key': k.api_key },
    ];
    for (const headers of dialects) {
      const res = await app().request('/v1/credits/balance', { headers });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.type).toBe('credit_bundle');
      expect(body.credits_remaining).toBe(500);
      expect(body.billing_order).toBe('allowance_then_credits');
      expect(body.allowance).toMatchObject({ basis: 'monthly', limit: 200 });
      const topup = body.topup as { by_card: Record<string, string>; same_key: boolean };
      expect(topup.same_key).toBe(true);
      expect(topup.by_card['1k']).toMatch(/client_reference_id=ifr_[0-9a-f]{32}$/);
    }
    const byQuery = await app().request(`/v1/credits/balance?api_key=${k.api_key}`);
    expect(byQuery.status).toBe(200);
  });

  it('une clé de pack n’a pas d’allocation, et une clé gratuite a ses liens', async () => {
    const pack = generateCreditKey(null, 1000);
    const packBody = (await (
      await app().request('/v1/credits/balance', { headers: { 'X-API-Key': pack.api_key } })
    ).json()) as Record<string, unknown>;
    expect(packBody.allowance).toBeNull();
    expect(packBody.billing_order).toBeUndefined();
    const free = generateApiKey(`balance-free-${Date.now()}@alpha.example.net`)!;
    const freeBody = (await (
      await app().request('/v1/credits/balance', { headers: { 'X-API-Key': free.api_key } })
    ).json()) as Record<string, unknown>;
    expect(freeBody.type).toBe('subscription');
    expect((freeBody.topup as { by_card: Record<string, string> }).by_card['25k']).toContain(
      'client_reference_id=ifr_',
    );
  });
});

describe('/v1/keys/usage d’une clé mixte', () => {
  it('dit l’assiette de l’allocation, le solde et l’ordre de facturation', async () => {
    const k = mixedKey(300);
    const body = (await (
      await app().request('/v1/keys/usage', { headers: { Authorization: `Bearer ${k.api_key}` } })
    ).json()) as Record<string, unknown>;
    expect(body.basis).toBe('monthly');
    expect(body.limit).toBe(200);
    expect(body.credits_remaining).toBe(300);
    expect(body.credits_total).toBe(300);
    expect(body.billing_order).toBe('allowance_then_credits');
    expect(body.topup).toMatchObject({ same_key: true });
  });
});

describe('/v1/keys/revoke et /v1/keys/rotate', () => {
  it('la révocation prévient que les crédits restants sont perdus', async () => {
    const pack = generateCreditKey(null, 1000);
    const res = await app().request('/v1/keys/revoke', {
      method: 'POST',
      headers: { Authorization: `Bearer ${pack.api_key}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warning?: string };
    expect(body.warning).toContain('1000 prepaid credits');
    expect(body.warning).toContain('/v1/keys/rotate');
  });

  it('la rotation garde l’allocation écrite, l’assiette et les verrous d’alerte', async () => {
    const k = mixedKey(1000);
    const before = validateApiKey(k.api_key);
    expect(recordQuotaNotice(k.key_hash, 'credits-1000')).toBe(true);
    const res = await app().request('/v1/keys/rotate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${k.api_key}` },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      api_key: string;
      monthly_limit: number;
      basis: string;
    };
    expect(body.monthly_limit).toBe(200);
    expect(body.basis).toBe('monthly');
    const after = validateApiKey(body.api_key);
    expect(after.creditsNoticeBase).toBe(before.creditsNoticeBase);
    // Le verrou a suivi : pas de second mail pour le même pack après /rotate.
    expect(recordQuotaNotice(after.keyHash, 'credits-1000')).toBe(false);

    const pack = generateCreditKey(null, 500);
    const packRot = (await (
      await app().request('/v1/keys/rotate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${pack.api_key}` },
      })
    ).json()) as { monthly_limit: number; basis: string };
    expect(packRot.monthly_limit).toBe(0);
    expect(packRot.basis).toBe('credits');
  });
});

describe('les routes d’administration du registre', () => {
  const admin = { 'X-Admin-Secret': ADMIN, 'Content-Type': 'application/json' };

  it('confirment une recharge en attente une fois, et listent les achats en attente', async () => {
    const k = generateApiKey(`admin-topup-${Date.now()}@alpha.example.net`)!;
    const opened = openUsdcTopup(
      { keyHash: k.key_hash, keyPrefix: k.key_prefix },
      {
        paymentRef: `x402:${'d'.repeat(24)}${Date.now().toString(16).slice(-8)}`,
        bundle: '1k',
        credits: 1000,
        quotedUsd: 4,
        payerEmail: null,
      },
    );
    if (!('opened' in opened)) throw new Error('attendu : une ligne ouverte');
    const list = (await (
      await app().request('/v1/admin/purchases?outcome=pending', { headers: admin })
    ).json()) as { purchases: Array<Record<string, unknown>> };
    const row = list.purchases.find((p) => p.id === opened.opened);
    expect(row).toMatchObject({ outcome: 'pending', key_prefix: k.key_prefix });
    // Jamais le hash de la clé ni de la lignée.
    expect(JSON.stringify(list)).not.toContain(k.key_hash);

    const confirm = await app().request(`/v1/admin/purchases/${opened.opened}/confirm`, {
      method: 'POST',
      headers: admin,
    });
    expect(((await confirm.json()) as { status: string }).status).toBe('credited');
    expect(validateApiKey(k.api_key).creditsRemaining).toBe(1000);
    const again = await app().request(`/v1/admin/purchases/${opened.opened}/confirm`, {
      method: 'POST',
      headers: admin,
    });
    expect(((await again.json()) as { status: string }).status).toBe('unchanged');
    expect(validateApiKey(k.api_key).creditsRemaining).toBe(1000);
  });

  it('échouent une frappe en attente : la clé reste morte', async () => {
    const ref = `${'e'.repeat(24)}${Date.now().toString(16).slice(-8)}`;
    const opened = openUsdcMint(null, {
      paymentRef: `x402:${ref}`,
      ref,
      bundle: '1k',
      credits: 1000,
      quotedUsd: 4,
      payerEmail: null,
    });
    if (!('opened' in opened)) throw new Error('attendu : une ligne ouverte');
    const res = await app().request(`/v1/admin/purchases/${opened.opened}/fail`, {
      method: 'POST',
      headers: admin,
    });
    expect(((await res.json()) as { status: string }).status).toBe('failed');
    expect(validateApiKey(opened.mint.api_key).valid).toBe(false);
  });

  it('refusent une reprise sans motif valable', async () => {
    const res = await app().request('/v1/admin/purchases/1/clawback', {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ reason: 'because' }),
    });
    expect(res.status).toBe(400);
  });
});

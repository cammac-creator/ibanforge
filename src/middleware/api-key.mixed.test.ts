/**
 * La règle B (décision du 24.09.2026, chantier « clé unique », lot B1) : sur
 * une clé qui a une allocation ET des crédits, l'allocation du mois passe
 * d'abord, puis les crédits ; un lot qui déborde est découpé, dans une seule
 * transaction, tout ou rien.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { apiKeyMiddleware } from './api-key.js';
import { ibanValidate } from '../routes/iban-validate.js';
import { ibanBatch } from '../routes/iban-batch.js';
import {
  creditKeyInTx,
  generateApiKey,
  generateCreditKey,
  generateOemKey,
  PRO_MONTHLY_LIMIT,
  validateApiKey,
} from '../lib/api-keys.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import type { HonoEnv } from '../types.js';

afterAll(() => closeAll());

const VALID_IBAN = 'CH9300762011623852957';
const MONTH = () => new Date().toISOString().slice(0, 7);
let seq = 0;

function app() {
  const a = new Hono<HonoEnv>();
  a.use('/v1/*', apiKeyMiddleware());
  a.route('/', ibanValidate);
  a.route('/', ibanBatch);
  return a;
}

/** Une clé gratuite (200 par mois) qui porte aussi `credits` crédits. */
function mixedKey(credits: number, usedThisMonth = 0) {
  seq += 1;
  const k = generateApiKey(`mixed-${Date.now()}-${seq}@alpha.example.net`);
  if (!k) throw new Error('frappe impossible');
  const db = getStatsDB();
  db.transaction(() => creditKeyInTx(db, k.key_hash, credits))();
  if (usedThisMonth > 0) setUsage(k.key_hash, usedThisMonth);
  return k;
}

function setUsage(keyHash: string, count: number, month = MONTH()): void {
  getStatsDB()
    .prepare(
      `INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, ?)
       ON CONFLICT(key_hash, month) DO UPDATE SET count = excluded.count`,
    )
    .run(keyHash, month, count);
}

function usage(keyHash: string, month = MONTH()): number {
  return (
    (
      getStatsDB()
        .prepare('SELECT count FROM api_usage WHERE key_hash = ? AND month = ?')
        .get(keyHash, month) as { count: number } | undefined
    )?.count ?? 0
  );
}

async function validate(key: string): Promise<Response> {
  return app().request('/v1/iban/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ iban: VALID_IBAN }),
  });
}

async function batch(key: string, ibans: unknown[]): Promise<Response> {
  return app().request('/v1/iban/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ ibans }),
  });
}

describe('la règle B sur une clé mixte', () => {
  it('allocation d’abord puis crédits', async () => {
    const k = mixedKey(100);
    const first = await validate(k.api_key);
    expect(first.status).toBe(200);
    expect(first.headers.get('x-charged-from')).toBe('allowance');
    expect(first.headers.get('x-quota-used')).toBe('1');
    expect(first.headers.get('x-credits-remaining')).toBe('100');
    expect(validateApiKey(k.api_key).creditsRemaining).toBe(100);

    setUsage(k.key_hash, 200);
    const second = await validate(k.api_key);
    expect(second.status).toBe(200);
    expect(second.headers.get('x-charged-from')).toBe('credits');
    expect(second.headers.get('x-credits-remaining')).toBe('99');
    expect(validateApiKey(k.api_key).creditsRemaining).toBe(99);
    // L'appel payé en crédits est aussi compté dans le mois : une observation.
    expect(usage(k.key_hash)).toBe(201);
  });

  it('lot à cheval découpé 30 + 20', async () => {
    const k = mixedKey(100, 170);
    const ibans = Array.from({ length: 50 }, () => VALID_IBAN);
    const res = await batch(k.api_key, ibans);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-charged-from')).toBe('allowance+credits');
    expect(res.headers.get('x-quota-charged')).toBe('30');
    expect(res.headers.get('x-credits-charged')).toBe('20');
    expect(res.headers.get('x-credits-remaining')).toBe('80');
    expect(validateApiKey(k.api_key).creditsRemaining).toBe(80);
    expect(usage(k.key_hash)).toBe(220);
  });

  it('lot refusé tout ou rien si les crédits manquent', async () => {
    const k = mixedKey(10, 170);
    const res = await batch(
      k.api_key,
      Array.from({ length: 50 }, () => VALID_IBAN),
    );
    expect(res.headers.get('x-credits-insufficient')).toBe('true');
    expect(res.headers.get('x-credits-required')).toBe('20');
    expect(res.headers.get('x-quota-remaining')).toBe('30');
    // Rien n'a été consommé : ni l'allocation, ni les crédits.
    expect(validateApiKey(k.api_key).creditsRemaining).toBe(10);
    expect(usage(k.key_hash)).toBe(170);
  });

  it('un 4xx rend les deux compteurs sur le mois facturé', async () => {
    const k = mixedKey(100, 190);
    // Trente éléments, dont un qui n'est pas une chaîne : la route répond 400.
    const ibans: unknown[] = Array.from({ length: 29 }, () => VALID_IBAN);
    ibans.push(42);
    const res = await batch(k.api_key, ibans);
    expect(res.status).toBe(400);
    expect(validateApiKey(k.api_key).creditsRemaining).toBe(100);
    expect(usage(k.key_hash)).toBe(190);
    expect(res.headers.get('x-credits-remaining')).toBe('100');
    expect(res.headers.get('x-quota-used')).toBe('190');
  });

  it('une clé de pack n’a jamais 200 par mois', async () => {
    const pack = generateCreditKey(null, 5);
    const v = validateApiKey(pack.api_key);
    expect(v.monthlyLimit).toBe(0);
    for (let i = 0; i < 5; i++) {
      const res = await validate(pack.api_key);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-charged-from')).toBe('credits');
      // Aucun plafond mensuel n'est opposé ni annoncé.
      expect(res.headers.get('x-quota-limit')).toBeNull();
    }
    const empty = await validate(pack.api_key);
    expect(empty.headers.get('x-credits-exhausted')).toBe('true');
    expect(empty.headers.get('x-quota-exhausted')).toBeNull();
    expect(validateApiKey(pack.api_key).creditsRemaining).toBe(0);
  });

  it('X-Charged-From dit quel compteur a payé l’appel', async () => {
    const free = generateApiKey(`plain-${Date.now()}@alpha.example.net`)!;
    expect((await validate(free.api_key)).headers.get('x-charged-from')).toBe('allowance');
    const pack = generateCreditKey(null, 10);
    expect((await validate(pack.api_key)).headers.get('x-charged-from')).toBe('credits');
    // Une route gratuite ne dit rien : aucun compteur n'a payé.
    const res = await app().request(`/v1/iban/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pack.api_key}` },
      body: '{}',
    });
    expect(res.status).toBe(400);
  });

  it('attribution seulement sur le gratuit, jamais sur un appel payé en crédits', async () => {
    const k = mixedKey(50);
    const onAllowance = (await (await validate(k.api_key)).json()) as Record<string, unknown>;
    expect(onAllowance.attribution).toBeDefined();
    setUsage(k.key_hash, 200);
    const onCredits = (await (await validate(k.api_key)).json()) as Record<string, unknown>;
    expect(onCredits.attribution).toBeUndefined();
    // Une clé Pro rechargée n'en porte pas plus qu'avant.
    const pro = generateOemKey(null, PRO_MONTHLY_LIMIT, `cs_test_mixed_${Date.now()}`, null);
    const proBody = (await (await validate(pro.api_key!)).json()) as Record<string, unknown>;
    expect(proBody.attribution).toBeUndefined();
  });

  it('X-Quota-Used plafonné à l’allocation', async () => {
    const k = mixedKey(100, 250);
    const res = await validate(k.api_key);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-charged-from')).toBe('credits');
    expect(res.headers.get('x-quota-used')).toBe('200');
    expect(res.headers.get('x-quota-limit')).toBe('200');
    expect(res.headers.get('x-quota-remaining')).toBe('0');
  });
});

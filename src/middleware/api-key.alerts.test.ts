/**
 * Le middleware des clés après le chantier « compte client et alertes » (lot 1,
 * 27.11.2026) : les seuils franchis partent en alerte hors du chemin chaud,
 * l'en-tête reste celui des 80 %, et le refus d'une clé qui PAIE ne dit jamais
 * « free tier » : il dit l'allocation de sa formule et la date de remise à zéro.
 *
 * Relais et canal de l'exploitant simulés : rien ne sort. Fixtures inventées.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

const relay = vi.fn(async (_mail: { to: string; subject: string; text: string }) => true);
vi.mock('../lib/mail-transport.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    isRelayConfigured: () => true,
    sendViaRelay: (mail: { to: string; subject: string; text: string }) => relay(mail),
  };
});
const operator = vi.fn(async (_kind: string, _text: string) => true);
vi.mock('../lib/admin-alerts.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, adminEventAlertSent: (kind: string, text: string) => operator(kind, text) };
});

import { apiKeyMiddleware } from './api-key.js';
import {
  PRO_MONTHLY_LIMIT,
  checkAndIncrementQuota,
  generateApiKey,
  generateOemKey,
  validateApiKey,
} from '../lib/api-keys.js';
import { writeThresholds } from '../lib/quota-alerts.js';
import { getStatsDB } from '../lib/db.js';
import { FREE_TIER_MONTHLY_LIMIT } from '../lib/tiers.js';
import type { HonoEnv } from '../types.js';

const RUN = Date.now();
let seq = 0;
let lastCause: { detail?: string; quota?: Record<string, unknown> } | undefined;

function makeApp(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.use('/v1/*', apiKeyMiddleware());
  app.post('/v1/probe', (c) => {
    lastCause = c.get('paywallCause') as typeof lastCause;
    return c.json({ ok: true });
  });
  return app;
}

function aged(keyHash: string): string {
  getStatsDB()
    .prepare("UPDATE api_keys SET created_at = datetime('now', '-3 days') WHERE key_hash = ?")
    .run(keyHash);
  return keyHash;
}

function newKey(kind: 'free' | 'pro'): { raw: string; hash: string; email: string } {
  const email = `alerts-${RUN}-${++seq}@alpha.example.net`;
  const raw =
    kind === 'pro'
      ? generateOemKey(email, PRO_MONTHLY_LIMIT, `cs_${RUN}_${seq}`, `sub_${RUN}_${seq}`).api_key!
      : generateApiKey(email)!.api_key;
  return { raw, hash: aged(validateApiKey(raw).keyHash), email };
}

const call = (app: Hono<HonoEnv>, raw: string) =>
  app.request('/v1/probe', { method: 'POST', headers: { Authorization: `Bearer ${raw}` } });

beforeEach(() => {
  relay.mockClear();
  operator.mockClear();
  lastCause = undefined;
});

describe('les seuils franchis par un appel servi', () => {
  it('une clé Pro à 80 % : en-tête X-Quota-Notice, alerte au texte Pro, message à l’exploitant', async () => {
    const k = newKey('pro');
    checkAndIncrementQuota(k.hash, PRO_MONTHLY_LIMIT, 7999);
    const res = await call(makeApp(), k.raw);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Quota-Notice')).toBe('threshold-crossed');
    await vi.waitFor(() => expect(relay).toHaveBeenCalledTimes(1));
    const mail = relay.mock.calls[0][0];
    expect(mail.to).toBe(k.email);
    expect(mail.text).toContain('of the 10,000 requests of your Pro plan');
    expect(mail.text).not.toMatch(/free/i);
    expect(operator).toHaveBeenCalledTimes(1);
  });

  it('le seuil de 50 % choisi par le client part, sans l’en-tête réservé aux 80 %', async () => {
    const k = newKey('free');
    writeThresholds(k.hash, [50]);
    checkAndIncrementQuota(k.hash, FREE_TIER_MONTHLY_LIMIT, 99);
    const res = await call(makeApp(), k.raw);
    expect(res.headers.get('X-Quota-Notice')).toBeNull();
    await vi.waitFor(() => expect(relay).toHaveBeenCalledTimes(1));
    expect(relay.mock.calls[0][0].subject).toContain('(50% alert)');
  });

  it('sans réglage, 50 % ne dit rien : 80 % seul, comme avant', async () => {
    const k = newKey('free');
    checkAndIncrementQuota(k.hash, FREE_TIER_MONTHLY_LIMIT, 99);
    await call(makeApp(), k.raw);
    // Laisse le temps à une alerte fautive de partir.
    await new Promise((r) => setTimeout(r, 30));
    expect(relay).not.toHaveBeenCalled();
    // …et 80 % part toujours.
    checkAndIncrementQuota(k.hash, FREE_TIER_MONTHLY_LIMIT, 59);
    const res = await call(makeApp(), k.raw);
    expect(res.headers.get('X-Quota-Notice')).toBe('threshold-crossed');
    await vi.waitFor(() => expect(relay).toHaveBeenCalledTimes(1));
  });

  it('un lot en rafale ne produit qu’un mail', async () => {
    const k = newKey('free');
    writeThresholds(k.hash, [50, 80, 90]);
    checkAndIncrementQuota(k.hash, FREE_TIER_MONTHLY_LIMIT, 99);
    const app = makeApp();
    await call(app, k.raw); // 100 : franchit 50
    for (let i = 0; i < 3; i += 1) await call(app, k.raw);
    await vi.waitFor(() => expect(relay).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(relay).toHaveBeenCalledTimes(1);
  });
});

describe('le refus du plafond du mois', () => {
  it('une clé Pro : l’allocation de sa formule, le 402 jusqu’à la remise à zéro, sa date', async () => {
    const k = newKey('pro');
    checkAndIncrementQuota(k.hash, PRO_MONTHLY_LIMIT, PRO_MONTHLY_LIMIT);
    const res = await call(makeApp(), k.raw);
    expect(res.headers.get('X-Quota-Exhausted')).toBe('true');
    const detail = lastCause?.detail ?? '';
    expect(detail).toContain('The 10,000 requests of your Pro plan are used up');
    expect(detail).toContain('HTTP 402');
    expect(detail).toMatch(/starts over on \d{4}-\d{2}-01 00:00 UTC/);
    expect(detail).toContain('prepaid credits');
    expect(detail).not.toMatch(/free tier/i);
    const resetsAt = res.headers.get('X-Quota-Resets-At');
    expect(resetsAt).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect(lastCause?.quota?.resets_at).toBe(resetsAt);
    // `resets` ne change pas : un client qui le lit continue de le lire.
    expect(lastCause?.quota?.resets).toBe('1st of month');
    expect(res.headers.get('X-Quota-Reset-Hint')).toBe('monthly, 1st of month');
  });

  it('une clé gratuite garde son texte', async () => {
    const k = newKey('free');
    checkAndIncrementQuota(k.hash, FREE_TIER_MONTHLY_LIMIT, FREE_TIER_MONTHLY_LIMIT);
    await call(makeApp(), k.raw);
    const detail = lastCause?.detail ?? '';
    expect(detail).toContain('Your free tier is exhausted for');
    expect(detail).toContain('it resets on the 1st of next month');
    expect(detail).not.toContain('Pro plan');
  });
});

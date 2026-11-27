/**
 * Le middleware des clés pour une clé d'abonnement basculée à la date
 * anniversaire (chantier « compte client et alertes », lot 2, 27.11.2026) : le
 * 402, son en-tête, l'alerte et GET /v1/keys/usage disent TOUS la même date de
 * remise à zéro, celle de la facturation, et jamais « le 1er ».
 *
 * Relais et canal de l'exploitant simulés : rien ne sort. Fixtures inventées.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { PRO_MONTHLY_LIMIT, generateOemKey, validateApiKey } from '../lib/api-keys.js';
import { recordSubscriptionAnchorInTx } from '../lib/quota-period.js';
import { getStatsDB } from '../lib/db.js';
import { apiKeys } from '../routes/api-keys.js';
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

/** Une clé Pro (abonnement vivant) au mois civil, puis ancrée sur la facturation du 10 décembre. */
function anchoredProKey(): { raw: string; hash: string; email: string } {
  const email = `anniv-${RUN}-${++seq}@alpha.example.net`;
  const sub = `sub_${RUN}_${seq}`;
  const raw = generateOemKey(email, PRO_MONTHLY_LIMIT, `cs_${RUN}_${seq}`, sub).api_key!;
  const hash = validateApiKey(raw).keyHash;
  const db = getStatsDB();
  db.prepare("UPDATE api_keys SET created_at = datetime('now', '-3 days') WHERE key_hash = ?").run(
    hash,
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-12-10T08:12:00Z'));
  const outcome = db
    .transaction(() =>
      recordSubscriptionAnchorInTx(db, {
        keyHash: hash,
        subscriptionId: sub,
        periodStartUnix: Math.floor(Date.parse('2026-12-10T08:00:00Z') / 1000),
        nowMs: Date.parse('2026-12-10T08:12:00Z'),
      }),
    )
    .immediate();
  expect(outcome).toBe('anchored');
  return { raw, hash, email };
}

const call = (app: Hono<HonoEnv>, raw: string) =>
  app.request('/v1/probe', { method: 'POST', headers: { Authorization: `Bearer ${raw}` } });

beforeEach(() => {
  relay.mockClear();
  operator.mockClear();
  lastCause = undefined;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('une clé d’abonnement basculée à la date anniversaire', () => {
  it('le 402 et son en-tête donnent la date anniversaire, le compteur est celui de la période', async () => {
    const k = anchoredProKey();
    const app = makeApp();
    // Épuise l'allocation en un lot (10 000 IBAN), puis un appel de plus.
    getStatsDB()
      .prepare(
        'INSERT INTO api_usage_period (key_hash, period_start, count) VALUES (?, ?, ?) ON CONFLICT(key_hash, period_start) DO UPDATE SET count = excluded.count',
      )
      .run(k.hash, '2026-12-09T23:00:00.000Z', PRO_MONTHLY_LIMIT);
    const res = await call(app, k.raw);
    expect(res.headers.get('X-Quota-Exhausted')).toBe('true');
    expect(res.headers.get('X-Quota-Resets-At')).toBe('2027-01-09T23:00:00.000Z');
    expect(res.headers.get('X-Quota-Month')).toBe('2026-12');
    expect(res.headers.get('X-Quota-Reset-Hint')).toContain('renewal day of the subscription');
    const detail = lastCause?.detail ?? '';
    expect(detail).toContain('2027-01-10 00:00 Zurich time (2027-01-09 23:00 UTC)');
    expect(detail).toContain('the period that began on 2026-12-10');
    expect(detail).not.toMatch(/1st/);
    expect(lastCause?.quota?.resets_at).toBe('2027-01-09T23:00:00.000Z');
    expect(lastCause?.quota?.resets).toBe('on the renewal day of the subscription');
  });

  it('l’alerte des 80 % dit la date anniversaire, et son verrou est celui de la période (un mail par période)', async () => {
    const k = anchoredProKey();
    getStatsDB()
      .prepare('INSERT INTO api_usage_period (key_hash, period_start, count) VALUES (?, ?, ?)')
      .run(k.hash, '2026-12-09T23:00:00.000Z', 7999);
    const res = await call(makeApp(), k.raw);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Quota-Notice')).toBe('threshold-crossed');
    await vi.waitFor(() => expect(relay).toHaveBeenCalledTimes(1));
    const mail = relay.mock.calls[0][0];
    expect(mail.text).toContain('2027-01-10 00:00 Zurich time (2027-01-09 23:00 UTC)');
    expect(operator.mock.calls[0][1]).toContain('2027-01-10 00:00 Zurich time');
    // Le verrou est sur la table des seuils, étiqueté du jour de Zurich : jamais sur
    // quota_notices, dont les lecteurs prennent chaque valeur pour un mois « AAAA-MM ».
    const db = getStatsDB();
    expect(
      db
        .prepare(
          'SELECT period FROM quota_threshold_notices WHERE key_hash = ? AND threshold = 80 ORDER BY period',
        )
        .all(k.hash),
    ).toEqual([{ period: '2026-12-10' }, { period: 'ops-2026-12-10' }]);
    expect(
      db.prepare('SELECT 1 FROM quota_notices WHERE key_hash = ?').get(k.hash),
    ).toBeUndefined();
  });

  it('GET /v1/keys/usage : month reste le mois civil, period_start et resets_at disent la vraie période', async () => {
    const k = anchoredProKey();
    getStatsDB()
      .prepare('INSERT INTO api_usage_period (key_hash, period_start, count) VALUES (?, ?, ?)')
      .run(k.hash, '2026-12-09T23:00:00.000Z', 42);
    const app = new Hono<HonoEnv>();
    app.route('/', apiKeys);
    const res = await app.request('/v1/keys/usage', {
      headers: { Authorization: `Bearer ${k.raw}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      month: '2026-12',
      used: 42,
      limit: PRO_MONTHLY_LIMIT,
      remaining: PRO_MONTHLY_LIMIT - 42,
      basis: 'monthly',
      period_basis: 'subscription',
      period_start: '2026-12-09T23:00:00.000Z',
      resets_at: '2027-01-09T23:00:00.000Z',
      resets_on: '2027-01-10',
    });
  });
});

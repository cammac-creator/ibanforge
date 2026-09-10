import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { adminAuditStats } from './admin-audit-stats.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import { auditStats } from '../lib/audit-jobs.js';

afterAll(() => closeAll());

function app() {
  const a = new Hono();
  a.route('/', adminAuditStats);
  return a;
}

describe('GET /v1/admin/audit-stats', () => {
  it('refuses without the admin secret', async () => {
    const r = await app().request('/v1/admin/audit-stats');
    expect(r.status).toBe(401);
  });

  it('answers the period, uploads, sales and revenue with the secret', async () => {
    const prev = process.env.ADMIN_SECRET;
    process.env.ADMIN_SECRET = 'test-admin-secret';
    try {
      const r = await app().request('/v1/admin/audit-stats?days=7', {
        headers: { 'X-Admin-Secret': 'test-admin-secret' },
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as Record<string, unknown>;
      expect(body.period_days).toBe(7);
      expect(typeof body.uploads).toBe('number');
      expect(typeof body.sales).toBe('number');
      expect(typeof body.revenue_chf).toBe('number');
      expect(Array.isArray(body.recent_uploads)).toBe(true);
      expect(Array.isArray(body.recent_sales)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ADMIN_SECRET;
      else process.env.ADMIN_SECRET = prev;
    }
  });
});

describe('the uploads behind the count', () => {
  it('lists each upload with the size class the API recorded, newest first', async () => {
    const { recordOperation } = await import('../lib/stats.js');
    recordOperation('audit_upload', null, true, 0, '4 rows, tier 1', null);
    recordOperation('audit_upload', null, true, 0, '1200 rows, tier 1', null);
    const prev = process.env.ADMIN_SECRET;
    process.env.ADMIN_SECRET = 'test-admin-secret';
    try {
      const r = await app().request('/v1/admin/audit-stats?days=7', {
        headers: { 'X-Admin-Secret': 'test-admin-secret' },
      });
      const body = (await r.json()) as {
        uploads: number;
        recent_uploads: Array<{
          rows: number | null;
          tier: string | null;
          key_prefix: string | null;
          internal: boolean;
        }>;
      };
      expect(body.uploads).toBeGreaterThanOrEqual(2);
      expect(body.recent_uploads.length).toBe(body.uploads);
      expect(body.recent_uploads[0]).toMatchObject({
        rows: 1200,
        key_prefix: null,
        internal: false,
      });
      expect(body.recent_uploads[1]).toMatchObject({ rows: 4 });
    } finally {
      if (prev === undefined) delete process.env.ADMIN_SECRET;
      else process.env.ADMIN_SECRET = prev;
    }
  });
});

describe('Montants des audits confirmés par Stripe', () => {
  beforeEach(() => getStatsDB().exec('DELETE FROM audit_sales'));

  function sale(amount: number | null, currency: string | null, paidAt?: string) {
    getStatsDB()
      .prepare(
        `INSERT INTO audit_sales (job_id, rows, tier, price_chf, amount_paid_minor, amount_paid_currency, paid_at)
         VALUES ('audit-fictif', 4, 'small', 149, ?, ?, COALESCE(?, datetime('now')))`,
      )
      .run(amount, currency, paidAt ?? null);
  }

  it('additionne les montants CHF après remise, sans convertir les autres devises ni deviner les inconnus', () => {
    sale(14900, 'chf');
    sale(7450, 'CHF');
    sale(0, 'chf');
    sale(null, null);
    sale(14900, 'usd');
    sale(14900, 'chf', '2000-01-01 00:00:00');

    const stats = auditStats(30);
    expect(stats.sales).toBe(5);
    expect(stats.revenue_basis).toBe('stripe_checkout');
    expect(stats.revenue_chf).toBe(223.5);
    expect(stats.payment_amounts).toEqual({ chf: 3, other_currency: 1, unknown: 1 });
    expect(stats.recent_sales).toHaveLength(5);
    expect(stats.recent_sales).toContainEqual(
      expect.objectContaining({ amount_paid_minor: 7450, amount_paid_currency: 'CHF' }),
    );
  });

  it('distingue un montant historique inconnu d’un paiement connu à zéro', () => {
    sale(null, null);
    expect(auditStats(30)).toMatchObject({
      revenue_chf: null,
      payment_amounts: { chf: 0, other_currency: 0, unknown: 1 },
    });
    getStatsDB().exec('DELETE FROM audit_sales');
    sale(0, 'chf');
    expect(auditStats(30)).toMatchObject({
      revenue_chf: 0,
      payment_amounts: { chf: 1, other_currency: 0, unknown: 0 },
    });
  });

  it('ne transforme pas une devise étrangère en francs', () => {
    sale(9900, 'usd');
    expect(auditStats(30)).toMatchObject({
      revenue_chf: null,
      payment_amounts: { chf: 0, other_currency: 1, unknown: 0 },
    });
  });

  it('signale les montants incomplets ou invalides sans les additionner', () => {
    sale(-100, 'chf');
    sale(10.5, 'chf');
    sale(100, null);
    sale(100, 'inconnue');
    expect(auditStats(30)).toMatchObject({
      revenue_chf: null,
      payment_amounts: { chf: 0, other_currency: 0, unknown: 4 },
    });
  });
});

import { describe, it, expect, afterAll } from 'vitest';
import { Hono } from 'hono';
import { adminAuditStats } from './admin-audit-stats.js';
import { closeAll } from '../lib/db.js';

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

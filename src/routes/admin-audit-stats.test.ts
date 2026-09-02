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
    } finally {
      if (prev === undefined) delete process.env.ADMIN_SECRET;
      else process.env.ADMIN_SECRET = prev;
    }
  });
});

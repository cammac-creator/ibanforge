import { Hono } from 'hono';
import { isAdminAuthorized } from './api-keys.js';
import { auditStats } from '../lib/audit-jobs.js';

/** Uploads and sales of the creditor-file audit over the last N days, for the dashboard. */
export const adminAuditStats = new Hono();

adminAuditStats.get('/v1/admin/audit-stats', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const raw = Number.parseInt(c.req.query('days') ?? '30', 10);
  const days = Number.isFinite(raw) ? Math.max(1, Math.min(365, raw)) : 30;
  return c.json(auditStats(days));
});

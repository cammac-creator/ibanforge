import { Hono } from 'hono';
import { isAdminAuthorized } from './api-keys.js';
import { signupSources } from '../lib/signup-attribution.js';

/**
 * Where the signups of the last N days came from, for the dashboard's
 * "what is new" section. Admin-only: the payload names campaign labels and
 * referring hosts, which is enough to reveal an outreach that has not been
 * announced. Read-only.
 */
export const adminSignupSources = new Hono();

adminSignupSources.get('/v1/admin/signup-sources', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const raw = Number.parseInt(c.req.query('days') ?? '30', 10);
  const days = Number.isFinite(raw) ? Math.max(1, Math.min(365, raw)) : 30;
  return c.json(signupSources(days));
});

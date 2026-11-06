import { Hono } from 'hono';
import { isAdminAuthorized } from './api-keys.js';
import { getBusinessPulse } from '../lib/business-pulse.js';

export const adminBusinessPulse = new Hono();

adminBusinessPulse.get('/v1/admin/business-pulse', (c) => {
  c.header('Cache-Control', 'private, no-store');
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return c.json(getBusinessPulse());
});

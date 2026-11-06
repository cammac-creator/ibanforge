import { Hono } from 'hono';
import { isAdminAuthorized } from './api-keys.js';
import {
  BUSINESS_COHORTS,
  getBusinessAccounts,
  getBusinessPulse,
  type BusinessCohort,
} from '../lib/business-pulse.js';

export const adminBusinessPulse = new Hono();

adminBusinessPulse.get('/v1/admin/business-pulse', (c) => {
  c.header('Cache-Control', 'private, no-store');
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return c.json(getBusinessPulse());
});

adminBusinessPulse.get('/v1/admin/business-accounts', (c) => {
  c.header('Cache-Control', 'private, no-store');
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const cohort = c.req.query('cohort');
  const page = c.req.query('page') ?? '1';
  if (!BUSINESS_COHORTS.includes(cohort as BusinessCohort) || !/^[1-9][0-9]{0,5}$/.test(page)) {
    return c.json({ error: 'invalid_selection' }, 400);
  }
  return c.json(getBusinessAccounts(cohort as BusinessCohort, Number(page)));
});

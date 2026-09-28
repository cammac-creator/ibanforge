import { Hono } from 'hono';
import { isAdminAuthorized } from './api-keys.js';
import { getBulletin } from '../lib/bulletin.js';

/**
 * The Monday bulletin (Claude-Alain's approval of 28.09.2026, step A1).
 *
 * `GET /v1/admin/bulletin?week=AAAA-Wss`: one Swiss week, the last complete one by
 * default. Read-only: every block reads what already runs (`src/lib/bulletin.ts`
 * names each source), and a block that cannot be read says `unread` instead of
 * showing zeros.
 *
 * AGGREGATES only: no address, no key, no hash. Never cached: an intermediary that
 * kept the body would show a frozen week to someone who believes they read today's
 * state. The header is set before the secret is checked, so the 401 carries it too.
 */
export const adminBulletin = new Hono();

adminBulletin.get('/v1/admin/bulletin', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return c.json(await getBulletin({ week: c.req.query('week') ?? null }));
});

import { Hono } from 'hono';
import { isAdminAuthorized } from './api-keys.js';
import {
  cachedSummary,
  isSearchConsoleConfigured,
  readSearchConsole,
  SearchConsoleError,
} from '../lib/search-console.js';

/**
 * GET /v1/admin/search-console — what Google sends the site, weekly.
 *
 * Three answers rather than two, because "the card is empty" has three
 * different causes and only one of them is worth an evening:
 *
 *   503 `not_configured` — no `GSC_SA_JSON` in this environment. Every laptop
 *        and every test run is here, and it is not an incident.
 *   502 + the last cached reading — Google refused (401, 403, the 429 of the
 *        inspection quota, a 5xx). The upstream status travels in the body, and
 *        so does the last payload that landed, marked `stale`: a week-old
 *        reading is worth more than an empty card, as long as it says it is
 *        old. The dashboard's own reader keeps this body on purpose.
 *   200  — a reading under six hours old, or a fresh one.
 *
 * Admin only: the payload names the queries the site ranks on, which is
 * competitive information we do not publish.
 */
export const adminSearchConsole = new Hono();

adminSearchConsole.get('/v1/admin/search-console', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  if (!isSearchConsoleConfigured()) {
    return c.json({ error: 'not_configured' }, 503);
  }
  try {
    const read = await readSearchConsole({ refresh: c.req.query('refresh') === '1' });
    return c.json({ ...read.summary, fetched_at: read.fetched_at, stale: false });
  } catch (err) {
    const upstream_status = err instanceof SearchConsoleError ? err.status : 0;
    const cached = cachedSummary();
    if (cached) {
      return c.json(
        {
          ...cached.summary,
          fetched_at: cached.fetched_at,
          stale: true,
          error: 'upstream',
          upstream_status,
        },
        502,
      );
    }
    return c.json({ error: 'upstream', upstream_status, stale: true }, 502);
  }
});

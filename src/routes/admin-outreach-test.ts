/**
 * GET /v1/admin/outreach-test — the measure of a one-off written offer to
 * existing key holders, read at any time during or after its window. Counts
 * only, never an address (see src/lib/outreach-test.ts for what each figure
 * means and what is deliberately not measured).
 *
 * Query:
 *  - `since`   first day of the window, YYYY-MM-DD, required;
 *  - `until`   last day, YYYY-MM-DD, inclusive; omitted: until now;
 *  - `subject` the exact subject of the message, repeated once per language
 *              (1 to 10). The campaign text never enters this repository.
 *
 * Read-only, admin secret (`X-Admin-Secret`), never cached.
 */
import { Hono } from 'hono';
import { isAdminAuthorized } from './api-keys.js';
import { summarizeOutreachTest } from '../lib/outreach-test.js';

export const adminOutreachTest = new Hono();

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

adminOutreachTest.get('/v1/admin/outreach-test', (c) => {
  c.header('Cache-Control', 'private, no-store');
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const since = c.req.query('since') ?? '';
  const until = c.req.query('until') ?? null;
  const subjects = (c.req.queries('subject') ?? []).map((s) => s.trim()).filter(Boolean);
  if (!DAY_RE.test(since) || Number.isNaN(Date.parse(`${since}T00:00:00Z`))) {
    return c.json({ error: 'invalid_since', message: 'since must be a day, YYYY-MM-DD' }, 400);
  }
  if (until !== null && (!DAY_RE.test(until) || until < since)) {
    return c.json(
      { error: 'invalid_until', message: 'until must be a day, YYYY-MM-DD, not before since' },
      400,
    );
  }
  if (subjects.length === 0 || subjects.length > 10 || subjects.some((s) => s.length > 200)) {
    return c.json(
      {
        error: 'invalid_subject',
        message:
          'Give the exact subject of the message: 1 to 10 `subject` parameters, 200 characters at most',
      },
      400,
    );
  }
  return c.json(summarizeOutreachTest({ since, until, subjects }));
});

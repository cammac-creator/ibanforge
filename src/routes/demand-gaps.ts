import { Hono } from 'hono';
import { getDemandGaps } from '../lib/demand-gaps.js';
import { monthEndedBefore, proposeFromDemand } from '../lib/demand-proposal.js';
import { readMonthlyRecord } from '../lib/demand-proposal-server.js';
import { isAdminAuthorized } from './api-keys.js';

const demandGaps = new Hono();

/**
 * The demand ledger, read side: what callers asked for that we could not
 * answer, ranked by how often. See src/lib/demand-gaps.ts for what is stored
 * and what is deliberately not.
 *
 * This is the endpoint the monthly data decision reads — "which register or
 * letter next" — and the dashboard's living-tool card. `days` windows on
 * last_seen so stale gaps age out of the ranking without being erased.
 */
demandGaps.get('/v1/admin/demand-gaps', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const raw = Number(c.req.query('days') ?? '30');
  const days = Number.isFinite(raw) ? raw : 30;
  const summary = getDemandGaps(days);
  // The live proposal for the window asked, and the record of the last
  // monthly turn (what was proposed, whether it was sent): the dashboard shows
  // both, the operator decides.
  return c.json({
    ...summary,
    proposal: proposeFromDemand(summary, monthEndedBefore(new Date())),
    monthly: readMonthlyRecord(),
  });
});

export default demandGaps;

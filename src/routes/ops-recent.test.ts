import { describe, it, expect, afterAll, vi } from 'vitest';
import { Hono } from 'hono';

// Hermetic stats DB — same idiom as stats.test.ts: the env must be set before
// any import touches db.js, whose path constant is read at module load.
const HERMETIC_DB = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? '/tmp'}/ibf-ops-recent-${process.pid}-${Date.now()}.sqlite`;
  process.env.STATS_DB_PATH = path;
  return path;
});

import { opsRecent } from './ops-recent.js';
import { recordOperation } from '../lib/stats.js';
import { closeAll } from '../lib/db.js';
import { rmSync } from 'node:fs';

const app = new Hono();
app.route('/', opsRecent);

afterAll(() => {
  closeAll();
  rmSync(HERMETIC_DB, { force: true });
  rmSync(`${HERMETIC_DB}-wal`, { force: true });
  rmSync(`${HERMETIC_DB}-shm`, { force: true });
});

interface Op {
  id: number;
  t: string;
  type: string;
  country: string | null;
  success: boolean;
}

async function fetchOps(qs = ''): Promise<{ status: number; ops: Op[] }> {
  const res = await app.request(`/v1/ops/recent${qs}`);
  const body = (await res.json()) as { ops: Op[] };
  return { status: res.status, ops: body.ops };
}

describe('GET /v1/ops/recent', () => {
  it('serves the recorded operations, newest first, as the four public fields only', async () => {
    // Written through the REAL recording path — the same one the API handlers
    // call — including an error detail and a key prefix that must NOT leak.
    recordOperation('iban_validate', 'DE', true, 0.005);
    recordOperation('bic_lookup', 'CH', true, 0.003);
    recordOperation('iban_validate', 'FR', false, 0, 'FR76', 'ibf_live_abc');

    const { status, ops } = await fetchOps();
    expect(status).toBe(200);
    expect(ops.length).toBeGreaterThanOrEqual(3);
    expect(ops[0]).toMatchObject({ type: 'iban_validate', country: 'FR', success: false });
    expect(ops[1]).toMatchObject({ type: 'bic_lookup', country: 'CH', success: true });
    for (const op of ops) {
      expect(Object.keys(op).sort()).toEqual(['country', 'id', 'success', 't', 'type']);
      expect(op.id).toBeTypeOf('number');
      expect(op.t).toBeTypeOf('string');
    }
  });

  it('filters with ?after=<id> so a poller only receives what it has not seen', async () => {
    const { ops: all } = await fetchOps();
    const newest = all[0].id;
    recordOperation('ch_clearing_lookup', 'CH', true, 0.003);
    // The 5 s cache must not hide rows from an after-cursor poll.
    const { ops } = await fetchOps(`?after=${newest}`);
    expect(ops.length).toBe(1);
    expect(ops[0].type).toBe('ch_clearing_lookup');
    expect(ops[0].id).toBeGreaterThan(newest);
  });

  it('caps the window at 50 operations', async () => {
    for (let i = 0; i < 60; i++) recordOperation('iban_format', 'AT', true, 0);
    // A fresh poll (cache-busting cursor 0 is the plain query) may serve the
    // 5 s cache; the cap applies either way.
    const { ops } = await fetchOps('?after=0');
    expect(ops.length).toBeLessThanOrEqual(50);
  });
});

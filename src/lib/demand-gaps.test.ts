import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';

/**
 * Hermetic stats database, same idiom and same hoisting reason as
 * stats.test.ts: db.js reads its path constant at module load, so the env
 * must be set before any import touches it.
 */
const HERMETIC_DB = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? '/tmp'}/ibf-gaps-hermetic-${process.pid}-${Date.now()}.sqlite`;
  process.env.STATS_DB_PATH = path;
  return path;
});

import { recordDemandGap, getDemandGaps, resetDemandGaps } from './demand-gaps.js';
import { getStatsDB } from '../lib/db.js';
import { rmSync } from 'node:fs';

afterAll(() => {
  for (const suffix of ['', '-shm', '-wal']) {
    try {
      rmSync(HERMETIC_DB + suffix);
    } catch {
      /* already gone */
    }
  }
});

beforeEach(() => {
  resetDemandGaps();
  getStatsDB().exec('DROP TABLE IF EXISTS lookup_gaps');
  resetDemandGaps();
  // Materialise a fresh empty table: the recorder only ensures it on a write
  // that PASSES the gate, and half these tests assert on rejected writes.
  getDemandGaps(1);
});

describe('recordDemandGap', () => {
  it('counts repeated asks on one row instead of growing the table', () => {
    recordDemandGap('bank_code', 'LT', '10000', 'not_in_register:not_allocated');
    recordDemandGap('bank_code', 'LT', '10000', 'not_in_register:not_allocated');
    recordDemandGap('bank_code', 'LT', '10000', 'not_in_register:not_allocated');
    const rows = getStatsDB().prepare('SELECT hits FROM lookup_gaps').all() as Array<{
      hits: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].hits).toBe(3);
  });

  it('drops off-shape keys — the gate that keeps the table publishable', () => {
    // A pasted email, path garbage, an overlong string: none may reach storage.
    recordDemandGap('bic', 'DE', 'acme@example.com', 'not_found');
    recordDemandGap('bank_code', 'DE', '../../etc/passwd', 'not_in_register');
    recordDemandGap('ch_clearing', 'CH', '123456789', 'not_found');
    const n = (getStatsDB().prepare('SELECT COUNT(*) AS n FROM lookup_gaps').get() as { n: number })
      .n;
    expect(n).toBe(0);
  });

  it('drops rows without a country: NULL in this PRIMARY KEY would defeat the upsert', () => {
    recordDemandGap('bank_code', null, '12345', 'not_in_register');
    recordDemandGap('bank_code', 'not-a-cc', '12345', 'not_in_register');
    const n = (getStatsDB().prepare('SELECT COUNT(*) AS n FROM lookup_gaps').get() as { n: number })
      .n;
    expect(n).toBe(0);
  });

  it('never throws when the table is unwritable — recording must not break the API', () => {
    getStatsDB().exec('DROP TABLE lookup_gaps');
    // Recreate as a VIEW-shaped obstacle: a table with a hostile CHECK.
    getStatsDB().exec(`CREATE TABLE lookup_gaps (kind TEXT CHECK (kind = 'never'))`);
    expect(() => recordDemandGap('bic', 'DE', 'MARKDEFFXXX', 'not_found')).not.toThrow();
  });
});

describe('getDemandGaps', () => {
  it('ranks demand by hits and keeps outages apart from data gaps', () => {
    recordDemandGap('bank_code', 'LT', '10000', 'not_in_register:not_allocated');
    recordDemandGap('bank_code', 'LT', '10000', 'not_in_register:not_allocated');
    recordDemandGap('bank_code', 'DE', '99999999', 'not_in_register:absent_from_reference_data');
    recordDemandGap('bank_code', 'BG', 'RZBB', 'unavailable:lookup_failed');
    const s = getDemandGaps(30);
    // The outage is not demand: it must not appear in the ranking nor the
    // country totals, or a register outage would masquerade as a data gap.
    expect(s.top.map((r) => r.code)).toEqual(['10000', '99999999']);
    expect(s.by_country.map((r) => r.country)).toEqual(['LT', 'DE']);
    expect(s.by_country[0]).toMatchObject({ country: 'LT', distinct_codes: 1, hits: 2 });
    expect(s.outages).toHaveLength(1);
    expect(s.outages[0]).toMatchObject({ country: 'BG', outcome: 'unavailable:lookup_failed' });
  });

  it('clamps the window instead of trusting the query string', () => {
    expect(getDemandGaps(0).period_days).toBe(1);
    expect(getDemandGaps(9999).period_days).toBe(365);
  });
});

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const HERMETIC_DB = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? '/tmp'}/ibf-demand-monthly-${process.pid}-${Date.now()}.sqlite`;
  process.env.STATS_DB_PATH = path;
  return path;
});

const notify = vi.hoisted(() => vi.fn(async (_text: string) => true));
vi.mock('./ops-alert.js', () => ({ notifyOps: notify }));

import { recordDemandGap, resetDemandGaps } from './demand-gaps.js';
import {
  monthlyDue,
  readMonthlyRecord,
  runMonthlyDemandProposal,
} from './demand-proposal-server.js';
import { kvSet } from './forum-radar-server.js';
import { getStatsDB } from './db.js';
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
  notify.mockClear();
  resetDemandGaps();
  getStatsDB().exec('DROP TABLE IF EXISTS lookup_gaps; DROP TABLE IF EXISTS kv_state;');
  resetDemandGaps();
});

describe('monthlyDue', () => {
  it('is due once per month that ended, whatever the hour of the tick', () => {
    expect(monthlyDue(new Date('2026-10-01T04:00:00Z'), undefined)).toBe(true);
    expect(monthlyDue(new Date('2026-10-01T04:00:00Z'), '2026-09')).toBe(false);
    expect(monthlyDue(new Date('2026-10-17T09:00:00Z'), '2026-09')).toBe(false);
    expect(monthlyDue(new Date('2026-11-01T00:30:00Z'), '2026-09')).toBe(true);
  });
});

describe('runMonthlyDemandProposal', () => {
  it('records the month once, and a second tick in the same month does nothing', async () => {
    for (let i = 0; i < 6; i++)
      recordDemandGap('bank_code', 'TR', '00205', 'not_in_register:absent_from_reference_data');
    const first = await runMonthlyDemandProposal(new Date('2026-10-01T03:00:00Z'));
    expect(first).toEqual({ done: true, sent: false, month: '2026-09' });
    const rec = readMonthlyRecord();
    expect(rec?.month).toBe('2026-09');
    expect(rec?.proposal?.kind).toBe('register');
    // Ledger born today: below the 28-day age, stored but not sent.
    expect(notify).not.toHaveBeenCalled();

    const second = await runMonthlyDemandProposal(new Date('2026-10-01T04:00:00Z'));
    expect(second.done).toBe(false);
  });

  it('sends the register proposal on the ops channel once the ledger is old enough', async () => {
    for (let i = 0; i < 6; i++)
      recordDemandGap('bank_code', 'TR', '00205', 'not_in_register:absent_from_reference_data');
    // Age the ledger: first_seen five weeks back.
    getStatsDB().exec(`UPDATE lookup_gaps SET first_seen = datetime('now', '-35 days')`);
    const r = await runMonthlyDemandProposal(new Date());
    expect(r.done).toBe(true);
    expect(r.sent).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(String(notify.mock.calls[0][0])).toContain('TR 00205');
    expect(readMonthlyRecord()?.sent).toBe(true);
  });

  it('a too-early or empty month is recorded, never sent', async () => {
    kvSet('demand_monthly_last', '2026-07');
    const r = await runMonthlyDemandProposal(new Date('2026-09-01T02:00:00Z'));
    expect(r.done).toBe(true);
    expect(r.sent).toBe(false);
    expect(readMonthlyRecord()?.proposal).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from 'vitest';
import type { KeyRow } from './build-contacts';
import { topUsers } from './top-users';

const TODAY = '2026-07-30';

const keyRow = (prefix: string, email: string, over: Partial<KeyRow> = {}): KeyRow => ({
  key_prefix: prefix,
  email,
  monthly_limit: 200,
  active: 1,
  created_at: '2026-01-05 10:00:00',
  used: 0,
  used_prev: 0,
  used_all_time: 0,
  last_active_month: '2026-07',
  credits_total: null,
  credits_remaining: null,
  paid: 0,
  series: [],
  ...over,
});

/** Requests attributed to a key, one entry per day. */
const activity = (day: string, count: number) => ({ days: [{ day, count }] });

describe('topUsers', () => {
  it('ranks today by attributed requests and keeps three', () => {
    const top = topUsers(
      [
        keyRow('k1', 'one@example.net'),
        keyRow('k2', 'two@example.net'),
        keyRow('k3', 'three@example.net'),
        keyRow('k4', 'four@example.net'),
      ],
      {
        k1: activity(TODAY, 5),
        k2: activity(TODAY, 40),
        k3: activity(TODAY, 12),
        k4: activity(TODAY, 1),
      },
      TODAY,
    );
    expect(top.map((u) => u.email)).toEqual([
      'two@example.net',
      'three@example.net',
      'one@example.net',
    ]);
    expect(top.every((u) => u.period === 'today')).toBe(true);
  });

  it('adds up the keys of one address rather than listing it twice', () => {
    const top = topUsers(
      [keyRow('k1', 'both@example.net'), keyRow('k2', 'Both@example.net')],
      { k1: activity(TODAY, 3), k2: activity(TODAY, 4) },
      TODAY,
    );
    expect(top).toHaveLength(1);
    expect(top[0].count).toBe(7);
  });

  it('gives an address its best category when its keys disagree', () => {
    const top = topUsers(
      [
        keyRow('k1', 'mixed@example.net'),
        keyRow('k2', 'mixed@example.net', { credits_total: 1000 }),
      ],
      { k1: activity(TODAY, 1), k2: activity(TODAY, 1) },
      TODAY,
    );
    expect(top[0].category).toBe('PAYANT');
  });

  it('reads a raised free quota as an evaluation pilot', () => {
    const top = topUsers(
      [keyRow('k1', 'pilot@example.net', { monthly_limit: 5000 })],
      { k1: activity(TODAY, 2) },
      TODAY,
    );
    expect(top[0].category).toBe('PILOTE');
  });

  it('never puts an internal account on the podium', () => {
    const top = topUsers(
      [keyRow('k1', 'ops@ibanforge.com'), keyRow('k2', 'real@example.net')],
      { k1: activity(TODAY, 900), k2: activity(TODAY, 1) },
      TODAY,
    );
    expect(top.map((u) => u.email)).toEqual(['real@example.net']);
  });

  it('backfills a quiet day with the month, and marks it as the month', () => {
    const top = topUsers(
      [
        keyRow('k1', 'today@example.net'),
        keyRow('k2', 'month@example.net', { used: 90 }),
        // Called neither today nor this month: it has nothing to show.
        keyRow('k3', 'idle@example.net'),
      ],
      { k1: activity(TODAY, 4) },
      TODAY,
    );
    expect(top.map((u) => [u.email, u.period])).toEqual([
      ['today@example.net', 'today'],
      ['month@example.net', 'month'],
    ]);
  });

  it('does not backfill an address that already stands on the podium', () => {
    const top = topUsers(
      [keyRow('k1', 'one@example.net', { used: 300 })],
      { k1: activity(TODAY, 4) },
      TODAY,
    );
    expect(top).toHaveLength(1);
    expect(top[0].count).toBe(4);
  });

  it('ignores a count carried by another day', () => {
    const top = topUsers(
      [keyRow('k1', 'one@example.net')],
      { k1: activity('2026-07-29', 50) },
      TODAY,
    );
    expect(top).toEqual([]);
  });
});

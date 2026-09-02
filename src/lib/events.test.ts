import { describe, it, expect, afterAll } from 'vitest';
import { getStatsDB } from './db.js';
import { recordEvent, getEvents } from './events.js';

const MARKER = 'events-test-fixture';

afterAll(() => {
  getStatsDB().prepare(`DELETE FROM events WHERE label LIKE '%${MARKER}%'`).run();
});

describe('events — chart annotations', () => {
  it('records and returns events, newest first', () => {
    recordEvent('manual', `rotation ${MARKER}`);
    recordEvent('manual', `campagne ${MARKER}`);
    const rows = getEvents(7).filter((e) => e.label.includes(MARKER));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].label).toContain('campagne');
    expect(rows[0].kind).toBe('manual');
  });

  it('clamps oversized labels to 120 chars', () => {
    recordEvent('manual', `${'x'.repeat(200)} ${MARKER}`);
    const rows = getEvents(7).filter((e) => e.label.startsWith('xxx'));
    expect(rows[0].label.length).toBeLessThanOrEqual(120);
  });

  it('dedups deploy events with the same label within 6 hours', () => {
    // Railway restarts re-run the boot hook with the same version string;
    // the chart must get ONE marker per actual release, not one per restart.
    recordEvent('deploy', `v9.9.9-${MARKER}`);
    recordEvent('deploy', `v9.9.9-${MARKER}`);
    const rows = getEvents(7).filter((e) => e.label === `v9.9.9-${MARKER}`);
    expect(rows).toHaveLength(1);
    // A DIFFERENT label (a real new release) is never deduped.
    recordEvent('deploy', `v9.9.10-${MARKER}`);
    expect(getEvents(7).filter((e) => e.label === `v9.9.10-${MARKER}`)).toHaveLength(1);
  });
});

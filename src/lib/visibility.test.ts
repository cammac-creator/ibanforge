import { describe, expect, it } from 'vitest';
import { getStatsDB } from './db.js';
import { getVisibility, isVisibilityState, recordVisibility } from './visibility.js';

/**
 * Runs against the real stats database like every other test here, so rows are
 * namespaced and removed rather than assumed absent.
 */
const P = 'test-surface-';
function clean(): void {
  getStatsDB().prepare(`DELETE FROM visibility_checks WHERE surface LIKE '${P}%'`).run();
}

describe('the listing watch', () => {
  it('keeps one row per surface and day, so a re-run corrects instead of duplicating', () => {
    clean();
    recordVisibility({ surface: `${P}npm`, state: 'absent', day: '2026-08-14' });
    recordVisibility({ surface: `${P}npm`, state: 'present', detail: 'v1.4.3', day: '2026-08-14' });
    const row = getVisibility().find((s) => s.surface === `${P}npm`);
    expect(row?.state).toBe('present');
    expect(row?.detail).toBe('v1.4.3');
    clean();
  });

  it('raises `lost` only when a surface that WAS present has gone', () => {
    clean();
    recordVisibility({ surface: `${P}dir`, state: 'present', day: '2026-08-10' });
    recordVisibility({ surface: `${P}dir`, state: 'absent', day: '2026-08-14' });
    const lost = getVisibility().find((s) => s.surface === `${P}dir`);
    expect(lost?.lost).toBe(true);
    expect(lost?.last_present_on).toBe('2026-08-10');
    clean();
  });

  it('does not cry delisting for a surface never seen, nor for a probe error', () => {
    clean();
    // Never listed: absent is the normal state, not a loss.
    recordVisibility({ surface: `${P}never`, state: 'absent', day: '2026-08-14' });
    // An unreachable directory is our probe's problem. Alarming on it would
    // teach the operator to ignore the whole panel.
    recordVisibility({ surface: `${P}flaky`, state: 'present', day: '2026-08-10' });
    recordVisibility({ surface: `${P}flaky`, state: 'error', detail: 'timeout', day: '2026-08-14' });
    const rows = getVisibility();
    expect(rows.find((s) => s.surface === `${P}never`)?.lost).toBe(false);
    expect(rows.find((s) => s.surface === `${P}flaky`)?.lost).toBe(false);
    clean();
  });

  it('clears its own alarm when the listing comes back', () => {
    clean();
    recordVisibility({ surface: `${P}back`, state: 'present', day: '2026-08-10' });
    recordVisibility({ surface: `${P}back`, state: 'absent', day: '2026-08-12' });
    recordVisibility({ surface: `${P}back`, state: 'present', day: '2026-08-14' });
    expect(getVisibility().find((s) => s.surface === `${P}back`)?.lost).toBe(false);
    clean();
  });

  it('validates the state on the way in', () => {
    expect(isVisibilityState('present')).toBe(true);
    expect(isVisibilityState('delisted')).toBe(false);
  });
});

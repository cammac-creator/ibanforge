import { describe, it, expect } from 'vitest';
import { NEW_SIGNUP_DAYS, signedUpRecently } from './new-signup';

const NOW = new Date('2026-07-29T12:00:00Z');

describe('signedUpRecently', () => {
  it('claims a key minted today', () => {
    expect(signedUpRecently('2026-07-29 01:14:26', NOW)).toBe(true);
  });

  it('claims a key from two days ago', () => {
    expect(signedUpRecently('2026-07-27 11:11:10', NOW)).toBe(true);
  });

  it('lets go the day after the window closes', () => {
    const inside = new Date(NOW.getTime() - (NEW_SIGNUP_DAYS - 1) * 86_400_000);
    const outside = new Date(NOW.getTime() - (NEW_SIGNUP_DAYS + 1) * 86_400_000);
    expect(signedUpRecently(inside.toISOString(), NOW)).toBe(true);
    expect(signedUpRecently(outside.toISOString(), NOW)).toBe(false);
  });

  it('does not claim a key from three months ago', () => {
    // The whole point of a window: making every never-used key visible would
    // bury the new ones under the dead ones, which is the problem inverted.
    expect(signedUpRecently('2026-05-15 08:00:00', NOW)).toBe(false);
  });

  it('reads both stored date shapes', () => {
    // The keys endpoint returns 'YYYY-MM-DD HH:MM:SS' for rows written by the
    // API and a full ISO string for rows written elsewhere. Both are real.
    expect(signedUpRecently('2026-07-29 01:14:26', NOW)).toBe(true);
    expect(signedUpRecently('2026-07-29T01:14:26.462Z', NOW)).toBe(true);
  });

  it('declines rather than throws on an unusable date', () => {
    // A row we cannot date must not be announced as a new customer: the badge
    // would be wrong on exactly the row the operator trusts most.
    for (const bad of ['', 'hier', null, undefined]) {
      expect(signedUpRecently(bad, NOW), String(bad)).toBe(false);
    }
  });

  it('declines a date in the future', () => {
    // A clock skew must not mint a permanent "new customer" badge.
    expect(signedUpRecently('2027-01-01 00:00:00', NOW)).toBe(false);
  });
});

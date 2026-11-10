/**
 * The label is read in the Stripe webhook's response path, after the payment
 * is recorded. A base that is locked or missing a table at that instant must
 * cost the alert its "Client" line and nothing else: no exception may reach
 * the webhook (review of PR 587: the catch was never exercised).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const fault = vi.hoisted(() => ({ broken: false }));

vi.mock('./db.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./db.js')>();
  return {
    ...real,
    getStatsDB: () => {
      if (fault.broken) throw new Error('database is locked');
      return real.getStatsDB();
    },
  };
});

const { ownerLabelForEmail, ownerLabelForKeyPrefix } = await import('./owner-label.js');

afterEach(() => {
  fault.broken = false;
});

describe('a base in trouble never costs more than the name', () => {
  it('answers null from the key prefix instead of throwing', () => {
    fault.broken = true;
    expect(() => ownerLabelForKeyPrefix('ifk_0a1b2c3d')).not.toThrow();
    expect(ownerLabelForKeyPrefix('ifk_0a1b2c3d')).toBeNull();
  });

  it('falls back to what the address alone says when the tables cannot be read', () => {
    fault.broken = true;
    expect(ownerLabelForEmail('achats@alpha.example.net')).toBe('alpha.example.net');
    expect(ownerLabelForEmail('quelquun@gmail.com')).toBeNull();
  });

  it('reads normally again once the base answers', () => {
    expect(ownerLabelForKeyPrefix('ifk_00000000')).toBeNull();
    expect(ownerLabelForEmail('achats@alpha.example.net')).toBe('alpha.example.net');
  });
});

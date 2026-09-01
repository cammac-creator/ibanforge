import { describe, it, expect } from 'vitest';
import { collected, type PacksSoldView, type OnChainView } from './revenue-view';

const SOLD: PacksSoldView = {
  count: 2,
  usd: 40,
  by_rail: { card: { count: 1, usd: 20 }, usdc: { count: 1, usd: 20 }, unknown: { count: 0, usd: 0 } },
  granted_count: 0,
  deduced_count: 1,
  partly_deduced: true,
  last_sale_at: '2026-08-27 10:00:00',
};

describe('collected — DASH-02, the card rail is not a hard-coded dash', () => {
  it('shows the card money as soon as a pack was sold on that rail', () => {
    expect(collected(SOLD, null).cardUsd).toBe(20);
    expect(collected(SOLD, null).packsCount).toBe(2);
  });

  it('says loudly that part of the total is deduced, not received', () => {
    expect(collected(SOLD, null).partlyDeduced).toBe(true);
  });
});

describe('collected — DASH-01, an unknown share is never a zero', () => {
  it('reports null and not-known when the internal payers are undeclared', () => {
    const chain: OnChainView = { total_received_usdc: 0.244, received_external_usdc: null };
    const c = collected(SOLD, chain);
    expect(c.externalUsdc).toBeNull();
    expect(c.externalKnown).toBe(false);
  });

  it('reports the external share when the API could compute it', () => {
    const chain: OnChainView = { total_received_usdc: 0.244, received_external_usdc: 0.114 };
    const c = collected(SOLD, chain);
    expect(c.externalUsdc).toBe(0.114);
    expect(c.externalKnown).toBe(true);
  });

  it('never merges dollars and USDC into one figure', () => {
    const c = collected(SOLD, { total_received_usdc: 1, received_external_usdc: 1 });
    // The shape itself is the guarantee: two units, two fields, no total.
    expect(Object.keys(c).sort()).toEqual(
      ['cardUsd', 'externalKnown', 'externalUsdc', 'packsCount', 'partlyDeduced'].sort(),
    );
  });

  it('holds nothing at all before the payloads land', () => {
    const c = collected(null, null);
    expect(c.cardUsd).toBeNull();
    expect(c.externalUsdc).toBeNull();
    expect(c.packsCount).toBeNull();
  });
});

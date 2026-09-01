import { describe, it, expect } from 'vitest';
import { stepPercent, medianLabel, type FunnelValues } from './activation-funnel-math';

/**
 * The production shape that produced "300 %": more buyers than clients who ever
 * hit a wall, because a client can buy without being refused first. Kept as the
 * regression case; the numbers are a shape, not a measurement.
 */
const INDEPENDENT_STEPS: FunnelValues = { signed_up: 20, first_call: 15, hit_limit: 1, purchased: 3 };

describe('stepPercent — DASH-06', () => {
  it('never renders more than 100 % on steps counted independently', () => {
    const order: Array<keyof FunnelValues> = ['signed_up', 'first_call', 'hit_limit', 'purchased'];
    order.forEach((key, i) => {
      const pct = stepPercent(INDEPENDENT_STEPS[key], INDEPENDENT_STEPS.signed_up, i);
      if (pct !== null) expect(pct).toBeLessThanOrEqual(100);
    });
  });

  it('divides by the population, not by the step above', () => {
    // The old rule was purchased / hit_limit = 3 / 1 = 300 %.
    expect(stepPercent(INDEPENDENT_STEPS.purchased, INDEPENDENT_STEPS.signed_up, 3)).toBe(15);
    expect(stepPercent(INDEPENDENT_STEPS.first_call, INDEPENDENT_STEPS.signed_up, 1)).toBe(75);
  });

  it('gives the population itself no percentage, and survives an empty period', () => {
    expect(stepPercent(20, 20, 0)).toBeNull();
    expect(stepPercent(0, 0, 2)).toBeNull();
  });
});

describe('medianLabel — DASH-20', () => {
  it('carries the sample size so a zero cannot pass for an instant purchase', () => {
    expect(medianLabel(0, 2)).toBe('< 1 h, n = 2');
    expect(medianLabel(0, 0)).toBe('< 1 h, n = 0');
  });

  it('omits n rather than inventing one, and keeps the old units', () => {
    expect(medianLabel(0)).toBe('< 1 h');
    expect(medianLabel(6, 3)).toBe('6 h, n = 3');
    expect(medianLabel(72, 1)).toBe('3 j, n = 1');
    expect(medianLabel(null, 5)).toBeNull();
  });
});

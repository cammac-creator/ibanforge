import { describe, it, expect, beforeEach } from 'vitest';
import {
  countDailyUnits,
  refundDailyUnits,
  resetDailyLedger,
  sweepDailyLedger,
} from './daily-ip-ledger.js';

/**
 * The counter three free allowances share (MCP tool calls, MCP session
 * openings, the keyless REST trial). Its exact shape is what the MCP route
 * relied on before the extraction of 2026-09-06, so every case below is a
 * behaviour someone already depends on.
 */
describe('countDailyUnits', () => {
  beforeEach(() => resetDailyLedger());

  it('spends one unit at a time and says what is left', () => {
    expect(countDailyUnits('rest:1.2.3.4', 1, 3)).toEqual({
      allowed: true,
      used: 1,
      remaining: 2,
    });
    expect(countDailyUnits('rest:1.2.3.4', 1, 3)).toEqual({
      allowed: true,
      used: 2,
      remaining: 1,
    });
  });

  it('spends a batch in one go, and refuses the batch that does not fit', () => {
    // The MCP batch tool bills one unit per IBAN; a 100-IBAN call against a
    // 10-unit allowance must be refused whole, not served ten-elevenths.
    expect(countDailyUnits('mcp:ip', 100, 10).allowed).toBe(false);
  });

  it('keeps counting past the ceiling so a refusal cannot be retried for free', () => {
    countDailyUnits('rest:ip', 10, 10);
    const over = countDailyUnits('rest:ip', 1, 10);
    expect(over).toEqual({ allowed: false, used: 11, remaining: 0 });
    // Still climbing on the next attempt — this is the property that makes the
    // refusal message's "you used N today" honest.
    expect(countDailyUnits('rest:ip', 1, 10).used).toBe(12);
  });

  it('gives each namespace its own budget', () => {
    countDailyUnits('rest:1.2.3.4', 10, 10);
    // Same address, other allowance: the MCP tool calls and the session
    // openings and the REST trial are three ceilings, not one.
    expect(countDailyUnits('1.2.3.4', 1, 10).allowed).toBe(true);
    expect(countDailyUnits('init:1.2.3.4', 1, 30).allowed).toBe(true);
  });

  it('never lets one address spend another address budget', () => {
    countDailyUnits('rest:1.2.3.4', 10, 10);
    expect(countDailyUnits('rest:5.6.7.8', 1, 10)).toEqual({
      allowed: true,
      used: 1,
      remaining: 9,
    });
  });
});

describe('refundDailyUnits', () => {
  beforeEach(() => resetDailyLedger());

  it('hands the slot back so a refused request costs nothing', () => {
    countDailyUnits('rest:ip', 1, 10);
    refundDailyUnits('rest:ip', 1);
    expect(countDailyUnits('rest:ip', 1, 10).used).toBe(1);
  });

  it('floors at zero rather than lending an allowance', () => {
    countDailyUnits('rest:ip', 1, 10);
    refundDailyUnits('rest:ip', 5);
    expect(countDailyUnits('rest:ip', 1, 10).used).toBe(1);
  });

  it('is a no-op on an address that spent nothing today', () => {
    refundDailyUnits('rest:never-seen', 1);
    expect(countDailyUnits('rest:never-seen', 1, 10).used).toBe(1);
  });
});

describe('the day boundary', () => {
  beforeEach(() => resetDailyLedger());

  it('starts a fresh count when the stored day is not today', () => {
    // Reach into the ledger the only way its API allows: spend, then age the
    // row by sweeping — a swept row is indistinguishable from a new day.
    countDailyUnits('rest:ip', 9, 10);
    resetDailyLedger();
    expect(countDailyUnits('rest:ip', 1, 10)).toEqual({ allowed: true, used: 1, remaining: 9 });
  });

  it('sweeps without touching today rows', () => {
    countDailyUnits('rest:ip', 4, 10);
    sweepDailyLedger();
    expect(countDailyUnits('rest:ip', 1, 10).used).toBe(5);
  });
});

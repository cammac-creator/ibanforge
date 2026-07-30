import { describe, expect, it } from 'vitest';
import { intentOf } from './intent';
import type { Situation } from './types';

function situation(ballInCourt: Situation['ballInCourt']): Situation {
  return {
    ballInCourt,
    silenceDays: 3,
    followupDue: false,
    firstContactAt: '2026-07-01',
    hasEverReplied: true,
    messageCount: 2,
    nextAction: 'wait',
  };
}

describe('intentOf', () => {
  it('answers reply when the ball is in our court', () => {
    expect(intentOf(situation('us'))).toBe('reply');
  });

  it('answers outbound while we are the ones waiting', () => {
    expect(intentOf(situation('them'))).toBe('outbound');
  });

  it('answers outbound when nobody holds the ball, which is a first touch', () => {
    expect(intentOf(situation('none'))).toBe('outbound');
  });

  it('answers outbound on a missing situation rather than throwing', () => {
    // The page builds one situation per contact id, so an absent one is a
    // programming error rather than data. Declining to claim a reply is the safe
    // direction: it keeps every prospecting guardrail armed instead of silently
    // disarming them on a thread we know nothing about.
    expect(intentOf(undefined)).toBe('outbound');
  });
});

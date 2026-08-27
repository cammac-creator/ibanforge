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

  /**
   * The institutional exception, and the reason it is worth four assertions:
   * `outbound` does not mean "we write first", it means "this is cold
   * prospecting", and it carries the daily send cap as a BLOCKING rule plus a
   * warning that the mail owes its reader a way to stop being contacted. Both
   * are wrong in a letter to a supervisor, and the second one is embarrassing.
   */
  it('answers reply for an institution whatever the thread says, first letter included', () => {
    expect(intentOf(undefined, 'institution')).toBe('reply');
    expect(intentOf(situation('none'), 'institution')).toBe('reply');
    expect(intentOf(situation('them'), 'institution')).toBe('reply');
    expect(intentOf(situation('us'), 'institution')).toBe('reply');
  });

  it('leaves the two commercial kinds on the rule the situation decides', () => {
    expect(intentOf(situation('none'), 'prospect')).toBe('outbound');
    expect(intentOf(situation('none'), 'client')).toBe('outbound');
    expect(intentOf(situation('us'), 'client')).toBe('reply');
  });
});

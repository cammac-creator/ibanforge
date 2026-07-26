import { describe, it, expect } from 'vitest';
import { situationOf } from './situation';
import type { Message } from './types';

// Offset-free on purpose, like the msg_date values the API stores. Both operands
// of every subtraction below are parsed in the runner's zone, so the local offset
// cancels and the expected day counts hold in any timezone.
const TODAY = new Date('2026-07-25T12:00:00');
const msg = (direction: Message['direction'], date: string | null): Message => ({
  direction,
  msg_date: date,
  subject: 's',
  snippet: null,
  counterparty: null,
});

describe('situationOf', () => {
  it('reports first_mail when there is no message', () => {
    const s = situationOf([], TODAY);
    expect(s.ballInCourt).toBe('none');
    expect(s.nextAction).toBe('first_mail');
    expect(s.silenceDays).toBeNull();
    expect(s.messageCount).toBe(0);
    expect(s.firstContactAt).toBeNull();
    expect(s.hasEverReplied).toBe(false);
    expect(s.followupDue).toBe(false);
  });

  it('puts the ball in our court when the last message is inbound', () => {
    const s = situationOf([msg('out', '2026-07-20T10:00'), msg('in', '2026-07-21T09:00')], TODAY);
    expect(s.ballInCourt).toBe('us');
    expect(s.silenceDays).toBe(4);
    expect(s.nextAction).toBe('reply');
  });

  it('never calls a followup due while the ball is in our court', () => {
    const s = situationOf([msg('out', '2026-06-01T10:00'), msg('in', '2026-06-02T10:00')], TODAY);
    expect(s.ballInCourt).toBe('us');
    expect(s.silenceDays).toBe(53);
    expect(s.followupDue).toBe(false);
    expect(s.nextAction).toBe('reply');
  });

  it('marks a followup due past 10 days of silence with no reply', () => {
    const s = situationOf([msg('out', '2026-07-01T10:00')], TODAY);
    expect(s.ballInCourt).toBe('them');
    expect(s.silenceDays).toBe(24);
    expect(s.followupDue).toBe(true);
    expect(s.nextAction).toBe('followup');
  });

  it('does not mark a followup due inside the 10 day window', () => {
    const s = situationOf([msg('out', '2026-07-20T10:00')], TODAY);
    expect(s.followupDue).toBe(false);
    expect(s.nextAction).toBe('wait');
  });

  it('leaves a followup undue at exactly 10 days of silence', () => {
    const s = situationOf([msg('out', '2026-07-15T12:00')], TODAY);
    expect(s.silenceDays).toBe(10);
    expect(s.followupDue).toBe(false);
    expect(s.nextAction).toBe('wait');
  });

  it('makes a followup due at 11 days of silence', () => {
    const s = situationOf([msg('out', '2026-07-14T12:00')], TODAY);
    expect(s.silenceDays).toBe(11);
    expect(s.followupDue).toBe(true);
    expect(s.nextAction).toBe('followup');
  });

  it('reports no silence at all for a message dated in the future', () => {
    const s = situationOf([msg('out', '2026-07-25T14:00')], TODAY);
    expect(s.silenceDays).toBe(0);
    expect(s.followupDue).toBe(false);
    expect(s.nextAction).toBe('wait');
  });

  it('prefers followup over firm_offer when a past replier went quiet', () => {
    const s = situationOf(
      [msg('out', '2026-06-20T10:00'), msg('in', '2026-06-21T10:00'), msg('out', '2026-07-05T10:00')],
      TODAY,
    );
    expect(s.hasEverReplied).toBe(true);
    expect(s.followupDue).toBe(true);
    expect(s.nextAction).toBe('followup');
  });

  it('suggests a firm offer when a replier is still inside the window', () => {
    const s = situationOf(
      [msg('out', '2026-07-18T10:00'), msg('in', '2026-07-19T10:00'), msg('out', '2026-07-20T10:00')],
      TODAY,
    );
    expect(s.hasEverReplied).toBe(true);
    expect(s.followupDue).toBe(false);
    expect(s.nextAction).toBe('firm_offer');
  });

  it('ignores drafts entirely', () => {
    const s = situationOf([msg('out', '2026-07-01T10:00'), msg('draft', '2026-07-24T10:00')], TODAY);
    expect(s.messageCount).toBe(1);
    expect(s.silenceDays).toBe(24);
    expect(s.nextAction).toBe('followup');
  });

  it('reports the first outbound date as first contact', () => {
    const s = situationOf([msg('out', '2026-07-01T10:00'), msg('in', '2026-07-02T10:00')], TODAY);
    expect(s.firstContactAt).toBe('2026-07-01T10:00');
  });

  it('reports the first outbound as first contact even when they wrote first', () => {
    const s = situationOf([msg('in', '2026-07-01T10:00'), msg('out', '2026-07-02T10:00')], TODAY);
    expect(s.firstContactAt).toBe('2026-07-02T10:00');
  });

  it('has no first contact when we have never written', () => {
    const s = situationOf([msg('in', '2026-07-24T10:00')], TODAY);
    expect(s.firstContactAt).toBeNull();
    expect(s.hasEverReplied).toBe(true);
    expect(s.nextAction).toBe('reply');
  });

  it('orders on the instant, not on the raw string', () => {
    // Two absolute instants written in different formats: the outbound happened an
    // hour before the inbound, yet its string sorts after it. Both carry an offset,
    // so this holds in every timezone.
    const s = situationOf(
      [msg('out', '2026-07-21T01:00+03:00'), msg('in', '2026-07-20T23:00Z')],
      TODAY,
    );
    expect(s.ballInCourt).toBe('us');
    expect(s.nextAction).toBe('reply');
  });

  it('sorts the thread by date without mutating the caller array', () => {
    const input = [msg('in', '2026-07-21T09:00'), msg('out', '2026-07-20T10:00')];
    const s = situationOf(input, TODAY);
    expect(s.ballInCourt).toBe('us');
    expect(s.silenceDays).toBe(4);
    expect(s.nextAction).toBe('reply');
    expect(input[0].msg_date).toBe('2026-07-21T09:00');
  });

  it('treats a thread of only undatable messages as no thread at all', () => {
    const s = situationOf([msg('out', 'not-a-date')], TODAY);
    expect(s.ballInCourt).toBe('none');
    expect(s.silenceDays).toBeNull();
    expect(s.followupDue).toBe(false);
    expect(s.messageCount).toBe(0);
    expect(s.nextAction).toBe('first_mail');
  });

  it('drops an undatable message instead of letting it decide who holds the ball', () => {
    const s = situationOf([msg('in', '2026-07-01T10:00'), msg('out', 'not-a-date')], TODAY);
    expect(s.ballInCourt).toBe('us');
    expect(s.silenceDays).toBe(24);
    expect(s.messageCount).toBe(1);
    expect(s.nextAction).toBe('reply');
  });

  it('does not let a message with no date blank out the first contact', () => {
    const s = situationOf(
      [msg('out', '2026-06-01T10:00'), msg('in', '2026-06-02T10:00'), msg('out', null)],
      TODAY,
    );
    expect(s.firstContactAt).toBe('2026-06-01T10:00');
    expect(s.messageCount).toBe(2);
    expect(s.ballInCourt).toBe('us');
    expect(s.silenceDays).toBe(53);
  });
});

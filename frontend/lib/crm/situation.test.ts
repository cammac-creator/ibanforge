import { describe, it, expect } from 'vitest';
import { NEXT_ACTION_LABEL, nextActionLabel, situationOf } from './situation';
import type { Message, NextAction } from './types';

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

  /**
   * Automated inbound decides nothing. Each case below is one of the two
   * shapes measured in the real mailbox on 27/07/2026.
   */
  describe('automated inbound', () => {
    const robot = (date: string, snippet: string): Message => ({
      direction: 'in',
      msg_date: date,
      subject: 'Ticket',
      snippet,
      counterparty: 'hello@northwind.example.net',
    });
    const ACK = 'We have received your message and a ticket has been created.';

    it('does not hand us the ball, and does not stop the silence running', () => {
      // The exact shape of the two false positives: we wrote, a desk robot
      // acknowledged, nobody answered. Before the fix this read "they are
      // waiting on you" and was excluded from the follow-up queue.
      const s = situationOf([msg('out', '2026-07-01T10:00'), robot('2026-07-01T22:00', ACK)], TODAY);
      expect(s.ballInCourt).toBe('them');
      expect(s.hasEverReplied).toBe(false);
      expect(s.silenceDays).toBe(24);
      expect(s.followupDue).toBe(true);
      expect(s.nextAction).toBe('followup');
      expect(s.messageCount).toBe(1);
    });

    it('keeps a human reply that arrives between two robots', () => {
      // The desk that sent an acknowledgement, then a person, then a nag. The
      // person must survive, or fixing the false positive creates a worse
      // false negative: relancer quelqu'un qui a répondu.
      const s = situationOf(
        [
          msg('out', '2026-07-20T10:00'),
          robot('2026-07-20T12:00', ACK),
          msg('in', '2026-07-21T16:00'),
          robot('2026-07-22T17:00', 'We are just checking in regarding your support request.'),
        ],
        TODAY,
      );
      expect(s.ballInCourt).toBe('us');
      expect(s.hasEverReplied).toBe(true);
      expect(s.nextAction).toBe('reply');
      // Counted from the human reply, not from the robot that came after it.
      expect(s.silenceDays).toBe(3);
      expect(s.messageCount).toBe(2);
    });

    it('leaves a thread of nothing but robots as never answered', () => {
      const s = situationOf([msg('out', '2026-07-01T10:00'), robot('2026-07-02T10:00', ACK)], TODAY);
      expect(s.hasEverReplied).toBe(false);
      // messageCount is human correspondence: archived.ts leans on it so that
      // a robot cannot pull a deliberately archived prospect back into view.
      expect(s.messageCount).toBe(1);
    });
  });
});

/**
 * The five states are facts about a thread and do not change with the
 * recipient. What they are CALLED does, and two of the commercial names
 * instruct the wrong act when the other end is an institution — which is why
 * this is pinned rather than left to be noticed on screen.
 */
describe('nextActionLabel', () => {
  const ACTIONS: NextAction[] = ['first_mail', 'reply', 'followup', 'firm_offer', 'wait'];

  it('is the commercial wording for a client, a prospect, and an unstated kind', () => {
    for (const a of ACTIONS) {
      expect(nextActionLabel(a, 'client')).toBe(NEXT_ACTION_LABEL[a]);
      expect(nextActionLabel(a, 'prospect')).toBe(NEXT_ACTION_LABEL[a]);
      expect(nextActionLabel(a)).toBe(NEXT_ACTION_LABEL[a]);
    }
  });

  /**
   * An institution reaches `firm_offer` by the ordinary road: they answered
   * once, we wrote back, no follow-up is due yet. The band would have printed
   * "Envoyer une offre ferme datée" directly above the composer — a dated
   * commercial offer to a financial supervisor.
   */
  it('never tells the operator to send a firm offer to an institution', () => {
    expect(nextActionLabel('firm_offer', 'institution')).toBe('En attente de leur réponse écrite');
    expect(nextActionLabel('firm_offer', 'institution')).not.toContain('offre');
  });

  /**
   * Every correspondent is in this state on the day it is registered, and the
   * sheet three centimetres below says "Première demande à". One screen must
   * not carry two vocabularies for one act.
   */
  it('calls an unwritten institutional thread a request, not a first cold mail', () => {
    expect(nextActionLabel('first_mail', 'institution')).toBe('Première demande à écrire');
  });

  it('says something for every state rather than falling through to blank', () => {
    for (const a of ACTIONS) {
      expect(nextActionLabel(a, 'institution')).toBeTruthy();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { lastInboundMessage, lastInboundNeedsNoReply, noReplyHolds } from './no-reply';
import { ballWithUs, followupDue, neverContacted } from './buckets';
import { situationOf } from './situation';
import type { Contact, Message } from './types';

/**
 * Every address and company below is invented; example.net is reserved for
 * documentation by RFC 2606.
 */

const TODAY = new Date('2026-08-30T09:00:00Z');
const daysAgo = (n: number): string => new Date(TODAY.getTime() - n * 86_400_000).toISOString();

interface MsgOver {
  subject?: string | null;
  snippet?: string | null;
  counterparty?: string | null;
  marked?: boolean;
}

const msg = (
  direction: Message['direction'],
  msg_date: string | null,
  over: MsgOver = {},
): Message => ({
  id: `m-${direction}-${msg_date ?? 'undated'}-${over.subject ?? ''}`,
  direction,
  msg_date,
  subject: over.subject ?? null,
  snippet: over.snippet ?? null,
  counterparty: over.counterparty ?? null,
  ...(over.marked ? { no_reply_needed: 1 } : {}),
});

/**
 * A client, i.e. the kind of contact that carries NO prospect row. It is the
 * shape the whole feature exists for: OutcomeControl never rendered here, so
 * before this rule there was no gesture at all on a self-service customer.
 */
const client = (messages: Message[]): Contact => ({
  kind: 'client',
  id: 'ops@alpha.example.net',
  email: 'ops@alpha.example.net',
  company: 'Société Alpha',
  country: 'CH',
  website: null,
  messages,
  draft: null,
  unread: false,
  account: 'crm@example.net',
  apiKey: {
    keyPrefix: 'ibf_alpha',
    paid: true,
    creditsTotal: 1000,
    creditsRemaining: 900,
    monthlyLimit: null,
    usedAllTime: 100,
    lastActiveMonth: '2026-08',
    createdAt: daysAgo(200),
    issuedByUs: false,
    isNew: false,
  },
  usage: { series: [], months: [], days: [], endpoints: [] },
});

/** An institutional correspondent: the other half of the population with no prospect row. */
const authority = (messages: Message[]): Contact => ({
  kind: 'institution',
  id: 'desk@beta.example.net',
  email: 'desk@beta.example.net',
  company: 'Autorité Bêta',
  country: 'EU',
  website: null,
  messages,
  draft: null,
  unread: false,
  account: 'crm@example.net',
  institution: {
    org: 'Autorité Bêta',
    category: 'autorite',
    country: 'EU',
    role: null,
    website: null,
    dossier: 'Permission de citer le registre',
  },
});

describe('lastInboundNeedsNoReply — what the marker answers', () => {
  it('is true when their last word is marked', () => {
    const c = client([
      msg('out', daysAgo(10), { subject: 'Ta clé' }),
      msg('in', daysAgo(9), { subject: 'Merci !', marked: true }),
    ]);
    expect(lastInboundNeedsNoReply(c)).toBe(true);
  });

  it('is false again the moment they write something newer — the reopening, for free', () => {
    // THE test of the design. No reopening rule runs: the marker sits on the
    // June message, the newest inbound is the August one, and it carries
    // nothing. A contact-level flag would have needed a date comparison here.
    const c = client([
      msg('in', daysAgo(60), { subject: 'Merci !', marked: true }),
      msg('in', daysAgo(1), { subject: 'Une question sur les quotas' }),
    ]);
    expect(lastInboundNeedsNoReply(c)).toBe(false);
  });

  it('is false when nobody has written to us', () => {
    expect(lastInboundNeedsNoReply(client([msg('out', daysAgo(3))]))).toBe(false);
    expect(lastInboundNeedsNoReply(client([]))).toBe(false);
  });

  it('is false when the API serves no such column', () => {
    // The deploy-order case: this frontend runs for a while against an API
    // whose SELECT predates the column, and absent must read as unmarked.
    const c = client([msg('in', daysAgo(2), { subject: 'Merci !' })]);
    expect(c.messages[0].no_reply_needed).toBeUndefined();
    expect(lastInboundNeedsNoReply(c)).toBe(false);
  });
});

describe('lastInboundNeedsNoReply — what may not clear a marker', () => {
  it('a robot writing afterwards does not', () => {
    // Without the isAutomated skip the ticket acknowledgement below becomes
    // "the last inbound", unmarked, and drags the thread back into the queue
    // the operator just emptied.
    const c = authority([
      msg('in', daysAgo(5), { subject: 'Merci pour votre courrier', marked: true }),
      msg('in', daysAgo(4), { subject: 'Ticket #4471 has been created' }),
    ]);
    expect(lastInboundNeedsNoReply(c)).toBe(true);
  });

  it('an undatable message does not, in either direction', () => {
    const c = client([
      msg('in', daysAgo(5), { subject: 'Merci !', marked: true }),
      msg('in', null, { subject: 'Sans date' }),
      msg('in', 'pas une date', { subject: 'Date illisible' }),
    ]);
    expect(lastInboundNeedsNoReply(c)).toBe(true);
  });

  it('a draft does not', () => {
    const c = client([
      msg('in', daysAgo(5), { subject: 'Merci !', marked: true }),
      msg('draft', daysAgo(1), { subject: 'Brouillon jamais parti' }),
    ]);
    expect(lastInboundNeedsNoReply(c)).toBe(true);
  });

  it('our own answer does not, and does not need to', () => {
    // Writing back leaves the marker standing, which changes nothing: the ball
    // is in their court, so ballWithUs was already false on its own terms.
    const c = client([
      msg('in', daysAgo(5), { subject: 'Merci !', marked: true }),
      msg('out', daysAgo(4), { subject: 'Avec plaisir' }),
    ]);
    expect(lastInboundNeedsNoReply(c)).toBe(true);
    expect(ballWithUs(c, situationOf(c.messages, TODAY))).toBe(false);
  });
});

describe('lastInboundMessage — the message the button marks', () => {
  it('is the one the rule reads, ties broken by thread order', () => {
    // msg_date is free-form TEXT and a day-granularity date makes every
    // message of one day share an instant, so the tie is ordinary rather than
    // exotic. The last bubble in the thread is the one the operator points at,
    // so it is the one the button marks and the one the rule reads — a single
    // selector for both is what keeps those two from disagreeing.
    const first = msg('in', '2026-08-28', { subject: 'Merci !' });
    const second = msg('in', '2026-08-28', { subject: 'Et bonne continuation' });
    const c = client([first, second]);
    expect(lastInboundMessage(c)).toBe(second);

    const marked = client([first, { ...second, no_reply_needed: 1 }]);
    expect(lastInboundNeedsNoReply(marked)).toBe(true);
  });

  it('skips what cannot decide, so the button never marks a robot or a draft', () => {
    const human = msg('in', daysAgo(6), { subject: 'Merci !' });
    const c = client([
      human,
      msg('in', daysAgo(5), { subject: 'This is an automated reply' }),
      msg('draft', daysAgo(4)),
      msg('in', null),
    ]);
    expect(lastInboundMessage(c)).toBe(human);
  });

  it('is null when there is nothing to mark', () => {
    expect(lastInboundMessage(client([msg('out', daysAgo(2))]))).toBeNull();
  });
});

describe('noReplyHolds — is the marker doing work right now', () => {
  const thanked = [
    msg('out', daysAgo(12), { subject: 'Ta clé' }),
    msg('in', daysAgo(11), { subject: 'Merci !', marked: true }),
  ];

  it('is true while the marker is the only thing keeping the thread out of the queue', () => {
    const c = client(thanked);
    expect(noReplyHolds(c, situationOf(c.messages, TODAY))).toBe(true);
  });

  it('is false once we have written back, where the raw predicate stays true', () => {
    // The distinction the two functions exist for. The marker still belongs to
    // their message — answering does not un-say what they said — but the row
    // is now waiting on them like any other, so nothing needs explaining and a
    // badge here would read as "done" rather than as a reason.
    const c = client([...thanked, msg('out', daysAgo(10), { subject: 'Avec plaisir' })]);
    expect(lastInboundNeedsNoReply(c)).toBe(true);
    expect(noReplyHolds(c, situationOf(c.messages, TODAY))).toBe(false);
  });

  it('is false with no situation at all', () => {
    // The page builds one entry per contact id, so an absent one is a
    // programming error rather than data — and a surface that explains nothing
    // beats one that explains the wrong thing.
    expect(noReplyHolds(client(thanked), undefined)).toBe(false);
  });
});

describe('the buckets, once a message is marked', () => {
  it('takes the thread out of « À répondre » and puts it back when they write', () => {
    const thanked = client([
      msg('out', daysAgo(12), { subject: 'Ta clé' }),
      msg('in', daysAgo(11), { subject: 'Merci !', marked: true }),
    ]);
    expect(situationOf(thanked.messages, TODAY).ballInCourt).toBe('us');
    expect(ballWithUs(thanked, situationOf(thanked.messages, TODAY))).toBe(false);

    const wroteAgain = client([...thanked.messages, msg('in', daysAgo(1), { subject: 'Une question' })]);
    expect(ballWithUs(wroteAgain, situationOf(wroteAgain.messages, TODAY))).toBe(true);
  });

  it('reaches a correspondent and a client alike — nobody needs a prospect row', () => {
    // The first half of the need: OutcomeControl renders only under a prospect
    // row, so these two kinds had no gesture at all.
    for (const c of [
      client([msg('in', daysAgo(2), { subject: 'Merci !', marked: true })]),
      authority([msg('in', daysAgo(2), { subject: 'Bien reçu, merci', marked: true })]),
    ]) {
      expect(c.sourcing).toBeUndefined();
      expect(ballWithUs(c, situationOf(c.messages, TODAY))).toBe(false);
    }
  });

  it('leaves a follow-up owed on OUR unanswered mail alone', () => {
    // Their thank-you is old, our letter is recent and unanswered. The
    // follow-up is about our letter; nothing the last inbound says can cancel
    // it, which is why followupDue does not read this marker.
    const c = authority([
      msg('in', daysAgo(90), { subject: 'Merci !', marked: true }),
      msg('out', daysAgo(40), { subject: 'Demande de permission' }),
    ]);
    const s = situationOf(c.messages, TODAY);
    expect(s.followupDue).toBe(true);
    expect(followupDue(c, s)).toBe(true);
  });

  it('cannot meet neverContacted, which is why that bucket does not test it', () => {
    // The exclusion buckets.ts claims, pinned rather than asserted in prose:
    // the marker needs a datable inbound message, and 'first_mail' is the
    // state of a thread that holds none in either direction.
    const c = client([msg('in', daysAgo(2), { subject: 'Merci !', marked: true })]);
    const s = situationOf(c.messages, TODAY);
    expect(lastInboundNeedsNoReply(c)).toBe(true);
    expect(s.nextAction).not.toBe('first_mail');
    expect(neverContacted(c, s)).toBe(false);
  });
});

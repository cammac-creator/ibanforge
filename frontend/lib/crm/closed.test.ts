import { describe, expect, it } from 'vitest';
import { isClosed } from './closed';
import { ballWithUs, followupDue } from './buckets';
import { situationOf } from './situation';
import type { Contact, Message, Outcome, ProspectSourcing } from './types';

/**
 * Every address and company below is invented; example.net is reserved for
 * documentation by RFC 2606.
 */

const TODAY = new Date('2026-07-25T09:00:00Z');
const daysAgo = (n: number): string => new Date(TODAY.getTime() - n * 86_400_000).toISOString();

const msg = (direction: Message['direction'], msg_date: string | null, counterparty: string | null = null): Message => ({
  direction,
  msg_date,
  subject: null,
  snippet: null,
  counterparty,
});

const sourcing = (outcome: Outcome | null, outcomeAt: string | null): ProspectSourcing => ({
  prospectId: 'p-1',
  segment: null,
  whatTheyDo: null,
  fitReason: null,
  buyingSignal: null,
  signalSourceUrl: null,
  contactName: null,
  contactRole: null,
  emailSourceUrl: null,
  personalizationHook: null,
  confidence: null,
  status: 'contacte',
  source: null,
  outcome,
  outcomeNote: null,
  wakeUpAt: null,
  createdAt: null,
  outcomeAt,
});

const prospect = (messages: Message[], outcome: Outcome | null, outcomeAt: string | null): Contact => ({
  kind: 'prospect',
  id: 'ops@alpha.example.net',
  email: 'ops@alpha.example.net',
  company: 'Société Alpha',
  country: 'CH',
  website: null,
  messages,
  draft: null,
  unread: false,
  account: 'crm@example.net',
  sourcing: sourcing(outcome, outcomeAt),
  readyMail: null,
});

describe('isClosed — a terminal verdict closes the dossier', () => {
  // Their message is last: without the verdict this thread sits in
  // « À répondre » forever, which is the cycle the gesture exists to break.
  const DEAD_THREAD = [msg('out', daysAgo(30)), msg('in', daysAgo(20))];

  it.each(['pas_interesse', 'mauvaise_personne'] as const)('closes on %s', (o) => {
    expect(isClosed(prospect(DEAD_THREAD, o, daysAgo(10)))).toBe(true);
  });

  it.each(['en_discussion', 'pas_maintenant'] as const)('does not close on %s', (o) => {
    // 'pas_maintenant' already has its own mechanism — the wake-up date — and
    // 'en_discussion' is the opposite of a closed dossier.
    expect(isClosed(prospect(DEAD_THREAD, o, daysAgo(10)))).toBe(false);
  });

  it('does not close without a verdict', () => {
    expect(isClosed(prospect(DEAD_THREAD, null, null))).toBe(false);
  });

  it('declines to close when the verdict has no date', () => {
    // Without the verdict's instant, "did they write since?" has no answer.
    // Showing a row that could be hidden is recoverable; hiding one that
    // should be shown is the failure the whole CRM exists to prevent.
    expect(isClosed(prospect(DEAD_THREAD, 'pas_interesse', null))).toBe(false);
  });
});

describe('isClosed — what reopens a dossier, and what must not', () => {
  const VERDICT_AT = daysAgo(10);

  it('a human inbound after the verdict reopens it', () => {
    // The person judged uninterested has since written: the judgement is
    // stale, and burying their message would hide the one event that proves
    // it wrong.
    const c = prospect(
      [msg('out', daysAgo(30)), msg('in', daysAgo(20)), msg('in', daysAgo(3))],
      'pas_interesse',
      VERDICT_AT,
    );
    expect(isClosed(c)).toBe(false);
  });

  it('an automated inbound after the verdict does NOT reopen it', () => {
    // A ticket robot acknowledging receipt proves nothing about interest —
    // the exact class of message automated.ts exists to keep from deciding
    // anything. no-reply sender: matched by the same rule situationOf uses.
    const c = prospect(
      [msg('out', daysAgo(30)), msg('in', daysAgo(20)), msg('in', daysAgo(3), 'no-reply@alpha.example.net')],
      'pas_interesse',
      VERDICT_AT,
    );
    expect(isClosed(c)).toBe(true);
  });

  it('our own outbound after the verdict does NOT reopen it', () => {
    // Writing to someone does not make them interested.
    const c = prospect(
      [msg('in', daysAgo(20)), msg('out', daysAgo(3))],
      'mauvaise_personne',
      VERDICT_AT,
    );
    expect(isClosed(c)).toBe(true);
  });

  it('drafts and undatable messages decide nothing, here as everywhere', () => {
    const c = prospect(
      [msg('in', daysAgo(20)), msg('draft', daysAgo(1)), msg('in', null)],
      'pas_interesse',
      VERDICT_AT,
    );
    expect(isClosed(c)).toBe(true);
  });

  it('an inbound BEFORE the verdict is what the verdict was passed on', () => {
    const c = prospect([msg('in', daysAgo(20))], 'pas_interesse', VERDICT_AT);
    expect(isClosed(c)).toBe(true);
  });
});

describe('the day queues honour the closed dossier', () => {
  it('a closed thread leaves « À répondre » even with their message last', () => {
    const messages = [msg('out', daysAgo(30)), msg('in', daysAgo(20))];
    const open = prospect(messages, null, null);
    const closed = prospect(messages, 'pas_interesse', daysAgo(10));
    const s = situationOf(messages, TODAY);
    expect(ballWithUs(open, s)).toBe(true);
    expect(ballWithUs(closed, s)).toBe(false);
  });

  it('a closed thread leaves « Relances » even past the silence threshold', () => {
    const messages = [msg('out', daysAgo(30))];
    const open = prospect(messages, null, null);
    const closed = prospect(messages, 'mauvaise_personne', daysAgo(10));
    const s = situationOf(messages, TODAY);
    expect(followupDue(open, s)).toBe(true);
    expect(followupDue(closed, s)).toBe(false);
  });

  it('a reopened dossier is back in the queue', () => {
    const messages = [msg('out', daysAgo(30)), msg('in', daysAgo(3))];
    const closed = prospect(messages, 'pas_interesse', daysAgo(10));
    const s = situationOf(messages, TODAY);
    expect(ballWithUs(closed, s)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { canLoadReadyMail } from './ready-mail';
import type {
  ClientKeyInfo,
  Contact,
  Message,
  ProspectSourcing,
  ReadyMail,
  UsageSeries,
} from './types';

/** Invented fixtures only; example.net is reserved by RFC 2606. */

const sourcing: ProspectSourcing = {
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
  status: 'a_contacter',
  source: null,
  outcome: null,
  outcomeNote: null,
  wakeUpAt: null,
  createdAt: null,
  outcomeAt: null,
};

const readyMail: ReadyMail = {
  subjectEn: 'One call for IBAN and BIC',
  bodyEn: 'Hello, I run a small API. Happy to open a test key.',
  subjectFr: null,
  bodyFr: null,
  recommendedLang: 'en',
};

const base = {
  id: 'contact@example.net',
  email: 'contact@example.net',
  company: 'Fictive Sarl',
  country: 'CH',
  website: null,
  messages: [] as Message[],
  draft: null,
  unread: false,
  account: 'crm@example.net',
};

const msg = (direction: Message['direction']): Message => ({
  direction,
  msg_date: '2026-07-01T10:00',
  subject: null,
  snippet: 'text',
  counterparty: null,
});

const prospect = (over: Partial<Extract<Contact, { kind: 'prospect' }>> = {}): Contact => ({
  ...base,
  kind: 'prospect',
  sourcing,
  readyMail,
  ...over,
});

const apiKey: ClientKeyInfo = {
  keyPrefix: 'ibf_test',
  paid: false,
  creditsTotal: null,
  creditsRemaining: null,
  monthlyLimit: 1000,
  usedAllTime: 0,
  lastActiveMonth: null,
  createdAt: null,
  isNew: false,
};

const usage: UsageSeries = { series: [], months: [], days: [], endpoints: [] };

describe('canLoadReadyMail', () => {
  it('is true on a prospect with a pre-written mail and an empty thread', () => {
    expect(canLoadReadyMail(prospect())).toBe(true);
  });

  it('is false once a single mail has gone out', () => {
    expect(canLoadReadyMail(prospect({ messages: [msg('out')] }))).toBe(false);
  });

  it('is false once they have written to us', () => {
    expect(canLoadReadyMail(prospect({ messages: [msg('in')] }))).toBe(false);
  });

  it('is false with no pre-written mail to load', () => {
    expect(canLoadReadyMail(prospect({ readyMail: null }))).toBe(false);
  });

  it('stays true with a parked draft, which is not correspondence', () => {
    expect(canLoadReadyMail(prospect({ draft: msg('draft') }))).toBe(true);
  });

  it('is false on a client, which has no pre-written mail at all', () => {
    const client: Contact = { ...base, kind: 'client', apiKey, usage };
    expect(canLoadReadyMail(client)).toBe(false);
  });

  it('narrows the contact so the caller can read readyMail', () => {
    const c = prospect();
    // The point of the type predicate: this block does not compile if the
    // caller has to re-check what the guard already decided.
    if (canLoadReadyMail(c)) {
      expect(c.readyMail.subjectEn).toBe('One call for IBAN and BIC');
    } else {
      throw new Error('the guard should have let this through');
    }
  });
});

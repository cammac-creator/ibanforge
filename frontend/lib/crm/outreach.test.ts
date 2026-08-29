import { describe, expect, it } from 'vitest';
import { AUTO_ENRICH, wonByOutreach } from './outreach';
import type { Contact, Message, ProspectSourcing } from './types';

function message(direction: Message['direction'], msg_date: string | null): Message {
  return { direction, msg_date, subject: 'Sujet', snippet: 'Extrait', counterparty: 'acme@example.com' };
}

function sourcing(source: string | null): ProspectSourcing {
  return {
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
    // The very status the machine hardcodes on an enriched signup. Present on
    // every fixture below, won or not, so that no test can pass by reading it.
    status: 'contacte',
    source,
    createdAt: null,
    outcome: null,
    outcomeNote: null,
    wakeUpAt: null,
    outcomeAt: null,
  };
}

function client(
  opts: {
    keyCreatedAt: string | null;
    messages: Message[];
    source?: string | null;
    withSourcing?: boolean;
    issuedByUs?: boolean;
  },
): Contact {
  const { keyCreatedAt, messages, source = 'sourcing-manuel', withSourcing = true, issuedByUs = false } = opts;
  return {
    kind: 'client',
    id: 'acme@example.com',
    email: 'acme@example.com',
    company: 'Société Alpha',
    country: 'CH',
    website: 'https://alpha.example.net',
    messages,
    draft: null,
    unread: false,
    account: 'desk@example.net',
    apiKey: {
      keyPrefix: 'ifk_test',
      paid: false,
      creditsTotal: null,
      creditsRemaining: null,
      monthlyLimit: 200,
      usedAllTime: 12,
      lastActiveMonth: '2026-08',
      createdAt: keyCreatedAt,
      issuedByUs,
      isNew: false,
    },
    usage: { series: [], months: [], days: [], endpoints: [] },
    ...(withSourcing ? { sourcing: sourcing(source) } : {}),
  };
}

function prospect(messages: Message[]): Contact {
  return {
    kind: 'prospect',
    id: 'acme@example.com',
    email: 'acme@example.com',
    company: 'Société Alpha',
    country: 'CH',
    website: 'https://alpha.example.net',
    messages,
    draft: null,
    unread: false,
    account: 'desk@example.net',
    sourcing: sourcing('sourcing-manuel'),
    readyMail: null,
  };
}

describe('wonByOutreach', () => {
  it('is true when an outbound mail predates the key', () => {
    const c = client({
      keyCreatedAt: '2026-06-20T09:00:00Z',
      messages: [message('out', '2026-06-11T08:30:00Z'), message('in', '2026-06-14T10:00:00Z')],
    });
    expect(wonByOutreach(c)).toBe(true);
  });

  it('is false when the only outbound mail comes after the key', () => {
    // Support, onboarding or an upsell: real correspondence that won nobody.
    // Without the causal clause this is where every organic client would slip
    // back in, the moment we answered their first question.
    const c = client({
      keyCreatedAt: '2026-06-20T09:00:00Z',
      messages: [message('in', '2026-06-22T08:00:00Z'), message('out', '2026-06-23T09:15:00Z')],
    });
    expect(wonByOutreach(c)).toBe(false);
  });

  it('is false for an auto-enrich dossier, whatever the thread says', () => {
    // The trap the rule exists for: a dossier the machine filed AFTER an
    // organic signup, carrying a hardcoded "contacte" status. The outbound
    // mail below predates the key, so every other clause is satisfied — only
    // the source keeps this one out.
    const c = client({
      keyCreatedAt: '2026-06-20T09:00:00Z',
      source: AUTO_ENRICH,
      messages: [message('out', '2026-06-11T08:30:00Z')],
    });
    expect(wonByOutreach(c)).toBe(false);
  });

  it('is false for a key we minted ourselves, however the thread is dated', () => {
    // The batch of evaluation pilots: fabricated here, mailed out, never called
    // once by the people they were addressed to. Every other clause passes —
    // there is a dossier, it is not machine-filed, and an outbound mail predates
    // the key — because the mail IS the one that carried the key. Only this
    // clause keeps them out of the conquest count.
    const c = client({
      keyCreatedAt: '2026-06-20T09:00:00Z',
      issuedByUs: true,
      messages: [message('out', '2026-06-11T08:30:00Z')],
    });
    expect(wonByOutreach(c)).toBe(false);
  });

  it('still counts a real conquest whose key the customer minted', () => {
    // The flag must not swallow the badge whole: the same thread, on a key
    // nobody handed over, is exactly what the rule is for.
    const c = client({
      keyCreatedAt: '2026-06-20T09:00:00Z',
      issuedByUs: false,
      messages: [message('out', '2026-06-11T08:30:00Z')],
    });
    expect(wonByOutreach(c)).toBe(true);
  });

  it('is false for a prospect that never converted', () => {
    expect(wonByOutreach(prospect([message('out', '2026-06-11T08:30:00Z')]))).toBe(false);
  });

  it('is false for a client whose key carries no date', () => {
    // No key date is no "before" to be on the right side of.
    const c = client({ keyCreatedAt: null, messages: [message('out', '2026-06-11T08:30:00Z')] });
    expect(wonByOutreach(c)).toBe(false);
  });

  it('is false when the thread holds no outbound mail at all', () => {
    // The exact shape the investigation found: a dossier saying "contacte"
    // while no mail had ever been sent. A status is a field somebody set.
    const c = client({
      keyCreatedAt: '2026-06-20T09:00:00Z',
      messages: [message('in', '2026-06-21T08:00:00Z')],
    });
    expect(wonByOutreach(c)).toBe(false);
  });

  it('is false for a client holding a key but no dossier', () => {
    const c = client({
      keyCreatedAt: '2026-06-20T09:00:00Z',
      withSourcing: false,
      messages: [message('out', '2026-06-11T08:30:00Z')],
    });
    expect(wonByOutreach(c)).toBe(false);
  });

  it('reads the two date formats against each other', () => {
    // `apiKey.createdAt` is stored as 'YYYY-MM-DD HH:MM:SS' (parsed as local
    // time) while msg_date is free-form and usually ISO with a Z (parsed as
    // UTC). Days apart on purpose: the offset between the two readings is
    // hours, so this stays true in every timezone the page runs in — which is
    // exactly the precision the rule claims, and no more.
    const won = client({
      keyCreatedAt: '2026-06-20 09:00:00',
      messages: [message('out', '2026-06-11T08:30:00Z')],
    });
    expect(wonByOutreach(won)).toBe(true);

    const notWon = client({
      keyCreatedAt: '2026-06-20 09:00:00',
      messages: [message('out', '2026-06-28T08:30:00Z')],
    });
    expect(wonByOutreach(notWon)).toBe(false);
  });

  it('ignores an outbound mail that cannot be placed in time', () => {
    const c = client({
      keyCreatedAt: '2026-06-20T09:00:00Z',
      messages: [message('out', null), message('out', 'pas une date')],
    });
    expect(wonByOutreach(c)).toBe(false);
  });
});

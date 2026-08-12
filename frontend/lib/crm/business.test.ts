import { describe, expect, it } from 'vitest';
import { chipOf, replyGroupOf } from './business';
import type { BusinessInfo, Contact } from './types';

function base(kind: 'client' | 'prospect', business?: BusinessInfo): Contact {
  const common = {
    id: 'x@alpha.example.net',
    email: 'x@alpha.example.net',
    company: 'Société Alpha',
    country: 'CH',
    website: null,
    messages: [],
    draft: null,
    unread: false,
    account: 'desk@example.com',
    ...(business ? { business } : {}),
  };
  if (kind === 'prospect') {
    return {
      ...common,
      kind: 'prospect',
      sourcing: {
        prospectId: 'p1',
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
        status: 'a_mailer',
        source: null,
        outcome: null,
        outcomeNote: null,
        wakeUpAt: null,
        outcomeAt: null,
      },
      readyMail: null,
    };
  }
  return {
    ...common,
    kind: 'client',
    apiKey: {
      keyPrefix: 'ifk_test',
      paid: false,
      creditsTotal: null,
      creditsRemaining: null,
      monthlyLimit: 200,
      usedAllTime: 4,
      lastActiveMonth: null,
      createdAt: '2026-01-01',
      isNew: false,
    },
    usage: { series: [], months: [], days: [], endpoints: [] },
  };
}

function biz(status: BusinessInfo['status'], packs = 0): BusinessInfo {
  return {
    status,
    source: 'direct',
    creditsTotal: packs > 0 ? 5000 : 0,
    creditsRemaining: packs > 0 ? 2400 : 0,
    packs,
    firstCallAt: null,
    calls90d: 0,
  };
}

describe('chipOf — the one word the list says about a contact', () => {
  it('paying wins over everything', () => {
    expect(chipOf(base('client', biz('paying', 1)))!.label).toBe('payant');
  });
  it('a dormant buyer says so — never "unused", never silent', () => {
    expect(chipOf(base('client', biz('dormant', 1)))!.label).toBe('endormi');
  });
  it('at-limit reads as the conversion moment it is', () => {
    expect(chipOf(base('client', biz('at-limit')))!.label).toBe('à la limite');
  });
  it('an elevated free quota is a pilot even when the activation status is bland', () => {
    const c = base('client', biz('active'));
    if (c.kind === 'client') c.apiKey.monthlyLimit = 5000;
    expect(chipOf(c)!.label).toBe('pilote');
  });
  it('an ordinary active client carries no chip: calm by default', () => {
    expect(chipOf(base('client', biz('active')))).toBeNull();
  });
  it('a prospect is chipped as such', () => {
    expect(chipOf(base('prospect'))!.label).toBe('prospect');
  });
  it('no activation data → only the kind speaks (client stays calm)', () => {
    expect(chipOf(base('client'))).toBeNull();
  });
});

describe('replyGroupOf — the three shelves of the reply queue', () => {
  it('unread is urgent whatever the silence', () => {
    expect(replyGroupOf(true, 0)).toBe('urgent');
  });
  it('a week of silence is urgent', () => {
    expect(replyGroupOf(false, 7)).toBe('urgent');
  });
  it('3-6 days is this week', () => {
    expect(replyGroupOf(false, 3)).toBe('week');
    expect(replyGroupOf(false, 6)).toBe('week');
  });
  it('fresh threads can wait', () => {
    expect(replyGroupOf(false, 0)).toBe('later');
    expect(replyGroupOf(false, null)).toBe('later');
  });
});

import { describe, expect, it } from 'vitest';
import { heatOf } from './heat';
import type { BusinessInfo, Contact, Situation } from './types';

function day(offset: number): string {
  return new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
}

function client(days: Array<{ day: string; count: number }>, business?: BusinessInfo): Contact {
  return {
    kind: 'client',
    id: 'c@alpha.example.net',
    email: 'c@alpha.example.net',
    company: 'Société Alpha',
    country: 'CH',
    website: null,
    messages: [],
    draft: null,
    unread: false,
    account: 'desk@example.com',
    apiKey: {
      keyPrefix: 'ifk_test',
      paid: !!business && business.packs > 0,
      creditsTotal: business?.creditsTotal ?? null,
      creditsRemaining: business?.creditsRemaining ?? null,
      monthlyLimit: 200,
      usedAllTime: 50,
      lastActiveMonth: null,
      createdAt: '2026-06-01',
      issuedByUs: false,
      isNew: false,
    },
    usage: { series: [], months: [], days, endpoints: [] },
    ...(business ? { business } : {}),
  };
}

function biz(status: BusinessInfo['status'], packs: number): BusinessInfo {
  return {
    status,
    source: 'direct',
    creditsTotal: packs * 5000,
    creditsRemaining: 2400,
    packs,
    firstCallAt: null,
    calls90d: 100,
  };
}

const quiet: Situation = {
  ballInCourt: 'none',
  silenceDays: null,
  firstContactAt: null,
  messageCount: 0,
  nextAction: 'first_mail',
} as unknown as Situation;

describe('heatOf — a score that always shows its arithmetic', () => {
  it('a fresh buyer burning credits scores hot, with named parts', () => {
    const c = client(
      [
        { day: day(1), count: 900 },
        { day: day(0), count: 1600 },
      ],
      biz('paying', 1),
    );
    const h = heatOf(c, quiet);
    expect(h.score).toBeGreaterThanOrEqual(70);
    expect(h.parts.some((p) => p.label.includes('pack'))).toBe(true);
    expect(h.parts.every((p) => p.points !== 0)).toBe(true);
  });

  it('a dormant buyer is cooled, never zeroed: the pack still counts', () => {
    const h = heatOf(client([], biz('dormant', 1)), quiet);
    expect(h.score).toBeLessThan(50);
    expect(h.score).toBeGreaterThan(0);
    expect(h.parts.some((p) => p.points < 0)).toBe(true);
  });

  it('a cold prospect with nothing scores zero', () => {
    const prospect: Contact = {
      kind: 'prospect',
      id: 'p@alpha.example.net',
      email: 'p@alpha.example.net',
      company: 'Société Alpha',
      country: null,
      website: null,
      messages: [],
      draft: null,
      unread: false,
      account: 'cold@example.com',
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
        createdAt: null,
        outcomeAt: null,
      },
      readyMail: null,
    };
    expect(heatOf(prospect, quiet).score).toBe(0);
  });

  it('a live conversation warms a free client', () => {
    const talking: Situation = { ...quiet, ballInCourt: 'us', silenceDays: 2, messageCount: 3 } as Situation;
    const c = client([{ day: day(2), count: 30 }], biz('active', 0));
    expect(heatOf(c, talking).score).toBeGreaterThan(heatOf(c, quiet).score);
  });

  it('the score is clamped to 100', () => {
    const c = client(
      Array.from({ length: 7 }, (_, i) => ({ day: day(i), count: 2000 })),
      biz('paying', 3),
    );
    const talking: Situation = { ...quiet, ballInCourt: 'us', silenceDays: 1, messageCount: 9 } as Situation;
    expect(heatOf(c, talking).score).toBeLessThanOrEqual(100);
  });
});

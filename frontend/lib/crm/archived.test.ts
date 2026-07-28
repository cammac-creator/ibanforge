import { describe, expect, it } from 'vitest';
import { isArchived } from './archived';
import type { Contact, ProspectSourcing, Situation } from './types';

/** Invented fixtures only; example.net is reserved by RFC 2606. */

const sourcing = (status: string): ProspectSourcing => ({
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
  status,
  source: null,
  outcome: null,
  outcomeNote: null,
  wakeUpAt: null,
  outcomeAt: null,
});

const base = {
  id: 'mira@example.net',
  email: 'mira@example.net',
  company: 'Fictive Sàrl',
  country: 'CH',
  website: null,
  messages: [],
  draft: null,
  unread: false,
  account: 'crm@example.net',
};

const prospect = (status: string): Contact => ({
  ...base,
  kind: 'prospect',
  sourcing: sourcing(status),
  readyMail: null,
});

/** A paying client carrying a matching prospect row, which is the trap. */
const client = (status: string): Contact => ({
  ...base,
  kind: 'client',
  apiKey: {
    keyPrefix: 'ifk_demo',
    paid: true,
    creditsTotal: null,
    creditsRemaining: null,
    monthlyLimit: 200,
    usedAllTime: 12,
    lastActiveMonth: '2026-07',
  },
  usage: { series: [], months: [], days: [], endpoints: [] },
  sourcing: sourcing(status),
});

const situation = (over: Partial<Situation> = {}): Situation => ({
  ballInCourt: 'none',
  silenceDays: null,
  followupDue: false,
  firstContactAt: null,
  hasEverReplied: false,
  messageCount: 0,
  nextAction: 'first_mail',
  ...over,
});

describe('isArchived', () => {
  it('hides an archived prospect whose thread is empty', () => {
    expect(isArchived(prospect('archive'), situation())).toBe(true);
  });

  it('leaves a prospect that was never archived', () => {
    expect(isArchived(prospect('contacte'), situation())).toBe(false);
  });

  it('never hides a client, whatever the attached prospect row says', () => {
    // 'archive' is terminal in the database and a stale duplicate prospect row
    // can carry it. Reading the status without the kind hid the paying customer
    // behind it: gone from the Clients card and from the revenue sum.
    expect(isArchived(client('archive'), situation())).toBe(false);
  });

  it('lets correspondence outrank the stored status', () => {
    // A prospect archived after silence who answers two months later is unread
    // and ball-in-court. Nothing ever clears 'archive', so without this rule the
    // reply would be invisible everywhere but the Archivés chip.
    expect(isArchived(prospect('archive'), situation({ messageCount: 1 }))).toBe(false);
  });

  it('shows an archived prospect whose situation is missing', () => {
    // An unknown situation means we cannot tell whether the thread is empty.
    // Showing a row that should be hidden is recoverable; hiding one that
    // should be shown is the failure this rule exists to prevent.
    expect(isArchived(prospect('archive'), undefined)).toBe(false);
  });
});

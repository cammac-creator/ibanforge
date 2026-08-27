import { describe, expect, it } from 'vitest';
import { BY_CONFIDENCE, BY_COUNTRY, BY_SEGMENT, funnelBy } from './funnel';
import type { Contact, Message, ProspectSourcing } from './types';

const out = (d: string): Message => ({ direction: 'out', msg_date: d, subject: null, snippet: null, counterparty: null });
const inb = (d: string): Message => ({ direction: 'in', msg_date: d, subject: 'Re:', snippet: 'Hi, yes, happy to talk.', counterparty: 'p@example.net' });
const robot = (d: string): Message => ({
  direction: 'in',
  msg_date: d,
  subject: 'Ticket',
  snippet: 'We have received your message and a ticket has been created.',
  counterparty: 'hello@example.net',
});

const sourcing = (over: Partial<ProspectSourcing> = {}): ProspectSourcing => ({
  prospectId: 'p-1',
  segment: 'fintech',
  whatTheyDo: null,
  fitReason: null,
  buyingSignal: null,
  signalSourceUrl: null,
  contactName: null,
  contactRole: null,
  emailSourceUrl: null,
  personalizationHook: null,
  confidence: 'high',
  status: 'contacte',
  source: 'campagne-A',
  outcome: null,
  outcomeNote: null,
  wakeUpAt: null,
  createdAt: null,
  outcomeAt: null,
  ...over,
});

const prospect = (id: string, messages: Message[] = [], over: Partial<ProspectSourcing> = {}, country: string | null = 'Suisse'): Contact => ({
  kind: 'prospect',
  id,
  email: id,
  company: 'Fictive Sàrl',
  country,
  website: null,
  messages,
  draft: null,
  unread: false,
  account: 'crm@example.net',
  sourcing: sourcing(over),
  readyMail: null,
});

const client = (id: string, usedAllTime = 100, messages: Message[] = [], withSourcing = true): Contact => ({
  kind: 'client',
  id,
  email: id,
  company: 'Fictive AG',
  country: 'Switzerland',
  website: null,
  messages,
  draft: null,
  unread: false,
  account: 'crm@example.net',
  apiKey: { keyPrefix: 'k', paid: false, creditsTotal: null, creditsRemaining: null, monthlyLimit: 1000, usedAllTime, lastActiveMonth: '2026-07', createdAt: null, isNew: false },
  usage: { series: [], months: [], days: [], endpoints: [] },
  ...(withSourcing ? { sourcing: sourcing() } : {}),
});

describe('funnelBy', () => {
  it('counts a follow-up as two outbound in a row, not as two mails', () => {
    // Counting "received two mails" scores every conversation as a follow-up.
    // On the real data that inflated the figure roughly four-fold.
    const conversation = prospect('a@example.net', [out('2026-07-01'), inb('2026-07-02'), out('2026-07-03')]);
    const realFollowUp = prospect('b@example.net', [out('2026-07-01'), out('2026-07-12')]);
    const rows = funnelBy([conversation, realFollowUp], BY_SEGMENT);
    expect(rows[0].mailed).toBe(2);
    expect(rows[0].followed).toBe(1);
  });

  it('does not let a robot count as a reply, nor break a follow-up pair', () => {
    // Both halves matter. The acknowledgement sits between our two mails: if
    // it counted, this contact would show a reply it never sent AND lose the
    // follow-up it did receive.
    const c = prospect('a@example.net', [out('2026-07-01'), robot('2026-07-01'), out('2026-07-12')]);
    const rows = funnelBy([c], BY_SEGMENT);
    expect(rows[0].replied).toBe(0);
    expect(rows[0].followed).toBe(1);
  });

  it('counts a human reply', () => {
    const rows = funnelBy([prospect('a@example.net', [out('2026-07-01'), inb('2026-07-02')])], BY_SEGMENT);
    expect(rows[0].replied).toBe(1);
  });

  it('counts a used key as converted and an idle one as not', () => {
    const rows = funnelBy([client('a@example.net', 100), client('b@example.net', 0)], BY_SEGMENT);
    expect(rows[0].stock).toBe(2);
    expect(rows[0].converted).toBe(1);
  });

  it('leaves out a contact the cut does not apply to, rather than bucketing it', () => {
    // A client that never came from the prospect list has no segment. Inventing
    // one would put a made-up row in a table meant to drive sourcing.
    const rows = funnelBy([prospect('a@example.net'), client('b@example.net', 10, [], false)], BY_SEGMENT);
    expect(rows.length).toBe(1);
    expect(rows[0].stock).toBe(1);
  });

  it('orders by replies, then by stock', () => {
    const rows = funnelBy(
      [
        prospect('a@example.net', [out('2026-07-01')], { segment: 'gros-stock' }),
        prospect('b@example.net', [out('2026-07-01')], { segment: 'gros-stock' }),
        prospect('c@example.net', [out('2026-07-01')], { segment: 'gros-stock' }),
        prospect('d@example.net', [out('2026-07-01'), inb('2026-07-02')], { segment: 'qui-repond' }),
      ],
      BY_SEGMENT,
    );
    expect(rows[0].key).toBe('qui-repond');
    expect(rows[1].key).toBe('gros-stock');
  });

  it('is stable when replies and stock tie', () => {
    const rows = funnelBy(
      [prospect('a@example.net', [], { segment: 'zebre' }), prospect('b@example.net', [], { segment: 'alpaga' })],
      BY_SEGMENT,
    );
    expect(rows.map((r) => r.key)).toEqual(['alpaga', 'zebre']);
  });

  it('labels the confidence tiers in French', () => {
    const rows = funnelBy([prospect('a@example.net', [], { confidence: 'high' })], BY_CONFIDENCE);
    expect(rows[0].label).toBe('Confiance haute');
  });

  it('folds the spellings of one country into one row', () => {
    // Rows saying "Suisse", "Switzerland" and "CH" were three separate places
    // before country.ts.
    const rows = funnelBy(
      [prospect('a@example.net', [], {}, 'Suisse'), prospect('b@example.net', [], {}, 'Switzerland'), prospect('c@example.net', [], {}, 'CH')],
      BY_COUNTRY,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].key).toBe('CH');
    expect(rows[0].stock).toBe(3);
  });

  it('shows the rows that name no country instead of dropping them', () => {
    const rows = funnelBy(
      [prospect('a@example.net', [], {}, 'Suisse'), prospect('b@example.net', [], {}, 'Global (online, EU-targeted)')],
      BY_COUNTRY,
    );
    expect(rows.map((r) => r.key).sort()).toEqual(['??', 'CH']);
    // The whole point: the stocks still add up to the contacts handed in.
    expect(rows.reduce((n, r) => n + r.stock, 0)).toBe(2);
  });

  it('counts a client with no prospect row in the geography, unlike the other cuts', () => {
    // Found on the real list: gating geography on the sourcing block the way
    // the segment cut is gated left every customer out, and the table summed
    // to 78 rows where 99 contacts were active. Country lives on the contact,
    // not on the sourcing, so it is known for a customer who was never a
    // prospect.
    const rows = funnelBy([prospect('a@example.net'), client('b@example.net', 10, [], false)], BY_COUNTRY);
    expect(rows.reduce((n, r) => n + r.stock, 0)).toBe(2);
    expect(rows[0].key).toBe('CH');
    expect(rows[0].converted).toBe(1);
  });

  it('keeps the sourcing cuts gated, so no made-up row informs a decision', () => {
    const rows = funnelBy([prospect('a@example.net'), client('b@example.net', 10, [], false)], BY_CONFIDENCE);
    expect(rows.reduce((n, r) => n + r.stock, 0)).toBe(1);
  });

  // The geography cut is the one cut that reads the contact rather than the
  // sourcing block, which is exactly why an institution reaches it: it has a
  // country like anybody else. Every row of this table is a commercial funnel
  // — stock, mailed, replied, converted — so one supervisor filed in CH would
  // inflate Switzerland's stock and depress its conversion, and the number the
  // owner reads to decide where to prospect would be wrong by however many
  // authorities happen to sit in that country.
  it('leaves institutions out of the geography, whatever country they carry', () => {
    const supervisor: Contact = {
      kind: 'institution',
      id: 'registry@alpha.example.net',
      email: 'registry@alpha.example.net',
      company: 'Autorité Alpha',
      country: 'CH',
      website: null,
      messages: [out('2026-07-01'), inb('2026-07-20')],
      draft: null,
      unread: false,
      account: 'crm@example.net',
      institution: {
        org: 'Autorité Alpha',
        category: 'autorite',
        country: 'CH',
        role: null,
        website: null,
        dossier: 'Permission de citer le registre',
      },
    };
    expect(BY_COUNTRY(supervisor)).toBeNull();
    // And through the aggregation, not only through the key function: one
    // prospect in, one prospect counted.
    const rows = funnelBy([prospect('a@example.net', [], {}, 'Suisse'), supervisor], BY_COUNTRY);
    expect(rows.reduce((n, r) => n + r.stock, 0)).toBe(1);
    expect(rows.map((r) => r.key)).toEqual(['CH']);
  });

  it('returns nothing for an empty list', () => {
    expect(funnelBy([], BY_SEGMENT)).toEqual([]);
  });
});

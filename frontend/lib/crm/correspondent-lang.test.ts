import { describe, expect, it } from 'vitest';
import {
  correspondentLangOf,
  normaliseLang,
  pickCorrespondentLang,
} from './correspondent-lang';
import type {
  ClientKeyInfo,
  Contact,
  Message,
  ProspectSourcing,
  ReadyMail,
  UsageSeries,
} from './types';

/** Invented fixtures only; example.net is reserved by RFC 2606. */

const msg = (over: Partial<Message> = {}): Message => ({
  direction: 'in',
  msg_date: '2026-07-01T10:00',
  subject: 'Question sur les IBAN',
  snippet: 'Bonjour, une question sur votre API.',
  counterparty: 'contact@alpha.example.net',
  ...over,
});

describe('normaliseLang', () => {
  it('reads the three languages the site publishes in', () => {
    expect(normaliseLang('en')).toBe('en');
    expect(normaliseLang('fr')).toBe('fr');
    expect(normaliseLang('de')).toBe('de');
  });

  it('folds a regional tag onto its primary subtag', () => {
    // The column is free TEXT clipped at 8 characters, so these really arrive.
    expect(normaliseLang('fr-CH')).toBe('fr');
    expect(normaliseLang('de_DE')).toBe('de');
    expect(normaliseLang('  EN  ')).toBe('en');
  });

  it('answers null on anything else, rather than falling to English here', () => {
    // Null is "this source said nothing", which lets the NEXT clause speak.
    // Folding to 'en' here would make a Dutch mail indistinguishable from a
    // missing column, and the clause order below is built on that difference.
    expect(normaliseLang('nl')).toBeNull();
    expect(normaliseLang('')).toBeNull();
    expect(normaliseLang(null)).toBeNull();
    expect(normaliseLang(undefined)).toBeNull();
  });
});

describe('pickCorrespondentLang', () => {
  it('follows the last mail they wrote us', () => {
    expect(pickCorrespondentLang({ messages: [msg({ lang: 'fr' })] })).toBe('fr');
    expect(pickCorrespondentLang({ messages: [msg({ lang: 'de' })] })).toBe('de');
  });

  it('reads the LAST inbound, not the first', () => {
    const messages = [msg({ lang: 'de' }), msg({ direction: 'out' }), msg({ lang: 'fr' })];
    expect(pickCorrespondentLang({ messages })).toBe('fr');
  });

  it('ignores what WE wrote, in either direction', () => {
    const messages = [msg({ lang: 'fr' }), msg({ direction: 'out', lang: 'en' })];
    expect(pickCorrespondentLang({ messages })).toBe('fr');
  });

  it('ignores a draft, which is not correspondence', () => {
    const messages = [msg({ lang: 'fr' }), msg({ direction: 'draft', lang: 'en' })];
    expect(pickCorrespondentLang({ messages })).toBe('fr');
  });

  it('skips an automated message, so a robot cannot choose the language', () => {
    // A German out-of-office landing after a French question is the newest
    // inbound row. Without the skip it would decide the answer's language.
    const messages = [
      msg({ lang: 'fr' }),
      msg({ lang: 'de', subject: 'Out of office', snippet: 'I am out of office until Monday.' }),
    ];
    expect(pickCorrespondentLang({ messages })).toBe('fr');
  });

  it('falls to the prospect recommendation when nobody has written', () => {
    expect(pickCorrespondentLang({ messages: [], recommendedLang: 'fr' })).toBe('fr');
  });

  it('prefers what they wrote over what a list recommends', () => {
    expect(
      pickCorrespondentLang({ messages: [msg({ lang: 'de' })], recommendedLang: 'fr' }),
    ).toBe('de');
  });

  it('falls to the client language when there is neither', () => {
    expect(pickCorrespondentLang({ messages: [], clientLang: 'de' })).toBe('de');
    // And it stays behind the recommendation, which is about this very person.
    expect(pickCorrespondentLang({ messages: [], recommendedLang: 'fr', clientLang: 'de' })).toBe(
      'fr',
    );
  });

  it('falls to English on an empty thread with nothing else known', () => {
    // Which is what both draft prompts have always pinned the mail to: falling
    // here changes nothing about the behaviour that existed before.
    expect(pickCorrespondentLang({ messages: [] })).toBe('en');
  });

  it('falls through a language it cannot proofread rather than obeying it', () => {
    const messages = [msg({ lang: 'nl' })];
    expect(pickCorrespondentLang({ messages, recommendedLang: 'fr' })).toBe('fr');
    expect(pickCorrespondentLang({ messages })).toBe('en');
  });

  it('treats a message with no lang column as saying nothing', () => {
    // The API serves the column optionally, so absent must degrade to the next
    // clause rather than to English.
    expect(pickCorrespondentLang({ messages: [msg()], recommendedLang: 'fr' })).toBe('fr');
  });
});

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
  createdAt: null,
  outcome: null,
  outcomeNote: null,
  wakeUpAt: null,
  outcomeAt: null,
};

const readyMail: ReadyMail = {
  subjectEn: 'One call for IBAN and BIC',
  bodyEn: 'Hello, I run a small API.',
  subjectFr: 'Un appel pour IBAN et BIC',
  bodyFr: 'Bonjour, je tiens une petite API.',
  recommendedLang: 'fr',
};

const base = {
  id: 'contact@alpha.example.net',
  email: 'contact@alpha.example.net',
  company: 'Société Alpha',
  country: 'CH',
  website: null,
  messages: [] as Message[],
  draft: null,
  unread: false,
  account: 'crm@example.net',
};

const apiKey: ClientKeyInfo = {
  keyPrefix: 'ifk_test',
  paid: false,
  creditsTotal: null,
  creditsRemaining: null,
  monthlyLimit: 200,
  usedAllTime: 0,
  lastActiveMonth: null,
  createdAt: null,
  issuedByUs: false,
  isNew: false,
};

const usage: UsageSeries = { series: [], months: [], days: [], endpoints: [] };

describe('correspondentLangOf', () => {
  it('reads the prospect recommendation off the contact', () => {
    const prospect: Contact = { ...base, kind: 'prospect', sourcing, readyMail };
    expect(correspondentLangOf(prospect)).toBe('fr');
  });

  it('lets the thread override the recommendation', () => {
    const prospect: Contact = {
      ...base,
      kind: 'prospect',
      sourcing,
      readyMail,
      messages: [msg({ lang: 'de' })],
    };
    expect(correspondentLangOf(prospect)).toBe('de');
  });

  it('has no recommendation to read on a client, and falls to the thread', () => {
    const client: Contact = {
      ...base,
      kind: 'client',
      apiKey,
      usage,
      messages: [msg({ lang: 'fr' })],
    };
    expect(correspondentLangOf(client)).toBe('fr');
  });

  it('answers English for a client nobody has heard from', () => {
    const client: Contact = { ...base, kind: 'client', apiKey, usage };
    expect(correspondentLangOf(client)).toBe('en');
  });

  it('answers for an institution, which carries neither key nor recommendation', () => {
    const institution: Contact = {
      ...base,
      kind: 'institution',
      institution: { org: 'Autorité Alpha', category: 'autorite', country: 'CH', role: null, website: null, dossier: null },
      messages: [msg({ lang: 'de' })],
    };
    expect(correspondentLangOf(institution)).toBe('de');
  });
});

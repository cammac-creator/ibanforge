import { describe, expect, it } from 'vitest';
import { institutionalBrief } from './institutional-brief';
import type { Contact, InstitutionInfo, Message } from './types';

/**
 * Institutions are invented, as everywhere in this repository: it is public and
 * no real authority, bank, scheme or supplier may be named here, fixtures
 * included.
 */
const msg = (direction: Message['direction'], subject: string, snippet: string, msg_date: string): Message => ({
  direction,
  msg_date,
  subject,
  snippet,
  counterparty: 'registry@alpha.example.net',
});

function institution(messages: Message[], over: Partial<InstitutionInfo> = {}): Extract<Contact, { kind: 'institution' }> {
  return {
    kind: 'institution',
    id: 'registry@alpha.example.net',
    email: 'registry@alpha.example.net',
    company: 'Autorité Alpha',
    country: 'CH',
    website: null,
    messages,
    draft: null,
    unread: false,
    account: 'desk@example.com',
    institution: {
      org: 'Autorité Alpha',
      category: 'autorite',
      country: 'CH',
      role: null,
      website: null,
      dossier: 'Permission de citer le registre',
      ...over,
    },
  };
}

const WAITING = 'They wrote last and are waiting on you.';
const FOLLOWUP = 'Our letter is the last message in the thread.';
const FIRST = 'this is the FIRST written request to this institution';

describe('the brief a letter to an institution is generated from', () => {
  // The three instructions are mutually exclusive by construction. Asserting
  // the two absences on every case is the point: the bug this pins was not a
  // missing instruction, it was the right one plus a wrong one.
  it('tells the writer to answer when their mail is the last one', () => {
    const brief = institutionalBrief(
      institution([
        msg('out', 'Demande de permission', 'Nous souhaitons citer votre registre', '2026-07-02'),
        msg('in', 'Re: Demande de permission', 'Merci, quelques précisions nous manquent', '2026-07-25'),
      ]),
    );
    expect(brief).toContain(WAITING);
    expect(brief).not.toContain(FOLLOWUP);
    expect(brief).not.toContain(FIRST);
  });

  // The state that used to be briefed as its own opposite: an institution whose
  // relance is due arrives on this sheet exactly like one that answered.
  it('asks for the due follow-up when our own letter is the last one', () => {
    const brief = institutionalBrief(
      institution([
        msg('in', 'Accusé de réception', 'Votre demande est enregistrée', '2026-07-02'),
        msg('out', 'Relance', 'Nous revenons vers vous au sujet de la demande', '2026-07-25'),
      ]),
    );
    expect(brief).toContain(FOLLOWUP);
    expect(brief).not.toContain(WAITING);
    expect(brief).not.toContain(FIRST);
  });

  it('opens a first written request when there is no thread at all', () => {
    const brief = institutionalBrief(institution([]));
    expect(brief).toContain(FIRST);
    expect(brief).not.toContain(WAITING);
    expect(brief).not.toContain(FOLLOWUP);
    // No thread, so nothing to quote: an empty tail header would tell the
    // writer a conversation exists.
    expect(brief).not.toContain('Thread so far:');
  });

  it('quotes the thread whenever there is one, in both directions', () => {
    const theirs = institutionalBrief(institution([msg('in', 'Re: Demande', 'Votre demande est enregistrée', '2026-07-25')]));
    const ours = institutionalBrief(institution([msg('out', 'Demande', 'Nous souhaitons citer votre registre', '2026-07-25')]));
    expect(theirs).toContain('Thread so far:');
    expect(ours).toContain('Thread so far:');
  });

  // A draft is not correspondence: it must not decide the instruction. The
  // stored thread never carries one today, which is exactly why this is pinned
  // rather than trusted.
  it('ignores a draft when deciding who wrote last', () => {
    const brief = institutionalBrief(
      institution([
        msg('in', 'Re: Demande', 'Merci, quelques précisions nous manquent', '2026-07-25'),
        msg('draft', 'Réponse', 'En cours de rédaction', '2026-07-26'),
      ]),
    );
    expect(brief).toContain(WAITING);
    expect(brief).not.toContain(FOLLOWUP);
  });

  it('carries the file line, which is the only thing it cannot derive', () => {
    const brief = institutionalBrief(institution([], { dossier: 'Conditions de redistribution des données' }));
    expect(brief).toContain('Conditions de redistribution des données');
    expect(brief).toContain('Institution: Autorité Alpha');
  });

  it('states the register on every road, so no letter opens like a pitch', () => {
    for (const c of [institution([]), institution([msg('in', 'Re:', 'oui', '2026-07-25')]), institution([msg('out', 'Demande', 'bonjour', '2026-07-25')])]) {
      expect(institutionalBrief(c)).toContain('not a commercial mail');
    }
  });
});

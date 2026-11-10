import { describe, expect, it } from 'vitest';
import { contactIdFromParam, contactsHref, contactsOpenHref, dossierIdFromParam } from './deep-link';

describe('contactsHref', () => {
  it('carries the address so the thread opens instead of the bare page', () => {
    expect(contactsHref('fr', 'A.Dupont@Societe-Alpha.Example')).toBe(
      '/fr/dashboard/contacts?client=a.dupont%40societe-alpha.example',
    );
  });

  it('escapes an address with a plus, which a bare query string would eat', () => {
    // "a+b@x.net" unescaped comes back as "a b@x.net" and matches nobody.
    expect(contactsHref('en', 'a+b@x.net')).toBe('/dashboard/contacts?client=a%2Bb%40x.net');
  });
});

describe('contactsOpenHref', () => {
  it('lands on the same page under the word the rest of the dashboard uses', () => {
    // The Courrier journal points every line at a thread; `open` is what
    // Clients and Clients Bot already call that gesture. CrmApp reads both.
    expect(contactsOpenHref('fr', 'Registry@Alpha.Example.NET')).toBe(
      '/fr/dashboard/contacts?open=registry%40alpha.example.net',
    );
  });

  it('escapes exactly like the older spelling', () => {
    expect(contactsOpenHref('en', 'a+b@x.net')).toBe('/dashboard/contacts?open=a%2Bb%40x.net');
  });
});

describe('contactIdFromParam', () => {
  const ids = ['acme@example.com', 'a.dupont@societe-alpha.example'];

  it('finds the contact the link points at', () => {
    expect(contactIdFromParam('acme@example.com', ids)).toBe('acme@example.com');
  });

  it('matches whatever the casing of the address in the link', () => {
    expect(contactIdFromParam('A.Dupont@Societe-Alpha.Example', ids)).toBe(
      'a.dupont@societe-alpha.example',
    );
  });

  it('selects nothing rather than guessing when the address is unknown', () => {
    // A contact the CRM hides, or an address that has since changed: opening
    // someone else's thread would be worse than opening none.
    expect(contactIdFromParam('nobody@example.net', ids)).toBeNull();
  });

  it('selects nothing when there is no parameter at all', () => {
    expect(contactIdFromParam(null, ids)).toBeNull();
    expect(contactIdFromParam('', ids)).toBeNull();
  });
});

/**
 * The owner's purchase alert travels through Telegram and may carry no
 * address: it links with the prefix of the key that paid (10/11/2026).
 */
describe('dossierIdFromParam', () => {
  const dossiers = [
    { id: 'acme@example.com', email: 'acme@example.com', keys: [{ prefix: 'ifk_aaaa1111' }] },
    {
      id: 'a.dupont@societe-alpha.example',
      email: 'A.Dupont@Societe-Alpha.Example',
      keys: [{ prefix: 'ifk_bbbb2222' }, { prefix: 'ifk_cccc3333' }],
    },
  ];

  it('opens the dossier that owns the key prefix, whichever of its keys paid', () => {
    expect(dossierIdFromParam('ifk_cccc3333', dossiers)).toBe('a.dupont@societe-alpha.example');
    expect(dossierIdFromParam('IFK_AAAA1111', dossiers)).toBe('acme@example.com');
  });

  it('still opens it from the address, as the other dashboard links do', () => {
    expect(dossierIdFromParam('a.dupont@societe-alpha.example', dossiers)).toBe(
      'a.dupont@societe-alpha.example',
    );
    expect(dossierIdFromParam(' ACME@example.com ', dossiers)).toBe('acme@example.com');
  });

  it('opens nothing rather than guessing', () => {
    expect(dossierIdFromParam('ifk_00000000', dossiers)).toBeNull();
    expect(dossierIdFromParam('ifk_aaaa', dossiers)).toBeNull();
    expect(dossierIdFromParam(null, dossiers)).toBeNull();
    expect(dossierIdFromParam('', dossiers)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { contactIdFromParam, contactsHref } from './deep-link';

describe('contactsHref', () => {
  it('carries the address so the thread opens instead of the bare page', () => {
    expect(contactsHref('fr', 'A.Dupont@Societe-Alpha.Example')).toBe(
      '/fr/dashboard/contacts?client=a.dupont%40societe-alpha.example',
    );
  });

  it('escapes an address with a plus, which a bare query string would eat', () => {
    // "a+b@x.net" unescaped comes back as "a b@x.net" and matches nobody.
    expect(contactsHref('en', 'a+b@x.net')).toBe('/en/dashboard/contacts?client=a%2Bb%40x.net');
  });
});

describe('contactIdFromParam', () => {
  const ids = ['acme@example.com', 'a.dupont@societe-alpha.example'];

  it('finds the contact the link points at', () => {
    expect(contactIdFromParam('acme@example.com', ids)).toBe('acme@example.com');
  });

  it('matches whatever the casing of the address in the link', () => {
    expect(contactIdFromParam('A.Dupont@Societe-Alpha.Example', ids)).toBe('a.dupont@societe-alpha.example');
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

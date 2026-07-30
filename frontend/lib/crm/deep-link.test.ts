import { describe, expect, it } from 'vitest';
import { contactIdFromParam, contactsHref } from './deep-link';

describe('contactsHref', () => {
  it('carries the address so the thread opens instead of the bare page', () => {
    expect(contactsHref('fr', 'D.Protasov@Raison.Finance')).toBe(
      '/fr/dashboard/contacts?client=d.protasov%40raison.finance',
    );
  });

  it('escapes an address with a plus, which a bare query string would eat', () => {
    // "a+b@x.net" unescaped comes back as "a b@x.net" and matches nobody.
    expect(contactsHref('en', 'a+b@x.net')).toBe('/en/dashboard/contacts?client=a%2Bb%40x.net');
  });
});

describe('contactIdFromParam', () => {
  const ids = ['d.protasov@raison.finance', 'petteri@asterpay.io'];

  it('finds the contact the link points at', () => {
    expect(contactIdFromParam('d.protasov@raison.finance', ids)).toBe('d.protasov@raison.finance');
  });

  it('matches whatever the casing of the address in the link', () => {
    expect(contactIdFromParam('Petteri@AsterPay.io', ids)).toBe('petteri@asterpay.io');
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

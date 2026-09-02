import { describe, it, expect } from 'vitest';
import { isDisposableDomain, isUnroutableEmail } from './disposable-domains.js';

describe('isDisposableDomain', () => {
  it('flags known disposable services and their subdomains', () => {
    expect(isDisposableDomain('a@yopmail.com')).toBe(true);
    expect(isDisposableDomain('a@mail.mailinator.com')).toBe(true);
  });

  it('flags unlisted domains through unmistakable branding substrings', () => {
    // The suffix trick that defeats exact lists: a disposable brand parked
    // under a country/edu hierarchy.
    expect(isDisposableDomain('a@tempmail.edu.ge')).toBe(true);
    expect(isDisposableDomain('a@web.temp-mail.gg')).toBe(true);
  });

  it('leaves ordinary providers and companies alone', () => {
    expect(isDisposableDomain('a@gmail.com')).toBe(false);
    expect(isDisposableDomain('a@societe-alpha.example.net')).toBe(false);
    // 'temp' alone must not trip anything — real companies contain it.
    expect(isDisposableDomain('a@temperature-controls.com')).toBe(false);
  });
});

describe('isUnroutableEmail', () => {
  it('refuses reserved TLDs that can never receive mail', () => {
    expect(isUnroutableEmail('cohorte@cohorte.invalid')).toBe(true);
    expect(isUnroutableEmail('a@acme.test')).toBe(true);
    expect(isUnroutableEmail('a@svc.internal')).toBe(true);
  });

  it('refuses disposable inboxes and empty domains', () => {
    expect(isUnroutableEmail('a@yopmail.fr')).toBe(true);
    expect(isUnroutableEmail('no-at-sign')).toBe(true);
  });

  it("blocks only the last label, so the repo's invented fixture domains keep working", () => {
    // *.example.net is an RFC 2606 name we use for test fixtures across the
    // suite; only a literal reserved TLD (.test, .invalid…) is refused.
    expect(isUnroutableEmail('holder@societe-alpha.example.net')).toBe(false);
    expect(isUnroutableEmail('holder@alpha-corp.de')).toBe(false);
  });
});

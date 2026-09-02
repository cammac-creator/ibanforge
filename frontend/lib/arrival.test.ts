import { describe, it, expect } from 'vitest';
import { arrivalFromLocation, attributionOf, mergeArrival } from './arrival';

describe('arrivalFromLocation', () => {
  it('keeps the landing path, the campaign labels and the referring host only', () => {
    const a = arrivalFromLocation(
      'https://ibanforge.com/en/docs/quickstart?utm_source=Newsletter&utm_medium=email&utm_campaign=Sept-2026&src=npm&x=1',
      'https://www.google.com/search?q=iban+api&sessionid=secret',
    );
    expect(a).toEqual({
      landing: '/en/docs/quickstart',
      src: 'npm',
      utm_source: 'newsletter',
      utm_medium: 'email',
      utm_campaign: 'sept-2026',
      referrer: 'google.com',
    });
  });

  it('drops a referrer from our own site, and one that is not a URL', () => {
    expect(arrivalFromLocation('https://ibanforge.com/fr', 'https://www.ibanforge.com/fr/pricing').referrer).toBeUndefined();
    expect(arrivalFromLocation('https://ibanforge.com/fr', 'not a url').referrer).toBeUndefined();
    expect(arrivalFromLocation('https://ibanforge.com/fr', '')).toEqual({ landing: '/fr' });
  });

  it('refuses labels the API would refuse, and caps what it keeps', () => {
    const a = arrivalFromLocation(
      'https://ibanforge.com/' + 'a'.repeat(300) + '?src=Bad%20Value&utm_source=<script>',
      'https://' + 'h'.repeat(200) + '.example.net/',
    );
    expect(a.src).toBeUndefined();
    expect(a.utm_source).toBeUndefined();
    expect(a.landing?.length).toBe(120);
    expect(a.referrer?.length).toBe(80);
  });

  it('returns nothing usable for a malformed href', () => {
    expect(arrivalFromLocation('::not-a-url', 'https://example.net')).toEqual({});
  });
});

describe('mergeArrival and attributionOf', () => {
  it('lets a later campaign link refresh the labels but not the landing or the referrer', () => {
    const first = { landing: '/en', referrer: 'google.com', utm_source: 'google' };
    const later = { landing: '/en/pricing', referrer: 'x.com', utm_source: 'x', src: 'tweet' };
    expect(mergeArrival(first, later)).toEqual({ landing: '/en', referrer: 'google.com', utm_source: 'x', src: 'tweet' });
  });

  it('separates the campaign tag (source) from the stored attribution', () => {
    expect(attributionOf({ landing: '/en', src: 'npm', utm_medium: 'email' })).toEqual({ landing: '/en', utm_medium: 'email' });
  });
});

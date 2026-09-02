import { describe, it, expect } from 'vitest';
import { parseAttribution, channelOf } from './signup-attribution.js';

describe('parseAttribution', () => {
  it('keeps the fields it knows, lower-cased and validated, and drops the rest', () => {
    expect(
      parseAttribution({
        landing: '/de/pricing',
        referrer: 'News.YCombinator.com',
        utm_source: 'Newsletter',
        utm_medium: 'email',
        utm_campaign: 'Sept-2026',
        email: 'acme@example.com',
      }),
    ).toEqual({ landing: '/de/pricing', referrer: 'news.ycombinator.com', utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'sept-2026' });
  });

  it('refuses shapes that could carry anything but labels', () => {
    expect(parseAttribution({ landing: 'javascript:alert(1)', referrer: 'a b.com', utm_source: '<script>' })).toEqual({});
    expect(parseAttribution({ landing: '/' + 'x'.repeat(200) })).toEqual({});
  });

  it('tells a browser that sent nothing usable from no browser at all', () => {
    expect(parseAttribution({})).toEqual({});
    expect(parseAttribution(null)).toBeNull();
    expect(parseAttribution('web')).toBeNull();
    expect(parseAttribution(['/en'])).toBeNull();
  });
});

describe('channelOf', () => {
  const base = { src: null, client: 'web', landing: '/en', referrer: null, utm_source: null, utm_medium: null, utm_campaign: null };
  it('names the most specific origin known', () => {
    expect(channelOf({ ...base, utm_source: 'newsletter', src: 'npm', referrer: 'google.com' })).toBe('utm:newsletter');
    expect(channelOf({ ...base, src: 'npm', referrer: 'google.com' })).toBe('src:npm');
    expect(channelOf({ ...base, referrer: 'google.com' })).toBe('ref:google.com');
    expect(channelOf(base)).toBe('direct');
    expect(channelOf({ ...base, client: 'api' })).toBe('api');
  });
});

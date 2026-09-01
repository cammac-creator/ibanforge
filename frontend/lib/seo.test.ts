import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEO_LOCALES, SITE_URL, alternatesFor, urlFor } from '@/lib/seo';
import { routing } from '@/i18n/routing';

const APP = resolve(__dirname, '../app');
const read = (rel: string) => readFileSync(resolve(APP, rel), 'utf8');

/**
 * The invariant the audit of 2026-09-01 caught being broken twice, in two
 * different ways: a page's canonical must be the page's OWN URL, and it must
 * agree with the hreflang entry for that page's own language. When the
 * canonical came from the locale layout, `canonical` named the home while
 * `languages` named the current page — the two halves of the same statement
 * contradicting each other on 52 pages.
 */
describe('alternatesFor', () => {
  it('agrees with itself: canonical is the hreflang entry of its own locale', () => {
    for (const locale of SEO_LOCALES) {
      for (const path of ['/', '/pricing', '/docs', '/docs/mcp', '/blog/some-post', '/legal/terms']) {
        const a = alternatesFor(locale, path);
        expect(a.canonical).toBe(a.languages[locale]);
      }
    }
  });

  it('names the page, never the locale home', () => {
    const a = alternatesFor('en', '/pricing');
    expect(a.canonical).toBe('https://ibanforge.com/en/pricing');
    expect(a.languages.fr).toBe('https://ibanforge.com/fr/pricing');
    expect(a.languages.de).toBe('https://ibanforge.com/de/pricing');
  });

  it('carries the three languages plus x-default, and x-default is English', () => {
    const a = alternatesFor('de', '/docs/mcp');
    expect(Object.keys(a.languages).sort()).toEqual(['de', 'en', 'fr', 'x-default']);
    expect(a.languages['x-default']).toBe(a.languages.en);
  });

  /**
   * WEB-03: `fr-CH` and `de-CH` offered the translated pages to Switzerland
   * only. France, Belgium, Luxembourg, Germany and Austria fell through to
   * x-default, i.e. to English.
   */
  it('uses plain language codes, not Swiss regional variants', () => {
    const keys = Object.keys(alternatesFor('fr', '/').languages);
    expect(keys).not.toContain('fr-CH');
    expect(keys).not.toContain('de-CH');
  });

  it('canonicalises the home to the locale prefix, never to the bare domain', () => {
    // `https://ibanforge.com/` answers 307 towards `/en`, and the sitemap lists
    // `/en`. A canonical pointing at a redirect names a URL that does not serve
    // the page.
    expect(alternatesFor('en', '/').canonical).toBe('https://ibanforge.com/en');
    expect(alternatesFor('en').canonical).toBe('https://ibanforge.com/en');
  });

  it('reads one page out of the three ways a caller may spell its path', () => {
    const written = ['/docs/mcp', 'docs/mcp', '/docs/mcp/'].map((p) => urlFor('fr', p));
    expect(new Set(written).size).toBe(1);
    expect(written[0]).toBe('https://ibanforge.com/fr/docs/mcp');
  });

  it('covers exactly the locales the router serves', () => {
    expect([...SEO_LOCALES].sort()).toEqual([...routing.locales].sort());
  });

  it('never emits a protocol-relative or doubled slash', () => {
    for (const locale of SEO_LOCALES) {
      const url = urlFor(locale, '/legal/terms');
      expect(url.startsWith(`${SITE_URL}/`)).toBe(true);
      expect(url.slice(SITE_URL.length)).not.toContain('//');
    }
  });
});

/**
 * The two shapes the audit of 2026-09-01 found, guarded at the source.
 *
 * Both are invisible in a browser and both cost the whole catalogue: a
 * canonical declared once in the locale layout, and a page-level `alternates`
 * holding a canonical with no `languages` beside it.
 */
describe('where canonicals are declared', () => {
  it('the locale layout declares none, since it cannot know the path', () => {
    const layout = read('[locale]/layout.tsx');
    // `META_BY_LOCALE[...].alternates` is a different thing (the og:locale
    // siblings), so the check is on what a canonical actually looks like.
    expect(layout).not.toContain('canonical:');
    expect(layout).not.toContain('languages:');
    expect(layout).not.toContain('hrefLang');
  });

  it.each([
    '[locale]/docs/[slug]/page.tsx',
    '[locale]/blog/[slug]/page.tsx',
    '[locale]/openapi/page.tsx',
    '[locale]/changelog/page.tsx',
    '[locale]/playground/layout.tsx',
  ])('%s builds its alternates with the helper, never by hand', (file) => {
    const source = read(file);
    expect(source).toContain('alternatesFor(');
    // A hand-written `alternates: { canonical: url }` is exactly what dropped
    // the hreflang block from 116 pages.
    expect(source).not.toMatch(/alternates:\s*\{\s*canonical/);
  });

  it('the two content pages name their own opengraph image', () => {
    for (const file of ['[locale]/docs/[slug]/page.tsx', '[locale]/blog/[slug]/page.tsx']) {
      expect(read(file)).toContain('ogImageFor(locale)');
    }
  });
});

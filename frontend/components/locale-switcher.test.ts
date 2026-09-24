import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LocaleSwitcher, unprefixedPath } from '@/components/locale-switcher';

const page = vi.hoisted(() => ({ locale: 'en', pathname: '/' }));
vi.mock('next-intl', () => ({
  useLocale: () => page.locale,
  useTranslations: () => (key: string, values?: { locale?: string }) => `${key}:${values?.locale ?? ''}`,
}));
vi.mock('next/navigation', () => ({ usePathname: () => page.pathname }));

/** The served HTML of the switcher on one page: what a crawler reads. */
function served(locale: string, pathname: string): string {
  page.locale = locale;
  page.pathname = pathname;
  return renderToStaticMarkup(createElement(LocaleSwitcher));
}

/** Every link target in the markup, with its hreflang, in document order. */
function links(html: string): Array<[string, string]> {
  return [...html.matchAll(/<a [^>]*>/g)].map((m) => {
    const tag = m[0];
    return [/href="([^"]*)"/.exec(tag)?.[1] ?? '', /hrefLang="([^"]*)"/i.exec(tag)?.[1] ?? ''];
  });
}

describe('unprefixedPath', () => {
  it.each([
    ['/', '/'],
    ['/pricing', '/pricing'],
    // what the prerender of an English page sees, before the rewrite to /pricing
    ['/en/pricing', '/pricing'],
    ['/en', '/'],
    ['/fr', '/'],
    ['/fr/pricing', '/pricing'],
    ['/de/iban/ch', '/iban/ch'],
    ['/iban/ch', '/iban/ch'],
    [null, '/'],
  ])('%s gives %s', (pathname, expected) => {
    expect(unprefixedPath(pathname)).toBe(expected);
  });
});

describe('Le sélecteur de langue sert de vrais liens (lisibles sans JavaScript)', () => {
  it.each([
    ['en', '/', ['/', '/fr', '/de']],
    ['en', '/pricing', ['/pricing', '/fr/pricing', '/de/pricing']],
    ['en', '/en/pricing', ['/pricing', '/fr/pricing', '/de/pricing']],
    ['fr', '/fr', ['/', '/fr', '/de']],
    ['fr', '/fr/pricing', ['/pricing', '/fr/pricing', '/de/pricing']],
    ['de', '/de/iban/ch', ['/iban/ch', '/fr/iban/ch', '/de/iban/ch']],
  ])('%s %s links the same page in every language', (locale, pathname, expected) => {
    const html = served(locale, pathname);
    expect(links(html)).toEqual([
      [expected[0], 'en'],
      [expected[1], 'fr'],
      [expected[2], 'de'],
    ]);
    // English lives at the root: /en/… only answers with a redirect
    expect(html).not.toMatch(/href="\/en[/"]/);
  });

  it('keeps the links in the HTML while the menu is closed, hidden and out of the tab order', () => {
    const html = served('en', '/pricing');
    expect(html).toContain('aria-expanded="false"');
    const menu = /<div id="([^"]+)" class="([^"]*)"/.exec(html);
    expect(menu?.[2].split(' ')).toContain('hidden');
    expect(menu?.[2].split(' ')).not.toContain('flex');
    expect(html).toContain(`aria-controls="${menu?.[1]}"`);
    expect(links(html)).toHaveLength(3);
  });

  it('marks the language being read, and only that one', () => {
    const html = served('de', '/de/iban/ch');
    const current = [...html.matchAll(/<a [^>]*aria-current="true"[^>]*>/g)];
    expect(current).toHaveLength(1);
    expect(current[0][0]).toContain('href="/de/iban/ch"');
    expect(current[0][0]).toContain('text-amber-500');
    expect(html).toContain('>DE</button>');
  });
});

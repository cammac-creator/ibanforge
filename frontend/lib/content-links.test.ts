import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { localizeContentHref } from './content-links';
import { mdxComponents, mdxComponentsForLocale } from './mdx';

describe('liens de contenu dans la langue de lecture', () => {
  it.each([
    ['/docs/onboarding', 'fr', '/fr/docs/onboarding'],
    ['/docs/api-keys?mode=free#claim', 'de', '/de/docs/api-keys?mode=free#claim'],
    ['/blog/un-guide', 'fr', '/fr/blog/un-guide'],
    ['/pricing#packs', 'de', '/de/pricing#packs'],
    ['/playground', 'fr', '/fr/playground'],
    ['/audit', 'de', '/de/audit'],
    ['/vendors', 'fr', '/fr/vendors'],
    ['/tools/test-iban', 'de', '/de/tools/test-iban'],
    ['/compare', 'fr', '/fr/compare'],
    ['/alternatives/ibancom', 'de', '/de/alternatives/ibancom'],
    ['/?source=docs', 'fr', '/fr?source=docs'],
    ['/agents', 'fr', '/fr/agents'],
    ['/status', 'de', '/de/status'],
    ['/iid/24', 'fr', '/fr/iid/24'],
    ['/blz/10070000', 'de', '/de/blz/10070000'],
  ])('localise %s pour %s', (href, locale, expected) => {
    expect(localizeContentHref(href, locale)).toBe(expected);
  });

  it.each([
    undefined, '', '#exemple', '?page=2', 'guide',
    'https://ibanforge.com/docs', 'https://example.com/docs', '//example.com/docs',
    'mailto:contact@example.com', '/fr/docs', '/de/pricing', '/en/blog/exemple',
    '/api/docs', '/v1/iban/validate', '/account', '/dashboard',
    '/examples/revue.py', '/integrations/modele.json', '/openapi.json',
    '/docs/specification.pdf', '/docs-archive', '/blogroll',
    '/docs/../api/action', '/docs/%2e%2e/api/action', '/docs\\api',
  ])('préserve une destination hors périmètre : %s', (href) => {
    expect(localizeContentHref(href, 'fr')).toBe(href);
    expect(localizeContentHref(href, 'de')).toBe(href);
  });

  it('garde les URL anglaises et ne devine pas une langue inconnue', () => {
    expect(localizeContentHref('/docs/onboarding', 'en')).toBe('/docs/onboarding');
    expect(localizeContentHref('/docs/onboarding', 'es')).toBe('/docs/onboarding');
  });

  it('rend le lien en conservant son contenu, son ancre et ses attributs', () => {
    const components = mdxComponentsForLocale('de');
    const html = renderToStaticMarkup(createElement(components.a, {
      href: '/docs/api-keys#claim', title: 'Clé', rel: 'help',
    }, 'Conserver la clé'));
    expect(html).toContain('href="/de/docs/api-keys#claim"');
    expect(html).toContain('title="Clé"');
    expect(html).toContain('rel="help"');
    expect(html).toContain('>Conserver la clé</a>');
    expect(components.table).toBe(mdxComponents.table);
    expect(components.TryApi).toBe(mdxComponents.TryApi);
  });

  it('préserve aussi un téléchargement déclaré sans extension', () => {
    const components = mdxComponentsForLocale('fr');
    const html = renderToStaticMarkup(createElement(components.a, {
      href: '/docs/export', download: 'guide',
    }, 'Télécharger'));
    expect(html).toContain('href="/docs/export"');
    expect(html).toContain('download="guide"');
  });
});

// La fabrique seule ne protège pas les pages qui oublient de lui passer leur langue.
describe('raccordement de la langue aux pages MDX', () => {
  it.each(['docs/page.tsx', 'docs/[slug]/page.tsx', 'blog/[slug]/page.tsx'])(
    '%s utilise les composants de sa langue', (page) => {
      const source = readFileSync(join(process.cwd(), 'app/[locale]', page), 'utf8');
      expect(source).toMatch(/import\s*\{[^}]*mdxComponentsForLocale[^}]*\}\s*from ["']@\/lib\/mdx["']/);
      expect(source).toMatch(/<MDXRemote\b[^>]*components=\{mdxComponentsForLocale\(locale\)\}/);
      expect(source).not.toMatch(/components=\{mdxComponents\}/);
    },
  );
});

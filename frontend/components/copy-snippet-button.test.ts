import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import fr from '../messages/fr.json';
import en from '../messages/en.json';
import de from '../messages/de.json';
import { mdxComponents } from '../lib/mdx';

describe('Le bloc MDX servi reste lisible et sa copie est localisée', () => {
  it.each([
    ['fr', fr], ['en', en], ['de', de],
  ] as const)('sert le bouton en %s sans exposer son attribut de transport', (locale, messages) => {
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale, messages, timeZone: 'UTC',
      children: mdxComponents.pre({
        'data-ibf-copy-source': 'brut réservé au presse-papiers\n',
        className: 'test-classe', tabIndex: 0,
        children: createElement('code', {}, '<contenu lisible>'),
      }),
    }));
    expect(html).toContain(`aria-label="${messages.common.copyCode}"`);
    expect(html).toContain(`>${messages.common.copy}</button>`);
    expect(html).toContain('type="button"');
    expect(html).toContain('role="status"');
    expect(html).toContain('class="test-classe"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('&lt;contenu lisible&gt;');
    expect(html).not.toContain('data-ibf-copy-source');
    expect(html).not.toContain('brut réservé');
    expect(messages.common.copyFailed.length).toBeGreaterThan(20);
  });

  it('garde le pre inchangé quand aucun texte à copier n’a été capturé', () => {
    const html = renderToStaticMarkup(mdxComponents.pre({ children: 'Texte manuel', id: 'manuel' }));
    expect(html).toBe('<pre id="manuel">Texte manuel</pre>');
  });
});

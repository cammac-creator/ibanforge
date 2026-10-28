import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const locales = [
  { locale: 'en', date: '23 October 2026', untried: 'Not tried by us', shared: 'shares the limits and counters' },
  { locale: 'fr', date: '23 octobre 2026', untried: 'Non essayé par nous', shared: 'partage les plafonds et les compteurs' },
  { locale: 'de', date: '23. Oktober 2026', untried: 'Von uns nicht ausprobiert', shared: 'teilt die Limits und Zähler' },
];

describe('la documentation des connecteurs MCP', () => {
  it.each(locales)('$locale : sources datées et limites explicites pour chaque ajout', ({ locale, date, untried, shared }) => {
    const text = readFileSync(resolve(process.cwd(), `content/${locale}/docs/mcp.mdx`), 'utf8');
    const mistral = text.split('**Mistral (Le Chat)**')[1]?.split('**Perplexity**')[0];
    const perplexity = text.split('**Perplexity**')[1]?.split('https://api.ibanforge.com/mcp/directory')[0];
    for (const section of [mistral, perplexity]) {
      expect(section).toContain(date);
      expect(section).toContain(untried);
      expect(section).toContain('https://api.ibanforge.com/mcp');
    }
    expect(mistral).toContain('https://docs.mistral.ai/vibe/work/connectors/mcp-connectors');
    expect(perplexity).toContain('https://www.perplexity.ai/help-center/en/articles/13915507-adding-custom-remote-connectors');
    expect(perplexity).toContain('**Streamable HTTP**');
    expect(perplexity).toContain('**None**');
    expect(text).toContain('https://api.ibanforge.com/mcp/directory');
    expect(text).toContain(shared);
  });
});

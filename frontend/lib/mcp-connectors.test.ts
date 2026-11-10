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

/**
 * Ce que la documentation d'Anthropic dit du champ de la clé (lue le 10.11.2026,
 * « Add a connector that isn't in the directory ») : la section Request headers
 * est en bêta et réservée à une partie des organisations, et un connecteur
 * existant ne prend pas de clé après coup. La page le dit dans les trois langues,
 * donne le lien d'Anthropic qui ouvre la fenêtre d'ajout préremplie, et cite la
 * page d'aide là où elle renvoie à sa section « Network requirements ».
 */
const claude = [
  { locale: 'en', date: '10 November 2026', beta: 'beta', withKey: '**Claude and Claude Desktop** (' },
  { locale: 'fr', date: '10 novembre 2026', beta: 'bêta', withKey: '**Claude et Claude Desktop** (' },
  { locale: 'de', date: '10. November 2026', beta: 'Beta', withKey: '**Claude und Claude Desktop** (' },
];

describe('la section Claude de la documentation MCP', () => {
  it.each(claude)('$locale : date du jour, raccourci d’ajout et réserve sur la bêta', ({ locale, date, beta, withKey }) => {
    const text = readFileSync(resolve(process.cwd(), `content/${locale}/docs/mcp.mdx`), 'utf8');
    const section = text.split('**Claude** ([')[1]?.split('**ChatGPT** ([')[0];
    expect(section).toContain(date);
    expect(section).toContain('https://claude.com/docs/connectors/custom/add-unlisted');
    expect(section).toContain(
      'https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=IBANforge&connectorUrl=https%3A%2F%2Fapi.ibanforge.com%2Fmcp',
    );
    expect(section).toContain('Ultra');
    expect(section).toContain('**No sign-in**');

    const keyParagraph = text.split(withKey)[1]?.split('\n')[0];
    expect(keyParagraph).toContain(date);
    expect(keyParagraph).toContain(beta);
    expect(keyParagraph).toContain('Option 1');

    // La section « Network requirements » est sur la page d'aide, pas sur la documentation.
    expect(text).toContain('(https://support.claude.com/en/articles/11175166), ');
  });
});

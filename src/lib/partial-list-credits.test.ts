import { afterAll, describe, expect, it, vi } from 'vitest';
import { PARTIAL_LIST_COUNTRIES, partialListSourceLines } from './partial-list-credits.js';
import { buildApp } from '../app.js';
import { closeAll } from './db.js';

/**
 * The sources section of the API's /llms.txt credits the publisher of every
 * partial list served from the private overlay (review of 19/11/2026).
 *
 * The public database carries none of these rows, so the editions are the
 * test's own: invented source lines and dates, no row of any list. The reader
 * of the edition in force is replaced for these countries only, so the served
 * /llms.txt below goes through the same wiring as production.
 */
const { FIXTURE } = vi.hoisted(() => ({
  FIXTURE: {
    IL: { source: 'Bank of Israel, fixture list of banking corporations', as_of: '2026-01-02' },
    MN: { source: 'Bank of Mongolia (Mongolbank), fixture register', as_of: '2026-01-03' },
    RU: { source: 'Bank of Russia, fixture BIC directory', as_of: '2026-01-05' },
    FO: { source: 'e-nettet A/S, fixture IBAN list', as_of: '2026-01-06' },
    TR: {
      source: 'Central Bank of the Republic of Türkiye (TCMB), fixture list',
      as_of: '2026-01-07',
    },
  } as Record<string, { source: string; as_of: string }>,
}));

vi.mock('./national-registers.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./national-registers.js')>();
  return {
    ...original,
    nationalRegisterEdition: (cc: string) => FIXTURE[cc] ?? original.nationalRegisterEdition(cc),
  };
});

const none = () => ({ source: null, as_of: null });

afterAll(() => closeAll());

describe('partialListSourceLines', () => {
  it('credits each loaded list once, with its publisher, its date and its reserve', () => {
    const lines = partialListSourceLines();
    expect(lines).toHaveLength(5);
    const [il, mn, ru, dk, tr] = lines;
    expect(il).toMatch(/^- Israeli bank codes: Source: Bank of Israel, .*2026-01-02/);
    expect(mn).toMatch(/^- Mongolian bank codes: Source: Bank of Mongolia .*2026-01-03/);
    expect(ru).toMatch(/^- Russian bank codes: Source: Bank of Russia, .*2026-01-05/);
    // Denmark, the Faroe Islands and Greenland share one list and one line: here
    // only the Faroese rows are loaded, and they still credit it.
    expect(dk).toMatch(
      /^- Danish, Faroese and Greenlandic bank codes: Source: e-nettet A\/S, .*2026-01-06/,
    );
    expect(tr).toMatch(
      /^- Turkish bank codes: Source: Central Bank of the Republic of Türkiye .*2026-01-07/,
    );
    for (const line of lines)
      expect(line).toMatch(/Partial (register|list): .*an absence is not a non-allocation/);
  });

  it('names no list whose rows are not loaded', () => {
    expect(partialListSourceLines(none)).toEqual([]);
    expect(partialListSourceLines((cc) => (cc === 'RU' ? FIXTURE.RU! : none()))).toHaveLength(1);
  });

  it('covers every country of the overlay lists', () => {
    expect([...PARTIAL_LIST_COUNTRIES].sort()).toEqual(['DK', 'FO', 'GL', 'IL', 'MN', 'RU', 'TR']);
  });

  it('puts the lines in the sources section of the llms.txt the API serves', async () => {
    const text = await (await buildApp().request('/llms.txt')).text();
    const start = text.indexOf('## Data sources and attribution');
    const end = text.indexOf('## Instructions for LLM agents');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = text.slice(start, end);
    for (const line of partialListSourceLines()) expect(section).toContain(line);
  }, 60_000);
});

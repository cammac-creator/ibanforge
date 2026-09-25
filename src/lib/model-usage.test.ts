import { afterEach, describe, expect, it, vi } from 'vitest';
import { logModelUsage, modelUsageLine } from './model-usage.js';

describe('modelUsageLine : le compteur de dépense', () => {
  it('écrit les jetons, le cache et les recherches web de la réponse', () => {
    const body = {
      model: 'claude-sonnet-5',
      content: [{ type: 'text', text: 'le texte ne sort jamais' }],
      usage: {
        input_tokens: 1830,
        output_tokens: 412,
        cache_creation_input_tokens: 64,
        cache_read_input_tokens: 1200,
        server_tool_use: { web_search_requests: 3 },
      },
    };
    const line = modelUsageLine('forum-draft', body);
    expect(line).toBe(
      '[usage] site=forum-draft model=claude-sonnet-5 input_tokens=1830 output_tokens=412 cache_write=64 cache_read=1200 web_search=3',
    );
    expect(line).not.toContain('le texte');
  });

  it('rend des zéros et un modèle inconnu quand la réponse ne dit rien', () => {
    expect(modelUsageLine('prospect-radar', { content: [] })).toBe(
      '[usage] site=prospect-radar model=unknown input_tokens=0 output_tokens=0 cache_write=0 cache_read=0 web_search=0',
    );
  });

  it.each([
    ['null', null],
    ['une chaîne', 'pas un objet'],
    ['un usage abîmé', { usage: 'abîmé' }],
    [
      'des valeurs hors nombre',
      { usage: { input_tokens: 'n/a', output_tokens: -5, cache_read_input_tokens: NaN } },
    ],
    ['un nom de modèle qui porterait une ligne de plus', { model: 'claude\ninjecté', usage: {} }],
  ])('ne lève jamais : %s', (_label, body) => {
    const line = modelUsageLine('forum-translate', body);
    expect(line).toMatch(
      /^\[usage\] site=forum-translate model=unknown input_tokens=0 output_tokens=0 /,
    );
    expect(line.split('\n')).toHaveLength(1);
  });

  it('garde un nombre écrit en chaîne, arrondi vers le bas', () => {
    expect(
      modelUsageLine('forum-draft', { usage: { input_tokens: '12', output_tokens: 7.9 } }),
    ).toContain('input_tokens=12 output_tokens=7 ');
  });
});

describe('logModelUsage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('écrit exactement une ligne au journal', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    logModelUsage('forum-draft', {
      model: 'claude-sonnet-5',
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toBe(
      '[usage] site=forum-draft model=claude-sonnet-5 input_tokens=10 output_tokens=2 cache_write=0 cache_read=0 web_search=0',
    );
  });
});

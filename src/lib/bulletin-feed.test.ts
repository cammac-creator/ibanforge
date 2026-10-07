import { describe, expect, it } from 'vitest';
import { getStatsDB } from './db.js';
import {
  FEED_LINE_MAX,
  cleanFeedLine,
  feedWeekAt,
  feedWeeks,
  readFeed,
  validateFeedPayload,
  writeFeed,
} from './bulletin-feed.js';

/**
 * Le dépôt des veilles du lundi : une charge strictement structurée, refusée
 * entière à la moindre forme inattendue. Base synthétique, textes inventés.
 */
describe('cleanFeedLine', () => {
  it('retire les caractères de contrôle et de direction, et resserre les espaces', () => {
    const rlo = String.fromCharCode(0x202e);
    const sep = String.fromCharCode(0x2028);
    expect(cleanFeedLine(`  une\tporte\nqui s’ouvre${rlo}  ${sep}fin \u0007`)).toBe(
      'une porte qui s’ouvre fin',
    );
    expect(cleanFeedLine(' \n\t ')).toBe('');
  });
});

describe('validateFeedPayload', () => {
  it('accepte trois lignes pour la veille, sans score', () => {
    expect(validateFeedPayload('weekly-veille', { lines: ['un', ' deux ', 'trois'] })).toEqual({
      ok: true,
      payload: { lines: ['un', 'deux', 'trois'], score: null },
    });
    expect(validateFeedPayload('weekly-veille', { lines: ['un'], score: null })).toMatchObject({
      ok: true,
    });
  });

  it('refuse un score sur la veille, et exige un score entier sur la mesure des IA', () => {
    expect(
      validateFeedPayload('weekly-veille', { lines: ['un'], score: { value: 1, out_of: 7 } }),
    ).toEqual({ ok: false, error: 'unexpected_score' });
    expect(validateFeedPayload('weekly-reco-baseline', { lines: ['un'] })).toEqual({
      ok: false,
      error: 'invalid_score',
    });
    expect(
      validateFeedPayload('weekly-reco-baseline', {
        lines: ['un'],
        score: { value: 3, out_of: 7 },
      }),
    ).toEqual({ ok: true, payload: { lines: ['un'], score: { value: 3, out_of: 7, errors: 0 } } });
    for (const score of [
      { value: 8, out_of: 7 },
      { value: -1, out_of: 7 },
      { value: 1.5, out_of: 7 },
      { value: '3', out_of: 7 },
      { value: 1, out_of: 0 },
      { value: 1, out_of: 101 },
      { value: 1, out_of: 7, errors: 8 },
      { value: 1, out_of: 7, extra: 1 },
      [1, 7],
    ]) {
      expect(
        validateFeedPayload('weekly-reco-baseline', { lines: ['un'], score }),
        JSON.stringify(score),
      ).toEqual({ ok: false, error: 'invalid_score' });
    }
  });

  it('refuse un champ inconnu, des lignes absentes, vides, trop nombreuses ou trop longues', () => {
    expect(validateFeedPayload('weekly-veille', { lines: ['un'], html: '<b>' })).toEqual({
      ok: false,
      error: 'unknown_field',
    });
    for (const lines of [
      undefined,
      [],
      ['un', 'deux', 'trois', 'quatre'],
      ['   '],
      [42],
      'une ligne',
      ['x'.repeat(FEED_LINE_MAX + 1)],
    ]) {
      expect(validateFeedPayload('weekly-veille', { lines }), JSON.stringify(lines)).toEqual({
        ok: false,
        error: 'invalid_lines',
      });
    }
    expect(validateFeedPayload('weekly-veille', ['un'])).toEqual({
      ok: false,
      error: 'invalid_body',
    });
    // La limite compte des caractères, pas des octets : un accent ne coûte qu'un.
    expect(
      validateFeedPayload('weekly-veille', { lines: ['é'.repeat(FEED_LINE_MAX)] }),
    ).toMatchObject({ ok: true });
  });
});

describe('le dépôt d’une semaine', () => {
  it('se range dans la dernière semaine suisse close à la réception', () => {
    // Lundi 05.10.2026 à 08:23 heure suisse : le bulletin de ce lundi est la semaine 40.
    expect(feedWeekAt(Date.parse('2026-10-05T06:23:00Z')).label).toBe('2026-W40');
    // Dimanche 04.10 à 23:30 heure suisse : encore la semaine 40, donc la 39 est close.
    expect(feedWeekAt(Date.parse('2026-10-04T21:30:00Z')).label).toBe('2026-W39');
  });

  it('remplace un dépôt de la même source la même semaine, et dit « rien » sinon', () => {
    writeFeed('weekly-veille', '2026-W40', { lines: ['première'], score: null });
    writeFeed('weekly-veille', '2026-W40', { lines: ['seconde'], score: null });
    const count = getStatsDB()
      .prepare(
        `SELECT COUNT(*) AS n FROM bulletin_feed WHERE source = 'weekly-veille' AND week = '2026-W40'`,
      )
      .get() as { n: number };
    expect(count.n).toBe(1);
    const feed = readFeed('2026-W40');
    expect(feed.sources[0]).toMatchObject({
      source: 'weekly-veille',
      state: 'read',
      lines: ['seconde'],
      score: null,
    });
    expect(feed.sources[1]).toEqual({
      source: 'weekly-reco-baseline',
      label: 'Le score des IA',
      state: 'none',
    });
    expect(readFeed('2026-W39').sources.every((s) => s.state === 'none')).toBe(true);
  });

  it('traite une charge stockée illisible comme absente, jamais à moitié montrée', () => {
    getStatsDB()
      .prepare(`INSERT INTO bulletin_feed (source, week, payload) VALUES (?, ?, ?)`)
      .run('weekly-reco-baseline', '2026-W38', '{"lines":["un"],"score":{"value":9,"out_of":7}}');
    expect(readFeed('2026-W38').sources[1]).toMatchObject({ state: 'none' });
  });

  it('dit les semaines où une source a déposé', () => {
    writeFeed('weekly-veille', '2026-W37', { lines: ['un'], score: null });
    expect([...feedWeeks('weekly-veille', ['2026-W36', '2026-W37', '2026-W40'])].sort()).toEqual([
      '2026-W37',
      '2026-W40',
    ]);
    expect(feedWeeks('weekly-veille', []).size).toBe(0);
  });
});

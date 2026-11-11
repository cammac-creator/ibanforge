import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import de from '@/messages/de.json';
import { waitParts } from './wait-words';

describe('waitParts, une attente de l’API en unité et en nombre', () => {
  it.each([
    [30, { unit: 'minute', count: '1' }],
    [60, { unit: 'minute', count: '1' }],
    [90, { unit: 'minutes', count: '2' }],
    [1500, { unit: 'minutes', count: '25' }],
    [3600, { unit: 'minutes', count: '60' }],
    [7140, { unit: 'minutes', count: '119' }],
    [7200, { unit: 'hours', count: '2' }],
    [7201, { unit: 'hours', count: '3' }],
    [86_400, { unit: 'hours', count: '24' }],
    ['1500', { unit: 'minutes', count: '25' }],
    [' 90 ', { unit: 'minutes', count: '2' }],
  ] as const)('%s s → %o', (seconds, expected) => {
    expect(waitParts(seconds)).toEqual(expected);
  });

  it('arrondit vers le haut : l’attente dite n’est jamais plus courte', () => {
    expect(waitParts(61)).toEqual({ unit: 'minutes', count: '2' });
    expect(waitParts(3601)).toEqual({ unit: 'minutes', count: '61' });
  });

  it.each([undefined, null, '', 'abc', '12abc', '-5', 0, -1, Number.NaN, Infinity, {}])(
    'rend null pour une attente inutilisable (%o)',
    (value) => {
      expect(waitParts(value)).toBeNull();
    },
  );
});

describe('common.wait, la même attente dans les trois langues', () => {
  it.each([
    ['fr', fr, ['environ une minute', 'environ 25 minutes', 'environ 3 heures']],
    ['en', en, ['about a minute', 'about 25 minutes', 'about 3 hours']],
    ['de', de, ['etwa einer Minute', 'etwa 25 Minuten', 'etwa 3 Stunden']],
  ] as const)('%s', (locale, messages, expected) => {
    const t = createTranslator({ locale, messages, namespace: 'common' });
    const say = (seconds: number) => {
      const p = waitParts(seconds)!;
      return t('wait', { unit: p.unit, count: p.count });
    };
    expect([say(40), say(1500), say(9000)]).toEqual(expected);
  });
});

describe('les textes qui disent une attente, rendus dans les trois langues', () => {
  it.each([
    ['fr', fr],
    ['en', en],
    ['de', de],
  ] as const)('%s', (locale, messages) => {
    const tCommon = createTranslator({ locale, messages, namespace: 'common' });
    const wait = tCommon('wait', { unit: 'hours', count: '5' });
    const dialog = createTranslator({ locale, messages, namespace: 'apiKeyDialog' });
    const account = createTranslator({ locale, messages, namespace: 'account' });
    for (const text of [
      dialog('errors.verificationPaused', { wait }),
      account('errorServicePaused', { wait }),
    ]) {
      expect(text).toContain(wait);
      expect(text).not.toMatch(/[{}]/);
    }
  });
});

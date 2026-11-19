import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { FirstTrialPrices, FIRST_TRIAL_EVENTS } from '@/components/first-trial-prices';
import { firstTrialPrices, showsFirstTrial } from './first-trial';
import { PACK_ENTRY_PRICE, PRO_MONTHLY_PRICE } from './pricing-estimate';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import de from '@/messages/de.json';

const MESSAGES = { en, fr, de } as const;

describe('les deux lignes du premier essai réussi', () => {
  it('lisent leurs montants dans les constantes de prix du site', () => {
    expect(PRO_MONTHLY_PRICE).toBe(29);
    expect(PACK_ENTRY_PRICE).toBe(4);
    expect(firstTrialPrices('en')).toEqual({ pro: '$29', pack: '$4' });
    expect(firstTrialPrices('fr')).toEqual({ pro: '29 $', pack: '4 $' });
    expect(firstTrialPrices('de')).toEqual({ pro: '29 $', pack: '4 $' });
  });

  it('le paquet d entrée est celui que la page des tarifs vend', () => {
    const pricing = readFileSync(join(import.meta.dirname, '..', 'app', '[locale]', 'pricing', 'page.tsx'), 'utf8');
    expect(pricing).toMatch(new RegExp(`bundle: "1k", price: ${PACK_ENTRY_PRICE},`));
  });

  it.each(['en', 'fr', 'de'] as const)('écrivent les trois textes en %s', (locale) => {
    const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: 'playground' });
    const prices = firstTrialPrices(locale);
    const pro = t('firstTrial.pro', { price: prices.pro });
    const pack = t('firstTrial.pack', { price: prices.pack });
    expect(pro).toContain(prices.pro);
    expect(pack).toContain(prices.pack);
    expect(`${pro} ${pack}`).not.toMatch(/[{}]/);
    if (locale === 'en') {
      expect(pro).toBe('In production: Pro, $29 per month');
      expect(pack).toBe('One-off need: a credit pack from $4');
    }
  });

  it('portent un événement de clic que l API accepte, et un lien vers les tarifs', () => {
    const NAME = /^(nav|cta|film):[a-z0-9][a-z0-9-]{0,31}$/;
    for (const name of Object.values(FIRST_TRIAL_EVENTS)) expect(name).toMatch(NAME);
    const html = renderToStaticMarkup(createElement(FirstTrialPrices, { locale: 'fr', pro: 'A', pack: 'B' }));
    expect(html).toContain('href="/fr/pricing#pro"');
    expect(html).toContain('href="/fr/pricing#packs"');
    expect(html).toContain(`data-evt="${FIRST_TRIAL_EVENTS.pro}"`);
    expect(html).toContain(`data-evt="${FIRST_TRIAL_EVENTS.pack}"`);
  });

  it('s affichent sous chaque réponse valide du bac à sable, jamais sous un refus ou une entrée invalide', () => {
    expect(showsFirstTrial(true, { valid: true })).toBe(true);
    expect(showsFirstTrial(true, { found: true, valid: undefined })).toBe(true);
    expect(showsFirstTrial(true, { valid: false })).toBe(false);
    expect(showsFirstTrial(true, { found: false })).toBe(false);
    expect(showsFirstTrial(true, {})).toBe(false);
    expect(showsFirstTrial(true, null)).toBe(false);
    // la réponse n est pas arrivée : rien
    expect(showsFirstTrial(false, { valid: true })).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from 'next-intl';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';
import de from '@/messages/de.json';
import { FailedPaymentsCard } from '@/components/dashboard/overview/failed-payments-card';
import { formatGrouped } from '@/lib/format-grouped';
vi.mock('next-intl/server', () => ({ getTranslations: async ({locale}: {locale: 'fr'|'en'|'de'}) => createTranslator({locale,messages:{fr,en,de}[locale],namespace:'dashboard.overview'}) }));
import { attemptDay, declineKey, retainedFailedPayments } from './failed-payments';

const valide = {
  version: 1 as const,
  source: 'stripe_charges_read' as const,
  scope: 'stripe_account' as const,
  read_at: '2026-09-11T12:00:01.000Z',
  coverage: {complete:true,reason:'complete',pages_read:1,charges_read:5},
  attempts_without_email:0,
  unknown_amount_attempts:0,
  amounts_by_currency:{usd:8000},
  period_days: 90,
  window_start: '2026-06-13T12:00:00.000Z',
  observed_until: '2026-09-11T12:00:00.000Z',
  attempts: 4,
  distinct_buyers: 2,
  unrecovered_buyers: 1,
  amount_attempted_minor: 8000,
  currency: 'usd',
  by_reason: { card_velocity_exceeded: 2, partner_insufficient_funds: 2 },
  latest: Array.from({length:4},(_,i)=>({created_at:'2026-09-08T11:00:00.000Z',email:i<2?'alpha@alpha.example.net':'beta@alpha.example.net',amount_minor:2000,currency:'usd',decline_reason:'generic_decline',decline_message:null,card_brand:null,card_last4:null,card_country:null,recovered:i<2,recovered_at:i<2?'2026-09-09T12:00:00.000Z':null})),
};

describe('Garde des paiements refusés', () => {
  it('accepte une lecture cohérente', () => {
    expect(retainedFailedPayments(valide)).not.toBeNull();
  });

  it.each([
    ['une autre version', { version: 2 }],
    ['une autre source', { source: 'devine' }],
    ['une borne qui n’est pas une date UTC', { observed_until: '2026-09-11 12:00' }],
    ['une fenêtre à l’envers', { window_start: '2026-10-01T12:00:00.000Z' }],
    ['un compteur négatif', { attempts: -1 }],
    ['un compteur décimal', { distinct_buyers: 1.5 }],
    ['plus d’acheteurs perdus que d’acheteurs', { unrecovered_buyers: 3 }],
    ['plus d’acheteurs que de tentatives', { distinct_buyers: 9 }],
    ['plus de détails que de tentatives', { latest: new Array(9).fill({}) }],
  ])('refuse %s plutôt que d’afficher zéro', (_, patch) => {
    expect(retainedFailedPayments({ ...valide, ...patch })).toBeNull();
  });

  it('refuse une réponse vide ou absente', () => {
    expect(retainedFailedPayments(null)).toBeNull();
    expect(retainedFailedPayments(undefined)).toBeNull();
    expect(retainedFailedPayments('indisponible')).toBeNull();
  });

  it('range les motifs techniques dans des familles lisibles', () => {
    expect(declineKey('card_velocity_exceeded')).toBe('velocity');
    expect(declineKey('partner_insufficient_funds')).toBe('funds');
    expect(declineKey('expired_card')).toBe('expired');
    expect(declineKey('un_motif_inconnu_de_stripe')).toBe('other');
    expect(declineKey(null)).toBe('other');
  });

  it('écrit le jour d’une tentative en UTC, sans conversion', () => {
    expect(attemptDay('2026-09-08T11:37:51.000Z')).toBe('08/09/2026');
  });
});


describe('les corps incomplets ou incohérents restent indisponibles', () => {
  it.each(['2026-99-11T12:00:00.000Z','2026-02-30T12:00:00.000Z'])('refuse une date impossible sans lever : %s', (date) => {
    expect(()=>retainedFailedPayments({...valide,observed_until:date})).not.toThrow();
    expect(retainedFailedPayments({...valide,observed_until:date})).toBeNull();
  });
  it.each([{coverage:undefined},{scope:undefined},{by_reason:[]},{by_reason:{generic_decline:99}},{currency:'dollars'},
    {read_at:'2026-09-01T00:00:00.000Z'},{latest:[null]},{attempts_without_email:9},
    {coverage:{complete:true,reason:'stripe_error',pages_read:1,charges_read:5}}])('refuse les métadonnées invalides', (patch) => {
    expect(retainedFailedPayments({...valide,...patch})).toBeNull();
  });
  it.each([{created_at:'2026-09-12T00:00:00.000Z'},{amount_minor:'2000'},{currency:'USD'},{email:42},{recovered:'oui'},
    {recovered_at:'2026-09-01T00:00:00.000Z'},{recovered_at:null},{decline_message:42}])('valide chaque ligne avant son rendu', (patch) => {
    expect(retainedFailedPayments({...valide,latest:[{...valide.latest[0],...patch},...valide.latest.slice(1)]})).toBeNull();
  });
});

describe('la carte dit ce qui est observé et conserve les détails', () => {
  const render=async(value:unknown,locale='fr')=>renderToStaticMarkup(createElement('div',null,await FailedPaymentsCard({value,locale})));
  it.each(['fr','en','de'] as const)('affiche la portée et les limites en %s', async(locale)=>{
    const html=await render(valide,locale),t={fr,en,de}[locale].dashboard.overview.failedPayments;
    expect(html).toContain(t.accountScope);expect(html).toContain(t.recoveredNote);expect(html).toContain(t.lost);expect(html).toContain(t.recovered);
    expect(html).toContain('data-failed-count="attempts">4');
  });
  it('distingue zéro complet et zéro partiel',async()=>{
    const empty={...valide,attempts:0,distinct_buyers:0,unrecovered_buyers:0,amount_attempted_minor:0,currency:null,amounts_by_currency:{},by_reason:{},latest:[],coverage:{complete:true,reason:'complete',pages_read:1,charges_read:0}};
    expect(await render(empty)).toContain(fr.dashboard.overview.failedPayments.none);
    const partial=await render({...empty,coverage:{complete:false,reason:'deadline',pages_read:1,charges_read:0}});
    expect(partial).toContain(fr.dashboard.overview.failedPayments.nonePartial);expect(partial).not.toContain(fr.dashboard.overview.failedPayments.none);
    expect(await render(null)).toContain(fr.dashboard.overview.failedPayments.unavailable);
  });
  it.each([['jpy',500,'500 JPY'],['ugx',500,'5.00 UGX'],['usd',500,'5.00 USD']])('respecte les unités Stripe %s',async(currency,amount,label)=>{
    const row={...valide.latest[0],currency,amount_minor:amount};
    const data={...valide,attempts:1,distinct_buyers:1,unrecovered_buyers:0,latest:[row],by_reason:{generic_decline:1},currency,amount_attempted_minor:amount,amounts_by_currency:{[currency]:amount}};
    expect(await render(data,'en')).toContain(label);
  });
  it('rend les vingt lignes conservées, dont la suite accessible dans un volet',async()=>{
    const data={...valide,attempts:20,distinct_buyers:2,latest:Array.from({length:20},(_,i)=>valide.latest[i%4]),amount_attempted_minor:40000,amounts_by_currency:{usd:40000},by_reason:{generic_decline:20},coverage:{complete:true,reason:'complete',pages_read:1,charges_read:21}};
    const html=await render(data);expect(html).toContain('Voir les 14 autres tentatives conservées');
    expect(html.split(formatGrouped(20,'fr',2)+' USD').length-1).toBe(20);
  });
});

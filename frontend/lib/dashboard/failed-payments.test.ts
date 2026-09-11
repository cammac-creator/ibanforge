import { describe, expect, it } from 'vitest';
import { attemptDay, declineKey, retainedFailedPayments } from './failed-payments';

const valide = {
  version: 1 as const,
  source: 'stripe_charges_read' as const,
  period_days: 90,
  window_start: '2026-06-13T12:00:00.000Z',
  observed_until: '2026-09-11T12:00:00.000Z',
  attempts: 4,
  distinct_buyers: 2,
  unrecovered_buyers: 1,
  amount_attempted_minor: 8000,
  currency: 'usd',
  by_reason: { card_velocity_exceeded: 2, partner_insufficient_funds: 2 },
  latest: [],
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

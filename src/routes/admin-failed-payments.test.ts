import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { summarizeFailedPayments } from './admin-failed-payments.js';

/**
 * La règle qui compte : un refus suivi d'un paiement réussi du MÊME acheteur
 * n'est pas une vente perdue. Sans elle, l'écran aurait annoncé une perte là où
 * le client était simplement revenu avec une autre carte, ce qui s'est produit
 * en août 2026.
 */
function charge(p: Partial<Stripe.Charge> & { created: number }): Stripe.Charge {
  return {
    amount: 2000,
    currency: 'usd',
    status: 'failed',
    refunded: false,
    billing_details: { email: 'a@exemple.test' },
    ...p,
  } as unknown as Stripe.Charge;
}

const DEBUT = new Date('2026-08-01T00:00:00.000Z');
const FIN = new Date('2026-09-11T12:00:00.000Z');

describe('Résumé des paiements refusés', () => {
  it('compte les tentatives, les acheteurs et le motif du refus', () => {
    const r = summarizeFailedPayments(
      [
        charge({
          created: 1757000000,
          outcome: { reason: 'card_velocity_exceeded' } as Stripe.Charge.Outcome,
        }),
        charge({
          created: 1757000100,
          outcome: { reason: 'card_velocity_exceeded' } as Stripe.Charge.Outcome,
        }),
      ],
      30,
      DEBUT,
      FIN,
    );
    expect(r.version).toBe(1);
    expect(r.attempts).toBe(2);
    expect(r.distinct_buyers).toBe(1);
    expect(r.by_reason).toEqual({ card_velocity_exceeded: 2 });
    expect(r.amount_attempted_minor).toBe(4000);
    expect(r.currency).toBe('usd');
  });

  it('ne compte PAS comme perdu un acheteur qui a fini par payer', () => {
    const r = summarizeFailedPayments(
      [charge({ created: 1756000000 }), charge({ created: 1756100000, status: 'succeeded' })],
      30,
      DEBUT,
      FIN,
    );
    expect(r.attempts).toBe(1);
    expect(r.distinct_buyers).toBe(1);
    expect(r.unrecovered_buyers).toBe(0);
    expect(r.latest[0].recovered).toBe(true);
  });

  it('garde un acheteur non rattrapé pour ce qu’il est', () => {
    const r = summarizeFailedPayments(
      [
        charge({
          created: 1756000000,
          billing_details: { email: 'perdu@exemple.test' } as Stripe.Charge.BillingDetails,
        }),
        charge({
          created: 1756100000,
          status: 'succeeded',
          billing_details: { email: 'autre@exemple.test' } as Stripe.Charge.BillingDetails,
        }),
      ],
      30,
      DEBUT,
      FIN,
    );
    expect(r.unrecovered_buyers).toBe(1);
    expect(r.latest[0].recovered).toBe(false);
  });

  it('ne mélange pas deux devises dans un même total', () => {
    const r = summarizeFailedPayments(
      [charge({ created: 1756000000 }), charge({ created: 1756100000, currency: 'chf' })],
      30,
      DEBUT,
      FIN,
    );
    expect(r.currency).toBeNull();
  });

  it('rend un résumé vide plutôt que de se casser quand rien n’a échoué', () => {
    const r = summarizeFailedPayments(
      [charge({ created: 1756000000, status: 'succeeded' })],
      30,
      DEBUT,
      FIN,
    );
    expect(r.attempts).toBe(0);
    expect(r.distinct_buyers).toBe(0);
    expect(r.latest).toEqual([]);
  });
});

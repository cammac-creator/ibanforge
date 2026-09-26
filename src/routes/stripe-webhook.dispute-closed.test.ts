/**
 * Le rendu des crédits quand un litige se referme sans perte (décision de
 * Claude-Alain du 26.09.2026, choix 4 du bilan : « rendre les crédits tout
 * seuls quand je garde l'argent ») : `charge.dispute.closed` avec le statut
 * `won` ou `warning_closed` rend à la clé active de la lignée exactement ce que
 * `charge.dispute.created` avait repris, une seule fois. Un litige perdu, un
 * pack remboursé entre-temps ou une lignée sans clé active unique ne rendent
 * rien.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { processStripeEvent, resetStripeClient } from './stripe-webhook.js';
import { generateApiKey, revokeApiKey, rotateApiKey, validateApiKey } from '../lib/api-keys.js';
import { ensureTopupRef, findPurchaseByRef, type PurchaseRow } from '../lib/key-purchases.js';
import { closeAll, getStatsDB } from '../lib/db.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetStripeClient();
});

afterAll(() => closeAll());

let seq = 0;
function uniq(tag: string): string {
  seq += 1;
  return `${tag}_${Date.now()}_${seq}`;
}

/** Un pack payé par carte, réduit à ce que le webhook lit. */
function packEvent(opts: {
  sessionId: string;
  bundle?: string;
  ref?: string | null;
  amountTotal?: number;
}): Stripe.Event {
  return {
    id: `evt_${uniq('pack')}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: opts.sessionId,
        metadata: { bundle: opts.bundle ?? '1k' },
        customer_email: null,
        customer_details: null,
        payment_status: 'paid',
        amount_total: opts.amountTotal ?? 400,
        currency: 'usd',
        client_reference_id: opts.ref ?? null,
        payment_intent: `pi_${opts.sessionId}`,
      },
    },
  } as unknown as Stripe.Event;
}

/** Un litige ouvert (`created`) ou refermé (`closed`) : Stripe envoie le litige. */
function disputeEvent(opts: {
  type: 'charge.dispute.created' | 'charge.dispute.closed';
  paymentIntent: string | null;
  status: string;
  disputeId?: string;
  id?: string;
}): Stripe.Event {
  return {
    id: opts.id ?? `evt_${uniq('dispute')}`,
    type: opts.type,
    data: {
      object: {
        id: opts.disputeId ?? `du_${uniq('dispute')}`,
        object: 'dispute',
        amount: 400,
        charge: `ch_${uniq('disputed')}`,
        currency: 'usd',
        payment_intent: opts.paymentIntent,
        reason: 'fraudulent',
        status: opts.status,
      },
    },
  } as unknown as Stripe.Event;
}

const opened = (paymentIntent: string, status = 'needs_response') =>
  disputeEvent({ type: 'charge.dispute.created', paymentIntent, status });
const closed = (paymentIntent: string | null, status: string, id?: string) =>
  disputeEvent({ type: 'charge.dispute.closed', paymentIntent, status, id });

/** `charge.refunded` total. */
function refundEvent(paymentIntent: string): Stripe.Event {
  return {
    id: `evt_${uniq('refund')}`,
    type: 'charge.refunded',
    data: {
      object: {
        id: `ch_${uniq('charge')}`,
        object: 'charge',
        amount: 400,
        amount_refunded: 400,
        refunded: true,
        currency: 'usd',
        payment_intent: paymentIntent,
      },
    },
  } as unknown as Stripe.Event;
}

/** Une clé gratuite (200 par mois), rechargée d'un pack par sa référence. */
function rechargedFreeKey(tag: string, bundle = '1k', amountTotal = 400) {
  const key = generateApiKey(`${uniq(tag)}@alpha.example.net`)!;
  const sessionId = `cs_test_${uniq(tag)}`;
  const credited = processStripeEvent(
    packEvent({ sessionId, ref: ensureTopupRef(key.key_hash)!, bundle, amountTotal }),
  );
  expect(credited.body.topup).toMatchObject({ outcome: 'credited' });
  return { key, sessionId, paymentIntent: `pi_${sessionId}` };
}

function purchaseOf(sessionId: string): PurchaseRow {
  return findPurchaseByRef(`stripe:${sessionId}`)!;
}

function creditsOf(keyHash: string): { remaining: number | null; total: number | null } {
  const row = getStatsDB()
    .prepare('SELECT credits_remaining, credits_total FROM api_keys WHERE key_hash = ?')
    .get(keyHash) as { credits_remaining: number | null; credits_total: number | null };
  return { remaining: row.credits_remaining, total: row.credits_total };
}

describe('litige refermé sans perte', () => {
  it('un litige gagné rend exactement ce qu’il avait repris, une seule fois', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('won');
    const before = creditsOf(key.key_hash);
    expect(before.remaining).toBe(1000);
    processStripeEvent(opened(paymentIntent));
    expect(creditsOf(key.key_hash).remaining).toBe(0);

    const event = closed(paymentIntent, 'won');
    const result = processStripeEvent(event);
    const purchase = purchaseOf(sessionId);
    expect(result.status).toBe(200);
    expect(result.body.dispute_closed).toEqual({
      dispute_status: 'won',
      outcome: 'reinstated',
      purchase_id: purchase.id,
      key_prefix: key.key_prefix,
      restored_credits: 1000,
    });
    expect(purchase).toMatchObject({ outcome: 'reinstated', clawback_credits: 1000 });
    // L'inverse exact de la reprise : solde et cumul acheté reviennent tels quels.
    expect(creditsOf(key.key_hash)).toEqual(before);
    expect(validateApiKey(key.api_key)).toMatchObject({ valid: true, creditsRemaining: 1000 });
    expect(result.alert?.key).toBe(`stripe:dispute-closed:${purchase.id}`);
    expect(result.alert?.detail).toContain('1000 crédits rendus');
    expect(result.alert?.detail).not.toContain('@');

    // Le même évènement rejoué : la barrière des évènements traités.
    expect(processStripeEvent(event).body).toMatchObject({ idempotent: true });
    // Un autre évènement sur la même fermeture : l'issue de la ligne fait barrière.
    const again = processStripeEvent(closed(paymentIntent, 'won'));
    expect(again.body.dispute_closed).toMatchObject({ outcome: 'unchanged', restored_credits: 0 });
    expect(again.alert).toBeUndefined();
    expect(creditsOf(key.key_hash).remaining).toBe(1000);
  });

  it('une demande de renseignements refermée (warning_closed) rend les crédits d’une clé frappée', () => {
    const sessionId = `cs_test_${uniq('inquiry_closed')}`;
    const minted = processStripeEvent(packEvent({ sessionId }));
    const rawKey = minted.notify!.rawKey;
    processStripeEvent(opened(`pi_${sessionId}`, 'warning_needs_response'));
    expect(validateApiKey(rawKey).creditsRemaining).toBe(0);

    const result = processStripeEvent(closed(`pi_${sessionId}`, 'warning_closed'));
    expect(result.body.dispute_closed).toMatchObject({
      dispute_status: 'warning_closed',
      outcome: 'reinstated',
      restored_credits: 1000,
    });
    expect(validateApiKey(rawKey).creditsRemaining).toBe(1000);
    expect(purchaseOf(sessionId).outcome).toBe('reinstated');
  });

  it('solde déjà entamé : ne rend que ce que le litige avait repris, jamais le pack entier', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('spent_won', '5k', 2000);
    getStatsDB()
      .prepare('UPDATE api_keys SET credits_remaining = 1200 WHERE key_hash = ?')
      .run(key.key_hash);
    processStripeEvent(opened(paymentIntent));
    expect(purchaseOf(sessionId).clawback_credits).toBe(1200);

    const result = processStripeEvent(closed(paymentIntent, 'won'));
    expect(result.body.dispute_closed).toMatchObject({
      outcome: 'reinstated',
      restored_credits: 1200,
    });
    expect(creditsOf(key.key_hash).remaining).toBe(1200);
  });

  it('clé tournée après le litige : le rendu vise la clé active de la lignée', () => {
    const { key, paymentIntent } = rechargedFreeKey('rotated_won');
    processStripeEvent(opened(paymentIntent));
    const rotated = rotateApiKey(key.api_key)!;
    const result = processStripeEvent(closed(paymentIntent, 'won'));
    expect(result.body.dispute_closed).toMatchObject({
      outcome: 'reinstated',
      key_prefix: rotated.key_prefix,
      restored_credits: 1000,
    });
    expect(validateApiKey(rotated.api_key).creditsRemaining).toBe(1000);
    expect(validateApiKey(key.api_key).valid).toBe(false);
  });

  it('un litige qui n’avait rien repris redevient une vente sans rien rendre', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('nothing_taken');
    getStatsDB()
      .prepare('UPDATE api_keys SET credits_remaining = 0 WHERE key_hash = ?')
      .run(key.key_hash);
    processStripeEvent(opened(paymentIntent));
    expect(purchaseOf(sessionId)).toMatchObject({ outcome: 'disputed', clawback_credits: 0 });

    const result = processStripeEvent(closed(paymentIntent, 'won'));
    expect(result.body.dispute_closed).toMatchObject({
      outcome: 'reinstated',
      restored_credits: 0,
    });
    expect(creditsOf(key.key_hash).remaining).toBe(0);
    expect(purchaseOf(sessionId).outcome).toBe('reinstated');
  });

  it('après un rendu, un nouveau litige sur le même paiement reprend de nouveau', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('second_dispute');
    processStripeEvent(opened(paymentIntent, 'warning_needs_response'));
    processStripeEvent(closed(paymentIntent, 'warning_closed'));
    expect(creditsOf(key.key_hash).remaining).toBe(1000);

    const second = processStripeEvent(opened(paymentIntent, 'needs_response'));
    expect(second.body.reversal).toMatchObject({ outcome: 'clawed_back', removed_credits: 1000 });
    expect(purchaseOf(sessionId)).toMatchObject({ outcome: 'disputed', clawback_credits: 1000 });
    expect(creditsOf(key.key_hash).remaining).toBe(0);
  });
});

describe('litige refermé sans rendu', () => {
  it('un litige perdu ne rend rien, et l’alerte dit que l’argent est reparti', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('lost');
    processStripeEvent(opened(paymentIntent));
    const result = processStripeEvent(closed(paymentIntent, 'lost'));
    const purchase = purchaseOf(sessionId);
    expect(result.body.dispute_closed).toMatchObject({
      dispute_status: 'lost',
      outcome: 'kept',
      purchase_id: purchase.id,
      restored_credits: 0,
    });
    expect(purchase).toMatchObject({ outcome: 'disputed', clawback_credits: 1000 });
    expect(creditsOf(key.key_hash).remaining).toBe(0);
    expect(result.alert?.detail).toContain('reparti au payeur');
    expect(result.alert?.detail).not.toContain('@');
  });

  it('un statut inconnu ne rend rien', () => {
    const { key, paymentIntent } = rechargedFreeKey('unknown_status');
    processStripeEvent(opened(paymentIntent));
    const result = processStripeEvent(closed(paymentIntent, 'prevented'));
    expect(result.body.dispute_closed).toMatchObject({ outcome: 'kept', restored_credits: 0 });
    expect(creditsOf(key.key_hash).remaining).toBe(0);
  });

  it('un pack remboursé pendant la demande ne rend rien quand elle se referme', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('refunded_then_closed');
    processStripeEvent(opened(paymentIntent, 'warning_needs_response'));
    // La demande est réglée par un remboursement : l'argent repart au payeur.
    const refund = processStripeEvent(refundEvent(paymentIntent));
    expect(refund.body.reversal).toMatchObject({ outcome: 'unchanged', removed_credits: 0 });
    expect(purchaseOf(sessionId)).toMatchObject({ outcome: 'refunded', clawback_credits: 1000 });

    const result = processStripeEvent(closed(paymentIntent, 'warning_closed'));
    expect(result.body.dispute_closed).toMatchObject({ outcome: 'unchanged', restored_credits: 0 });
    expect(creditsOf(key.key_hash).remaining).toBe(0);
    expect(result.alert?.detail).toContain('remboursé entre-temps');
  });

  it('fermeture reçue AVANT le remboursement : rendu, puis le remboursement reprend une fois', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('closed_then_refunded');
    processStripeEvent(opened(paymentIntent, 'warning_needs_response'));
    processStripeEvent(closed(paymentIntent, 'warning_closed'));
    expect(creditsOf(key.key_hash).remaining).toBe(1000);
    // Stripe ne garantit aucun ordre : le remboursement arrive après la fermeture.
    const refund = processStripeEvent(refundEvent(paymentIntent));
    expect(refund.body.reversal).toMatchObject({ outcome: 'clawed_back', removed_credits: 1000 });
    expect(purchaseOf(sessionId).outcome).toBe('refunded');
    expect(creditsOf(key.key_hash).remaining).toBe(0);
  });

  it('clé révoquée depuis le litige : rien rendu, jamais réactivée, et l’alerte demande un rendu à la main', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('revoked_won');
    processStripeEvent(opened(paymentIntent));
    expect(revokeApiKey(key.api_key)).toBe(true);
    const result = processStripeEvent(closed(paymentIntent, 'won'));
    expect(result.body.dispute_closed).toMatchObject({
      outcome: 'no_single_active_key',
      restored_credits: 0,
    });
    expect(purchaseOf(sessionId).outcome).toBe('disputed');
    expect(validateApiKey(key.api_key).valid).toBe(false);
    expect(result.alert?.detail).toContain('À rendre à la main');
  });

  it('un litige refermé qui ne mène à aucun achat est ignoré, sans alerte', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const unknown = processStripeEvent(closed(`pi_${uniq('nobody')}`, 'won'));
    expect(unknown.body).toMatchObject({ ignored: 'no_matching_purchase' });
    expect(unknown.alert).toBeUndefined();
    const noIntent = processStripeEvent(closed(null, 'won'));
    expect(noIntent.body).toMatchObject({ ignored: 'no_payment_intent' });
    expect(info).toHaveBeenCalledWith(expect.stringContaining('(dispute status won)'));
  });

  it('un litige refermé sur un pack jamais disputé ne rend rien', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('never_disputed');
    const result = processStripeEvent(closed(paymentIntent, 'won'));
    expect(result.body.dispute_closed).toMatchObject({ outcome: 'unchanged', restored_credits: 0 });
    expect(result.alert).toBeUndefined();
    expect(purchaseOf(sessionId).outcome).toBe('credited');
    expect(creditsOf(key.key_hash).remaining).toBe(1000);
  });
});

/**
 * Le rendu des crédits quand un litige se referme sans perte (décision de
 * Claude-Alain du 26.09.2026, choix 4 du bilan : « rendre les crédits tout
 * seuls quand je garde l'argent ») : `charge.dispute.closed` avec le statut
 * `won` ou `warning_closed` rend à la clé active de la lignée exactement ce que
 * `charge.dispute.created` avait repris, une seule fois, et seulement pour le
 * litige qui avait repris. Un litige perdu, un pack remboursé entre-temps, un
 * second litige, un remboursement partiel ou une lignée sans clé active unique
 * ne rendent rien d'eux-mêmes.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { processStripeEvent, resetStripeClient } from './stripe-webhook.js';
import { generateApiKey, revokeApiKey, rotateApiKey, validateApiKey } from '../lib/api-keys.js';
import { ensureTopupRef, findPurchaseByRef, type PurchaseRow } from '../lib/key-purchases.js';
import { serviceContact } from '../lib/quota-notice.js';
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
  payerEmail?: string;
}): Stripe.Event {
  return {
    id: `evt_${uniq('pack')}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: opts.sessionId,
        metadata: { bundle: opts.bundle ?? '1k' },
        customer_email: opts.payerEmail ?? null,
        customer_details: opts.payerEmail ? { email: opts.payerEmail } : null,
        payment_status: 'paid',
        amount_total: opts.amountTotal ?? 400,
        currency: 'usd',
        client_reference_id: opts.ref ?? null,
        payment_intent: `pi_${opts.sessionId}`,
      },
    },
  } as unknown as Stripe.Event;
}

/** Un évènement de litige : Stripe envoie l'objet litige, avec son identifiant. */
function disputeEvent(
  type: 'charge.dispute.created' | 'charge.dispute.closed',
  paymentIntent: string | null,
  disputeId: string,
  status: string,
  eventId?: string,
): Stripe.Event {
  return {
    id: eventId ?? `evt_${uniq('dispute')}`,
    type,
    data: {
      object: {
        id: disputeId,
        object: 'dispute',
        amount: 400,
        charge: `ch_${uniq('disputed')}`,
        currency: 'usd',
        payment_intent: paymentIntent,
        reason: 'fraudulent',
        status,
      },
    },
  } as unknown as Stripe.Event;
}

/** Un litige sur un paiement : on l'ouvre et on le referme sous le même identifiant. */
function disputeOn(paymentIntent: string) {
  const id = `du_${uniq('dispute')}`;
  return {
    id,
    open: (status = 'needs_response') =>
      processStripeEvent(disputeEvent('charge.dispute.created', paymentIntent, id, status)),
    closedEvent: (status: string) =>
      disputeEvent('charge.dispute.closed', paymentIntent, id, status),
    close: (status: string) =>
      processStripeEvent(disputeEvent('charge.dispute.closed', paymentIntent, id, status)),
  };
}

/** `charge.refunded`, total par défaut. */
function refundEvent(paymentIntent: string, amountRefunded = 400): Stripe.Event {
  return {
    id: `evt_${uniq('refund')}`,
    type: 'charge.refunded',
    data: {
      object: {
        id: `ch_${uniq('charge')}`,
        object: 'charge',
        amount: 400,
        amount_refunded: amountRefunded,
        refunded: amountRefunded >= 400,
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

function creditsOf(keyHash: string): {
  remaining: number | null;
  total: number | null;
  noticeBase: number | null;
} {
  const row = getStatsDB()
    .prepare(
      'SELECT credits_remaining, credits_total, credits_notice_base FROM api_keys WHERE key_hash = ?',
    )
    .get(keyHash) as {
    credits_remaining: number | null;
    credits_total: number | null;
    credits_notice_base: number | null;
  };
  return {
    remaining: row.credits_remaining,
    total: row.credits_total,
    noticeBase: row.credits_notice_base,
  };
}

describe('litige refermé sans perte', () => {
  it('un litige gagné rend exactement ce qu’il avait repris, une seule fois', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('won');
    const before = creditsOf(key.key_hash);
    expect(before.remaining).toBe(1000);
    const d = disputeOn(paymentIntent);
    d.open();
    expect(creditsOf(key.key_hash).remaining).toBe(0);
    // Le litige qui a repris est mémorisé.
    expect(purchaseOf(sessionId)).toMatchObject({ outcome: 'disputed', dispute_id: d.id });

    const event = d.closedEvent('won');
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
    // L'inverse exact de la reprise : solde, cumul acheté et assiette des 10 %.
    expect(creditsOf(key.key_hash)).toEqual(before);
    expect(validateApiKey(key.api_key)).toMatchObject({ valid: true, creditsRemaining: 1000 });
    expect(result.alert?.key).toMatch(
      new RegExp(`^stripe:dispute-closed:${purchase.id}:[0-9a-f]{12}$`),
    );
    expect(result.alert?.detail).toContain('1000 crédits rendus');
    expect(result.alert?.detail).not.toContain('@');

    // Le même évènement rejoué : la barrière des évènements traités.
    expect(processStripeEvent(event).body).toMatchObject({ idempotent: true });
    // Un autre évènement sur la même fermeture : l'issue de la ligne fait barrière.
    const again = d.close('won');
    expect(again.body.dispute_closed).toMatchObject({ outcome: 'unchanged', restored_credits: 0 });
    expect(again.alert).toBeUndefined();
    expect(creditsOf(key.key_hash).remaining).toBe(1000);
  });

  it('une demande de renseignements refermée (warning_closed) rend les crédits d’une clé frappée', () => {
    const sessionId = `cs_test_${uniq('inquiry_closed')}`;
    const minted = processStripeEvent(packEvent({ sessionId }));
    const rawKey = minted.notify!.rawKey;
    const d = disputeOn(`pi_${sessionId}`);
    d.open('warning_needs_response');
    expect(validateApiKey(rawKey).creditsRemaining).toBe(0);

    const result = d.close('warning_closed');
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
      .prepare(
        'UPDATE api_keys SET credits_remaining = 1200, credits_notice_base = 5000 WHERE key_hash = ?',
      )
      .run(key.key_hash);
    const before = creditsOf(key.key_hash);
    const d = disputeOn(paymentIntent);
    d.open();
    expect(purchaseOf(sessionId).clawback_credits).toBe(1200);
    expect(creditsOf(key.key_hash).noticeBase).toBe(3800);

    const result = d.close('won');
    expect(result.body.dispute_closed).toMatchObject({
      outcome: 'reinstated',
      restored_credits: 1200,
    });
    expect(creditsOf(key.key_hash)).toEqual(before);
  });

  it('clé tournée après le litige : le rendu vise la clé active de la lignée', () => {
    const { key, paymentIntent } = rechargedFreeKey('rotated_won');
    const d = disputeOn(paymentIntent);
    d.open();
    const rotated = rotateApiKey(key.api_key)!;
    const result = d.close('won');
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
    const d = disputeOn(paymentIntent);
    d.open();
    expect(purchaseOf(sessionId)).toMatchObject({ outcome: 'disputed', clawback_credits: 0 });

    const result = d.close('won');
    expect(result.body.dispute_closed).toMatchObject({
      outcome: 'reinstated',
      restored_credits: 0,
    });
    expect(creditsOf(key.key_hash).remaining).toBe(0);
    expect(purchaseOf(sessionId).outcome).toBe('reinstated');
  });

  it('un litige perdu puis gagné plus tard rend les crédits au gain', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('late_win');
    const d = disputeOn(paymentIntent);
    d.open();
    const lost = d.close('lost');
    expect(lost.body.dispute_closed).toMatchObject({ outcome: 'kept' });
    expect(purchaseOf(sessionId).outcome).toBe('disputed');
    const won = d.close('won');
    expect(won.body.dispute_closed).toMatchObject({
      outcome: 'reinstated',
      restored_credits: 1000,
    });
    expect(creditsOf(key.key_hash).remaining).toBe(1000);
  });

  it('après un rendu, un nouveau litige sur le même paiement reprend de nouveau, avec sa propre alerte', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('second_dispute');
    const first = disputeOn(paymentIntent);
    const opened = first.open('warning_needs_response');
    first.close('warning_closed');
    expect(creditsOf(key.key_hash).remaining).toBe(1000);

    const second = disputeOn(paymentIntent);
    const reopened = second.open('needs_response');
    expect(reopened.body.reversal).toMatchObject({
      outcome: 'clawed_back',
      removed_credits: 1000,
    });
    expect(purchaseOf(sessionId)).toMatchObject({
      outcome: 'disputed',
      clawback_credits: 1000,
      dispute_id: second.id,
      reinstate_blocked: null,
    });
    expect(creditsOf(key.key_hash).remaining).toBe(0);
    // Une clé d'alerte par litige : celle du second part, elle aussi.
    expect(reopened.alert?.key).toBeDefined();
    expect(reopened.alert?.key).not.toBe(opened.alert?.key);

    const closed = second.close('won');
    expect(closed.body.dispute_closed).toMatchObject({
      outcome: 'reinstated',
      restored_credits: 1000,
    });
    expect(creditsOf(key.key_hash).remaining).toBe(1000);
  });
});

describe('ce qui lit les ventes voit un pack rendu', () => {
  // Relecture de l'intégrateur du 26.09.2026 : `serviceContact` filtrait sur une
  // liste d'issues écrite en dur, sans `reinstated`. Une clé sans adresse,
  // rechargée par carte, perdait son seul contact après un litige gagné, et ses
  // alertes de solde ne partaient plus alors que ses crédits étaient rendus.
  it('le contact du payeur d’une clé sans adresse revient avec les crédits', () => {
    const anon = generateApiKey(null)!;
    const email = `${uniq('payer')}@alpha.example.net`;
    const sessionId = `cs_test_${uniq('anon_won')}`;
    processStripeEvent(
      packEvent({ sessionId, ref: ensureTopupRef(anon.key_hash)!, payerEmail: email }),
    );
    expect(serviceContact(anon.key_hash, undefined)).toBe(email);

    const d = disputeOn(`pi_${sessionId}`);
    d.open();
    expect(purchaseOf(sessionId).outcome).toBe('disputed');
    expect(serviceContact(anon.key_hash, undefined)).toBeNull();

    d.close('won');
    expect(purchaseOf(sessionId).outcome).toBe('reinstated');
    expect(serviceContact(anon.key_hash, undefined)).toBe(email);
  });
});

describe('litige refermé sans rendu', () => {
  it('un litige perdu ne rend rien, et l’alerte dit que l’argent est reparti', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('lost');
    const d = disputeOn(paymentIntent);
    d.open();
    const result = d.close('lost');
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

  it('prevented, ou un statut inconnu : rien rendu, et l’alerte demande de relire sans rien affirmer', () => {
    for (const status of ['prevented', 'some_new_status']) {
      const { key, paymentIntent } = rechargedFreeKey(`kept_${status}`);
      const d = disputeOn(paymentIntent);
      d.open();
      const result = d.close(status);
      expect(result.body.dispute_closed).toMatchObject({ outcome: 'kept', restored_credits: 0 });
      expect(creditsOf(key.key_hash).remaining).toBe(0);
      expect(result.alert?.detail).toContain('À relire');
      expect(result.alert?.detail).not.toContain('reparti au payeur');
    }
  });

  it('un pack remboursé pendant la demande ne rend rien quand elle se referme', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('refunded_then_closed');
    const d = disputeOn(paymentIntent);
    d.open('warning_needs_response');
    // La demande est réglée par un remboursement : l'argent repart au payeur.
    const refund = processStripeEvent(refundEvent(paymentIntent));
    expect(refund.body.reversal).toMatchObject({ outcome: 'unchanged', removed_credits: 0 });
    expect(purchaseOf(sessionId)).toMatchObject({ outcome: 'refunded', clawback_credits: 1000 });

    const result = d.close('warning_closed');
    expect(result.body.dispute_closed).toMatchObject({
      outcome: 'unchanged',
      restored_credits: 0,
    });
    expect(creditsOf(key.key_hash).remaining).toBe(0);
    expect(result.alert?.detail).toContain('remboursé entre-temps');
  });

  it('fermeture reçue AVANT le remboursement : rendu, puis le remboursement reprend une fois', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('closed_then_refunded');
    const d = disputeOn(paymentIntent);
    d.open('warning_needs_response');
    d.close('warning_closed');
    expect(creditsOf(key.key_hash).remaining).toBe(1000);
    // Stripe ne garantit aucun ordre : le remboursement arrive après la fermeture.
    const refund = processStripeEvent(refundEvent(paymentIntent));
    expect(refund.body.reversal).toMatchObject({
      outcome: 'clawed_back',
      removed_credits: 1000,
    });
    expect(purchaseOf(sessionId).outcome).toBe('refunded');
    expect(creditsOf(key.key_hash).remaining).toBe(0);
  });

  it('un remboursement PARTIEL pendant le litige bloque le rendu, et une alerte le dit tout de suite', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('partial_during');
    const d = disputeOn(paymentIntent);
    d.open('warning_needs_response');
    const partial = processStripeEvent(refundEvent(paymentIntent, 100));
    expect(partial.body.reversal).toMatchObject({
      outcome: 'partial_refund_on_dispute',
      removed_credits: 0,
    });
    expect(partial.alert?.detail).toContain('ne seront PAS rendus');
    expect(purchaseOf(sessionId)).toMatchObject({
      outcome: 'disputed',
      reinstate_blocked: 'partial_refund',
    });

    const result = d.close('warning_closed');
    expect(result.body.dispute_closed).toMatchObject({
      outcome: 'blocked',
      blocked_reason: 'partial_refund',
      restored_credits: 0,
    });
    expect(creditsOf(key.key_hash).remaining).toBe(0);
    expect(result.alert?.detail).toContain('À décider à la main');
  });

  it('deux litiges ouverts sur le même paiement : la fermeture gagnée du premier ne rend rien', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('two_disputes');
    const a = disputeOn(paymentIntent);
    const b = disputeOn(paymentIntent);
    const openedA = a.open();
    const openedB = b.open();
    expect(openedB.body.reversal).toMatchObject({ outcome: 'unchanged', removed_credits: 0 });
    expect(openedB.alert?.detail).toContain('second litige');
    expect(openedB.alert?.key).not.toBe(openedA.alert?.key);
    expect(purchaseOf(sessionId)).toMatchObject({
      outcome: 'disputed',
      dispute_id: a.id,
      reinstate_blocked: 'second_dispute',
    });

    const wonA = a.close('won');
    expect(wonA.body.dispute_closed).toMatchObject({
      outcome: 'blocked',
      blocked_reason: 'second_dispute',
      restored_credits: 0,
    });
    expect(wonA.alert?.detail).toContain('À décider à la main');
    // Le second se referme à son tour : ce n'est pas lui qui avait repris.
    const wonB = b.close('won');
    expect(wonB.body.dispute_closed).toMatchObject({
      outcome: 'other_dispute',
      restored_credits: 0,
    });
    expect(creditsOf(key.key_hash).remaining).toBe(0);
    expect(purchaseOf(sessionId).outcome).toBe('disputed');
  });

  it('la fermeture d’un litige qui n’a rien repris ne rend rien', () => {
    const { key, paymentIntent } = rechargedFreeKey('other_dispute');
    disputeOn(paymentIntent).open();
    const stranger = disputeOn(paymentIntent);
    const result = stranger.close('won');
    expect(result.body.dispute_closed).toMatchObject({
      outcome: 'other_dispute',
      restored_credits: 0,
    });
    expect(creditsOf(key.key_hash).remaining).toBe(0);
    expect(result.alert?.detail).toContain('À relire');
  });

  it('clé révoquée depuis le litige : rien rendu, jamais réactivée, et l’alerte demande un rendu à la main', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('revoked_won');
    const d = disputeOn(paymentIntent);
    d.open();
    expect(revokeApiKey(key.api_key)).toBe(true);
    const result = d.close('won');
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
    const unknown = disputeOn(`pi_${uniq('nobody')}`).close('won');
    expect(unknown.body).toMatchObject({ ignored: 'no_matching_purchase' });
    expect(unknown.alert).toBeUndefined();
    const noIntent = processStripeEvent(
      disputeEvent('charge.dispute.closed', null, `du_${uniq('none')}`, 'won'),
    );
    expect(noIntent.body).toMatchObject({ ignored: 'no_payment_intent' });
    expect(info).toHaveBeenCalledWith(expect.stringContaining('(dispute status won)'));
  });

  it('un litige refermé sur un pack jamais disputé ne rend rien', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('never_disputed');
    const result = disputeOn(paymentIntent).close('won');
    expect(result.body.dispute_closed).toMatchObject({
      outcome: 'unchanged',
      restored_credits: 0,
    });
    expect(result.alert).toBeUndefined();
    expect(purchaseOf(sessionId).outcome).toBe('credited');
    expect(creditsOf(key.key_hash).remaining).toBe(1000);
  });
});

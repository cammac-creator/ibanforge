/**
 * La reprise automatique d'un pack remboursé ou contesté (décision de
 * Claude-Alain du 25.09.2026, après la mise en ligne de la recharge de la même
 * clé) : `charge.refunded` (total) et `charge.dispute.created` reprennent les
 * crédits de l'achat retrouvé par son intention de paiement, par le même code
 * que la route d'administration. Jamais au-delà du solde, jamais sous zéro,
 * jamais une clé désactivée, une seule fois par achat.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { processStripeEvent, resetStripeClient, stripeWebhook } from './stripe-webhook.js';
import {
  generateApiKey,
  PRO_MONTHLY_LIMIT,
  revokeApiKey,
  rotateApiKey,
  validateApiKey,
} from '../lib/api-keys.js';
import {
  clawbackPurchase,
  ensureTopupRef,
  findPurchaseByRef,
  type PurchaseRow,
} from '../lib/key-purchases.js';
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

/** `charge.refunded` : Stripe envoie la charge, avec le cumul remboursé. */
function refundEvent(opts: {
  paymentIntent: string | null;
  amount: number;
  amountRefunded: number;
  id?: string;
}): Stripe.Event {
  return {
    id: opts.id ?? `evt_${uniq('refund')}`,
    type: 'charge.refunded',
    data: {
      object: {
        id: `ch_${uniq('charge')}`,
        object: 'charge',
        amount: opts.amount,
        amount_refunded: opts.amountRefunded,
        refunded: opts.amountRefunded >= opts.amount,
        currency: 'usd',
        payment_intent: opts.paymentIntent,
      },
    },
  } as unknown as Stripe.Event;
}

/** `charge.dispute.created` : Stripe envoie le litige. */
function disputeEvent(opts: {
  paymentIntent: string | null;
  amount: number;
  status?: string;
}): Stripe.Event {
  return {
    id: `evt_${uniq('dispute')}`,
    type: 'charge.dispute.created',
    data: {
      object: {
        id: `du_${uniq('dispute')}`,
        object: 'dispute',
        amount: opts.amount,
        charge: `ch_${uniq('disputed')}`,
        currency: 'usd',
        payment_intent: opts.paymentIntent,
        reason: 'fraudulent',
        status: opts.status ?? 'needs_response',
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

function eventProcessed(eventId: string): boolean {
  return !!getStatsDB()
    .prepare('SELECT 1 FROM processed_webhooks WHERE stripe_event_id = ?')
    .get(eventId);
}

describe('remboursement total d’un pack', () => {
  it('reprend les crédits du pack, et un évènement rejoué ne reprend rien deux fois', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('full', '5k', 2000);
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(5000);

    const refund = refundEvent({ paymentIntent, amount: 2000, amountRefunded: 2000 });
    const first = processStripeEvent(refund);
    expect(first.status).toBe(200);
    const purchase = purchaseOf(sessionId);
    expect(first.body.reversal).toEqual({
      reason: 'refunded',
      outcome: 'clawed_back',
      purchase_id: purchase.id,
      key_prefix: key.key_prefix,
      removed_credits: 5000,
      pack_credits: 5000,
    });
    expect(purchase).toMatchObject({ outcome: 'refunded', clawback_credits: 5000 });
    expect(purchase.ended_at).not.toBeNull();
    const v = validateApiKey(key.api_key);
    expect(v.valid).toBe(true);
    expect(v.creditsRemaining).toBe(0);
    // Règle A : une clé gratuite rechargée garde son mois.
    expect(v.monthlyLimit).toBe(200);
    // L'alerte d'exploitation : le préfixe et l'achat, jamais une adresse.
    expect(first.alert?.key).toBe(`stripe:refund:${purchase.id}`);
    expect(first.alert?.detail).toContain('5000 crédits repris');
    expect(first.alert?.detail).not.toContain('@');
    expect(eventProcessed(refund.id)).toBe(true);

    // Stripe rejoue le même évènement : la barrière des évènements traités.
    const replay = processStripeEvent(refund);
    expect(replay.status).toBe(200);
    expect(replay.body.idempotent).toBe(true);
    expect(replay.alert).toBeUndefined();
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(0);
    expect(purchaseOf(sessionId).clawback_credits).toBe(5000);
  });

  it('un autre évènement sur le même paiement ne reprend rien de plus : l’issue de la ligne fait barrière', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('twice');
    // Un second pack sur la même clé : ce qu'une reprise en double mangerait.
    processStripeEvent(
      packEvent({ sessionId: `cs_test_${uniq('twice2')}`, ref: ensureTopupRef(key.key_hash)! }),
    );
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(2000);

    processStripeEvent(refundEvent({ paymentIntent, amount: 400, amountRefunded: 400 }));
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(1000);

    // Un second `charge.refunded` sous un autre identifiant : rien de plus, pas d'alerte.
    const again = processStripeEvent(
      refundEvent({ paymentIntent, amount: 400, amountRefunded: 400 }),
    );
    expect(again.body.reversal).toMatchObject({ outcome: 'unchanged', removed_credits: 0 });
    expect(again.alert).toBeUndefined();

    // Puis un litige sur le même paiement : rien de plus, mais un humain le sait.
    const dispute = processStripeEvent(disputeEvent({ paymentIntent, amount: 400 }));
    expect(dispute.body.reversal).toMatchObject({
      reason: 'disputed',
      outcome: 'unchanged',
      removed_credits: 0,
    });
    expect(dispute.alert?.key).toBe(`stripe:dispute:${purchaseOf(sessionId).id}`);
    expect(dispute.alert?.detail).toContain('déjà repris');
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(1000);
    expect(purchaseOf(sessionId).outcome).toBe('refunded');

    // La route d'administration lit la même barrière.
    expect(clawbackPurchase(purchaseOf(sessionId).id, 'refunded')).toMatchObject({
      status: 'unchanged',
    });
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(1000);
  });
});

describe('remboursement partiel', () => {
  it('ne reprend rien, alerte, puis le remboursement qui complète reprend une fois', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('partial');
    const partial = processStripeEvent(
      refundEvent({ paymentIntent, amount: 400, amountRefunded: 100 }),
    );
    expect(partial.status).toBe(200);
    expect(partial.body.reversal).toMatchObject({
      reason: 'refunded',
      outcome: 'partial_refund',
      removed_credits: 0,
    });
    expect(partial.alert?.key).toMatch(/^stripe:refund-partial:/);
    expect(partial.alert?.detail).toContain('PARTIEL');
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(1000);
    expect(purchaseOf(sessionId)).toMatchObject({ outcome: 'credited', clawback_credits: null });

    // Le cumul remboursé atteint le montant : Stripe dit `refunded: true`.
    const completing = processStripeEvent(
      refundEvent({ paymentIntent, amount: 400, amountRefunded: 400 }),
    );
    expect(completing.body.reversal).toMatchObject({
      outcome: 'clawed_back',
      removed_credits: 1000,
    });
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(0);
  });
});

describe('litige', () => {
  it('reprend le pack d’une clé née d’un achat, quel que soit le statut du litige', () => {
    const sessionId = `cs_test_${uniq('dispute-born')}`;
    const minted = processStripeEvent(packEvent({ sessionId }));
    const rawKey = minted.notify!.rawKey;
    expect(validateApiKey(rawKey).creditsRemaining).toBe(1000);

    // Une simple demande de renseignements (`warning_*`) reprend aussi : c'est
    // la lettre de la décision ; un humain restitue si elle se referme.
    const result = processStripeEvent(
      disputeEvent({
        paymentIntent: `pi_${sessionId}`,
        amount: 400,
        status: 'warning_needs_response',
      }),
    );
    const purchase = purchaseOf(sessionId);
    expect(result.body.reversal).toMatchObject({
      reason: 'disputed',
      outcome: 'clawed_back',
      purchase_id: purchase.id,
      removed_credits: 1000,
    });
    expect(purchase).toMatchObject({ outcome: 'disputed', clawback_credits: 1000 });
    expect(result.alert?.key).toBe(`stripe:dispute:${purchase.id}`);
    expect(result.alert?.detail).toContain('Litige gagné');
    // Jamais une clé désactivée : elle reste valable, à zéro (règle A : 402 avec ses liens).
    const v = validateApiKey(rawKey);
    expect(v.valid).toBe(true);
    expect(v.creditsRemaining).toBe(0);
  });
});

describe('achat inconnu', () => {
  it('répond 200 ignored avec un journal, sans alerte, et Stripe ne le rejoue pas', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const refund = refundEvent({
      paymentIntent: `pi_${uniq('autre-projet')}`,
      amount: 5000,
      amountRefunded: 5000,
    });
    const result = processStripeEvent(refund);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ received: true, ignored: 'no_matching_purchase' });
    expect(result.alert).toBeUndefined();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('no_matching_purchase'));
    expect(eventProcessed(refund.id)).toBe(true);
    expect(processStripeEvent(refund).body.idempotent).toBe(true);
  });

  it('un litige sans intention de paiement est ignoré, jamais une erreur', () => {
    const result = processStripeEvent(disputeEvent({ paymentIntent: null, amount: 400 }));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ received: true, ignored: 'no_payment_intent' });
    expect(result.alert).toBeUndefined();
  });
});

describe('la clé a changé depuis l’achat', () => {
  it('clé tournée : la reprise vise la clé active de la lignée', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('rotated', '5k', 2000);
    const rotated = rotateApiKey(key.api_key)!;
    expect(validateApiKey(rotated.api_key).creditsRemaining).toBe(5000);

    const result = processStripeEvent(
      refundEvent({ paymentIntent, amount: 2000, amountRefunded: 2000 }),
    );
    expect(result.body.reversal).toMatchObject({
      outcome: 'clawed_back',
      key_prefix: rotated.key_prefix,
      removed_credits: 5000,
    });
    expect(validateApiKey(rotated.api_key).creditsRemaining).toBe(0);
    expect(validateApiKey(rotated.api_key).valid).toBe(true);
    // L'ancienne clé reste morte, et la ligne garde la clé servie à l'achat.
    expect(validateApiKey(key.api_key).valid).toBe(false);
    expect(purchaseOf(sessionId).key_prefix).toBe(key.key_prefix);
  });

  it('solde déjà entamé : seulement ce qui reste, jamais sous zéro', () => {
    const { key, paymentIntent } = rechargedFreeKey('spent', '5k', 2000);
    // Le porteur a déjà consommé 3 800 crédits.
    getStatsDB()
      .prepare('UPDATE api_keys SET credits_remaining = 1200 WHERE key_hash = ?')
      .run(key.key_hash);
    const result = processStripeEvent(
      refundEvent({ paymentIntent, amount: 2000, amountRefunded: 2000 }),
    );
    expect(result.body.reversal).toMatchObject({
      outcome: 'clawed_back',
      removed_credits: 1200,
      pack_credits: 5000,
    });
    expect(result.alert?.detail).toContain('seul le solde');
    const v = validateApiKey(key.api_key);
    expect(v.creditsRemaining).toBe(0);
    expect(v.valid).toBe(true);
  });

  it('clé révoquée : rien repris, jamais réactivée, et l’alerte le dit', () => {
    const { key, sessionId, paymentIntent } = rechargedFreeKey('revoked');
    expect(revokeApiKey(key.api_key)).toBe(true);
    const result = processStripeEvent(
      refundEvent({ paymentIntent, amount: 400, amountRefunded: 400 }),
    );
    expect(result.body.reversal).toMatchObject({ outcome: 'clawed_back', removed_credits: 0 });
    expect(result.alert?.detail).toContain('Aucune clé active');
    expect(validateApiKey(key.api_key).valid).toBe(false);
    expect(
      (
        getStatsDB()
          .prepare('SELECT active FROM api_keys WHERE key_hash = ?')
          .get(key.key_hash) as {
          active: number;
        }
      ).active,
    ).toBe(0);
    expect(purchaseOf(sessionId)).toMatchObject({ outcome: 'refunded', clawback_credits: 0 });
  });
});

describe('un paiement d’abonnement remboursé', () => {
  it('ne reprend rien et ne touche pas la clé Pro, mais un humain le sait', () => {
    const sessionId = `cs_test_${uniq('pro')}`;
    const minted = processStripeEvent({
      id: `evt_${uniq('pro')}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          metadata: { plan: 'pro' },
          customer_email: null,
          customer_details: null,
          payment_status: 'paid',
          mode: 'subscription',
          subscription: `sub_test_${uniq('pro')}`,
          amount_total: 2900,
          currency: 'usd',
          // Synthétique : une session d'abonnement n'a en principe pas
          // d'intention ; ce test vise la branche « pas un pack ».
          payment_intent: `pi_${sessionId}`,
        },
      },
    } as unknown as Stripe.Event);
    const rawKey = minted.notify!.rawKey;
    const result = processStripeEvent(
      refundEvent({ paymentIntent: `pi_${sessionId}`, amount: 2900, amountRefunded: 2900 }),
    );
    expect(result.body.reversal).toMatchObject({ outcome: 'not_a_pack', removed_credits: 0 });
    expect(result.alert?.detail).toContain('abonnement');
    const v = validateApiKey(rawKey);
    expect(v.valid).toBe(true);
    expect(v.monthlyLimit).toBe(PRO_MONTHLY_LIMIT);
  });
});

describe('la signature Stripe est vérifiée comme pour les autres évènements', () => {
  it('refuse un corps retouché sans rien reprendre, puis reprend une fois sur le vrai', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fictif_sans_compte');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_fictif_sans_compte');
    resetStripeClient();
    const { key, paymentIntent } = rechargedFreeKey('signed', '5k', 2000);
    const payload = JSON.stringify(
      refundEvent({ paymentIntent, amount: 2000, amountRefunded: 2000 }),
    );
    const signature = new Stripe('sk_test_fictif_sans_compte').webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_fictif_sans_compte',
    });
    const send = (body: string, sig: string | null = signature) =>
      stripeWebhook.request('/v1/stripe/webhook', {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          ...(sig ? { 'stripe-signature': sig } : {}),
        },
      });

    expect((await send(`${payload} `)).status).toBe(400);
    expect((await send(payload, null)).status).toBe(400);
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(5000);

    const valid = await send(payload);
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({
      reversal: { outcome: 'clawed_back', removed_credits: 5000 },
    });
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(0);

    const replay = await send(payload);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ idempotent: true });
    expect(validateApiKey(key.api_key).creditsRemaining).toBe(0);
  });
});

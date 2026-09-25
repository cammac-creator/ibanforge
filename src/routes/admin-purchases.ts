/**
 * Le registre des achats, côté administration (chantier « clé unique », lot B1,
 * 25.09.2026). Secret d'administration (`X-Admin-Secret`), comme les autres
 * routes `/v1/admin/*`.
 *
 *  - `GET  /v1/admin/purchases?outcome=pending` : les achats, les plus récents
 *    d'abord, filtrés par issue ;
 *  - `POST /v1/admin/purchases/:id/confirm` : le rapprochement d'un achat USDC
 *    resté en attente (issue de règlement inconnue : délai, erreur du
 *    facilitateur, transaction diffusée non confirmée), une fois le transfert
 *    relu sur la chaîne à partir de `payer_address`, `auth_nonce` et `tx_hash`.
 *    Crédite la clé, ou active la clé neuve, une fois ;
 *  - `POST /v1/admin/purchases/:id/fail` : le même achat, quand le transfert
 *    n'a pas eu lieu. Rien n'est crédité, une clé neuve reste morte ;
 *  - `POST /v1/admin/purchases/:id/clawback` : la reprise d'un pack remboursé
 *    ou disputé, appelée par l'opérateur APRÈS avoir remboursé dans Stripe
 *    (spec §9, Q9). L'automatisme par webhook exigerait d'abonner le point
 *    d'écoute Stripe à `charge.refunded` et `charge.dispute.created` : un
 *    réglage du compte de paiement, donc la décision de Claude-Alain.
 *
 * Toutes idempotentes : un second appel ne crédite ni ne reprend rien de plus.
 */
import { Hono } from 'hono';
import { isAdminAuthorized } from './api-keys.js';
import {
  clawbackPurchase,
  confirmPurchase,
  failPurchase,
  listPurchases,
  type PurchaseOutcome,
  type PurchaseRow,
} from '../lib/key-purchases.js';

export const adminPurchases = new Hono();

const OUTCOMES: ReadonlySet<string> = new Set<PurchaseOutcome>([
  'pending',
  'credited',
  'minted',
  'minted_fallback',
  'attached',
  'failed',
  'refunded',
  'disputed',
]);

/** Une ligne telle que l'administration la lit : jamais le hash de la clé ni de la lignée. */
function publicRow(row: PurchaseRow): Record<string, unknown> {
  return {
    id: row.id,
    payment_ref: row.payment_ref,
    rail: row.rail,
    kind: row.kind,
    outcome: row.outcome,
    key_prefix: row.key_prefix,
    bundle: row.bundle,
    credits: row.credits,
    balance_after: row.balance_after,
    amount_minor: row.amount_minor,
    currency: row.currency,
    quoted_amount_usd: row.quoted_amount_usd,
    stripe_payment_intent: row.stripe_payment_intent,
    payer_email: row.payer_email,
    // De quoi relire la chaîne avant de confirmer ou d'échouer un achat USDC
    // (relecture de la PR 259, D10). Jamais la signature.
    payer_address: row.payer_address,
    auth_nonce: row.auth_nonce,
    tx_hash: row.tx_hash,
    clawback_credits: row.clawback_credits,
    backfilled: row.backfilled === 1,
    created_at: row.created_at,
    settled_at: row.settled_at,
    ended_at: row.ended_at,
  };
}

function purchaseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

adminPurchases.get('/v1/admin/purchases', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const outcome = c.req.query('outcome');
  if (outcome !== undefined && !OUTCOMES.has(outcome)) {
    return c.json(
      { error: 'invalid_outcome', message: `outcome must be one of: ${[...OUTCOMES].join(', ')}` },
      400,
    );
  }
  const limit = Number(c.req.query('limit') ?? 50);
  const rows = listPurchases({
    outcome: outcome as PurchaseOutcome | undefined,
    limit: Number.isFinite(limit) ? limit : 50,
  });
  c.header('Cache-Control', 'private, no-store');
  return c.json({ purchases: rows.map(publicRow) });
});

adminPurchases.post('/v1/admin/purchases/:id/confirm', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const id = purchaseId(c.req.param('id'));
  if (!id) return c.json({ error: 'invalid_id' }, 400);
  const result = confirmPurchase(id);
  if (result.status === 'not_found') return c.json({ error: 'not_found' }, 404);
  return c.json({
    status: result.status,
    purchase: publicRow(result.purchase),
    ...(result.status === 'minted_fallback'
      ? {
          note:
            'The key this payment was meant for is no longer active: a new key was minted instead, recoverable ONCE ' +
            'at GET /v1/credits/recover/<settlement reference>. Tell the payer.',
        }
      : {}),
  });
});

adminPurchases.post('/v1/admin/purchases/:id/fail', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const id = purchaseId(c.req.param('id'));
  if (!id) return c.json({ error: 'invalid_id' }, 400);
  const result = failPurchase(id);
  if (result.status === 'not_found') return c.json({ error: 'not_found' }, 404);
  return c.json(result);
});

adminPurchases.post('/v1/admin/purchases/:id/clawback', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const id = purchaseId(c.req.param('id'));
  if (!id) return c.json({ error: 'invalid_id' }, 400);
  let body: { reason?: unknown };
  try {
    body = await c.req.json<{ reason?: unknown }>();
  } catch {
    return c.json(
      { error: 'invalid_json', message: 'Expected { "reason": "refunded" | "disputed" }' },
      400,
    );
  }
  if (body.reason !== 'refunded' && body.reason !== 'disputed') {
    return c.json(
      { error: 'invalid_reason', message: 'reason must be "refunded" or "disputed"' },
      400,
    );
  }
  const result = clawbackPurchase(id, body.reason);
  switch (result.status) {
    case 'not_found':
      return c.json({ error: 'not_found' }, 404);
    case 'not_a_pack':
      return c.json(
        {
          error: 'not_a_pack',
          message: 'Only a credit pack can be clawed back; a subscription is refunded in Stripe.',
        },
        409,
      );
    case 'not_settled':
      return c.json(
        {
          error: 'not_settled',
          message:
            'This purchase never credited a key (pending or failed): there is nothing to take back.',
          purchase: publicRow(result.purchase),
        },
        409,
      );
    case 'unchanged':
      return c.json({ status: 'unchanged', purchase: publicRow(result.purchase) });
    default:
      return c.json({
        status: 'clawed_back',
        removed_credits: result.removed,
        key_prefix: result.keyPrefix,
        purchase: publicRow(result.purchase),
        note:
          result.removed < (result.purchase.credits ?? 0)
            ? 'Fewer credits were left on the key than the pack held: only what was left was taken back, never below zero.'
            : undefined,
      });
  }
});

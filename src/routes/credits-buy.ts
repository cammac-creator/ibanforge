/**
 * /v1/credits/buy/:bundle — paid endpoint that sells a credit pack after an
 * x402 settlement. MUST be mounted AFTER the x402 middleware in src/index.ts so
 * the payment gate runs first; if mounted before, the handler executes without
 * payment validation.
 *
 * Pricing for each bundle is enforced in src/middleware/x402.ts (route
 * `POST /v1/credits/buy/:bundle`).
 *
 * Depuis le lot B1 du chantier « clé unique » (25.09.2026, décision de
 * Claude-Alain du 24.09.2026) :
 *
 *  - une clé VALIDE présentée est RECHARGÉE : le pack atterrit sur elle, la
 *    réponse la renvoie telle quelle (`same_key: true`), rien ne change dans
 *    l'intégration du client. Présenter sa clé ne coûte plus une unité (route
 *    gratuite du middleware des clés) et n'accorde plus « 200 une fois » : un
 *    achat ne crée jamais de gratuit ;
 *  - sans clé présentée (ou avec une clé invalide), une clé NEUVE, comme avant ;
 *  - dans les deux cas, RIEN n'est crédité ni activé avant un règlement
 *    confirmé. Le SDK x402 exécute cette route AVANT de régler : elle n'ouvre
 *    qu'un achat en attente, que l'enrobage x402 confirme ou échoue ensuite
 *    (`src/middleware/x402.ts`, `settlePendingPurchase`).
 */
import { Hono, type Context } from 'hono';
import type { HonoEnv } from '../types.js';
import { creditKeyInTx, generateCreditKey } from '../lib/api-keys.js';
import { getStatsDB } from '../lib/db.js';
import {
  findPurchaseByRef,
  isSaleOutcome,
  openUsdcMint,
  openUsdcTopup,
  type PurchaseRow,
} from '../lib/key-purchases.js';
import { currentSettlementSlot, settlementRef } from '../lib/settlement-slot.js';
import { isReachableContact } from '../lib/quota-notice.js';
import { buildFirstCallCurl } from '../lib/first-call.js';
import { sendApiKeyEmail, sendRechargeEmail, alertKeyDeliveryFailure } from '../lib/email.js';
import { extractKey } from '../middleware/api-key.js';

const BUNDLES: Record<string, { credits: number; price_usdc: number }> = {
  '1k': { credits: 1000, price_usdc: 4 },
  '5k': { credits: 5000, price_usdc: 20 },
  '25k': { credits: 25000, price_usdc: 80 },
};

/**
 * Re-exported for the callers that imported it from here before lot B1: the
 * digest now lives in src/lib/settlement-slot.ts, beside the slot it serves.
 */
export { settlementRef };

const creditsBuy = new Hono<HonoEnv>();

/** La clé que ce règlement a frappée : si elle est active, et si sa clé brute est encore récupérable. */
function mintedBy(
  ref: string,
): { key_hash: string; key_prefix: string; active: boolean; recoverable: boolean } | null {
  const row = getStatsDB()
    .prepare(
      `SELECT key_hash, key_prefix, active, raw_key_one_time_view IS NOT NULL AS has_raw
         FROM api_keys WHERE x402_payment_ref = ?`,
    )
    .get(ref) as
    { key_hash: string; key_prefix: string; active: number; has_raw: number } | undefined;
  if (!row) return null;
  return {
    key_hash: row.key_hash,
    key_prefix: row.key_prefix,
    active: row.active === 1,
    recoverable: row.active === 1 && row.has_raw === 1,
  };
}

/**
 * Un paiement déjà vu (requête rejouée), lu sur la ligne de son achat
 * (relecture de sécurité de la PR 259, D2).
 *
 *  - achat CRÉDITÉ ou FRAPPÉ : 200 idempotent, rien de plus. Le lien de
 *    récupération seulement pour une clé active dont la clé brute est encore
 *    gardée : sinon il répondrait 404 ;
 *  - TOUT LE RESTE (en attente, refusé, remboursé, disputé) : 409. Le SDK ne
 *    règle jamais une réponse d'erreur, donc l'autorisation rejouée ne part
 *    pas : un 200 ici la faisait régler sans rien livrer.
 */
function replayAnswer(
  c: Context<HonoEnv>,
  row: PurchaseRow,
  ref: string,
  bundle: { slug: string; credits: number },
): Response {
  if (!isSaleOutcome(row.outcome)) {
    if (row.outcome === 'pending') {
      return c.json(
        {
          error: 'payment_pending',
          purchase_status: 'pending',
          message:
            'This payment was already received and its settlement is not confirmed yet: do NOT pay again. ' +
            'It is reconciled by hand once the transfer is confirmed on-chain; write to support@ibanforge.com ' +
            'with the transaction hash if nothing has arrived within a day.',
        },
        409,
      );
    }
    if (row.outcome === 'failed') {
      return c.json(
        {
          error: 'payment_refused',
          purchase_status: 'failed',
          message:
            'This payment was refused when it was settled: nothing was credited, and it will not be settled ' +
            'again. Sign a new payment to buy this pack.',
        },
        409,
      );
    }
    return c.json(
      {
        error: 'payment_reversed',
        purchase_status: row.outcome,
        message:
          'This payment was refunded or disputed and its credits were taken back: it will not be settled ' +
          'again. Sign a new payment to buy this pack.',
      },
      409,
    );
  }
  const minted = mintedBy(ref);
  if (!minted || minted.key_hash !== row.key_hash) {
    return c.json(
      {
        key_prefix: row.key_prefix,
        credits: bundle.credits,
        bundle: bundle.slug,
        idempotent: true,
        recharged: true,
        message:
          'This settlement was already recorded for this key: nothing was credited twice. ' +
          'Check the balance at GET /v1/credits/balance.',
      },
      200,
    );
  }
  return c.json(
    {
      key_prefix: row.key_prefix,
      credits: bundle.credits,
      bundle: bundle.slug,
      idempotent: true,
      ...(minted.recoverable
        ? {
            message:
              'This settlement already minted a key: it was not minted again. ' +
              'If you never received it, fetch it once at the recovery URL below.',
            recovery_url: `https://api.ibanforge.com/v1/credits/recover/${ref}`,
          }
        : {
            message:
              'This settlement already minted a key: it was not minted again, and it can no longer be shown.',
          }),
    },
    200,
  );
}

/**
 * Une clé frappée par ce règlement sans ligne au registre (rattrapage manqué) :
 * 200 seulement si elle est active, jamais pour une clé morte.
 */
function legacyReplayAnswer(
  c: Context<HonoEnv>,
  minted: { key_prefix: string; active: boolean; recoverable: boolean },
  ref: string,
  bundle: { slug: string; credits: number },
): Response {
  if (!minted.active) {
    return c.json(
      {
        error: 'payment_already_used',
        message:
          'This payment already bought a key, which is no longer active: it will not be settled again. ' +
          'Sign a new payment to buy this pack.',
      },
      409,
    );
  }
  return c.json(
    {
      key_prefix: minted.key_prefix,
      credits: bundle.credits,
      bundle: bundle.slug,
      idempotent: true,
      message: 'This settlement already minted a key: it was not minted again.',
      ...(minted.recoverable
        ? { recovery_url: `https://api.ibanforge.com/v1/credits/recover/${ref}` }
        : {}),
    },
    200,
  );
}

creditsBuy.post('/v1/credits/buy/:bundle', async (c) => {
  const slug = c.req.param('bundle');
  const bundle = BUNDLES[slug];
  if (!bundle) {
    return c.json(
      {
        error: 'unknown_bundle',
        message: `Bundle "${slug}" not found. Choose: ${Object.keys(BUNDLES).join(', ')}.`,
        bundles: Object.keys(BUNDLES),
      },
      404,
    );
  }

  // Optional email. On a NEW key it is the key's contact, as before; on a
  // recharge it is only the payer's service contact (ZG8): never written
  // into the key it pays for.
  let email: string | null = null;
  try {
    const body = await c.req.json<{ email?: unknown }>().catch(() => ({}));
    if (
      body &&
      typeof body === 'object' &&
      'email' in body &&
      typeof body.email === 'string' &&
      body.email.includes('@')
    ) {
      email = body.email.trim().toLowerCase();
    }
  } catch {
    // No body, no email — fine.
  }

  const presentedHash = c.get('apiKeyHash');
  const presentedPrefix = c.get('apiKeyPrefix');
  const presentedKey = presentedHash ? extractKey(c) : null;
  // Une clé présentée mais invalide ou révoquée : le middleware des clés a posé
  // sa cause. Le pack part alors sur une clé neuve, et la réponse le dit.
  const cause = c.get('paywallCause');
  const invalidKeyPresented =
    cause?.reason === 'invalid_api_key' || cause?.reason === 'key_revoked_burst';

  const ref = settlementRef(c);
  const slot = currentSettlementSlot();

  // ─── Hors d'un règlement ─────────────────────────────────────────────────
  //
  // L'enrobage x402 ouvre un créneau pour toute requête qu'il cote ; sans
  // créneau, aucun règlement ne suivra cette réponse. C'est le cas du mode
  // gratuit (développement, tests, mode gratuit explicite), où la frappe
  // d'avant ce lot était déjà gratuite : on y crédite tout de suite, et rien
  // n'y est une vente. PARTOUT AILLEURS, refus : en production, une vente
  // atteinte sans règlement serait un pack offert.
  if (!slot || !ref) {
    const production = process.env.NODE_ENV === 'production';
    const explicitFreeMode = process.env.IBANFORGE_FREE_MODE === 'true';
    if (production && !explicitFreeMode) {
      return c.json(
        {
          error: 'payment_unavailable',
          message:
            'This pack could not be sold: no payment was settled for this request. Nothing was charged. ' +
            'Retry with an x402 payment, or buy by card on https://ibanforge.com/pricing.',
        },
        503,
      );
    }
    if (presentedHash && presentedKey) {
      const db = getStatsDB();
      const balance = db.transaction(() => creditKeyInTx(db, presentedHash, bundle.credits))();
      return c.json(
        {
          api_key: presentedKey,
          same_key: true,
          recharged: true,
          key_prefix: presentedPrefix,
          credits: bundle.credits,
          credits_added: bundle.credits,
          credits_remaining: balance,
          bundle: slug,
          price_paid_usdc: 0,
          balance_endpoint: 'GET /v1/credits/balance',
          message: 'Free mode: the credits were added to the key you presented, nothing was paid.',
        },
        201,
      );
    }
    const result = generateCreditKey(email, bundle.credits, null);
    return c.json(
      {
        api_key: result.api_key,
        key_prefix: result.key_prefix,
        credits: result.credits,
        bundle: slug,
        price_paid_usdc: 0,
        first_call: buildFirstCallCurl(result.api_key),
        usage_hint:
          'Send Authorization: Bearer ' +
          result.api_key +
          ' on subsequent /v1/iban/* and /v1/bic/* calls.',
        balance_endpoint: 'GET /v1/credits/balance',
        message: 'Free mode: save this key, it will not be shown again. Nothing was paid.',
      },
      201,
    );
  }

  const paymentRef = `x402:${ref}`;
  const quotedUsd = slot.quotedUsd ?? bundle.price_usdc;
  const pack = { slug, credits: bundle.credits };

  // ─── Un paiement déjà vu (requête rejouée) ───────────────────────────────
  //
  // Avant toute ouverture : la ligne de son achat dit ce qu'on en répond (D2).
  const seen = findPurchaseByRef(paymentRef);
  if (seen) return replayAnswer(c, seen, ref, pack);
  const legacy = mintedBy(ref);
  if (legacy) return legacyReplayAnswer(c, legacy, ref, pack);

  // ─── Recharge de la clé présentée ────────────────────────────────────────
  if (presentedHash && presentedPrefix && presentedKey) {
    const opened = openUsdcTopup(
      { keyHash: presentedHash, keyPrefix: presentedPrefix },
      { paymentRef, bundle: slug, credits: bundle.credits, quotedUsd, payerEmail: email },
    );
    // Une requête jumelle a ouvert la ligne entre la lecture et l'ouverture.
    if ('existing' in opened) return replayAnswer(c, opened.existing, ref, pack);
    slot.purchase = { id: opened.opened, paymentRef, kind: 'topup' };
    // Le mail de recharge part à l'adresse JOIGNABLE de la clé, jamais à celle
    // du corps (ZG8), et seulement une fois le règlement confirmé : c'est
    // l'enrobage qui le déclenche, par ce crochet.
    slot.afterConfirm = (confirmed) => {
      if (process.env.VITEST || confirmed.status !== 'credited') return;
      const keyEmail = (
        getStatsDB().prepare('SELECT email FROM api_keys WHERE key_hash = ?').get(presentedHash) as
          { email: string } | undefined
      )?.email;
      if (!isReachableContact(keyEmail)) return;
      void sendRechargeEmail({
        to: keyEmail,
        keyPrefix: confirmed.keyPrefix,
        creditsAdded: bundle.credits,
        balance: confirmed.balanceAfter,
        bundle: slug,
      }).catch(() => {});
    };
    return c.json(
      {
        // La clé présentée, renvoyée telle quelle : un client qui suit la
        // documentation d'avant et « bascule sur la clé rendue » continue donc
        // sur la même (Q7 de la spec). Ce corps n'est remis qu'au SDK x402 au
        // moment du règlement, qui ne le transmet à personne (constat C8, à
        // relire à chaque montée de version du SDK).
        api_key: presentedKey,
        same_key: true,
        recharged: true,
        key_prefix: presentedPrefix,
        // La taille du pack, comme sur une clé neuve : le contrat publié exige
        // `credits`, et un client d'avant ce lot le lit.
        credits: bundle.credits,
        credits_added: bundle.credits,
        bundle: slug,
        price_paid_usdc: bundle.price_usdc,
        balance_endpoint: 'GET /v1/credits/balance',
        message:
          'The credits are on the key you presented: nothing to change in your integration. ' +
          'They are added once the payment settles, before this response reaches you.',
      },
      201,
    );
  }

  // ─── Clé neuve ────────────────────────────────────────────────────────────
  //
  // Un règlement déjà vu a répondu plus haut : rien n'est frappé deux fois pour
  // un paiement, et l'acheteur d'une clé active est renvoyé à la récupération
  // unique, la raison même pour laquelle la clé brute est gardée.
  const opened = openUsdcMint(email, {
    paymentRef,
    ref,
    bundle: slug,
    credits: bundle.credits,
    quotedUsd,
    payerEmail: email,
  });
  if ('existing' in opened) return replayAnswer(c, opened.existing, ref, pack);
  const result = opened.mint;
  slot.purchase = { id: opened.opened, paymentRef, kind: 'mint' };
  // Mail delivery on the USDC rail, matching the card rail (BIZ-04, 2026-09-01),
  // now sent only once the settlement is CONFIRMED (lot B1): a key mailed
  // before a refused settlement would be a dead key in the buyer's mailbox.
  //
  // Skipped under vitest for the same reason as the free rail in
  // src/routes/api-keys.ts: the suite drives this route with published example
  // addresses, and a relay configured in the shell would mail real people.
  slot.afterConfirm = (confirmed) => {
    if (!email || process.env.VITEST || confirmed.status !== 'minted') return;
    void sendApiKeyEmail({
      to: email,
      rawKey: result.api_key,
      credits: bundle.credits,
      bundle: slug,
    }).catch(() => {
      alertKeyDeliveryFailure('credits/buy key delivery threw before the relay answered');
    });
  };

  return c.json(
    {
      api_key: result.api_key,
      key_prefix: result.key_prefix,
      credits: bundle.credits,
      bundle: slug,
      price_paid_usdc: bundle.price_usdc,
      price_per_call_usdc: Math.round((bundle.price_usdc / bundle.credits) * 1_000_000) / 1_000_000,
      // The command that works, not a description of one (BIZ-04, 2026-09-01).
      // Same block the delivery emails and the Stripe success page carry, so the
      // three rails cannot drift. `usage_hint` printed the PREFIX followed by an
      // ellipsis, which is a string no caller can ever authenticate with.
      first_call: buildFirstCallCurl(result.api_key),
      usage_hint:
        'Send Authorization: Bearer ' +
        result.api_key +
        ' on subsequent /v1/iban/* and /v1/bic/* calls.',
      balance_endpoint: 'GET /v1/credits/balance',
      // How to get this key back exactly once if you lose this response. The
      // reference is sha256(your payment header) truncated to 32 hex chars, so
      // you can recompute it from the request you sent even if this body never
      // reached you.
      recovery_url: `https://api.ibanforge.com/v1/credits/recover/${ref}`,
      recovery_note:
        'Lost this response? GET the recovery_url once — it works a single time, then the key is gone from our side too (we store only its hash).',
      ...(invalidKeyPresented
        ? { note: 'The key you presented is invalid or revoked: this pack is on a NEW key.' }
        : {}),
      message: 'Save this key — it will not be shown again.',
    },
    201,
  );
});

export { creditsBuy };

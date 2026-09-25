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
import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { creditKeyInTx, findCreditKeyByPaymentRef, generateCreditKey } from '../lib/api-keys.js';
import { getStatsDB } from '../lib/db.js';
import { openUsdcMint, openUsdcTopup } from '../lib/key-purchases.js';
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

/** Le corps d'une vente dont le règlement a déjà été vu (requête rejouée). */
function idempotentBody(
  ref: string,
  bundle: { slug: string; credits: number },
  keyPrefix: string,
  topup: boolean,
): Record<string, unknown> {
  return topup
    ? {
        key_prefix: keyPrefix,
        credits: bundle.credits,
        bundle: bundle.slug,
        idempotent: true,
        recharged: true,
        message:
          'This settlement was already recorded for this key: nothing was credited twice. ' +
          'Check the balance at GET /v1/credits/balance.',
      }
    : {
        key_prefix: keyPrefix,
        credits: bundle.credits,
        bundle: bundle.slug,
        idempotent: true,
        message:
          'This settlement already minted a key — it was not minted again. ' +
          'If you never received it, fetch it once at the recovery URL below.',
        recovery_url: `https://api.ibanforge.com/v1/credits/recover/${ref}`,
      };
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

  // ─── Recharge de la clé présentée ────────────────────────────────────────
  if (presentedHash && presentedPrefix && presentedKey) {
    const opened = openUsdcTopup(
      { keyHash: presentedHash, keyPrefix: presentedPrefix },
      { paymentRef, bundle: slug, credits: bundle.credits, quotedUsd, payerEmail: email },
    );
    if ('existing' in opened) {
      const topup = opened.existing.key_hash !== findMintedKeyHash(ref);
      return c.json(
        idempotentBody(ref, { slug, credits: bundle.credits }, opened.existing.key_prefix, topup),
        200,
      );
    }
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
  // A settlement we have already minted for. Nothing is minted again — that
  // would be two packs for one payment — and the buyer is pointed at the
  // one-time recovery, which is the whole reason the raw key was kept.
  const already = findCreditKeyByPaymentRef(ref);
  if (already) {
    return c.json(
      idempotentBody(ref, { slug, credits: bundle.credits }, already.key_prefix, false),
    );
  }
  const opened = openUsdcMint(email, {
    paymentRef,
    ref,
    bundle: slug,
    credits: bundle.credits,
    quotedUsd,
    payerEmail: email,
  });
  if ('existing' in opened) {
    return c.json(
      idempotentBody(ref, { slug, credits: bundle.credits }, opened.existing.key_prefix, false),
      200,
    );
  }
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

/** La clé que ce règlement a frappée, par sa référence ; null s'il n'en a frappé aucune. */
function findMintedKeyHash(ref: string): string | null {
  const row = getStatsDB()
    .prepare('SELECT key_hash FROM api_keys WHERE x402_payment_ref = ?')
    .get(ref) as { key_hash: string } | undefined;
  return row?.key_hash ?? null;
}

export { creditsBuy };

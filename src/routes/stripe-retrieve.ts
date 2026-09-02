/**
 * GET /v1/stripe/key/:session_id — one-time retrieval of the API key minted
 * for a Stripe Checkout session.
 *
 * After payment, Stripe redirects the user to the success URL with the
 * session id in the query string (success_url=...?session_id={CHECKOUT_SESSION_ID}).
 * The frontend calls this endpoint to fetch the raw key, which is then cleared
 * from the database so it can only be retrieved once.
 *
 * If the webhook has not yet processed the event when the user reaches the
 * success page (rare but possible — Stripe redirects can be faster than the
 * webhook), this returns 404 and the frontend should retry after a short delay.
 */
import { Hono } from 'hono';
import {
  consumeOneTimeKey,
  consumeOneTimeKeyByPaymentRef,
  OEM_MONTHLY_LIMIT,
} from '../lib/api-keys.js';

export const stripeRetrieve = new Hono();

stripeRetrieve.get('/v1/stripe/key/:session_id', (c) => {
  const sessionId = c.req.param('session_id');

  if (!sessionId || !/^cs_(test|live)_[A-Za-z0-9_]+$/.test(sessionId)) {
    return c.json(
      {
        error: 'invalid_session_id',
        message: 'Session id must look like cs_test_... or cs_live_...',
      },
      400,
    );
  }

  const result = consumeOneTimeKey(sessionId);

  if (!result) {
    return c.json(
      {
        error: 'not_available',
        message:
          'No API key available for this session. Either the webhook is still processing (try again in a few seconds) or the key was already retrieved on a previous visit. Contact support@ibanforge.com if you lost it.',
      },
      404,
    );
  }

  return c.json({
    api_key: result.api_key,
    key_prefix: result.api_key.slice(0, 12),
    credits_total: result.credits_total,
    credits_remaining: result.credits_remaining,
    // Subscription keys carry a monthly allowance instead of credits. The plan
    // is read off the allowance: OEM is the only one at 50,000, everything
    // below is Pro (2026-09-02).
    monthly_limit: result.monthly_limit,
    plan:
      result.monthly_limit !== null && result.credits_total === null
        ? result.monthly_limit >= OEM_MONTHLY_LIMIT
          ? 'oem'
          : 'pro'
        : 'credits',
    email: result.email,
    note: 'This key will only be shown ONCE. Store it securely.',
    usage_hint:
      'Send Authorization: Bearer ' +
      result.api_key.slice(0, 12) +
      '... on subsequent /v1/iban/* and /v1/bic/* calls.',
  });
});

/**
 * GET /v1/credits/recover/:ref — the same one-time retrieval, for the rail that
 * had none.
 *
 * A credit pack bought with x402 costs up to $80 and used to exist only in the
 * HTTP response that announced it: a connection dropped after settlement left a
 * buyer who had paid and had nothing, and left us unable to help — we keep only
 * the key's hash. The card rail has had this safety net since Stripe day one
 * (`/v1/stripe/key/:session_id` above); this is its twin.
 *
 * `ref` is sha256(the payment header you sent), truncated to 32 hex characters
 * — see `settlementRef` in src/routes/credits-buy.ts. Deliberately something
 * the BUYER can recompute from the request they made, because when the response
 * is lost the request is the only thing they still have.
 *
 * Mounted with the Stripe routes, i.e. BEFORE the api-key and x402 middlewares:
 * recovering a key you already paid for must not cost quota, and must not
 * require the payment you cannot make twice.
 */
stripeRetrieve.get('/v1/credits/recover/:ref', (c) => {
  const ref = c.req.param('ref');

  if (!/^[0-9a-f]{32}$/.test(ref)) {
    return c.json(
      {
        error: 'invalid_reference',
        message:
          'Reference must be 32 lowercase hex characters: sha256(your PAYMENT-SIGNATURE or X-PAYMENT header value), truncated to 32 chars.',
      },
      400,
    );
  }

  const result = consumeOneTimeKeyByPaymentRef(ref);

  if (!result) {
    return c.json(
      {
        error: 'not_available',
        message:
          'No key is recoverable for this settlement. Either it was never minted (the payment did not settle), or the key was already recovered — recovery works exactly once. Contact support@ibanforge.com with the transaction hash if you believe you paid and never received a key.',
      },
      404,
    );
  }

  return c.json({
    api_key: result.api_key,
    key_prefix: result.api_key.slice(0, 12),
    credits_total: result.credits_total,
    credits_remaining: result.credits_remaining,
    note: 'Recovered once. This key can no longer be retrieved — store it now.',
    usage_hint:
      'Send Authorization: Bearer ' +
      result.api_key.slice(0, 12) +
      '... on subsequent /v1/iban/* and /v1/bic/* calls.',
  });
});

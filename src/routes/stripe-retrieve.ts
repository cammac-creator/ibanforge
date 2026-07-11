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
import { consumeOneTimeKey } from '../lib/api-keys.js';

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
    // Editor/OEM subscription keys carry a monthly allowance instead of credits.
    monthly_limit: result.monthly_limit,
    plan: result.monthly_limit !== null && result.credits_total === null ? 'oem' : 'credits',
    email: result.email,
    note: 'This key will only be shown ONCE. Store it securely.',
    usage_hint:
      'Send Authorization: Bearer ' +
      result.api_key.slice(0, 12) +
      '... on subsequent /v1/iban/* and /v1/bic/* calls.',
  });
});

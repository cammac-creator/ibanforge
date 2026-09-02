/**
 * Live Stripe Payment Links for the prepaid credit packs.
 *
 * Single source of truth for the card rail. They were previously inlined in
 * `src/routes/landing.ts` only, which is why the 402 paywall could advertise
 * `pay_by_card` while pointing at an HTML anchor a machine client never
 * renders: the 2026-07-25 funnel audit found the period's biggest evaluator
 * received thousands of 402s and never loaded a single HTML page.
 *
 * Keep in sync with `src/routes/landing.ts` and `frontend/app/[locale]/pricing`.
 */
export const PAYMENT_LINKS = {
  '1k': 'https://buy.stripe.com/3cI00c18lauh1i8bqO8so00',
  '5k': 'https://buy.stripe.com/aFafZa6sF45TaSI9iG8so01',
  '25k': 'https://buy.stripe.com/14A7sE9ERbyld0QcuS8so02',
} as const;

/**
 * Pro subscription (2026-09-02): the public monthly tier. A public Payment
 * Link whose metadata.plan = 'pro' is what the webhook keys on. The allowance
 * is PRO_MONTHLY_LIMIT in src/lib/api-keys.ts; the price is restated here
 * because this file is where every card-rail fact is read from.
 */
export const PRO_PAYMENT_LINK = 'https://buy.stripe.com/aFacMYaIVeKx1i87ay8so04';
export const PRO_PRICE_USD = 29;

/** Entry-level pack: the cheapest way to turn a blocked call into a paid one. */
export const ENTRY_PAYMENT_LINK = PAYMENT_LINKS['1k'];

/** All three packs, card checkout. */
export const PRICING_PAGE = 'https://ibanforge.com/pricing';

/**
 * One-line card offer for machine-readable surfaces (402 bodies, headers).
 * Card first, USDC second: an autonomous agent parses whichever rail it can
 * settle, a human integrator needs a link they can actually click.
 */
export const CARD_CHECKOUT_HINT =
  `Pay by card in one click: ${ENTRY_PAYMENT_LINK} (1,000 credits, $5) ` +
  `— all packs: ${PRICING_PAGE} ` +
  `— or a flat $${PRO_PRICE_USD}/month for 10,000 requests: ${PRO_PAYMENT_LINK}`;

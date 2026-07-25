/**
 * Live Stripe Payment Links for the prepaid credit packs.
 *
 * Single source of truth for the card rail. They were previously inlined in
 * `src/routes/landing.ts` only, which is why the 402 paywall could advertise
 * `pay_by_card` while pointing at an HTML anchor a machine client never
 * renders: the 2026-07-25 funnel audit found the biggest evaluator of June
 * received 3,862 x 402 and never loaded a single HTML page.
 *
 * Keep in sync with `src/routes/landing.ts` and `frontend/app/[locale]/pricing`.
 */
export const PAYMENT_LINKS = {
  '1k': 'https://buy.stripe.com/3cI00c18lauh1i8bqO8so00',
  '5k': 'https://buy.stripe.com/aFafZa6sF45TaSI9iG8so01',
  '25k': 'https://buy.stripe.com/14A7sE9ERbyld0QcuS8so02',
} as const;

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
  `— all packs: ${PRICING_PAGE}`;

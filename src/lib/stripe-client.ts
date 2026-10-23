import Stripe from 'stripe';

/** Version relue avec Stripe 23.0.0 ; indépendante des réglages du compte et des webhooks. */
export const STRIPE_API_VERSION = '2026-09-30.endive' as const;

/** Les cinq lecteurs utilisent le même contrat, en conservant leurs délais et tentatives. */
export function createStripeClient(
  key: string,
  config: Omit<Stripe.StripeConfig, 'apiVersion'> = {},
): Stripe {
  return new Stripe(key, { ...config, apiVersion: STRIPE_API_VERSION });
}

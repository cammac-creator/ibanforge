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
  // 16/09/2026 : le pack d'entrée passe de 5 $ à 4 $ (décision de Claude-Alain sur
  // l'audit du jour : acheter doit toujours coûter moins que payer à l'appel).
  // Nouveau lien, même métadonnée `bundle: 1k` ; l'ancien lien à 5 $ est désactivé.
  '1k': 'https://buy.stripe.com/bJe3coeZb31P6CsamK8so05',
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

/**
 * Portail client Stripe de l'abonnement Pro (16/09/2026) : le client y gère sa
 * carte, ses factures et sa résiliation lui-même. Page de connexion par e-mail,
 * pas de session à créer côté API. Cité dans les CGU (§3) et le mail Pro.
 */
export const PRO_PORTAL_URL = 'https://billing.stripe.com/p/login/3cI00c18lauh1i8bqO8so00';

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
  `Pay by card in one click: ${ENTRY_PAYMENT_LINK} (1,000 credits, $4) ` +
  `— all packs: ${PRICING_PAGE} ` +
  `— or a flat $${PRO_PRICE_USD}/month for 10,000 requests: ${PRO_PAYMENT_LINK}`;

// ─── Recharger CETTE clé (chantier « clé unique », lot B1, 25.09.2026) ──────

export type PackSlug = keyof typeof PAYMENT_LINKS;

/**
 * Les packs dans l'ordre où on les propose, avec ce qu'ils contiennent et ce
 * qu'ils coûtent. Les prix sont ceux de BUNDLES (`src/routes/api-keys.ts`), que
 * `payment-links.test.ts` compare à ceux-ci : un module de `lib/` n'importe pas
 * une route, et un prix qui dériverait ici ferait mentir le 402 et les mails.
 */
export const PACK_OFFERS: ReadonlyArray<{ slug: PackSlug; credits: number; priceUsd: number }> = [
  { slug: '1k', credits: 1000, priceUsd: 4 },
  { slug: '5k', credits: 5000, priceUsd: 20 },
  { slug: '25k', credits: 25000, priceUsd: 80 },
];

/** La forme d'une référence de recharge : `ifr_` puis 128 bits tirés au hasard. */
export const TOPUP_REF_PATTERN = /^ifr_[0-9a-f]{32}$/;

/**
 * Le lien de paiement d'un pack, porteur de la référence de recharge d'une clé.
 *
 * Stripe rend `client_reference_id` tel quel dans `checkout.session.completed`
 * (alphanumérique, tirets et soulignés, 200 caractères au plus) : c'est ce qui
 * fait atterrir le pack sur la clé au lieu d'en frapper une neuve. La référence
 * n'est PAS un secret de la clé : elle ne permet que de payer pour elle (voir
 * `src/lib/key-purchases.ts`). Une référence mal formée n'est jamais recopiée
 * dans une adresse : le lien public est rendu tel quel.
 */
export function topupLink(slug: PackSlug, ref: string): string {
  const base = PAYMENT_LINKS[slug];
  if (!TOPUP_REF_PATTERN.test(ref)) return base;
  return `${base}?client_reference_id=${ref}`;
}

/** Les trois liens de recharge d'une clé. */
export function topupLinks(ref: string): Record<PackSlug, string> {
  return {
    '1k': topupLink('1k', ref),
    '5k': topupLink('5k', ref),
    '25k': topupLink('25k', ref),
  };
}

/**
 * Le lien Pro porteur de la référence de recharge d'une clé (lot B2,
 * 25.09.2026) : l'abonnement se pose sur CETTE clé au lieu d'en frapper une
 * neuve. Même règle que `topupLink` : une référence mal formée n'est jamais
 * recopiée, le lien public est rendu tel quel. À ne proposer qu'à une clé qui
 * n'a pas d'abonnement vivant : le webhook refuse d'en poser un second (ZG10).
 */
export function proLink(ref: string): string {
  if (!TOPUP_REF_PATTERN.test(ref)) return PRO_PAYMENT_LINK;
  return `${PRO_PAYMENT_LINK}?client_reference_id=${ref}`;
}

/**
 * La même offre que CARD_CHECKOUT_HINT, pour une clé VALIDE : les packs y
 * rechargent cette clé-ci, rien ne change dans l'intégration du porteur.
 *
 * Pro se pose sur CETTE clé depuis le lot B2 (25.09.2026), par le lien porteur
 * de sa référence. Il n'est proposé qu'à une clé qui n'a pas d'abonnement
 * vivant (`withPro`) : le webhook refuse d'en poser un second (ZG10), et
 * proposer Pro à un abonné Pro n'a pas de sens.
 */
export function topupHint(ref: string, opts: { withPro?: boolean } = {}): string {
  const packs = PACK_OFFERS.map(
    (p) => `${p.credits.toLocaleString('en-US')} credits $${p.priceUsd}: ${topupLink(p.slug, ref)}`,
  ).join(' · ');
  return (
    `Recharge THIS key by card, nothing to change in your integration: ${packs}. ` +
    'Prefer USDC? POST /v1/credits/buy/1k|5k|25k with this key presented: the credits land on it' +
    (opts.withPro === false
      ? ''
      : `. Or Pro on this same key, a flat $${PRO_PRICE_USD}/month for 10,000 requests: ${proLink(ref)}`)
  );
}

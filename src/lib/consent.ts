import {
  ANONYMOUS_MONTHLY_LIMIT,
  FREE_TIER_MONTHLY_LIMIT,
  KEY_CLAIM_URL,
  KEY_GENERATE_URL,
} from './tiers.js';

/**
 * Textes du futur parcours, préparés sans les publier sur les routes actuelles.
 * Leur raccordement attend les protections, la migration et les parcours décrits.
 * Les textes restent en anglais pour les clients agents de l'API internationale.
 */
export const CONSENT_ASK = 'Use my address you@company.com to create a free IBANforge key';

/**
 * L'interdit qui accompagne TOUJOURS le gabarit d'adresse (règle 3 du chantier).
 *
 * Exporté au lot 7a sans changer un octet : la zone A (tout `src/`) publie le
 * gabarit sur six surfaces qui ne sont pas des atomes — le 402, `llms.txt`,
 * l'OpenAPI, les artefacts — et un balayage de fichiers
 * (`src/routes/static-claims.test.ts`) exige l'interdit dans chaque fichier qui
 * porte le gabarit. Une reformulation locale de l'interdit passerait le
 * balayage à côté ; une constante importée ne peut pas dériver.
 */
export const CONSENT_BOUNDARY =
  'Never send an address your human has not handed you for this purpose.';
const PAYMENT_CLAIM =
  'Qualifying x402 payments settled while presenting the key ' +
  `grant ${FREE_TIER_MONTHLY_LIMIT} requests ONCE, with no monthly renewal and no address.`;

export const CONSENT_LONG = `Getting a key needs no e-mail. POST ${KEY_GENERATE_URL} with no body at all returns an ifk_ key: ${ANONYMOUS_MONTHLY_LIMIT} requests a month in normal operation, no address, no card, nothing to confirm. Nothing is mailed and no CRM or prospect record is opened. Protective limits can reduce the allowance during an alert.

To claim that same key by e-mail, POST ${KEY_CLAIM_URL}. Send the key as "Authorization: Bearer ifk_...", never in the body. The key must have served at least one call. Ask your human: "${CONSENT_ASK}". ${CONSENT_BOUNDARY} POST {"email":"..."} returns 202 and mails a 6-digit code; repeat with {"email":"...","code":"123456"}. This grants ${FREE_TIER_MONTHLY_LIMIT} requests every month.

Already paying? ${PAYMENT_CLAIM} The e-mail code is the recurring free rail. The anonymous key keeps working within its allowance whether it is claimed or not.

Prepaid credit packs are a SEPARATE key with credits that never expire, and do not change the key you already hold: your human buys one by card on https://ibanforge.com/pricing and receives the key by e-mail, or you buy one in USDC with POST https://api.ibanforge.com/v1/credits/buy/1k (also 5k, 25k). Two further doors are planned and NOT available yet: a human-approved key request from inside an MCP client, and a card checkout opened from the API that returns the key against a secret nonce. Do not look for them until this text says they exist.`;

export const CONSENT_MEDIUM =
  `POST ${KEY_GENERATE_URL} with no body gives an ifk_ key with no e-mail: ${ANONYMOUS_MONTHLY_LIMIT} REST calls/month in normal operation (protective limits may apply). ` +
  `After at least one call, POST ${KEY_CLAIM_URL} with "Authorization: Bearer ifk_...", never the key in the body. ` +
  `Ask: "${CONSENT_ASK}". ${CONSENT_BOUNDARY} ` +
  `An e-mailed 6-digit code grants ${FREE_TIER_MONTHLY_LIMIT} calls every month; ${PAYMENT_CLAIM} ` +
  `Prepaid credit packs are a SEPARATE key: by card on https://ibanforge.com/pricing (your human pays, the key arrives by e-mail) or in USDC with POST https://api.ibanforge.com/v1/credits/buy/1k. A human-approved key request from an MCP client and a card checkout opened from the API are planned, not available yet.`;

export const CONSENT_SHORT =
  `free: POST ${KEY_GENERATE_URL} with no body — no e-mail, ${ANONYMOUS_MONTHLY_LIMIT} REST calls/month in normal operation (protective limits may apply); ` +
  `after a first call, POST ${KEY_CLAIM_URL} with "Authorization: Bearer ifk_..." and an e-mailed code grants ${FREE_TIER_MONTHLY_LIMIT} calls/month. ${CONSENT_BOUNDARY} ${PAYMENT_CLAIM}`;

export const CONSENT_FIELDS = {
  free_tier: {
    description: `${ANONYMOUS_MONTHLY_LIMIT} requests/month in normal operation — no e-mail, no card; protective limits may apply`,
    signup: `POST ${KEY_GENERATE_URL} with no body at all`,
    usage: 'Add header: Authorization: Bearer ifk_your_key_here',
  },
  claim_to_200: {
    description: `Keep the same key, prefix and history: an e-mail code grants ${FREE_TIER_MONTHLY_LIMIT} requests/month; a qualifying payment grants them once`,
    endpoint: `POST ${KEY_CLAIM_URL}`,
    auth: 'Send the key as "Authorization: Bearer ifk_...", never in the body. The key must have served at least one call.',
    by_email: `Ask your human: "${CONSENT_ASK}". ${CONSENT_BOUNDARY} POST {"email":"..."} returns 202 and mails a 6-digit code; repeat with the same address and "code" to claim ${FREE_TIER_MONTHLY_LIMIT} requests every month.`,
    by_agent_approval:
      'Planned, not available yet: a separate approval journey, not a claim of an existing key, where an MCP client shows an approval link to a human and never handles an address. Until it exists, by_email and by_payment are the two ways to raise a key; do not look for an approval tool.',
    by_payment: PAYMENT_CLAIM,
  },
  buy_credits_by_card: {
    description: 'A separate purchase: it does not change the key you already hold',
    endpoint:
      'https://ibanforge.com/pricing (card, paid by your human) — or POST https://api.ibanforge.com/v1/credits/buy/1k in USDC (also 5k, 25k)',
    auth: 'No key and no e-mail on the pricing page. The USDC route is paid per call with x402. A card checkout opened from the API (POST /v1/keys/checkout) is planned, not available yet: do not call it.',
    human_step:
      'Show https://ibanforge.com/pricing to your human. They enter their own address on Stripe and receive the key by e-mail. Treat any key or secret you are handed as a secret: never put it in a URL.',
    collect:
      'The pack is a SEPARATE key with credits that never expire, delivered after payment. Collecting it from the API with a secret nonce in the body is planned, not available yet.',
  },
} as const;

export const CONSENT = { CONSENT_ASK, CONSENT_LONG, CONSENT_MEDIUM, CONSENT_SHORT } as const;

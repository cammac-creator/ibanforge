import {
  ANONYMOUS_MONTHLY_LIMIT,
  FREE_TIER_MONTHLY_LIMIT,
  KEY_CHECKOUT_URL,
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

Separately, an MCP client can call request_api_key, show the returned approval link and user code to a human, then use poll_api_key after approval. The human controls what they share; the agent does not handle their address. This journey returns its own key and does not promote an existing anonymous key.

For a card purchase, POST ${KEY_CHECKOUT_URL} with {"pack":"1k"} returns a Stripe link and a secret nonce. No key or e-mail is needed to open the checkout. The human enters their own address on Stripe. After payment, POST ${KEY_CHECKOUT_URL}/claim with {"nonce":"..."} to collect a SEPARATE key with credits that never expire, once only. Keep the nonce secret, send it only in the retrieval request body, and never put it in a URL. This purchase does not change an existing anonymous key.`;

export const CONSENT_MEDIUM =
  `POST ${KEY_GENERATE_URL} with no body gives an ifk_ key with no e-mail: ${ANONYMOUS_MONTHLY_LIMIT} REST calls/month in normal operation (protective limits may apply). ` +
  `After at least one call, POST ${KEY_CLAIM_URL} with "Authorization: Bearer ifk_...", never the key in the body. ` +
  `Ask: "${CONSENT_ASK}". ${CONSENT_BOUNDARY} ` +
  `An e-mailed 6-digit code grants ${FREE_TIER_MONTHLY_LIMIT} calls every month; ${PAYMENT_CLAIM} ` +
  `For a separate human-approved key use request_api_key then poll_api_key. For a separate paid credit key use POST ${KEY_CHECKOUT_URL} with {"pack":"1k"}, then POST ${KEY_CHECKOUT_URL}/claim with the secret nonce in the body after payment.`;

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
      'Separate approval journey, not a claim of an existing key: call request_api_key, show the approval link and user code, then poll_api_key after human approval. Open a grant only when needed: it reserves a key creation allowance. The agent does not handle an address.',
    by_payment: PAYMENT_CLAIM,
  },
  buy_credits_by_card: {
    description: 'A separate purchase: it does not change the key you already hold',
    endpoint: `POST ${KEY_CHECKOUT_URL}`,
    auth: 'No key and no e-mail. Body: {"pack":"1k"} (or 5k, 25k); the pack is required.',
    human_step:
      'Show checkout_url to your human. They enter their own address on Stripe. Keep the returned nonce secret; never put it in a URL.',
    collect: `After payment, POST ${KEY_CHECKOUT_URL}/claim with {"nonce":"..."} in the body. It returns a SEPARATE key with credits that never expire, once only.`,
  },
} as const;

export const CONSENT = { CONSENT_ASK, CONSENT_LONG, CONSENT_MEDIUM, CONSENT_SHORT } as const;

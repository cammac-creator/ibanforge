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
// La promotion « une fois » ne vise que le paiement À L'APPEL (chantier « clé
// unique », lot B1, 25.09.2026) : un pack acheté en présentant la clé la
// recharge, et un achat ne crée jamais de gratuit.
const PAYMENT_CLAIM =
  'Qualifying x402 pay-per-call payments settled while presenting the key ' +
  `grant ${FREE_TIER_MONTHLY_LIMIT} requests ONCE, with no monthly renewal and no address; ` +
  'buying a credit pack with the key presented recharges it and grants nothing free.';

/**
 * Où atterrit un pack (lot B1) : sur la clé présentée, qui ne change pas ; une
 * clé neuve seulement pour qui n'en présente aucune. Une clé ANONYME qui achète
 * quitte le palier anonyme sans garder de gratuit (ZG1, ZG7) : la réclamer par
 * e-mail d'abord est ce qui garde une allocation mensuelle.
 */
const PACK_LANDING =
  'Prepaid credit packs land on the key you already hold, with credits that never expire: in USDC, ' +
  'POST https://api.ibanforge.com/v1/credits/buy/1k (also 5k, 25k) with that key presented; by card, your human ' +
  'opens the recharge link of that key (under `topup` in GET /v1/keys/usage, and in a 402 served to that key). ' +
  'Nothing to change in your integration. An anonymous key that buys credits leaves the anonymous tier and keeps ' +
  'no free monthly allowance: claim it by e-mail first to keep one. Without a key, a pack is a new key: by card on ' +
  'https://ibanforge.com/pricing, delivered by e-mail, or in USDC with the same route and no key.';

export const CONSENT_LONG = `Getting a key needs no e-mail. POST ${KEY_GENERATE_URL} with no body at all returns an ifk_ key: ${ANONYMOUS_MONTHLY_LIMIT} requests a month in normal operation, no address, no card, nothing to confirm. Nothing is mailed and no CRM or prospect record is opened. Protective limits can reduce the allowance during an alert.

To claim that same key by e-mail, POST ${KEY_CLAIM_URL}. Send the key as "Authorization: Bearer ifk_...", never in the body. The key must have served at least one call. Ask your human: "${CONSENT_ASK}". ${CONSENT_BOUNDARY} POST {"email":"..."} returns 202 and mails a 6-digit code; repeat with {"email":"...","code":"123456"}. This grants ${FREE_TIER_MONTHLY_LIMIT} requests every month.

Already paying? ${PAYMENT_CLAIM} The e-mail code is the recurring free rail. The anonymous key keeps working within its allowance whether it is claimed or not.

Inside an MCP client there is a third door, and it is open: call request_api_key, show the short code and the link to your human, then call poll_api_key. A human approves in a browser, the agent never handles an address, and the key comes back once. Both tools are free and keep answering after the free allowance is spent.

${PACK_LANDING} One further door is planned and NOT available yet: a card checkout opened from the API that returns the key against a secret nonce. Do not look for it until this text says it exists.`;

export const CONSENT_MEDIUM =
  `POST ${KEY_GENERATE_URL} with no body gives an ifk_ key with no e-mail: ${ANONYMOUS_MONTHLY_LIMIT} REST calls/month in normal operation (protective limits may apply). ` +
  `After at least one call, POST ${KEY_CLAIM_URL} with "Authorization: Bearer ifk_...", never the key in the body. ` +
  `Ask: "${CONSENT_ASK}". ${CONSENT_BOUNDARY} ` +
  `An e-mailed 6-digit code grants ${FREE_TIER_MONTHLY_LIMIT} calls every month; ${PAYMENT_CLAIM} ` +
  `Inside an MCP client: call request_api_key, show the code and the link to your human, then poll_api_key — a human approves in a browser, the agent never handles an address, and both tools are free and keep answering once the free allowance is spent. ` +
  `${PACK_LANDING} A card checkout opened from the API is planned, not available yet.`;

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
    // 🚨 Ce rail est DISPONIBLE depuis le 15/09/2026. Il reste décrit comme
    // « pas une réclamation de la clé en main » parce que c'est exactement ce
    // qu'il n'est pas : il ouvre un parcours d'approbation qui FRAPPE une clé
    // neuve, il ne relève pas celle que l'agent tient déjà.
    by_agent_approval:
      'Available inside an MCP client, and it is a separate approval journey, not a claim of an existing key: call request_api_key, show the short code and the link to your human, then call poll_api_key. A human approves in a browser, the agent never handles an address, and the key is handed over exactly once. Both tools are free and keep answering after the free allowance is spent.',
    by_payment: PAYMENT_CLAIM,
  },
  buy_credits_by_card: {
    description:
      'A separate purchase that lands on the key you already hold: the credits recharge it, nothing to change in your integration. Without a key, the pack is a new key.',
    endpoint:
      'The recharge links of your key (under `topup` in GET /v1/keys/usage, and in a 402 served to that key) — or https://ibanforge.com/pricing for a new key (card, paid by your human) — or POST https://api.ibanforge.com/v1/credits/buy/1k in USDC (also 5k, 25k)',
    auth: 'No e-mail needed. A recharge link names the key by a reference, never by the key itself, so the key never enters a URL. The USDC route is paid per call with x402, the key presented as usual. A card checkout opened from the API (POST /v1/keys/checkout) is planned, not available yet: do not call it.',
    human_step:
      'Show your human the recharge link of your key, or https://ibanforge.com/pricing when you hold no key. They enter their own address on Stripe. Treat any key or secret you are handed as a secret: never put it in a URL.',
    collect:
      'A recharge adds credits that never expire to the same key once the payment settles. Without a key, the pack is a SEPARATE key delivered after payment. Collecting it from the API with a secret nonce in the body is planned, not available yet.',
  },
} as const;

export const CONSENT = { CONSENT_ASK, CONSENT_LONG, CONSENT_MEDIUM, CONSENT_SHORT } as const;

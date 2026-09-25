/**
 * Ce que le paquet npm SERT, adapté de textes qu'il partage avec les deux
 * autres surfaces MCP.
 *
 * Le conseil métier reste commun ; l'accès du paquet npm passe par REST,
 * contrairement au serveur distant dont provient le paragraphe de quota.
 *
 * 🚨 24/09/2026 : aucun chiffre de quota n'est écrit ici, et c'est la règle.
 * Un paquet publié est figé jusqu'à la publication suivante, alors que les
 * quotas du service bougent (l'essai sans clé est passé au jour puis à la
 * semaine, l'accès MCP sans clé suit le même soir). Les chiffres du jour se
 * lisent à `rate-limits.yml` et à `GET /v1` ; ce texte y renvoie.
 */

const RATE_LIMITS_URL = 'https://api.ibanforge.com/.well-known/rate-limits.yml';
const CATALOGUE_URL = 'https://api.ibanforge.com/v1';

/**
 * Le passage du texte commun qui parle d'accès et de chiffres : du quota du
 * serveur distant jusqu'au prix des packs compris. Tout ce qui le précède (le
 * conseil de départ) et tout ce qui le suit (retour d'erreur, paiement,
 * recettes) est servi tel quel.
 *
 * Deux ancres plutôt qu'une expression par phrase : le texte commun passe le
 * même soir de « 10 tool calls/IP/day » à une phrase de la semaine, et les deux
 * ancres ne bougent pas avec lui. Si l'une disparaît, le serveur refuse de
 * démarrer et les tests du paquet le disent avant toute publication.
 */
const ACCESS_START = 'Free tier:';
const ACCESS_END = 'Missing data, wrong result, or something blocking you from paying?';

const STDIO_ACCESS =
  'This installed MCP server calls the REST API, not the remote /mcp service. ' +
  'Without a key, validate_iban goes through the REST keyless trial, counted per source address: read the trial block of each answer for what is left and when it resets. ' +
  'The remote /mcp service has its own allowance, separate from this one, which an API key does not increase. ' +
  'For sustained use, POST https://api.ibanforge.com/v1/keys/generate with no body at all — no e-mail, no card, nothing to confirm — and an ifk_ key with its own allowance comes back on the spot. ' +
  'POST https://api.ibanforge.com/v1/keys/claim raises the allowance of that same key — send the key as "Authorization: Bearer ifk_...", not in the body, once it has served at least one call. ' +
  'Two ways: a 6-digit code mailed to an address your human gave you FOR THIS (ask in their words, "Use my address you@company.com to create a free IBANforge key", and never send an address your human has not handed you for this purpose), or an x402 payment made on the key. With the mailed code the larger allowance is renewed with each new period; a payment grants it once, without renewal. ' +
  'Or ask for a durable key with request_api_key then poll_api_key: a human approves in a browser, the agent never handles an address, and both tools keep answering after the free allowance is spent. ' +
  'Prepaid credit packs never expire: one credit per validation or lookup, one per IBAN in a batch. ' +
  `The figures in force are served at ${RATE_LIMITS_URL} and GET ${CATALOGUE_URL}: read them there, not from this text. `;

export function stdioInstructions(shared: string): string {
  const start = shared.indexOf(ACCESS_START);
  const end = shared.indexOf(ACCESS_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      'Le paragraphe d’accès du texte partagé a changé ; adapter les instructions du transport npm.',
    );
  }
  return (
    shared.slice(0, start) +
    STDIO_ACCESS +
    shared.slice(end) +
    ' Configure a saved key as IBANFORGE_API_KEY and reconnect this MCP server; reuse it instead of generating one per call. ' +
    'This package has no wallet and does not sign x402 payments. It relays payment requirements for an x402-capable HTTP client. ' +
    'A result marked _degraded with _scope=format_only has no bank, routing or compliance verdict. ' +
    'On isError, read error, cause, _hint and retry_after; do not infer an invalid account from an unavailable API. Requests are not retried automatically.'
  );
}

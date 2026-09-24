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
  'For sustained use, POST https://api.ibanforge.com/v1/keys/generate with no body at all — no e-mail, no card, nothing to confirm — and an ifk_ key with a monthly allowance comes back on the spot. ' +
  'POST https://api.ibanforge.com/v1/keys/claim raises the monthly allowance of that same key — send the key as "Authorization: Bearer ifk_...", not in the body, once it has served at least one call. ' +
  'Two ways: a 6-digit code mailed to an address your human gave you FOR THIS (ask in their words, "Use my address you@company.com to create a free IBANforge key", and never send an address your human has not handed you for this purpose), or an x402 payment made on the key. With the mailed code the larger allowance renews every month; a payment grants it once. ' +
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

/**
 * Les descriptions d'outils que le paquet partage AU CARACTÈRE PRÈS avec les
 * deux autres surfaces (`scripts/mcp-parity.test.ts`), et qui disent encore
 * « daily » dans la source.
 *
 * 24/09/2026 : ces littéraux ne peuvent pas changer ici tant que leurs jumeaux
 * de `src/mcp/server.ts` et `src/routes/mcp-http.ts` ne changent pas : c'est la
 * PR de l'accès MCP à la semaine (branche `codex/porte-lectrices-20260924`) qui
 * les réécrit, et elle porte les écarts de l'autre côté
 * (`PENDING_NPM_RELEASE`). Pour que le paquet publié entre-temps ne dise pas
 * « daily », le texte SERVI par `tools/list` est corrigé ici, avec la
 * formulation exacte que cette PR donne aux deux autres surfaces.
 *
 * Chaque remplacement lève s'il ne trouve plus sa phrase : le jour où les
 * littéraux sont alignés, le serveur refuse de démarrer, les tests du paquet
 * rougissent, et cette table doit partir avec les `PENDING_NPM_RELEASE`.
 */
const PENDING_SHARED_WORDING: Record<string, ReadonlyArray<readonly [string, string]>> = {
  request_api_key: [
    [
      'USE WHEN: you hit the daily free allowance, a call answers 402,',
      'USE WHEN: you used up the free allowance, a call answers 402,',
    ],
    [
      'This tool is free and does NOT count against the daily free-tier limit — it works even after the limit is reached.',
      'This tool is free and does NOT count against the free allowance — it works even after the allowance is spent.',
    ],
  ],
  poll_api_key: [
    [
      'This tool is free and does NOT count against the daily free-tier limit.',
      'This tool is free and does NOT count against the free allowance.',
    ],
  ],
};

export function stdioTools<T extends { name: string; description?: string }>(
  tools: readonly T[],
): T[] {
  return tools.map((tool) => {
    const pending = PENDING_SHARED_WORDING[tool.name];
    if (!pending) return tool;
    let description = tool.description ?? '';
    for (const [published, served] of pending) {
      if (!description.includes(published)) {
        throw new Error(
          `La description de ${tool.name} ne contient plus « ${published} » ; retirer l’écart de PENDING_SHARED_WORDING.`,
        );
      }
      description = description.split(published).join(served);
    }
    return { ...tool, description };
  });
}

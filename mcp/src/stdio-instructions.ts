/**
 * Le conseil métier reste commun ; l'accès du paquet npm passe par REST,
 * contrairement au serveur distant dont provient le paragraphe de quota.
 */
export function stdioInstructions(shared: string): string {
  const remoteLimit = /Free tier: \d+ tool calls\/IP\/day here, no signup\./;
  if (!remoteLimit.test(shared)) {
    throw new Error(
      'Le paragraphe de quota partagé a changé ; adapter les instructions du transport npm.',
    );
  }
  return (
    shared.replace(
      remoteLimit,
      'This installed MCP server calls the REST API. Eligible calls without a key share the REST daily trial; read the response for remaining quota. The separate remote /mcp service has its own allowance, which an API key does not increase.',
    ) +
    ' Configure a saved key as IBANFORGE_API_KEY and reconnect this MCP server; reuse it instead of generating one per call. ' +
    'This package has no wallet and does not sign x402 payments. It relays payment requirements for an x402-capable HTTP client. ' +
    'A result marked _degraded with _scope=format_only has no bank, routing or compliance verdict. ' +
    'On isError, read error, cause, _hint and retry_after; do not infer an invalid account from an unavailable API. Requests are not retried automatically.'
  );
}

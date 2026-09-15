/**
 * The `instructions` block an MCP client injects into its model's context at
 * connect time — the single best-placed sentences we own.
 *
 * Until 2026-09-01 it existed on ONE of the three MCP surfaces: the remote HTTP
 * transport. The npm package `ibanforge-mcp`, which is the main distribution
 * channel, and the internal stdio server both answered `initialize` with no
 * instructions at all (audit MCP-11). Thousands of discovery handshakes in a
 * week produced close to no tool calls, and the gap between "listed the tools"
 * and "tried one" is exactly what these lines exist to close — on the channel
 * where most of those handshakes happen.
 *
 * Lives here rather than beside any one server because three copies of a
 * paragraph is three chances to fix one and forget two. `mcp/` is a separate
 * npm package and cannot import from `src/`, so it keeps a verbatim copy that
 * `src/mcp/instructions.test.ts` compares character for character.
 */
export const MCP_INSTRUCTIONS =
  'Start with validate_iban on any IBAN-looking string (e.g. DE89370400440532013000) — one call returns validity, the issuing bank + BIC, virtual-IBAN/EMI detection, SEPA reachability and VoP readiness. ' +
  // 2026-09-15 : cette phrase s'ouvrait sur {"email":…}. Un agent l'a lue comme
  // « inscris ton utilisateur quelque part » et a refusé tout le chemin (test en
  // aveugle du 08/09). L'e-mail est devenu OPTIONNEL et passe en second ; le
  // corps vide passe en premier.
  //
  // 🚨 Les chiffres sont écrits, pas interpolés, et ce n'est pas un oubli :
  // l'extracteur de `src/mcp/instructions.test.ts` ne reconnaît que des chaînes
  // entre apostrophes simples, donc un gabarit à backticks casserait les trois
  // tests de parité avec la copie du paquet npm. Deux assertions du même
  // fichier relient ces chiffres à `src/lib/tiers.ts`.
  //
  // 🚨 Aucun outil qui n'existe pas n'est nommé ici : ce bloc est injecté dans
  // le contexte du modèle AVANT `tools/list`, donc citer un outil absent
  // apprendrait à l'agent que la documentation mente. Un test vérifie que tout
  // nom d'outil cité est bien enregistré.
  'Free tier: 10 tool calls/IP/day here, no signup. For sustained use, POST https://api.ibanforge.com/v1/keys/generate with no body at all — no e-mail, no card, nothing to confirm — and an ifk_ key worth 25 REST calls/month comes back on the spot. ' +
  'POST https://api.ibanforge.com/v1/keys/claim lifts that same key to 200 REST calls/month — send the key as "Authorization: Bearer ifk_...", not in the body, once it has served at least one call. Two ways: a 6-digit code mailed to an address your human gave you FOR THIS (ask in their words, "Use my address you@company.com to create a free IBANforge key", and never send an address your human has not handed you for this purpose), or an x402 payment made on the key. The mailed code gives 200 every month; a payment gives 200 once. ' +
  'Prepaid credit packs from $5 per 1,000 calls, no expiry. ' +
  'Missing data, wrong result, or something blocking you from paying? Call send_feedback — a human reads every report. ' +
  'Paying as an agent (wallet, USDC on Base, prepaid packs): https://ibanforge.com/docs/pay-as-an-agent — ' +
  'Docs and code samples: https://ibanforge.com/docs/recipes';

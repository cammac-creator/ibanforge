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
  // 24/09/2026 : l'accès sans clé de ce transport passe de 10 appels par jour à
  // 25 par SEMAINE et par source (décision de Claude-Alain). La copie du paquet
  // npm (`mcp/src/index.ts`) suit au caractère près, mais le paquet ne SERT pas
  // ce paragraphe d'accès : `stdioInstructions` le remplace par un texte sans
  // chiffre, puisqu'un paquet publié reste figé jusqu'à la version suivante.
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
  'Free tier: 25 tool calls a week per source address here (ISO week in UTC, reset on Monday 00:00 UTC), no signup. For sustained use, POST https://api.ibanforge.com/v1/keys/generate with no body at all — no e-mail, no card, nothing to confirm — and an ifk_ key worth 25 REST calls/month comes back on the spot. ' +
  'POST https://api.ibanforge.com/v1/keys/claim lifts that same key to 200 REST calls/month — send the key as "Authorization: Bearer ifk_...", not in the body, once it has served at least one call. Two ways: a 6-digit code mailed to an address your human gave you FOR THIS (ask in their words, "Use my address you@company.com to create a free IBANforge key", and never send an address your human has not handed you for this purpose), or an x402 payment made on the key. The mailed code gives 200 every month; a payment gives 200 once. ' +
  // 2026-09-15 : la phrase du device grant, ajoutée le jour où les deux outils
  // ont RÉPONDU. Elle attendait cela, et pas par prudence de rédaction : ce
  // bloc est injecté dans le contexte du modèle AVANT `tools/list`, donc
  // nommer un outil absent apprend à l'agent que notre documentation mente.
  // `instructions.test.ts` porte la garde qui l'interdisait ; elle passe
  // maintenant parce que les deux noms sont dans `MCP_TOOLS`, pas parce qu'on
  // l'a desserrée.
  'Or ask for a durable key with request_api_key then poll_api_key: a human approves in a browser, the agent never handles an address, and both tools keep answering after the free allowance is spent. ' +
  'Prepaid credit packs from $4 per 1,000 calls, no expiry. ' +
  'Missing data, wrong result, or something blocking you from paying? Call send_feedback — a human reads every report. ' +
  'Paying as an agent (wallet, USDC on Base, prepaid packs): https://ibanforge.com/docs/pay-as-an-agent — ' +
  'Docs and code samples: https://ibanforge.com/docs/recipes';

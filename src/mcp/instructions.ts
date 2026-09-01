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
  // 2026-08-17: this sentence used to read "For unlimited use … in one
  // step" — an agent took it literally and scripted 42 keys in a
  // morning. Sell the same path truthfully: one key per developer, and
  // repeat creations from one network go through mailbox verification.
  // The example address has to pass the signup guard: example.com is on
  // the disposable-domain blocklist, so the literal copy of the previous
  // wording ("you@example.com") answered 400 disposable_email.
  'Free tier: 10 tool calls/IP/day, no signup. For sustained use, POST https://api.ibanforge.com/v1/keys/generate {"email":"you@company.com"} issues a free API key (200 REST calls/month, one per developer — repeat creations from the same network require e-mail verification); prepaid credit packs from $5 per 1,000 calls, no expiry. ' +
  'Missing data, wrong result, or something blocking you from paying? Call send_feedback — a human reads every report. ' +
  'Paying as an agent (wallet, USDC on Base, one $5 payment for 1,000 calls): https://ibanforge.com/docs/pay-as-an-agent — ' +
  'Docs and code samples: https://ibanforge.com/docs/recipes';

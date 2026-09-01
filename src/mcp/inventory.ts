/**
 * The one place that says which tools and which free endpoints exist.
 *
 * ## Why this file exists
 *
 * Audit of 2026-09-01 (DX-01, MCP-05, MCP-12, MCP-16, MCP-18) counted the MCP
 * tool inventory on every surface that publishes it and got FIVE different
 * answers for one product: 8 real tools, 7 on `GET /mcp` and the server card,
 * 7 claimed in prose by `/llms.txt`, 5 in the A2A agent card, 5 in the x402
 * document, and 5 (frozen at version 1.3.3 since 2026-07-03) in the static
 * `frontend/public/.well-known/mcp.json`.
 *
 * That is not five oversights, it is one oversight repeated: the two free
 * tools shipped on 2026-08-26 (`validate_payment_reference`,
 * `check_postal_address`) were wired into all three MCP servers and then into
 * no discovery document at all. They are the only tools that answer without a
 * key and without a payment, so the surfaces an agent reads FIRST were the
 * exact surfaces hiding the two doors it could walk through for free.
 *
 * Every document now derives its list from the table below, so a ninth tool
 * publishes itself everywhere or nowhere. `src/mcp/inventory.test.ts` fails
 * when a document drops one.
 *
 * ## Why counts are never written down
 *
 * "7 tools" and "5 tools" were literals, and a literal beside a moving list
 * always loses. Read the shape instead: `dataTools()` is the seven tools an
 * agent calls for data, and it is derived from `readOnly` rather than from a
 * hand-kept list, because `send_feedback` is the only tool that writes.
 *
 * ## Deliberately NOT the source of the tool schemas
 *
 * The input/output schemas and the long agent-facing descriptions stay in the
 * three MCP servers (`src/routes/mcp-http.ts`, `src/mcp/server.ts`,
 * `mcp/src/index.ts`), which is where a client that has already connected
 * reads them. This table carries only what a DISCOVERY document needs: the
 * name, a human title, the REST route behind the tool, the price, one
 * sentence, and whether the tool writes anything. Keeping it free of schemas
 * is what lets discovery routes import it without pulling in an MCP server.
 */

/** What a tool costs per call, in USDC, or `'free'` when no payment is required. */
export type ToolPrice = number | 'free';

export interface InventoryTool {
  /** The MCP tool name, identical on all three transports. */
  name: string;
  /** Human-readable title, matching the `annotations.title` of the MCP servers. */
  title: string;
  /** The REST route that serves the same answer, in the OpenAPI path spelling. */
  restRoute: string;
  /** USDC price per call, or `'free'`. Batch is priced per IBAN. */
  price: ToolPrice;
  /** One sentence, for documents that have room for a line and not a page. */
  description: string;
  /**
   * `false` only for tools that write. It is the discriminator that separates
   * the data tools from `send_feedback` without anyone counting to seven.
   */
  readOnly: boolean;
  /**
   * The slug this tool answers under in the `capabilities` list of
   * `/.well-known/agents.json`, whose vocabulary is capabilities rather than
   * tool names. `null` for tools a directory should not index as a capability
   * a caller can buy.
   */
  capability: string | null;
}

export const MCP_TOOLS: readonly InventoryTool[] = [
  {
    name: 'validate_iban',
    title: 'Validate IBAN',
    restRoute: 'POST /v1/iban/validate',
    price: 0.005,
    description:
      'Validate one IBAN and enrich it with the issuing bank, BIC, EMI/vIBAN class, SEPA + VoP reachability, risk indicators and Swiss BC-Nummer.',
    readOnly: true,
    capability: 'iban_validation',
  },
  {
    name: 'batch_validate_iban',
    title: 'Batch Validate IBANs',
    restRoute: 'POST /v1/iban/batch',
    price: 0.002,
    description: 'Validate up to 100 IBANs in one call, with the same enrichment as a single validation.',
    readOnly: true,
    capability: 'batch_iban_validation',
  },
  {
    name: 'lookup_bic',
    title: 'Lookup BIC/SWIFT',
    restRoute: 'GET /v1/bic/{code}',
    price: 0.003,
    description:
      'Resolve a BIC/SWIFT code into the institution behind it: legal name, country, city, LEI and registered address where published.',
    readOnly: true,
    capability: 'bic_lookup',
  },
  {
    name: 'check_compliance',
    title: 'Compliance Check',
    restRoute: 'POST /v1/iban/compliance',
    price: 0.02,
    description:
      'Pre-flight compliance triage on an IBAN or a BIC: bank-level sanctions screening, FATF jurisdiction flag, SEPA Instant reachability, VoP participation and a 0-100 risk score.',
    readOnly: true,
    capability: 'sepa_compliance_check',
  },
  {
    name: 'lookup_ch_clearing',
    title: 'Swiss Clearing Lookup',
    restRoute: 'GET /v1/ch/clearing/{iid}',
    price: 0.003,
    description:
      'Resolve a Swiss BC-Nummer / IID into the institution, its seat address, its BIC and its full payment-rail participation including QR-IID.',
    readOnly: true,
    capability: 'swiss_clearing_lookup',
  },
  {
    name: 'validate_payment_reference',
    title: 'Validate Payment Reference',
    restRoute: 'GET|POST /v1/reference/validate',
    price: 'free',
    description:
      'Check a structured payment reference (RF/ISO 11649, Swiss QRR, Belgian OGM/VCS, Finnish viitenumero) against the dated document that publishes its rule.',
    readOnly: true,
    capability: 'payment_reference_validation',
  },
  {
    name: 'check_postal_address',
    title: 'Check ISO 20022 Postal Address',
    restRoute: 'POST /v1/address/check',
    price: 'free',
    description:
      "Check a structured ISO 20022 postal address against one payment rail's published rules (sps, hvps_plus or fedwire), each finding citing its source document.",
    readOnly: true,
    capability: 'postal_address_check',
  },
  {
    // The only tool that writes, hence the only one outside `dataTools()`.
    // It stays out of the server card and the A2A skills on purpose: a
    // directory crawler indexes capabilities a caller can buy, and a feedback
    // inbox is not one of them.
    name: 'send_feedback',
    title: 'Send Feedback to IBANforge',
    restRoute: 'POST /v1/feedback',
    price: 'free',
    description: 'Report incorrect data or claim an x402 refund, without opening an account.',
    readOnly: false,
    capability: null,
  },
];

/**
 * The endpoints that answer with no key, no credit and no payment.
 *
 * `/.well-known/x402` used to advertise only `/v1/demo` plus its own metadata
 * routes, so an agent asking "what can I try before paying?" concluded there
 * was a demo and nothing else (audit 2026-09-01, DX-13 and MCP-18). These six
 * are API endpoints, not documents: the discovery routes add their own
 * metadata paths around them.
 */
export interface FreeEndpoint {
  path: string;
  description: string;
}

export const FREE_ENDPOINTS: readonly FreeEndpoint[] = [
  { path: '/v1/iban/format', description: 'Free IBAN format check (mod-97 + country structure), no auth' },
  { path: '/v1/iban/structure', description: 'Free IBAN structural templates per country, no auth' },
  {
    path: '/v1/reference/validate',
    description: 'Free structured payment reference validation (RF/ISO 11649, Swiss QRR, OGM/VCS, viitenumero), no auth',
  },
  {
    path: '/v1/address/check',
    description: 'Free ISO 20022 postal address conformity check (sps, hvps_plus, fedwire), no auth',
  },
  { path: '/v1/demo', description: 'Free demo with example IBAN/BIC validations' },
  { path: '/v1/credits/bundles', description: 'Free list of prepaid credit bundles' },
];

/**
 * The tools an agent calls to obtain data: everything that does not write.
 *
 * Derived rather than listed, so the seven-versus-eight distinction cannot
 * drift the way the literal "7 tools" did on five surfaces at once.
 */
export function dataTools(): readonly InventoryTool[] {
  return MCP_TOOLS.filter((t) => t.readOnly);
}

/** `$0.005` or `free`, the spelling every description already uses. */
export function priceLabel(price: ToolPrice): string {
  return price === 'free' ? 'free' : `$${price}`;
}

/**
 * The price label of one tool, by name, for prose that quotes a single price.
 *
 * Throws rather than defaulting: a price quoted for a tool that no longer
 * exists is worse than no price at all, because it keeps selling a tool
 * nothing serves. A served document is better absent than confidently wrong.
 */
export function toolPriceLabel(name: string): string {
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`No MCP tool named "${name}" in the inventory`);
  return priceLabel(tool.price);
}

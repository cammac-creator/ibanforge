import { Hono } from 'hono';
import type { Handler } from 'hono';
import { datasetFacts } from '../lib/dataset-facts.js';
import { PAYMENT_LINKS, PRICING_PAGE } from '../lib/payment-links.js';

/** Dataset sizes, read once and rounded down so a claim cannot outlive its data. */
const F = datasetFacts();


const discovery = new Hono();

// USDC contract on Base L2
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NETWORK = 'base';
const NETWORK_CHAIN_ID = 'eip155:8453';

interface PricedEndpoint {
  method: string;
  /** The route template, which is what documents the shape of the URL. */
  path: string;
  /**
   * A concrete URL for the x402 `resource` field, required wherever `path`
   * carries a parameter.
   *
   * The catalogue used to advertise the template itself, so an agent following
   * the listing called /v1/bic/:code literally, the route read ":code" as a BIC
   * and answered 400 — the agent never reached the 402 and could neither learn
   * the price nor pay. Two of five priced resources were unbuyable that way
   * from May to 30/07/2026, and x402-observer, a public trust monitor, scored
   * us on it the whole time.
   *
   * Safe to change: the paywall middleware builds the resource it demands from
   * the URL actually requested, never from this document. Verified against
   * production — GET /v1/bic/DEUTDEFF answers 402 quoting itself as the
   * resource — so a client paying for a different BIC is unaffected.
   */
  examplePath?: string;
  price_usdc: number;
  description: string;
  price_note?: string;
}

const PAID_ENDPOINTS: PricedEndpoint[] = [
  {
    method: 'POST',
    path: '/v1/iban/validate',
    price_usdc: 0.005,
    description: 'Validate single IBAN with BIC lookup, SEPA data, issuer classification',
  },
  {
    method: 'POST',
    path: '/v1/iban/batch',
    price_usdc: 0.002,
    price_note: 'per IBAN, billed dynamically (1 IBAN = $0.002, 100 = $0.20)',
    description: 'Validate up to 100 IBANs in one call',
  },
  {
    method: 'GET',
    path: '/v1/bic/:code',
    examplePath: '/v1/bic/DEUTDEFF',
    price_usdc: 0.003,
    description: 'Lookup BIC/SWIFT code with LEI enrichment',
  },
  {
    method: 'POST',
    path: '/v1/iban/compliance',
    price_usdc: 0.02,
    description: 'Pre-payout screening — check the bank behind a counterparty IBAN before you send funds: validation + sanctions screening (OFAC) + SEPA Instant reachability + VoP participant + risk score (0-100)',
  },
  {
    method: 'GET',
    path: '/v1/ch/clearing/:iid',
    examplePath: '/v1/ch/clearing/100',
    price_usdc: 0.003,
    description: `Swiss BC-Nummer / IID clearing lookup with SIC, euroSIC, Instant Payments and QR-IID data (${F.claim.chClearing} SIX entries, refreshed monthly)`,
  },
];

function buildAccepts(endpoint: PricedEndpoint, walletAddress: string) {
  // x402 v0.1 spec: amount in atomic units. USDC has 6 decimals.
  const atomicAmount = Math.round(endpoint.price_usdc * 1_000_000).toString();
  return [
    {
      scheme: 'exact',
      network: NETWORK,
      maxAmountRequired: atomicAmount,
      resource: `https://api.ibanforge.com${endpoint.examplePath ?? endpoint.path}`,
      description: endpoint.description,
      mimeType: 'application/json',
      payTo: walletAddress,
      maxTimeoutSeconds: 60,
      asset: USDC_BASE,
      extra: { name: 'USDC', version: '2' },
    },
  ];
}

// ──────────────────────────────────────────────────────────────────────────────
// /.well-known/x402 — primary x402 discovery endpoint (machine-readable)
// ──────────────────────────────────────────────────────────────────────────────

// The `.json` suffix is what agent-tools.cloud, agent-discover-indexer and
// three others reach for: 457 hits over the ninety days to 30/07. Same handler
// rather than a redirect, because an x402 client that follows a 301 on its
// discovery document is not guaranteed to keep reading.
const x402Document: Handler = (c) => {
  const walletAddress = process.env.WALLET_ADDRESS ?? '0x0000000000000000000000000000000000000000';

  return c.json({
    x402Version: 1,
    name: 'IBANforge',
    description:
      `IBAN validation, BIC/SWIFT lookup, Swiss clearing & compliance API. ${F.claim.bic} BIC entries (${F.claim.lei} LEI-enriched via GLEIF), ${F.claim.chClearing} Swiss BC-Nummer from SIX, 89 countries, 85 EMI/vIBAN issuer classifications, refreshed monthly.`,
    homepage: 'https://ibanforge.com',
    documentation: 'https://ibanforge.com/docs',
    pricing: 'https://ibanforge.com/pricing',
    openapi: 'https://api.ibanforge.com/openapi.json',
    network: NETWORK,
    chain_id: NETWORK_CHAIN_ID,
    asset: {
      address: USDC_BASE,
      symbol: 'USDC',
      decimals: 6,
      name: 'USD Coin',
    },
    pay_to: walletAddress,
    facilitator: process.env.FACILITATOR_URL || 'https://x402.org/facilitator',
    endpoints: PAID_ENDPOINTS.map((ep) => ({
      ...ep,
      atomic_amount: Math.round(ep.price_usdc * 1_000_000).toString(),
      accepts: buildAccepts(ep, walletAddress),
    })),
    free_endpoints: [
      { path: '/v1/demo', description: 'Free demo with example IBAN/BIC validations' },
      { path: '/health', description: 'Health check' },
      { path: '/openapi.json', description: 'OpenAPI 3.1 specification' },
      { path: '/.well-known/x402', description: 'This document' },
      { path: '/.well-known/agents.json', description: 'Agent discovery (A2A spec)' },
    ],
    mcp: {
      http_url: 'https://api.ibanforge.com/mcp',
      stdio: { command: 'npx', args: ['ibanforge-mcp'] },
      tools: ['validate_iban', 'batch_validate_iban', 'lookup_bic', 'check_compliance', 'lookup_ch_clearing'],
    },
    auth: {
      api_key: {
        scheme: 'bearer',
        token_prefix: 'ifk_',
        signup: 'POST /v1/keys/generate with body {"email":"you@example.com"}',
        free_tier_quota: 200,
        free_tier_period: 'month',
      },
      x402: {
        scheme: 'exact',
        protocol: 'x402',
        version: 1,
        docs: 'https://x402.org',
      },
    },
  });
};

discovery.get('/.well-known/x402', x402Document);
discovery.get('/.well-known/x402.json', x402Document);

// ──────────────────────────────────────────────────────────────────────────────
// /.well-known/oauth-protected-resource — RFC 9728 (MCP OAuth discovery)
// MCP spec 2025-03-26+ clients query this. Returning 404 makes them give up.
// We don't require OAuth (we use API keys + x402), so we return minimal metadata
// that points clients to the actual auth methods.
// ──────────────────────────────────────────────────────────────────────────────

const oauthResourceMetadata = {
  resource: 'https://api.ibanforge.com',
  resource_documentation: 'https://ibanforge.com/docs',
  bearer_methods_supported: ['header'],
  // No OAuth required. Use API key (Bearer ifk_*) or x402 payment.
  authentication_methods: [
    {
      type: 'api_key',
      description: 'Free tier: 200 requests/month. POST /v1/keys/generate to obtain.',
      docs: 'https://ibanforge.com/docs',
    },
    {
      type: 'x402',
      description: 'Pay-per-call USDC micropayments on Base L2.',
      docs: 'https://api.ibanforge.com/.well-known/x402',
    },
  ],
};

discovery.get('/.well-known/oauth-protected-resource', (c) => c.json(oauthResourceMetadata));
discovery.get('/.well-known/oauth-protected-resource/mcp', (c) =>
  c.json({ ...oauthResourceMetadata, resource: 'https://api.ibanforge.com/mcp' }),
);

// RFC 9728 inserts the well-known segment before the resource path, which the
// route above already serves. Plenty of MCP clients append it instead, and on
// 2026-07-28 that spelling was requested 1,021 times by 90 distinct IPs and
// answered 404. A 404 there is worse than unhelpful: the client cannot tell
// "this server needs no OAuth" from "this server is broken".
discovery.get('/mcp/.well-known/oauth-protected-resource', (c) =>
  c.json({ ...oauthResourceMetadata, resource: 'https://api.ibanforge.com/mcp' }),
);

// We deliberately do NOT serve /.well-known/oauth-authorization-server. There
// is no authorization server; a 404 is the correct RFC 8414 signal and lets a
// client fall through to the API-key or x402 path advertised above.

// ──────────────────────────────────────────────────────────────────────────────
// /.well-known/agents.json — A2A agent discovery (emerging standard).
// Served at the canonical path and at the agent.json / agents.json /
// agent-directory.json aliases that directory crawlers request
// (~182 hits/month previously landed in 404). The singular agent.json alias
// intentionally serves the same A2A manifest — better than a 404.
// ──────────────────────────────────────────────────────────────────────────────

const AGENT_MANIFEST = {
  schema_version: 'v1',
  name: 'IBANforge',
  description:
    'Pre-payout compliance screening for autonomous agents — check the bank behind a counterparty IBAN before you send funds: validation, sanctions, Swiss clearing, SEPA/VoP reachability and risk scoring.',
  url: 'https://ibanforge.com',
  contact: 'https://github.com/cammac-creator/ibanforge',
  capabilities: [
    'iban_validation',
    'bic_lookup',
    'swift_lookup',
    'swiss_clearing_lookup',
    'sepa_compliance_check',
    'sanctions_screening',
    'vop_check',
    'emi_classification',
    'viban_detection',
    'country_risk_scoring',
  ],
  payment: {
    protocol: 'x402',
    network: NETWORK,
    asset: USDC_BASE,
    discovery: 'https://api.ibanforge.com/.well-known/x402',
  },
  interfaces: [
    { type: 'rest', url: 'https://api.ibanforge.com', spec: 'https://api.ibanforge.com/openapi.json' },
    { type: 'mcp', transport: 'http', url: 'https://api.ibanforge.com/mcp' },
    { type: 'mcp', transport: 'stdio', package: 'ibanforge-mcp' },
  ],
};

for (const path of [
  '/.well-known/agents.json',
  '/.well-known/agent.json',
  '/agents.json',
  '/agent-directory.json',
  // Measured 2026-07-28 in production request_log, all previously 404:
  //   /.well-known/agent-card.json      411 hits / 104 distinct IPs
  //   /.well-known/agent-directory.json 253 hits /   3 distinct IPs
  // agent-card.json is the A2A spelling most crawlers reach for, and it was
  // the single largest agent-discovery 404 on the service.
  '/.well-known/agent-card.json',
  '/.well-known/agent-directory.json',
]) {
  discovery.get(path, (c) => c.json(AGENT_MANIFEST));
}

// /agents.txt — plain-text discovery index (llms.txt-style), requested by
// directory crawlers (~53 hits/month previously landed in 404).
const AGENTS_TXT = `# IBANforge — agent & API discovery

IBAN validation, BIC/SWIFT lookup, Swiss clearing and compliance risk
scoring API, built for AI agents and developers.

## Discovery endpoints
- Agent manifest (A2A): https://api.ibanforge.com/.well-known/agents.json
- MCP server card:      https://api.ibanforge.com/.well-known/mcp/server-card.json
- OpenAPI 3.1:          https://api.ibanforge.com/openapi.json
- x402 payment:         https://api.ibanforge.com/.well-known/x402
- MCP server (HTTP):    https://api.ibanforge.com/mcp

## Full agent guide
https://api.ibanforge.com/llms.txt
`;

discovery.get('/agents.txt', (c) =>
  c.text(AGENTS_TXT, 200, { 'Content-Type': 'text/plain; charset=utf-8' }),
);

// ──────────────────────────────────────────────────────────────────────────────
// /.well-known/glama.json — the manifest glama.ai fetches to (re)ingest a
// server. It was requested 181 times by 45 distinct IPs on 2026-07-28 and
// answered 404, while glama's own API still served `tools: []` and a frozen
// "39K+ entries / 75+ countries" description that has since been observed
// resurfacing inside AI-written summaries of the product.
//
// The repository ships a glama.json at its root, but that file is static and
// its counts are hardcoded — which the project CLAUDE.md forbids for anything
// actually served. The served copy therefore derives every figure from the
// live dataset instead.
// ──────────────────────────────────────────────────────────────────────────────

const GLAMA_MANIFEST = {
  $schema: 'https://glama.ai/mcp/schemas/server.json',
  maintainers: ['cammac-creator'],
  name: 'IBANforge',
  description:
    `Check the bank behind a counterparty IBAN before you send funds: IBAN validation, BIC/SWIFT lookup, ` +
    `Swiss BC-Nummer clearing with payment-rail participation, sanctions screening (OFAC) ` +
    `at bank level, SEPA and VoP reachability, and a 0-100 risk score. ` +
    `${F.claim.bic} BIC entries (${F.claim.lei} LEI-enriched via GLEIF; further rows from the ` +
    `SWIFT directory, Bundesbank, SIX and EBA STEP2 SCT), ${F.claim.chClearing} Swiss clearing ` +
    `entries from the SIX BankMaster refreshed monthly, ${F.claim.countries} countries. ` +
    `MCP-native over HTTP and stdio, x402 micropayments on Base L2, free tier.`,
  homepage: 'https://ibanforge.com',
  repository: 'https://github.com/cammac-creator/ibanforge',
  documentation: 'https://ibanforge.com/docs/mcp',
  categories: ['finance', 'compliance', 'data-validation', 'banking'],
  keywords: [
    'iban', 'bic', 'swift', 'sepa', 'vop', 'swiss-clearing', 'bc-nummer',
    'qr-iid', 'fintech', 'compliance', 'risk-scoring', 'x402', 'micropayments', 'mcp',
  ],
  tools: [
    { name: 'validate_iban', description: 'Validate a single IBAN with BIC, SEPA, issuer and risk data ($0.005)' },
    { name: 'batch_validate_iban', description: 'Validate up to 100 IBANs in one call ($0.002 each)' },
    { name: 'lookup_bic', description: `Look up a BIC/SWIFT code against ${F.claim.bic} entries ($0.003)` },
    { name: 'check_compliance', description: 'Sanctions (OFAC) at bank level + FATF + SEPA reachability + VoP + risk score ($0.02)' },
    { name: 'lookup_ch_clearing', description: `Look up a Swiss BC-Nummer / IID with SIC, euroSIC, CHF instant, QR-IID and institution type — ${F.claim.chClearing} entries from the SIX BankMaster ($0.003)` },
  ],
} as const;

discovery.get('/.well-known/glama.json', (c) => c.json(GLAMA_MANIFEST));

// /.well-known/security.txt — RFC 9116. Probed by 16 distinct IPs; several
// directory scorers treat its absence as a maturity signal.
const SECURITY_TXT = `Contact: mailto:security@ibanforge.com
Preferred-Languages: en, fr, de
Canonical: https://api.ibanforge.com/.well-known/security.txt
Policy: https://ibanforge.com/docs
`;

discovery.get('/.well-known/security.txt', (c) =>
  c.text(SECURITY_TXT, 200, { 'Content-Type': 'text/plain; charset=utf-8' }),
);

// ──────────────────────────────────────────────────────────────────────────────
// Dead Stripe placeholders. The landing page shipped literal
// href="STRIPE_PAYMENT_LINK_*" anchors between 2026-05-12 and 2026-06-19,
// rewritten only by client-side JS — which crawlers never run. The HTML is
// fixed, but the URLs live on in caches: on 2026-07-28 the three paths were
// still drawing ~90 distinct IPs each. A 301 both rescues that traffic and
// tells the indexes holding the bad URL where the real one is.
// ──────────────────────────────────────────────────────────────────────────────

for (const [suffix, bundle] of [['1K', '1k'], ['5K', '5k'], ['25K', '25k']] as const) {
  discovery.get(`/STRIPE_PAYMENT_LINK_${suffix}`, (c) => c.redirect(PAYMENT_LINKS[bundle], 301));
}

// www-only pages probed on the api host. Claude Code fetched /pricing and
// /en/docs here and got 404 while ibanforge.com serves both; /docs already
// redirected, these did not. Measured on Claude-User traffic, 2026-07-28.
discovery.get('/pricing', (c) => c.redirect(PRICING_PAGE, 302));
for (const lang of ['en', 'de', 'fr']) {
  discovery.get(`/${lang}/docs`, (c) => c.redirect(`https://ibanforge.com/${lang}/docs`, 302));
}

// ──────────────────────────────────────────────────────────────────────────────
// Second sweep of the same log, 2026-07-29. The first pass filtered out
// anything resembling a scanner probe and threw the baby out with it.
// ──────────────────────────────────────────────────────────────────────────────

// Sibling of the oauth probe fixed above: clients that append the well-known
// segment to /mcp ask for both. 1,021 hits / 90 distinct IPs.
discovery.get('/mcp/.well-known/mcp', (c) =>
  c.json({
    name: 'IBANforge',
    url: 'https://api.ibanforge.com/mcp',
    transport: 'streamable-http',
    server_card: 'https://api.ibanforge.com/.well-known/mcp/server-card.json',
  }),
);

// OpenAPI under the two names tooling reaches for besides /openapi.json.
// 13 and 9 distinct IPs.
discovery.get('/swagger.json', (c) => c.redirect('/openapi.json', 301));
discovery.get('/api/openapi.json', (c) => c.redirect('/openapi.json', 301));

// /sse is the pre-streamable MCP transport; /mcp. is a client-side bug that
// leaves the trailing dot on. 14 and 23 distinct IPs. 308 keeps the method, so
// a JSON-RPC POST survives the hop instead of degrading to GET.
discovery.get('/sse', (c) => c.redirect('/mcp', 308));
discovery.all('/mcp.', (c) => c.redirect('/mcp', 308));

// Not agent discovery, but the two largest plain 404s on the service: 366 and
// 36 distinct IPs. Both exist on the www host.
discovery.get('/favicon.ico', (c) => c.redirect('https://ibanforge.com/favicon.ico', 301));
discovery.get('/sitemap.xml', (c) => c.redirect('https://ibanforge.com/sitemap.xml', 301));

// ──────────────────────────────────────────────────────────────────────────────
// Third sweep, 2026-07-30, read off the Clients Bot tab: what the first two
// passes left. Counts are hits over the ninety days to 30/07.
// ──────────────────────────────────────────────────────────────────────────────

// The largest single 404 left on the service, and it was never a missing page:
// APIHub-HealthCheck POSTs the API root, 3,469 times. 404 tells a health
// checker the API is not there; 405 with Allow tells it the API is there and
// the verb was wrong, which is what actually happened. GET and HEAD fall
// through to the landing page, which is mounted after this router.
discovery.on(['POST', 'PUT', 'PATCH', 'DELETE'], '/', (c) =>
  c.json(
    { error: 'method_not_allowed', message: 'The API root answers GET and HEAD. See /openapi.json for the endpoints.' },
    405,
    { Allow: 'GET, HEAD' },
  ),
);

// RFC 9116 puts security.txt under /.well-known; a copy at the root would be a
// second thing to keep in step with the first. 83 hits, one scanner.
discovery.get('/security.txt', (c) => c.redirect('/.well-known/security.txt', 301));

// Clients that assume every API lives under /api. 308 keeps the method, so a
// JSON-RPC POST survives. 76 hits across five agents.
discovery.all('/api/mcp', (c) => c.redirect('/mcp', 308));

// NOT served, deliberately: /.well-known/oauth-authorization-server and its
// /mcp sibling, 1,164 hits from aisec-registry. RFC 8414 metadata describes an
// OAuth authorization server, and we do not run one — authentication here is an
// API key or an x402 payment, which is what the protected-resource document
// already says. Publishing a document there would misrepresent us to a security
// registry. 404 is the honest answer and it stays.

export { discovery };

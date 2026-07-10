import { Hono } from 'hono';

const discovery = new Hono();

// USDC contract on Base L2
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NETWORK = 'base';
const NETWORK_CHAIN_ID = 'eip155:8453';

interface PricedEndpoint {
  method: string;
  path: string;
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
    price_usdc: 0.003,
    description: 'Lookup BIC/SWIFT code with LEI enrichment',
  },
  {
    method: 'POST',
    path: '/v1/iban/compliance',
    price_usdc: 0.02,
    description: 'Pre-payout screening — vet a counterparty IBAN before you send funds: validation + sanctions screening (OFAC/EU/UN) + SEPA Instant reachability + VoP participant + risk score (0-100)',
  },
  {
    method: 'GET',
    path: '/v1/ch/clearing/:iid',
    price_usdc: 0.003,
    description: 'Swiss BC-Nummer / IID clearing lookup with SIC, euroSIC, Instant Payments and QR-IID data (~1,200 SIX entries, refreshed monthly)',
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
      resource: `https://api.ibanforge.com${endpoint.path}`,
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

discovery.get('/.well-known/x402', (c) => {
  const walletAddress = process.env.WALLET_ADDRESS ?? '0x0000000000000000000000000000000000000000';

  return c.json({
    x402Version: 1,
    name: 'IBANforge',
    description:
      'IBAN validation, BIC/SWIFT lookup, Swiss clearing & compliance API. 121k+ BIC entries (38k+ LEI-enriched via GLEIF), ~1,200 Swiss BC-Nummer from SIX, 89 countries, 85 EMI/vIBAN issuer classifications, refreshed monthly.',
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
});

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
    'Pre-payout compliance screening for autonomous agents — vet a counterparty IBAN before you send funds: validation, sanctions, Swiss clearing, SEPA/VoP reachability and risk scoring.',
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

export { discovery };

import { Hono } from 'hono';

const discovery = new Hono();

const x402Discovery = {
  name: 'IBANforge',
  description: 'IBAN validation, BIC/SWIFT lookup & compliance API with sanctions screening and risk scoring',
  endpoints: [
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
      price_note: 'per IBAN, max 100 IBANs per batch ($0.20 max)',
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
      description: 'Full compliance check: IBAN validation + sanctions screening (OFAC/EU/UN) + SEPA Instant reachability + VoP participant + risk score (0-100)',
    },
  ],
  free_endpoints: ['/v1/demo', '/health', '/stats', '/openapi.json'],
  mcp: {
    command: 'npx',
    args: ['tsx', 'src/mcp/server.ts'],
  },
  docs: 'https://ibanforge.com/docs',
  pricing: 'https://ibanforge.com/pricing',
};

discovery.get('/.well-known/x402', (c) => {
  return c.json(x402Discovery);
});

export { discovery };

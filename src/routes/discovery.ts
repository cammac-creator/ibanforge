import { Hono } from 'hono';

const discovery = new Hono();

const x402Discovery = {
  name: 'IBANforge',
  description: 'IBAN validation & BIC/SWIFT lookup API',
  endpoints: [
    {
      method: 'POST',
      path: '/v1/iban/validate',
      price_usdc: 0.005,
      description: 'Validate single IBAN',
    },
    {
      method: 'POST',
      path: '/v1/iban/batch',
      price_usdc: 0.02,
      description: 'Validate up to 100 IBANs',
    },
    {
      method: 'GET',
      path: '/v1/bic/:code',
      price_usdc: 0.003,
      description: 'Lookup BIC/SWIFT code',
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
